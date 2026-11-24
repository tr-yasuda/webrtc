import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asResourceId,
  asWorkerId,
  createInMemoryResourceStore,
  type InMemoryResourceStore,
  type ReservationId,
  type Reservation,
  type ResourceEvent,
  type QuotaScope,
} from "../src/index.js";

const scope: QuotaScope = { kind: "server", key: "property-server" };
const workerId = asWorkerId("property-worker");
const bootId = asBootId("property-boot");
const maxCount = 3;

type ActionKind = "reserve" | "allocate" | "request-release" | "release" | "outcome-unknown";

const action = fc.record({
  kind: fc.constantFrom<ActionKind>(
    "reserve",
    "allocate",
    "request-release",
    "release",
    "outcome-unknown",
  ),
  index: fc.nat(5),
});

async function listAllReservations(store: InMemoryResourceStore): Promise<Reservation[]> {
  const reservations: Reservation[] = [];
  let cursor: ReservationId | undefined;
  for (;;) {
    const page = await store.listReservationsPage(
      {},
      { limit: 2, ...(cursor === undefined ? {} : { cursor }) },
    );
    reservations.push(...page.reservations);
    if (page.nextCursor === undefined) {
      return reservations;
    }
    cursor = page.nextCursor;
  }
}

async function assertAccounting(store: InMemoryResourceStore): Promise<void> {
  const reservations = await listAllReservations(store);
  const counted = reservations.filter((reservation) => reservation.state !== "released");
  const usage = await store.getQuotaUsage(scope);

  expect(usage?.usedCount).toBe(counted.length);
  expect(usage?.usedBytes).toBe(
    counted.reduce((total, reservation) => total + reservation.sizeBytes, 0),
  );
  expect(counted.length).toBeLessThanOrEqual(maxCount);
  expect(usage?.usedCount).toBeGreaterThanOrEqual(0);
  expect(usage?.usedBytes).toBeGreaterThanOrEqual(0);
}

async function chooseReservation(
  store: InMemoryResourceStore,
  index: number,
  predicate: (reservation: Reservation) => boolean,
): Promise<Reservation | undefined> {
  const reservations = (await listAllReservations(store)).filter(predicate);
  return reservations.length === 0 ? undefined : reservations[index % reservations.length];
}

describe("資源状態のプロパティ", () => {
  test("任意の操作列でも計上と状態の不変条件を保つ", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { maxLength: 30 }), async (actions) => {
        const store = createInMemoryResourceStore({ reservationTtlMs: 10_000 });
        await store.setQuotaLimit({ scope, maxCount, maxBytes: 10 });
        let operationNumber = 0;
        let resourceNumber = 0;
        let now = 0;

        const nextOperation = () => asOperationId(`operation-${operationNumber++}`);
        const nextResource = () => asResourceId(`resource-${resourceNumber++}`);

        for (const current of actions) {
          now += 1;
          switch (current.kind) {
            case "reserve": {
              await store.reserve({ scopes: [scope], sizeBytes: 1 }, nextOperation(), now);
              break;
            }
            case "allocate": {
              const reservation = await chooseReservation(
                store,
                current.index,
                (candidate) => candidate.resourceId === undefined,
              );
              if (reservation !== undefined) {
                await store.applyEvent(
                  {
                    type: "allocated",
                    reservationId: reservation.id,
                    resourceId: nextResource(),
                    workerId,
                    bootId,
                    operationId: nextOperation(),
                    at: now,
                  },
                  now,
                );
              }
              break;
            }
            case "request-release": {
              const reservation = await chooseReservation(
                store,
                current.index,
                (candidate) => candidate.state === "in-use",
              );
              if (reservation !== undefined) {
                await store.applyEvent(
                  {
                    type: "release-requested",
                    reservationId: reservation.id,
                    operationId: nextOperation(),
                    at: now,
                  },
                  now,
                );
              }
              break;
            }
            case "release": {
              const reservation = await chooseReservation(
                store,
                current.index,
                (candidate) => candidate.resourceId !== undefined && candidate.state !== "released",
              );
              if (reservation?.resourceId !== undefined) {
                const event: ResourceEvent = {
                  type: "released",
                  reservationId: reservation.id,
                  resourceId: reservation.resourceId,
                  workerId,
                  bootId,
                  operationId: nextOperation(),
                  at: now,
                };
                await store.applyEvent(event, now);
                await store.applyEvent(event, now);
              }
              break;
            }
            case "outcome-unknown": {
              const reservation = await chooseReservation(
                store,
                current.index,
                (candidate) => candidate.state !== "released",
              );
              if (reservation !== undefined) {
                await store.applyEvent(
                  {
                    type: "outcome-unknown",
                    reservationId: reservation.id,
                    operationId: nextOperation(),
                    at: now,
                  },
                  now,
                );
              }
              break;
            }
          }

          await assertAccounting(store);
        }
      }),
      { numRuns: 60 },
    );
  });
});
