import { and, asc, eq, gt, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
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
  resolveResourceAuditOptions,
  type ResourceAuditCleanupResult,
  type ResourceAuditFilter,
  type ResourceAuditOptions,
  type ResourceAuditPage,
  type ResourceAuditPageOptions,
} from "../audit/contract.js";
import {
  asBootId,
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
import type { ResourceState } from "../state.js";
import { planExpiry, planTransition, planWorkerStopForReservation } from "../transition.js";
import { PostgresAuditLog, type AuditWriteInput } from "./audit.js";
import {
  toQuotaUsage,
  toReconciliationJob,
  toReconciliationJobStatus,
  toReservation,
} from "./codec.js";
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
import * as schema from "./schema.js";

type ReconciliationTargetRow = typeof schema.reconciliationTarget.$inferSelect;

type ReconciliationTargetOutcome =
  | { readonly kind: "reclaimed"; readonly reservationId: ReservationId }
  | { readonly kind: "isolated"; readonly reservationId: ReservationId }
  | { readonly kind: "unchanged"; readonly reservationId: ReservationId }
  | { readonly kind: "skipped"; readonly reservationId: ReservationId };

export interface PostgresResourceStoreOptions extends ResourceStoreOptions {
  readonly pool: Pool;
  readonly audit: ResourceAuditOptions;
}

export class PostgresResourceStore implements ResourceStore {
  private readonly db: ResourcesDatabase;
  private readonly pool: Pool;
  private readonly options: ResolvedResourceStoreOptions;
  private readonly auditLog: PostgresAuditLog;
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
      if (event.type === "allocated" || event.type === "release-failed") {
        const targetCapacityAvailable = await this.checkReconciliationTargetCapacity(
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
    return this.auditLog.list(filter, options);
  }

  public async cleanupAuditEvents(now: number): Promise<ResourceAuditCleanupResult> {
    return this.auditLog.cleanup(now);
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
      await releaseReservationQuota(tx, reservation);
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

  private async checkReconciliationTargetCapacity(
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
    await this.auditLog.write(tx, input);
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
}

export function createPostgresResourceStore(
  options: PostgresResourceStoreOptions,
): PostgresResourceStore {
  return new PostgresResourceStore(options);
}
