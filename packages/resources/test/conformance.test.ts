import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asResourceId,
  asWorkerId,
  createInMemoryResourceStore,
  type QuotaScope,
  type QuotaScopeKind,
  type Reservation,
  type ResourceClaim,
  type ResourceEvent,
  type ResourceStore,
} from "../src/index.js";

interface ScenarioFile {
  readonly store: {
    readonly reservationTtlMs: number;
    readonly inUseTtlMs: number | null;
  };
  readonly quotas: readonly JsonQuota[];
  readonly claimScopes: readonly JsonScope[];
  readonly scenarios: readonly Scenario[];
}

interface JsonScope {
  readonly kind: QuotaScopeKind;
  readonly key: string;
}

interface JsonQuota extends JsonScope {
  readonly maxCount: number;
  readonly maxBytes: number;
}

interface Scenario {
  readonly name: string;
  readonly steps: readonly Step[];
}

type Step =
  | {
      readonly op: "reserve";
      readonly operation: string;
      readonly sizeBytes: number;
      readonly ttlMs?: number;
      readonly now?: number;
      readonly expect?: string;
    }
  | {
      readonly op: "allocate";
      readonly reservation: number;
      readonly resource: string;
      readonly operation: string;
      readonly now: number;
    }
  | {
      readonly op: "release-requested";
      readonly reservation: number;
      readonly operation: string;
      readonly now: number;
    }
  | {
      readonly op: "released" | "release-failed";
      readonly reservation: number;
      readonly resource: string;
      readonly operation: string;
      readonly now: number;
    }
  | {
      readonly op: "outcome-unknown";
      readonly reservation: number;
      readonly operation: string;
      readonly now: number;
    }
  | {
      readonly op: "isolate";
      readonly reservation: number;
      readonly operation: string;
      readonly now: number;
    }
  | {
      readonly op: "worker-stopped";
      readonly confirmed: readonly string[];
      readonly operation: string;
      readonly now: number;
    }
  | { readonly op: "expire"; readonly now: number }
  | {
      readonly op: "assert";
      readonly reservation?: number;
      readonly state?: string;
      readonly usedCount?: number;
    };

const scenarioFile = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../specs/lifecycle-scenarios.json", import.meta.url)),
    "utf8",
  ),
) as ScenarioFile;
const workerId = asWorkerId("conformance-worker");
const bootId = asBootId("conformance-boot");

function operation(value: string) {
  return asOperationId(value);
}

function stepNow(step: Step): number {
  return "now" in step && step.now !== undefined ? step.now : 0;
}

function reservationAt(reservations: readonly Reservation[], index: number): Reservation {
  const reservation = reservations[index];
  if (reservation === undefined) {
    throw new Error(`reservation ${index} is missing`);
  }
  return reservation;
}

function ensureReserved(result: Awaited<ReturnType<ResourceStore["reserve"]>>): Reservation {
  if (result.status !== "reserved") {
    throw new Error(`reservation was rejected: ${result.reason}`);
  }
  return result.reservation;
}

function baseEvent(step: { readonly operation: string; readonly now: number }): {
  operationId: ReturnType<typeof asOperationId>;
  at: number;
} {
  return { operationId: operation(step.operation), at: step.now };
}

describe.each(scenarioFile.scenarios)("共通シナリオ: $name", ({ steps }) => {
  test("TypeScript 実装が期待する状態と計上を満たす", async () => {
    const store = createInMemoryResourceStore({
      reservationTtlMs: scenarioFile.store.reservationTtlMs,
      ...(scenarioFile.store.inUseTtlMs === null
        ? {}
        : { inUseTtlMs: scenarioFile.store.inUseTtlMs }),
    });
    for (const quota of scenarioFile.quotas) {
      await store.setQuotaLimit({
        scope: { kind: quota.kind, key: quota.key },
        maxCount: quota.maxCount,
        maxBytes: quota.maxBytes,
      });
    }

    const reservations: Reservation[] = [];
    for (const step of steps) {
      const now = stepNow(step);
      switch (step.op) {
        case "reserve": {
          const claim: ResourceClaim = {
            scopes: scenarioFile.claimScopes,
            sizeBytes: step.sizeBytes,
            ...(step.ttlMs === undefined ? {} : { ttlMs: step.ttlMs }),
          };
          const result = await store.reserve(claim, operation(step.operation), now);
          if (step.expect !== undefined) {
            expect(result).toMatchObject({ status: "rejected", reason: step.expect });
          } else {
            reservations.push(ensureReserved(result));
          }
          break;
        }
        case "allocate": {
          const reservation = reservationAt(reservations, step.reservation);
          await store.applyEvent(
            {
              type: "allocated",
              reservationId: reservation.id,
              resourceId: asResourceId(step.resource),
              workerId,
              bootId,
              ...baseEvent(step),
            },
            now,
          );
          break;
        }
        case "release-requested": {
          const reservation = reservationAt(reservations, step.reservation);
          await store.applyEvent(
            {
              type: "release-requested",
              reservationId: reservation.id,
              ...baseEvent(step),
            },
            now,
          );
          break;
        }
        case "released":
        case "release-failed": {
          const reservation = reservationAt(reservations, step.reservation);
          const event: ResourceEvent = {
            type: step.op,
            reservationId: reservation.id,
            resourceId: asResourceId(step.resource),
            workerId,
            bootId,
            ...baseEvent(step),
          };
          await store.applyEvent(event, now);
          break;
        }
        case "outcome-unknown": {
          const reservation = reservationAt(reservations, step.reservation);
          await store.applyEvent(
            {
              type: "outcome-unknown",
              reservationId: reservation.id,
              ...baseEvent(step),
            },
            now,
          );
          break;
        }
        case "isolate": {
          const reservation = reservationAt(reservations, step.reservation);
          await store.applyEvent(
            {
              type: "isolate",
              reservationId: reservation.id,
              ...baseEvent(step),
            },
            now,
          );
          break;
        }
        case "worker-stopped": {
          const result = await store.applyEvent(
            {
              type: "worker-stopped",
              workerId,
              bootId,
              confirmedResourceIds: step.confirmed.map(asResourceId),
              ...baseEvent(step),
            },
            now,
          );
          if (result.status !== "reconciliation-started") {
            throw new Error("reconciliation did not start");
          }
          let cursor = 0;
          for (;;) {
            const batch = await store.continueReconciliation(result.job.id, { cursor }, now);
            if (!batch.hasMore) {
              break;
            }
            if (batch.nextCursor === undefined) {
              throw new Error("reconciliation cursor is missing");
            }
            cursor = batch.nextCursor;
          }
          break;
        }
        case "expire": {
          await store.expire(now);
          break;
        }
        case "assert": {
          if (step.reservation !== undefined && step.state !== undefined) {
            const reservation = reservationAt(reservations, step.reservation);
            expect(await store.getReservation(reservation.id)).toMatchObject({
              state: step.state,
            });
          }
          if (step.usedCount !== undefined) {
            const serverScope = scenarioFile.claimScopes.find((scope) => scope.kind === "server");
            if (serverScope === undefined) {
              throw new Error("server scope is missing");
            }
            expect(await store.getQuotaUsage(serverScope as QuotaScope)).toMatchObject({
              usedCount: step.usedCount,
            });
          }
          break;
        }
      }
    }
  });
});
