import { and, asc, eq, gt, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { monotonicFactory } from "ulid";
import {
  compareQuotaScopes,
  resolveBatchLimit,
  validateResourceClaim,
  resolveResourceStoreOptions,
  type ApplyEventResult,
  type ExpireBatchResult,
  type QuotaDeleteResult,
  type QuotaLimit,
  type QuotaScope,
  type QuotaUsage,
  type Reservation,
  type ReservationFilter,
  type ReservationPage,
  type ReservationPageOptions,
  type ReconciliationBatchOptions,
  type ReconciliationBatchResult,
  type ReconciliationJob,
  type ReconciliationJobStatus,
  type ResolvedResourceStoreOptions,
  type RetentionCleanupResult,
  type ReserveResult,
  type ResourceClaim,
  type ResourceEvent,
  type ResourceStore,
  type ResourceStoreOptions,
  type TransitionResult,
  type WorkerStoppedEvent,
  ReconciliationCapacityError,
  ReconciliationCursorMismatchError,
  ReconciliationJobNotFoundError,
} from "../contract.js";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_PAGE_SIZE,
  resolveResourceAuditOptions,
  type ResourceAuditEvent,
  type ResourceAuditEventType,
  type ResourceAuditCleanupResult,
  type ResourceAuditFilter,
  type ResourceAuditOptions,
  type ResourceAuditOutcome,
  type ResourceAuditPage,
  type ResourceAuditPageOptions,
  type ResolvedResourceAuditOptions,
} from "../audit/contract.js";
import { computeScopeRef } from "../audit/scope-ref.js";
import {
  asBootId,
  asOperationId,
  asReconciliationJobId,
  asReservationId,
  asResourceId,
  asWorkerId,
  newReconciliationJobId,
  newReservationId,
  type OperationId,
  type ReconciliationJobId,
  type ReservationId,
  type ResourceId,
  type BootId,
  type WorkerId,
} from "../id.js";
import { confirmedResourceSize, reconciliationTargetSize } from "../reconciliation-size.js";
import { RESOURCE_STATES } from "../state.js";
import type { ResourceState } from "../state.js";
import { planExpiry, planTransition, planWorkerStopForReservation } from "../transition.js";
import type { ResourcesDatabase, ResourcesTransaction } from "./db.js";
import * as schema from "./schema.js";

type ReservationRow = typeof schema.resourceReservation.$inferSelect;
type QuotaRow = typeof schema.resourceQuota.$inferSelect;
type OperationRow = typeof schema.resourceOperation.$inferSelect;
type ReconciliationJobRow = typeof schema.reconciliationJob.$inferSelect;
type ReconciliationTargetRow = typeof schema.reconciliationTarget.$inferSelect;

interface AuditEventRow {
  event_id: string;
  recorded_at: string;
  occurred_at: string;
  event_type: string;
  outcome: string;
  operation_id: string | null;
  reservation_id: string | null;
  resource_id: string | null;
  worker_id: string | null;
  boot_id: string | null;
  reconciliation_job_id: string | null;
  state_before: string | null;
  state_after: string | null;
  size_bytes: string | null;
  max_count_before: string | null;
  max_count_after: string | null;
  max_bytes_before: string | null;
  max_bytes_after: string | null;
}

interface AuditScopeRow {
  event_id: string;
  scope_kind: string;
  scope_ref: string;
  key_version: number;
}

const PENDING_RESULT: { readonly status: "pending" } = { status: "pending" };
// 同一 recorded_at の監査イベントを挿入順でページングするため、プロセス内で単調増加させる。
const nextAuditEventId = monotonicFactory();

type ReconciliationTargetOutcome =
  | { readonly kind: "reclaimed"; readonly reservationId: ReservationId }
  | { readonly kind: "isolated"; readonly reservationId: ReservationId }
  | { readonly kind: "unchanged"; readonly reservationId: ReservationId }
  | { readonly kind: "skipped"; readonly reservationId: ReservationId };

interface AuditWriteInput {
  readonly eventType: ResourceAuditEventType;
  readonly outcome: ResourceAuditOutcome;
  readonly recordedAt: number;
  readonly occurredAt: number;
  readonly operationId?: OperationId;
  readonly reservationId?: ReservationId;
  readonly resourceId?: ResourceId;
  readonly workerId?: WorkerId;
  readonly bootId?: BootId;
  readonly reconciliationJobId?: ReconciliationJobId;
  readonly stateBefore?: ResourceState;
  readonly stateAfter?: ResourceState;
  readonly sizeBytes?: number;
  readonly maxCountBefore?: number;
  readonly maxCountAfter?: number;
  readonly maxBytesBefore?: number;
  readonly maxBytesAfter?: number;
  readonly scopes: readonly QuotaScope[];
}

export interface PostgresResourceStoreOptions extends ResourceStoreOptions {
  readonly pool: Pool;
  readonly audit: ResourceAuditOptions;
}

function toResourceState(value: string): ResourceState {
  if (!RESOURCE_STATES.includes(value as ResourceState)) {
    throw new Error(`unknown resource state: ${value}`);
  }
  return value as ResourceState;
}

function toQuotaScopeKind(value: string): QuotaScope["kind"] {
  if (value !== "user" && value !== "room" && value !== "server") {
    throw new Error(`unknown quota scope kind: ${value}`);
  }
  return value;
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: asReservationId(row.id),
    state: toResourceState(row.state),
    scopes: row.scopes,
    sizeBytes: row.sizeBytes,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.resourceId === null ? {} : { resourceId: asResourceId(row.resourceId) }),
    ...(row.workerId === null ? {} : { workerId: asWorkerId(row.workerId) }),
    ...(row.bootId === null ? {} : { bootId: asBootId(row.bootId) }),
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
  };
}

function toQuotaUsage(row: QuotaRow): QuotaUsage {
  return {
    scope: { kind: toQuotaScopeKind(row.scopeKind), key: row.scopeKey },
    maxCount: row.maxCount,
    maxBytes: row.maxBytes,
    usedCount: row.usedCount,
    usedBytes: row.usedBytes,
  };
}

function toReconciliationJobStatus(value: string): ReconciliationJobStatus {
  if (value !== "pending" && value !== "running" && value !== "completed" && value !== "failed") {
    throw new Error(`unknown reconciliation job status: ${value}`);
  }
  return value;
}

function toReconciliationJob(row: ReconciliationJobRow): ReconciliationJob {
  return {
    id: asReconciliationJobId(row.jobId),
    workerId: asWorkerId(row.workerId),
    bootId: asBootId(row.bootId),
    status: toReconciliationJobStatus(row.status),
    lastTargetSeq: row.lastTargetSeq,
    targetCount: row.targetCount,
    targetBytes: row.targetBytes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.error === null ? {} : { error: row.error }),
  };
}

