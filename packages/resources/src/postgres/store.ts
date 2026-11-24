import { and, asc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
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
  type ResolvedResourceStoreOptions,
  type RetentionCleanupResult,
  type ReserveResult,
  type ResourceClaim,
  type ResourceEvent,
  type ResourceStore,
  type ResourceStoreOptions,
  type TransitionResult,
  type WorkerStoppedEvent,
} from "../contract.js";
import {
  resolveResourceAuditOptions,
  type ResourceAuditCleanupResult,
  type ResourceAuditFilter,
  type ResourceAuditOptions,
  type ResourceAuditPage,
  type ResourceAuditPageOptions,
} from "../audit/contract.js";
import {
  newReservationId,
  type OperationId,
  type ReconciliationJobId,
  type ReservationId,
} from "../id.js";
import type { ResourceState } from "../state.js";
import { planExpiry, planTransition } from "../transition.js";
import { PostgresAuditLog, type AuditWriteInput } from "./audit.js";
import { toQuotaUsage, toReservation } from "./codec.js";
import type { ResourcesDatabase, ResourcesTransaction } from "./db.js";
import {
  completeOperation,
  lockOperation,
  lockQuota,
  lockQuotaScope,
  releaseQuota as releaseReservationQuota,
  updateReservation,
  type QuotaRow,
} from "./operations.js";
import { PostgresReconciliationStore } from "./reconciliation.js";
import * as schema from "./schema.js";

export interface PostgresResourceStoreOptions extends ResourceStoreOptions {
  readonly pool: Pool;
  readonly audit: ResourceAuditOptions;
}

export class PostgresResourceStore implements ResourceStore {
  private readonly db: ResourcesDatabase;
  private readonly pool: Pool;
  private readonly options: ResolvedResourceStoreOptions;
  private readonly auditLog: PostgresAuditLog;
  private readonly reconciliation: PostgresReconciliationStore;
  private operationCapacityExceeded = false;

  public constructor(options: PostgresResourceStoreOptions) {
    this.db = drizzle(options.pool, { schema });
    this.pool = options.pool;
    this.options = resolveResourceStoreOptions(options);
    this.auditLog = new PostgresAuditLog(
      this.db,
      this.pool,
      resolveResourceAuditOptions(options.audit),
    );
    this.reconciliation = new PostgresReconciliationStore(this.db, this.options, this.auditLog);
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
        const job = await this.reconciliation.startInTransaction(tx, event, now);
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
      if (event.type === "allocated" || event.type === "release-failed") {
        const targetCapacityAvailable = await this.reconciliation.checkTargetCapacity(
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
        await releaseReservationQuota(tx, reservation);
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
      if (event.type === "allocated" || event.type === "release-failed") {
        await this.reconciliation.appendTarget(tx, plan.next, now);
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
          await releaseReservationQuota(tx, reservation);
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
    return this.reconciliation.start(event, now);
  }

  public async continueReconciliation(
    jobId: ReconciliationJobId,
    options: ReconciliationBatchOptions,
    now: number,
  ): Promise<ReconciliationBatchResult> {
    return this.reconciliation.continue(jobId, options, now);
  }

  public async getReconciliationJob(
    jobId: ReconciliationJobId,
  ): Promise<ReconciliationJob | undefined> {
    return this.reconciliation.get(jobId);
  }

  public async listAuditEvents(
    filter: ResourceAuditFilter = {},
    options: ResourceAuditPageOptions = {},
  ): Promise<ResourceAuditPage> {
    return this.auditLog.list(filter, options);
  }

  public async cleanupAuditEvents(now: number): Promise<ResourceAuditCleanupResult> {
    return this.auditLog.cleanup(now);
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

  private async writeAuditEvent(tx: ResourcesTransaction, input: AuditWriteInput): Promise<void> {
    await this.auditLog.write(tx, input);
  }
}

export function createPostgresResourceStore(
  options: PostgresResourceStoreOptions,
): PostgresResourceStore {
  return new PostgresResourceStore(options);
}