// 同じ操作IDの同時再送を直列化する。先行トランザクションの INSERT が確定するまで待ち、
// その後 FOR UPDATE で結果を読み出す。未完了の結果は pending として区別する。
type LockedOperation =
  | { readonly kind: "owned"; readonly stored: OperationRow }
  | { readonly kind: "existing"; readonly stored: OperationRow }
  | { readonly kind: "capacity-exhausted" };

async function lockOperation(
  tx: ResourcesTransaction,
  operationId: OperationId,
  kind: "reserve" | "event",
  occurredAt: number,
  recordedAt: number,
  capacityExceeded: boolean,
): Promise<LockedOperation> {
  const [existing] = await tx
    .select()
    .from(schema.resourceOperation)
    .where(eq(schema.resourceOperation.operationId, operationId))
    .limit(1);
  if (existing !== undefined) {
    if ((existing.result as { status?: string }).status === "pending") {
      throw new Error("operation result is incomplete");
    }
    return { kind: "existing", stored: existing };
  }
  if (capacityExceeded) {
    return { kind: "capacity-exhausted" };
  }

  const inserted = await tx
    .insert(schema.resourceOperation)
    .values({
      operationId,
      kind,
      result: PENDING_RESULT,
      occurredAt,
      recordedAt,
    })
    .onConflictDoNothing()
    .returning({ operationId: schema.resourceOperation.operationId });
  const [stored] = await tx
    .select()
    .from(schema.resourceOperation)
    .where(eq(schema.resourceOperation.operationId, operationId))
    .for("update");
  if (stored === undefined) {
    throw new Error("operation row is missing");
  }
  if (!inserted.length && (stored.result as { status?: string }).status === "pending") {
    throw new Error("operation result is incomplete");
  }
  return { kind: inserted.length > 0 ? "owned" : "existing", stored };
}

async function completeOperation<T>(
  tx: ResourcesTransaction,
  operationId: OperationId,
  result: T,
): Promise<T> {
  const updated = await tx
    .update(schema.resourceOperation)
    .set({ result })
    .where(eq(schema.resourceOperation.operationId, operationId))
    .returning({ operationId: schema.resourceOperation.operationId });
  if (updated.length === 0) {
    throw new Error("operation row is missing");
  }
  return result;
}

async function lockQuota(
  tx: ResourcesTransaction,
  scope: QuotaScope,
): Promise<QuotaRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.resourceQuota)
    .where(
      and(
        eq(schema.resourceQuota.scopeKind, scope.kind),
        eq(schema.resourceQuota.scopeKey, scope.key),
      ),
    )
    .for("update");
  return row;
}

// quota 行の INSERT と DELETE が競合すると変更前値を失うため、スコープ単位で直列化する。
async function lockQuotaScope(tx: ResourcesTransaction, scope: QuotaScope): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope.kind}:${scope.key}`})::bigint)`,
  );
}

async function updateReservation(
  tx: ResourcesTransaction,
  reservation: Reservation,
): Promise<void> {
  await tx
    .update(schema.resourceReservation)
    .set({
      state: reservation.state,
      resourceId: reservation.resourceId ?? null,
      workerId: reservation.workerId ?? null,
      bootId: reservation.bootId ?? null,
      version: reservation.version,
      updatedAt: reservation.updatedAt,
      expiresAt: reservation.expiresAt ?? null,
    })
    .where(eq(schema.resourceReservation.id, reservation.id));
}

export class PostgresResourceStore implements ResourceStore {
  private readonly db: ResourcesDatabase;
  private readonly pool: Pool;
  private readonly options: ResolvedResourceStoreOptions;
  private readonly audit: ResolvedResourceAuditOptions;
  private operationCapacityExceeded = false;

  public constructor(options: PostgresResourceStoreOptions) {
    this.db = drizzle(options.pool, { schema });
    this.pool = options.pool;
    this.options = resolveResourceStoreOptions(options);
    this.audit = resolveResourceAuditOptions(options.audit);
  }

  public async setQuotaLimit(limit: QuotaLimit, now = Date.now()): Promise<void> {
    if (
      !Number.isSafeInteger(limit.maxCount) ||
      limit.maxCount < 0 ||
      !Number.isSafeInteger(limit.maxBytes) ||
      limit.maxBytes < 0
    ) {
      throw new Error("quota limits must be non-negative safe integers");
    }

    await this.db.transaction(async (tx) => {
      await lockQuotaScope(tx, limit.scope);
      const insertedRows = await tx
        .insert(schema.resourceQuota)
        .values({
          scopeKind: limit.scope.kind,
          scopeKey: limit.scope.key,
          maxCount: limit.maxCount,
          maxBytes: limit.maxBytes,
        })
        .onConflictDoNothing()
        .returning({ scopeKind: schema.resourceQuota.scopeKind });
      let previousQuota: QuotaRow | undefined;
      if (insertedRows.length === 0) {
        previousQuota = await lockQuota(tx, limit.scope);
        if (previousQuota === undefined) {
          throw new Error("quota row is missing");
        }
        await tx
          .update(schema.resourceQuota)
          .set({
            maxCount: limit.maxCount,
            maxBytes: limit.maxBytes,
          })
          .where(
            and(
              eq(schema.resourceQuota.scopeKind, limit.scope.kind),
              eq(schema.resourceQuota.scopeKey, limit.scope.key),
            ),
          );
      }
      await this.writeAuditEvent(tx, {
        eventType: "quota-set",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        ...(previousQuota === undefined ? {} : { maxCountBefore: previousQuota.maxCount }),
        ...(previousQuota === undefined ? {} : { maxBytesBefore: previousQuota.maxBytes }),
        maxCountAfter: limit.maxCount,
        maxBytesAfter: limit.maxBytes,
        scopes: [limit.scope],
      });
    });
  }

  public async getQuotaUsage(scope: QuotaScope): Promise<QuotaUsage | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.resourceQuota)
      .where(
        and(
          eq(schema.resourceQuota.scopeKind, scope.kind),
          eq(schema.resourceQuota.scopeKey, scope.key),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toQuotaUsage(row);
  }

  public async deleteQuotaScope(scope: QuotaScope, now = Date.now()): Promise<QuotaDeleteResult> {
    return this.db.transaction(async (tx) => {
      await lockQuotaScope(tx, scope);
      const quota = await lockQuota(tx, scope);
      if (quota === undefined) {
        return { status: "not-found" };
      }
      const usage = toQuotaUsage(quota);
      if (usage.usedCount > 0 || usage.usedBytes > 0) {
        return { status: "in-use", usage };
      }
      await tx
        .delete(schema.resourceQuota)
        .where(
          and(
            eq(schema.resourceQuota.scopeKind, scope.kind),
            eq(schema.resourceQuota.scopeKey, scope.key),
          ),
        );
      await this.writeAuditEvent(tx, {
        eventType: "quota-delete",
        outcome: "deleted",
        recordedAt: now,
        occurredAt: now,
        maxCountBefore: usage.maxCount,
        maxBytesBefore: usage.maxBytes,
        scopes: [scope],
      });
      return { status: "deleted" };
    });
  }

  public async reserve(
    claim: ResourceClaim,
    operationId: OperationId,
    now: number,
  ): Promise<ReserveResult> {
    return this.db.transaction(async (tx) => {
      const operation = await lockOperation(
        tx,
        operationId,
        "reserve",
        now,
        now,
        this.operationCapacityExceeded,
      );
      if (operation.kind === "capacity-exhausted") {
        return { status: "rejected", reason: "capacity-exhausted" };
      }
      if (operation.kind === "existing") {
        return operation.stored.kind === "reserve"
          ? (operation.stored.result as ReserveResult)
          : { status: "rejected", reason: "invalid-claim" };
      }

      const validated = validateResourceClaim(claim, this.options.maxScopesPerClaim);
      if (!validated.ok) {
        return completeOperation(tx, operationId, {
          status: "rejected",
          reason: "invalid-claim",
        } satisfies ReserveResult);
      }

      const quotas: QuotaRow[] = [];
      for (const scope of validated.scopes) {
        const quota = await lockQuota(tx, scope);
        if (quota === undefined) {
          return completeOperation(tx, operationId, {
            status: "rejected",
            reason: "limit-not-configured",
          } satisfies ReserveResult);
        }
        quotas.push(quota);
      }

      const exceedsQuota = quotas.some(
        (quota) =>
          quota.usedCount + 1 > quota.maxCount ||
          quota.usedBytes + claim.sizeBytes > quota.maxBytes,
      );
      if (exceedsQuota) {
        return completeOperation(tx, operationId, {
          status: "rejected",
          reason: "quota-exceeded",
        } satisfies ReserveResult);
      }

      const ttlMs = claim.ttlMs ?? this.options.reservationTtlMs;
      const reservation: Reservation = {
        id: newReservationId(),
        state: "reserved",
        scopes: validated.scopes,
        sizeBytes: claim.sizeBytes,
        version: 1,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ttlMs,
      };
      await tx.insert(schema.resourceReservation).values({
        id: reservation.id,
        state: reservation.state,
        scopes: reservation.scopes,
        sizeBytes: reservation.sizeBytes,
        version: reservation.version,
        createdAt: reservation.createdAt,
        updatedAt: reservation.updatedAt,
        expiresAt: reservation.expiresAt,
      });

      for (const quota of quotas) {
        await tx
          .update(schema.resourceQuota)
          .set({
            usedCount: quota.usedCount + 1,
            usedBytes: quota.usedBytes + claim.sizeBytes,
          })
          .where(
            and(
              eq(schema.resourceQuota.scopeKind, quota.scopeKind),
              eq(schema.resourceQuota.scopeKey, quota.scopeKey),
            ),
          );
      }

      await this.writeAuditEvent(tx, {
        eventType: "reserve",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        operationId,
        reservationId: reservation.id,
        stateAfter: "reserved",
        sizeBytes: reservation.sizeBytes,
        scopes: reservation.scopes,
      });
      return completeOperation(tx, operationId, {
        status: "reserved",
        reservation,
      } satisfies ReserveResult);
    });
  }

  public async applyEvent(event: ResourceEvent, now: number): Promise<ApplyEventResult> {
    return this.db.transaction(async (tx) => {
      const operation = await lockOperation(
        tx,
        event.operationId,
        "event",
        event.at,
        now,
        this.operationCapacityExceeded,
      );
      if (operation.kind === "capacity-exhausted") {
        return { status: "rejected", reason: "capacity-exhausted" };
      }
      if (operation.kind === "existing") {
        if (operation.stored.kind === "event") {
          return operation.stored.result as ApplyEventResult;
        }
        return { status: "rejected", reason: "correlation-mismatch" };
      }

      if (event.type === "worker-stopped") {
        const job = await this.startReconciliationInTransaction(tx, event, now);
        return completeOperation(tx, event.operationId, {
          status: "reconciliation-started",
          job,
        } satisfies ApplyEventResult);
      }

      const [row] = await tx
        .select()
        .from(schema.resourceReservation)
        .where(eq(schema.resourceReservation.id, event.reservationId))
        .for("update");
      if (row === undefined) {
        return completeOperation(tx, event.operationId, {
          status: "rejected",
          reason: "not-found",
        } satisfies TransitionResult);
      }

      const reservation = toReservation(row);
      const plan = planTransition(reservation, event, now, this.options);
      if (plan.kind === "ignore") {
        return completeOperation(tx, event.operationId, {
          status: "ignored",
          reason: plan.reason,
        } satisfies TransitionResult);
      }
      if (plan.kind === "reject") {
        return completeOperation(tx, event.operationId, {
          status: "rejected",
          reason: plan.reason,
        } satisfies TransitionResult);
      }
      if (event.type === "allocated") {
        const targetCapacityAvailable = await this.checkAllocatedReconciliationTargetCapacity(
          tx,
          event.reservationId,
          event.workerId,
          event.bootId,
          event.resourceId,
        );
        if (!targetCapacityAvailable) {
          return completeOperation(tx, event.operationId, {
            status: "rejected",
            reason: "capacity-exhausted",
          } satisfies TransitionResult);
        }
      }

      if (plan.releaseQuota) {
        await this.releaseQuota(tx, reservation);
      }
      await updateReservation(tx, plan.next);
      await this.writeAuditEvent(tx, {
        eventType: event.type,
        outcome: "applied",
        recordedAt: now,
        occurredAt: event.at,
        operationId: event.operationId,
        reservationId: reservation.id,
        ...(plan.next.resourceId === undefined ? {} : { resourceId: plan.next.resourceId }),
        ...(plan.next.workerId === undefined ? {} : { workerId: plan.next.workerId }),
        ...(plan.next.bootId === undefined ? {} : { bootId: plan.next.bootId }),
        stateBefore: reservation.state,
        stateAfter: plan.next.state,
        sizeBytes: plan.next.sizeBytes,
        scopes: plan.next.scopes,
      });
      if (event.type === "allocated") {
        await this.appendReconciliationTarget(tx, plan.next, now);
      }
      return completeOperation(tx, event.operationId, {
        status: "applied",
        reservation: plan.next,
      } satisfies TransitionResult);
    });
  }

  public async expire(
    now: number,
    options: { readonly limit?: number } = {},
  ): Promise<ExpireBatchResult> {
    const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
    return this.db.transaction(async (tx) => {
      const states: ResourceState[] = ["reserved", "in-use", "release-pending", "result-unknown"];
      const rows = await tx
        .select()
        .from(schema.resourceReservation)
        .where(
          and(
            lte(schema.resourceReservation.expiresAt, now),
            inArray(schema.resourceReservation.state, states),
          ),
        )
        .orderBy(asc(schema.resourceReservation.expiresAt), asc(schema.resourceReservation.id))
        .limit(limit)
        .for("update");

      const released: ReservationId[] = [];
      const isolated: ReservationId[] = [];
      for (const row of rows) {
        const reservation = toReservation(row);
        const plan = planExpiry(reservation, now);
        if (plan === undefined) {
          continue;
        }
        if (plan.releaseQuota) {
          await this.releaseQuota(tx, reservation);
        }
        await updateReservation(tx, plan.next);
        await this.writeAuditEvent(tx, {
          eventType: "expire",
          outcome: "applied",
          recordedAt: now,
          occurredAt: now,
          reservationId: reservation.id,
          ...(reservation.resourceId === undefined ? {} : { resourceId: reservation.resourceId }),
          ...(reservation.workerId === undefined ? {} : { workerId: reservation.workerId }),
          ...(reservation.bootId === undefined ? {} : { bootId: reservation.bootId }),
          stateBefore: reservation.state,
          stateAfter: plan.next.state,
          sizeBytes: plan.next.sizeBytes,
          scopes: plan.next.scopes,
        });
        if (plan.next.state === "released") {
          released.push(reservation.id);
        } else {
          isolated.push(reservation.id);
        }
      }

      const hasMoreResult = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM resource_reservation
          WHERE expires_at <= ${now}
            AND state IN ('reserved', 'in-use', 'release-pending', 'result-unknown')
        ) AS has_more
      `);
      return {
        released,
        isolated,
        hasMore: Boolean(hasMoreResult.rows[0]?.has_more),
      };
    });
  }

  public async getReservation(id: ReservationId): Promise<Reservation | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.resourceReservation)
      .where(eq(schema.resourceReservation.id, id))
      .limit(1);
    return row === undefined ? undefined : toReservation(row);
  }

  public async getOperationOccurredAt(operationId: OperationId): Promise<number | undefined> {
    const [row] = await this.db
      .select({ occurredAt: schema.resourceOperation.occurredAt })
      .from(schema.resourceOperation)
      .where(eq(schema.resourceOperation.operationId, operationId))
      .limit(1);
    return row?.occurredAt;
  }

  public async getOperationRecordedAt(operationId: OperationId): Promise<number | undefined> {
    const [row] = await this.db
      .select({ recordedAt: schema.resourceOperation.recordedAt })
      .from(schema.resourceOperation)
      .where(eq(schema.resourceOperation.operationId, operationId))
      .limit(1);
    return row?.recordedAt;
  }

  public async startReconciliation(
    event: WorkerStoppedEvent,
    now: number,
  ): Promise<ReconciliationJob> {
    return this.db.transaction((tx) => this.startReconciliationInTransaction(tx, event, now));
  }

  private async startReconciliationInTransaction(
    tx: ResourcesTransaction,
    event: WorkerStoppedEvent,
    now: number,
  ): Promise<ReconciliationJob> {
    await tx
      .insert(schema.workerBoot)
      .values({
        workerId: event.workerId,
        bootId: event.bootId,
        state: "stopped",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(
        and(
          eq(schema.workerBoot.workerId, event.workerId),
          eq(schema.workerBoot.bootId, event.bootId),
        ),
      )
      .for("update");
    if (boot === undefined) {
      throw new Error("worker boot row is missing");
    }
    if (boot.jobId !== null) {
      const [existing] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, boot.jobId))
        .for("update");
      if (existing !== undefined) {
        return toReconciliationJob(existing);
      }
    }
    const [existingByBoot] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(
        and(
          eq(schema.reconciliationJob.workerId, event.workerId),
          eq(schema.reconciliationJob.bootId, event.bootId),
        ),
      )
      .for("update");
    if (existingByBoot !== undefined) {
      await tx
        .update(schema.workerBoot)
        .set({ jobId: existingByBoot.jobId, updatedAt: now })
        .where(
          and(
            eq(schema.workerBoot.workerId, event.workerId),
            eq(schema.workerBoot.bootId, event.bootId),
          ),
        );
      return toReconciliationJob(existingByBoot);
    }

    const confirmed = new Set(event.confirmedResourceIds);
    let confirmedBytes = 0;
    for (const resourceId of confirmed) {
      confirmedBytes += confirmedResourceSize(resourceId);
    }
    if (
      confirmed.size > this.options.maxConfirmedResourceIds ||
      confirmedBytes > this.options.maxConfirmedResourceBytes
    ) {
      throw new ReconciliationCapacityError("confirmed resource capacity exceeded");
    }

    const candidateRows = await tx
      .select()
      .from(schema.resourceReservation)
      .where(
        and(
          eq(schema.resourceReservation.workerId, event.workerId),
          eq(schema.resourceReservation.bootId, event.bootId),
          ne(schema.resourceReservation.state, "released"),
        ),
      )
      .orderBy(asc(schema.resourceReservation.id))
      .limit(this.options.maxReconciliationTargets + 1);
    if (candidateRows.length > this.options.maxReconciliationTargets) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }

    const targetSpecs = candidateRows.map((row) => {
      const resourceId = row.resourceId === null ? undefined : asResourceId(row.resourceId);
      return {
        reservationId: asReservationId(row.id),
        resourceId,
        confirmed: resourceId !== undefined && confirmed.has(resourceId),
        sizeBytes: reconciliationTargetSize(asReservationId(row.id), resourceId),
      };
    });
    const targetBytes = targetSpecs.reduce((total, target) => total + target.sizeBytes, 0);
    if (targetBytes > this.options.maxReconciliationTargetBytes) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }

    const jobId = newReconciliationJobId();
    const status: ReconciliationJobStatus = targetSpecs.length === 0 ? "completed" : "pending";
    await tx.insert(schema.reconciliationJob).values({
      jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      status,
      lastTargetSeq: 0,
      targetCount: targetSpecs.length,
      targetBytes,
      createdAt: now,
      updatedAt: now,
    });
    const confirmedValues = [...confirmed].map((resourceId) => ({
      jobId,
      resourceId,
      sizeBytes: confirmedResourceSize(resourceId),
    }));
    for (let offset = 0; offset < confirmedValues.length; offset += 1_000) {
      await tx
        .insert(schema.reconciliationConfirmedResource)
        .values(confirmedValues.slice(offset, offset + 1_000));
    }
    for (let offset = 0; offset < targetSpecs.length; offset += 1_000) {
      await tx.insert(schema.reconciliationTarget).values(
        targetSpecs.slice(offset, offset + 1_000).map((target) => ({
          jobId,
          reservationId: target.reservationId,
          resourceId: target.resourceId ?? null,
          confirmed: target.confirmed,
          state: "pending",
          sizeBytes: target.sizeBytes,
        })),
      );
    }
    await tx
      .update(schema.workerBoot)
      .set({ jobId, updatedAt: now })
      .where(
        and(
          eq(schema.workerBoot.workerId, event.workerId),
          eq(schema.workerBoot.bootId, event.bootId),
        ),
      );

    await this.writeAuditEvent(tx, {
      eventType: "reconciliation-start",
      outcome: status === "completed" ? "completed" : "started",
      recordedAt: now,
      occurredAt: event.at,
      operationId: event.operationId,
      reconciliationJobId: jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      scopes: [],
    });
    return {
      id: jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      status,
      lastTargetSeq: 0,
      targetCount: targetSpecs.length,
      targetBytes,
      createdAt: now,
      updatedAt: now,
    } satisfies ReconciliationJob;
  }

  public async continueReconciliation(
    jobId: ReconciliationJobId,
    options: ReconciliationBatchOptions,
    now: number,
  ): Promise<ReconciliationBatchResult> {
    return this.db.transaction(async (tx) => {
      const [initialJob] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, jobId));
      if (initialJob === undefined) {
        throw new ReconciliationJobNotFoundError(jobId);
      }
      if (options.cursor !== initialJob.lastTargetSeq) {
        throw new ReconciliationCursorMismatchError(initialJob.lastTargetSeq, options.cursor);
      }
      const initialStatus = toReconciliationJobStatus(initialJob.status);
      if (initialStatus === "completed" || initialStatus === "failed") {
        return {
          reclaimed: [],
          isolated: [],
          unchanged: [],
          hasMore: false,
          status: initialStatus,
        };
      }

      const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
      const selectedTargets = await tx
        .select()
        .from(schema.reconciliationTarget)
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, jobId),
            eq(schema.reconciliationTarget.state, "pending"),
            gt(schema.reconciliationTarget.targetSeq, options.cursor),
          ),
        )
        .orderBy(asc(schema.reconciliationTarget.targetSeq))
        .limit(limit);
      const reservationIds = [...new Set(selectedTargets.map((target) => target.reservationId))];
      if (reservationIds.length > 0) {
        await tx
          .select()
          .from(schema.resourceReservation)
          .where(inArray(schema.resourceReservation.id, reservationIds))
          .orderBy(asc(schema.resourceReservation.id))
          .for("update");
      }

      const [job] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, jobId))
        .for("update");
      if (job === undefined) {
        throw new ReconciliationJobNotFoundError(jobId);
      }
      if (options.cursor !== job.lastTargetSeq) {
        throw new ReconciliationCursorMismatchError(job.lastTargetSeq, options.cursor);
      }
      const status = toReconciliationJobStatus(job.status);
      if (status === "completed" || status === "failed") {
        return {
          reclaimed: [],
          isolated: [],
          unchanged: [],
          hasMore: false,
          status,
        };
      }

      const freshTargets =
        selectedTargets.length === 0
          ? []
          : await tx
              .select()
              .from(schema.reconciliationTarget)
              .where(
                and(
                  eq(schema.reconciliationTarget.jobId, jobId),
                  inArray(
                    schema.reconciliationTarget.targetSeq,
                    selectedTargets.map((target) => target.targetSeq),
                  ),
                ),
              )
              .orderBy(asc(schema.reconciliationTarget.targetSeq));
      const reservationRows =
        reservationIds.length === 0
          ? []
          : await tx
              .select()
              .from(schema.resourceReservation)
              .where(inArray(schema.resourceReservation.id, reservationIds));
      const reservations = new Map(
        reservationRows.map((row) => [row.id, toReservation(row)] as const),
      );

      const reclaimed: ReservationId[] = [];
      const isolated: ReservationId[] = [];
      const unchanged: ReservationId[] = [];
      const jobWorkerId = asWorkerId(job.workerId);
      const jobBootId = asBootId(job.bootId);
      for (const target of freshTargets) {
        const reservation = reservations.get(target.reservationId);
        const targetResourceId =
          target.resourceId === null ? undefined : asResourceId(target.resourceId);
        const outcome = await this.applyReconciliationTarget(
          tx,
          target,
          reservation,
          targetResourceId,
          jobId,
          jobWorkerId,
          jobBootId,
          now,
        );
        if (outcome.kind === "reclaimed") {
          reclaimed.push(outcome.reservationId);
        } else if (outcome.kind === "isolated") {
          isolated.push(outcome.reservationId);
        } else if (outcome.kind === "unchanged") {
          unchanged.push(outcome.reservationId);
        }
      }

      const lastTargetSeq =
        selectedTargets[selectedTargets.length - 1]?.targetSeq ?? options.cursor;
      const [remaining] = await tx
        .select({ targetSeq: schema.reconciliationTarget.targetSeq })
        .from(schema.reconciliationTarget)
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, jobId),
            eq(schema.reconciliationTarget.state, "pending"),
            gt(schema.reconciliationTarget.targetSeq, lastTargetSeq),
          ),
        )
        .limit(1);
      const hasMore = remaining !== undefined;
      const nextStatus: ReconciliationJobStatus = hasMore ? "running" : "completed";
      await tx
        .update(schema.reconciliationJob)
        .set({
          lastTargetSeq,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(schema.reconciliationJob.jobId, jobId));
      if (nextStatus === "completed") {
        await this.writeAuditEvent(tx, {
          eventType: "reconciliation-complete",
          outcome: "completed",
          recordedAt: now,
          occurredAt: now,
          reconciliationJobId: jobId,
          workerId: jobWorkerId,
          bootId: jobBootId,
          scopes: [],
        });
      }

      return {
        reclaimed,
        isolated,
        unchanged,
        ...(lastTargetSeq > options.cursor ? { nextCursor: lastTargetSeq } : {}),
        hasMore,
        status: nextStatus,
      };
    });
  }

  public async getReconciliationJob(
    jobId: ReconciliationJobId,
  ): Promise<ReconciliationJob | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, jobId))
      .limit(1);
    return row === undefined ? undefined : toReconciliationJob(row);
  }

  public async listAuditEvents(
    filter: ResourceAuditFilter = {},
    options: ResourceAuditPageOptions = {},
  ): Promise<ResourceAuditPage> {
    if (filter.eventTypes !== undefined && filter.eventTypes.length === 0) {
      return { events: [] };
    }
    const limit = Math.max(
      1,
      Math.min(options.limit ?? DEFAULT_AUDIT_PAGE_SIZE, MAX_AUDIT_PAGE_SIZE),
    );
    const params: unknown[] = [];
    const parameter = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];
    if (filter.from !== undefined) {
      conditions.push(`e.recorded_at >= ${parameter(filter.from)}`);
    }
    if (filter.to !== undefined) {
      conditions.push(`e.recorded_at < ${parameter(filter.to)}`);
    }
    if (filter.eventTypes !== undefined) {
      conditions.push(`e.event_type = ANY(${parameter(filter.eventTypes)}::text[])`);
    }
    if (options.cursor !== undefined) {
      const separator = options.cursor.indexOf(":");
      const recordedAt = Number(options.cursor.slice(0, separator));
      const eventId = options.cursor.slice(separator + 1);
      if (separator <= 0 || !Number.isSafeInteger(recordedAt) || eventId.length === 0) {
        throw new Error("invalid audit cursor");
      }
      conditions.push(
        `(e.recorded_at, e.event_id) > (${parameter(recordedAt)}, ${parameter(eventId)})`,
      );
    }
    const scope = filter.scope;
    if (scope !== undefined) {
      const refs = this.audit.keys.map((key) => computeScopeRef(key.secret, key.version, scope));
      conditions.push(`EXISTS (
        SELECT 1 FROM resource_audit_scope s
        WHERE s.event_id = e.event_id
          AND s.scope_kind = ${parameter(scope.kind)}
          AND s.scope_ref = ANY(${parameter(refs)}::text[])
      )`);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const events = await this.pool.query<AuditEventRow>(
      `SELECT e.*
       FROM resource_audit_event e
       ${where}
       ORDER BY e.recorded_at, e.event_id
       LIMIT ${parameter(limit + 1)}`,
      params,
    );
    const pageRows = events.rows.slice(0, limit);
    if (pageRows.length === 0) {
      return { events: [] };
    }
    const scopeRows = await this.pool.query<AuditScopeRow>(
      `SELECT event_id, scope_kind, scope_ref, key_version
       FROM resource_audit_scope
       WHERE event_id = ANY($1::text[])`,
      [pageRows.map((row) => row.event_id)],
    );
    const scopesByEvent = new Map<string, ResourceAuditEvent["scopes"][number][]>();
    for (const row of scopeRows.rows) {
      const scopes = scopesByEvent.get(row.event_id) ?? [];
      scopes.push({
        kind: toQuotaScopeKind(row.scope_kind),
        ref: row.scope_ref,
        keyVersion: row.key_version,
      });
      scopesByEvent.set(row.event_id, scopes);
    }
    const page = pageRows.map((row) =>
      this.toAuditEvent(row, scopesByEvent.get(row.event_id) ?? []),
    );
    const last = page[page.length - 1];
    return {
      events: page,
      ...(events.rows.length > limit && last !== undefined
        ? { nextCursor: `${last.recordedAt}:${last.id}` }
        : {}),
    };
  }

  public async cleanupAuditEvents(now: number): Promise<ResourceAuditCleanupResult> {
    const cutoff = now - this.audit.retentionMs;
    return this.db.transaction(async (tx) => {
      const deleted = await tx.execute(sql`
        DELETE FROM resource_audit_event
        WHERE event_id IN (
          SELECT event_id FROM resource_audit_event
          WHERE recorded_at <= ${cutoff}
          ORDER BY recorded_at
          LIMIT ${this.audit.cleanupBatchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING event_id
      `);
      const eventIds = (deleted.rows as { event_id: string }[]).map((row) => row.event_id);
      if (eventIds.length > 0) {
        await tx
          .delete(schema.resourceAuditScope)
          .where(inArray(schema.resourceAuditScope.eventId, eventIds));
      }
      return { deletedAuditEvents: eventIds.length };
    });
  }

  private toAuditEvent(
    row: AuditEventRow,
    scopes: ResourceAuditEvent["scopes"][number][],
  ): ResourceAuditEvent {
    return {
      id: row.event_id,
      recordedAt: Number(row.recorded_at),
      occurredAt: Number(row.occurred_at),
      type: row.event_type as ResourceAuditEventType,
      outcome: row.outcome as ResourceAuditOutcome,
      ...(row.operation_id === null ? {} : { operationId: asOperationId(row.operation_id) }),
      ...(row.reservation_id === null
        ? {}
        : { reservationId: asReservationId(row.reservation_id) }),
      ...(row.resource_id === null ? {} : { resourceId: asResourceId(row.resource_id) }),
      ...(row.worker_id === null ? {} : { workerId: asWorkerId(row.worker_id) }),
      ...(row.boot_id === null ? {} : { bootId: asBootId(row.boot_id) }),
      ...(row.reconciliation_job_id === null
        ? {}
        : { reconciliationJobId: asReconciliationJobId(row.reconciliation_job_id) }),
      ...(row.state_before === null ? {} : { stateBefore: toResourceState(row.state_before) }),
      ...(row.state_after === null ? {} : { stateAfter: toResourceState(row.state_after) }),
      ...(row.size_bytes === null ? {} : { sizeBytes: Number(row.size_bytes) }),
      ...(row.max_count_before === null ? {} : { maxCountBefore: Number(row.max_count_before) }),
      ...(row.max_count_after === null ? {} : { maxCountAfter: Number(row.max_count_after) }),
      ...(row.max_bytes_before === null ? {} : { maxBytesBefore: Number(row.max_bytes_before) }),
      ...(row.max_bytes_after === null ? {} : { maxBytesAfter: Number(row.max_bytes_after) }),
      scopes,
    };
  }

  private async applyReconciliationTarget(
    tx: ResourcesTransaction,
    target: ReconciliationTargetRow,
    reservation: Reservation | undefined,
    targetResourceId: ResourceId | undefined,
    jobId: ReconciliationJobId,
    workerId: WorkerId,
    bootId: BootId,
    now: number,
  ): Promise<ReconciliationTargetOutcome> {
    const reservationId = asReservationId(target.reservationId);
    const skip = async (): Promise<ReconciliationTargetOutcome> => {
      await tx
        .update(schema.reconciliationTarget)
        .set({ state: "skipped", processedAt: now })
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, target.jobId),
            eq(schema.reconciliationTarget.targetSeq, target.targetSeq),
          ),
        );
      return { kind: "skipped", reservationId };
    };

    if (reservation === undefined) {
      return skip();
    }
    if (
      reservation.workerId !== workerId ||
      reservation.bootId !== bootId ||
      (targetResourceId !== undefined && targetResourceId !== reservation.resourceId) ||
      (targetResourceId === undefined && reservation.resourceId !== undefined) ||
      reservation.state === "released" ||
      reservation.state === "isolated"
    ) {
      return skip();
    }

    const confirmed = new Set<ResourceId>();
    if (target.confirmed && targetResourceId !== undefined) {
      confirmed.add(targetResourceId);
    }
    const plan = planWorkerStopForReservation(reservation, confirmed, workerId, bootId, now);
    if (plan === undefined) {
      return skip();
    }

    if (plan.action === "release") {
      await this.releaseQuota(tx, reservation);
    }
    if (plan.next !== undefined && plan.action !== "unchanged") {
      await updateReservation(tx, plan.next);
    }
    await tx
      .update(schema.reconciliationTarget)
      .set({ state: "processed", processedAt: now })
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, target.jobId),
          eq(schema.reconciliationTarget.targetSeq, target.targetSeq),
        ),
      );
    if (plan.action === "release") {
      await this.writeAuditEvent(tx, {
        eventType: "reconciliation-reclaimed",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        reservationId,
        reconciliationJobId: jobId,
        ...(reservation.resourceId === undefined ? {} : { resourceId: reservation.resourceId }),
        ...(reservation.workerId === undefined ? {} : { workerId: reservation.workerId }),
        ...(reservation.bootId === undefined ? {} : { bootId: reservation.bootId }),
        stateBefore: reservation.state,
        stateAfter: "released",
        sizeBytes: reservation.sizeBytes,
        scopes: reservation.scopes,
      });
      return { kind: "reclaimed", reservationId };
    }
    if (plan.action === "isolate") {
      await this.writeAuditEvent(tx, {
        eventType: "reconciliation-isolated",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        reservationId,
        reconciliationJobId: jobId,
        ...(reservation.resourceId === undefined ? {} : { resourceId: reservation.resourceId }),
        ...(reservation.workerId === undefined ? {} : { workerId: reservation.workerId }),
        ...(reservation.bootId === undefined ? {} : { bootId: reservation.bootId }),
        stateBefore: reservation.state,
        stateAfter: "isolated",
        sizeBytes: reservation.sizeBytes,
        scopes: reservation.scopes,
      });
      return { kind: "isolated", reservationId };
    }
    return { kind: "unchanged", reservationId };
  }

  public async cleanup(now: number): Promise<RetentionCleanupResult> {
    const operations = await this.pool.query(
      `DELETE FROM resource_operation
       WHERE operation_id IN (
         SELECT operation_id FROM resource_operation
         WHERE recorded_at <= $1
         ORDER BY recorded_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING operation_id`,
      [now - this.options.operationRetentionMs, this.options.cleanupBatchSize],
    );
    const operationCountResult = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM resource_operation",
    );
    const operationCount = Number(operationCountResult.rows[0]?.count ?? 0);
    this.operationCapacityExceeded = operationCount >= this.options.maxOperationRecords;

    const reservations = await this.pool.query(
      `DELETE FROM resource_reservation
       WHERE id IN (
         SELECT id FROM resource_reservation
         WHERE state = 'released' AND updated_at <= $1
         ORDER BY updated_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [now - this.options.releasedReservationRetentionMs, this.options.cleanupBatchSize],
    );
    const releasedCountResult = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM resource_reservation WHERE state = 'released'",
    );
    const releasedCount = Number(releasedCountResult.rows[0]?.count ?? 0);
    const evictionCount = Math.max(0, releasedCount - this.options.maxReleasedReservations);
    const evicted =
      evictionCount === 0
        ? undefined
        : await this.pool.query(
            `DELETE FROM resource_reservation
             WHERE id IN (
               SELECT id FROM resource_reservation
               WHERE state = 'released'
               ORDER BY updated_at
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )
             RETURNING id`,
            [evictionCount],
          );
    const evictedCount = evicted === undefined ? 0 : (evicted.rowCount ?? evicted.rows.length);

    const expiredJobs = await this.pool.query<{ job_id: string }>(
      `DELETE FROM reconciliation_job
       WHERE job_id IN (
         SELECT job_id FROM reconciliation_job
         WHERE status IN ('completed', 'failed') AND updated_at <= $1
         ORDER BY updated_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING job_id`,
      [now - this.options.reconciliationJobRetentionMs, this.options.cleanupBatchSize],
    );
    const deletedJobIds = expiredJobs.rows.map((row) => row.job_id);
    if (deletedJobIds.length > 0) {
      await this.pool.query("DELETE FROM reconciliation_target WHERE job_id = ANY($1::text[])", [
        deletedJobIds,
      ]);
      await this.pool.query(
        "DELETE FROM reconciliation_confirmed_resource WHERE job_id = ANY($1::text[])",
        [deletedJobIds],
      );
      await this.pool.query("DELETE FROM worker_boot WHERE job_id = ANY($1::text[])", [
        deletedJobIds,
      ]);
    }

    return {
      deletedOperations: operations.rowCount ?? operations.rows.length,
      deletedReleasedReservations: reservations.rowCount ?? reservations.rows.length,
      evictedReleasedReservations: evictedCount,
      operationCount,
      releasedReservationCount: releasedCount - evictedCount,
      operationCapacityExceeded: this.operationCapacityExceeded,
      deletedReconciliationJobs: deletedJobIds.length,
    };
  }

  /** @internal 照合・テスト用。公開 ResourceStore 契約には含めない。 */
  public async listReservationsPage(
    filter: ReservationFilter = {},
    options: ReservationPageOptions = {},
  ): Promise<ReservationPage> {
    const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
    const conditions: SQL[] = [];
    if (filter.workerId !== undefined) {
      conditions.push(eq(schema.resourceReservation.workerId, filter.workerId));
    }
    if (filter.bootId !== undefined) {
      conditions.push(eq(schema.resourceReservation.bootId, filter.bootId));
    }
    if (filter.state !== undefined) {
      conditions.push(eq(schema.resourceReservation.state, filter.state));
    }
    if (options.cursor !== undefined) {
      conditions.push(gt(schema.resourceReservation.id, options.cursor));
    }

    const rows =
      conditions.length === 0
        ? await this.db
            .select()
            .from(schema.resourceReservation)
            .orderBy(asc(schema.resourceReservation.id))
            .limit(limit + 1)
        : await this.db
            .select()
            .from(schema.resourceReservation)
            .where(and(...conditions))
            .orderBy(asc(schema.resourceReservation.id))
            .limit(limit + 1);
    const page = rows.slice(0, limit).map(toReservation);
    const nextCursor = rows.length > limit ? page[page.length - 1]?.id : undefined;
    return {
      reservations: page,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private async checkAllocatedReconciliationTargetCapacity(
    tx: ResourcesTransaction,
    reservationId: ReservationId,
    workerId: WorkerId,
    bootId: BootId,
    resourceId: ResourceId,
  ): Promise<boolean> {
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(and(eq(schema.workerBoot.workerId, workerId), eq(schema.workerBoot.bootId, bootId)))
      .for("update");
    if (boot?.jobId === null || boot?.jobId === undefined) {
      return true;
    }
    const [job] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, boot.jobId))
      .for("update");
    if (job === undefined || job.status === "failed") {
      return true;
    }
    const sizeBytes = reconciliationTargetSize(reservationId, resourceId);
    const [existing] = await tx
      .select()
      .from(schema.reconciliationTarget)
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, boot.jobId),
          eq(schema.reconciliationTarget.reservationId, reservationId),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return true;
      }
      return (
        job.targetBytes - existing.sizeBytes + sizeBytes <=
        this.options.maxReconciliationTargetBytes
      );
    }
    return (
      job.targetCount + 1 <= this.options.maxReconciliationTargets &&
      job.targetBytes + sizeBytes <= this.options.maxReconciliationTargetBytes
    );
  }

  private async writeAuditEvent(tx: ResourcesTransaction, input: AuditWriteInput): Promise<void> {
    const activeKey = this.audit.keys.find((key) => key.version === this.audit.activeKeyVersion);
    if (activeKey === undefined) {
      throw new Error("active audit key is missing");
    }
    const eventId = nextAuditEventId();
    await tx.insert(schema.resourceAuditEvent).values({
      eventId,
      recordedAt: input.recordedAt,
      occurredAt: input.occurredAt,
      eventType: input.eventType,
      outcome: input.outcome,
      operationId: input.operationId ?? null,
      reservationId: input.reservationId ?? null,
      resourceId: input.resourceId ?? null,
      workerId: input.workerId ?? null,
      bootId: input.bootId ?? null,
      reconciliationJobId: input.reconciliationJobId ?? null,
      stateBefore: input.stateBefore ?? null,
      stateAfter: input.stateAfter ?? null,
      sizeBytes: input.sizeBytes ?? null,
      maxCountBefore: input.maxCountBefore ?? null,
      maxCountAfter: input.maxCountAfter ?? null,
      maxBytesBefore: input.maxBytesBefore ?? null,
      maxBytesAfter: input.maxBytesAfter ?? null,
    });
    if (input.scopes.length === 0) {
      return;
    }
    await tx.insert(schema.resourceAuditScope).values(
      input.scopes.map((scope) => ({
        eventId,
        scopeKind: scope.kind,
        scopeRef: computeScopeRef(activeKey.secret, activeKey.version, scope),
        keyVersion: activeKey.version,
      })),
    );
  }

  private async appendReconciliationTarget(
    tx: ResourcesTransaction,
    reservation: Reservation,
    now: number,
  ): Promise<void> {
    if (
      reservation.workerId === undefined ||
      reservation.bootId === undefined ||
      reservation.resourceId === undefined
    ) {
      return;
    }
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(
        and(
          eq(schema.workerBoot.workerId, reservation.workerId),
          eq(schema.workerBoot.bootId, reservation.bootId),
        ),
      )
      .for("update");
    if (boot?.jobId === null || boot?.jobId === undefined) {
      return;
    }
    const [job] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, boot.jobId))
      .for("update");
    if (job === undefined || job.status === "failed") {
      return;
    }
    const [confirmedRow] = await tx
      .select({ resourceId: schema.reconciliationConfirmedResource.resourceId })
      .from(schema.reconciliationConfirmedResource)
      .where(
        and(
          eq(schema.reconciliationConfirmedResource.jobId, boot.jobId),
          eq(schema.reconciliationConfirmedResource.resourceId, reservation.resourceId),
        ),
      )
      .limit(1);
    const confirmed = confirmedRow !== undefined;
    const sizeBytes = reconciliationTargetSize(reservation.id, reservation.resourceId);
    const [existing] = await tx
      .select()
      .from(schema.reconciliationTarget)
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, boot.jobId),
          eq(schema.reconciliationTarget.reservationId, reservation.id),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return;
      }
      const targetBytes = job.targetBytes - existing.sizeBytes + sizeBytes;
      if (targetBytes > this.options.maxReconciliationTargetBytes) {
        throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
      }
      await tx
        .update(schema.reconciliationTarget)
        .set({
          resourceId: reservation.resourceId,
          confirmed,
          sizeBytes,
        })
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, boot.jobId),
            eq(schema.reconciliationTarget.targetSeq, existing.targetSeq),
          ),
        );
      await tx
        .update(schema.reconciliationJob)
        .set({
          status: job.status === "completed" ? "pending" : job.status,
          targetBytes,
          updatedAt: now,
        })
        .where(eq(schema.reconciliationJob.jobId, boot.jobId));
      return;
    }

    if (
      job.targetCount + 1 > this.options.maxReconciliationTargets ||
      job.targetBytes + sizeBytes > this.options.maxReconciliationTargetBytes
    ) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }
    await tx.insert(schema.reconciliationTarget).values({
      jobId: boot.jobId,
      reservationId: reservation.id,
      resourceId: reservation.resourceId,
      confirmed,
      state: "pending",
      sizeBytes,
    });
    await tx
      .update(schema.reconciliationJob)
      .set({
        status: job.status === "completed" ? "pending" : job.status,
        targetCount: job.targetCount + 1,
        targetBytes: job.targetBytes + sizeBytes,
        updatedAt: now,
      })
      .where(eq(schema.reconciliationJob.jobId, boot.jobId));
  }

  private async releaseQuota(tx: ResourcesTransaction, reservation: Reservation): Promise<void> {
    const scopes = reservation.scopes.toSorted(compareQuotaScopes);
    for (const scope of scopes) {
      const quota = await lockQuota(tx, scope);
      if (quota === undefined) {
        throw new Error(`quota is missing for ${scope.kind}:${scope.key}`);
      }
      if (quota.usedCount < 1 || quota.usedBytes < reservation.sizeBytes) {
        throw new Error(`quota accounting is inconsistent for ${scope.kind}:${scope.key}`);
      }
      await tx
        .update(schema.resourceQuota)
        .set({
          usedCount: quota.usedCount - 1,
          usedBytes: quota.usedBytes - reservation.sizeBytes,
        })
        .where(
          and(
            eq(schema.resourceQuota.scopeKind, quota.scopeKind),
            eq(schema.resourceQuota.scopeKey, quota.scopeKey),
          ),
        );
    }
  }
}

export function createPostgresResourceStore(
  options: PostgresResourceStoreOptions,
): PostgresResourceStore {
  return new PostgresResourceStore(options);
}
