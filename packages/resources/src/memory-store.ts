import {
  quotaScopeKey,
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
} from "./contract.js";
import {
  newReconciliationJobId,
  newReservationId,
  type BootId,
  type OperationId,
  type ReconciliationJobId,
  type ReservationId,
  type ResourceId,
  type WorkerId,
} from "./id.js";
import { planExpiry, planWorkerStopForReservation, planTransition } from "./transition.js";
import { confirmedResourceSize, reconciliationTargetSize } from "./reconciliation-size.js";

interface QuotaState {
  readonly scope: QuotaScope;
  maxCount: number;
  maxBytes: number;
  usedCount: number;
  usedBytes: number;
}

type StoredOperation =
  | {
      readonly kind: "reserve";
      readonly result: ReserveResult;
      readonly occurredAt: number;
      readonly recordedAt: number;
    }
  | {
      readonly kind: "event";
      readonly result: ApplyEventResult;
      readonly occurredAt: number;
      readonly recordedAt: number;
    };

function cloneReservation(reservation: Reservation): Reservation {
  return {
    ...reservation,
    scopes: [...reservation.scopes],
  };
}

function isExpiredCandidate(reservation: Reservation, now: number): boolean {
  return (
    reservation.state !== "released" &&
    reservation.state !== "isolated" &&
    reservation.expiresAt !== undefined &&
    reservation.expiresAt <= now
  );
}

function matchesReservationFilter(reservation: Reservation, filter: ReservationFilter): boolean {
  return (
    (filter.workerId === undefined || reservation.workerId === filter.workerId) &&
    (filter.bootId === undefined || reservation.bootId === filter.bootId) &&
    (filter.state === undefined || reservation.state === filter.state)
  );
}

interface ReconciliationTargetState {
  readonly targetSeq: number;
  readonly reservationId: ReservationId;
  resourceId?: ResourceId;
  confirmed: boolean;
  state: "pending" | "processed" | "skipped";
  processedAt?: number;
  sizeBytes: number;
}

interface ReconciliationState {
  job: ReconciliationJob;
  readonly confirmed: Set<ResourceId>;
  readonly targets: Map<number, ReconciliationTargetState>;
}

function workerBootKey(workerId: WorkerId, bootId: BootId): string {
  return JSON.stringify([workerId, bootId]);
}

export class InMemoryResourceStore implements ResourceStore {
  private readonly reservations = new Map<ReservationId, Reservation>();
  private readonly quotas = new Map<string, QuotaState>();
  private readonly operations = new Map<OperationId, StoredOperation>();
  private readonly options: ResolvedResourceStoreOptions;
  private operationCapacityExceeded = false;
  private readonly reconciliations = new Map<ReconciliationJobId, ReconciliationState>();
  private readonly reconciliationByWorkerBoot = new Map<string, ReconciliationJobId>();
  private nextTargetSeq = 1;

  public constructor(options: ResourceStoreOptions) {
    this.options = resolveResourceStoreOptions(options);
  }

  public async setQuotaLimit(limit: QuotaLimit, _now?: number): Promise<void> {
    if (
      !Number.isSafeInteger(limit.maxCount) ||
      limit.maxCount < 0 ||
      !Number.isSafeInteger(limit.maxBytes) ||
      limit.maxBytes < 0
    ) {
      throw new Error("quota limits must be non-negative safe integers");
    }

    const key = quotaScopeKey(limit.scope);
    const existing = this.quotas.get(key);
    if (existing === undefined) {
      this.quotas.set(key, {
        scope: { ...limit.scope },
        maxCount: limit.maxCount,
        maxBytes: limit.maxBytes,
        usedCount: 0,
        usedBytes: 0,
      });
      return;
    }

    existing.maxCount = limit.maxCount;
    existing.maxBytes = limit.maxBytes;
  }

  public async getQuotaUsage(scope: QuotaScope): Promise<QuotaUsage | undefined> {
    const quota = this.quotas.get(quotaScopeKey(scope));
    if (quota === undefined) {
      return undefined;
    }

    return {
      scope: { ...quota.scope },
      maxCount: quota.maxCount,
      maxBytes: quota.maxBytes,
      usedCount: quota.usedCount,
      usedBytes: quota.usedBytes,
    };
  }

  public async deleteQuotaScope(scope: QuotaScope, _now?: number): Promise<QuotaDeleteResult> {
    const key = quotaScopeKey(scope);
    const quota = this.quotas.get(key);
    if (quota === undefined) {
      return { status: "not-found" };
    }
    const usage: QuotaUsage = {
      scope: { ...quota.scope },
      maxCount: quota.maxCount,
      maxBytes: quota.maxBytes,
      usedCount: quota.usedCount,
      usedBytes: quota.usedBytes,
    };
    if (usage.usedCount > 0 || usage.usedBytes > 0) {
      return { status: "in-use", usage };
    }
    this.quotas.delete(key);
    return { status: "deleted" };
  }

  public async reserve(
    claim: ResourceClaim,
    operationId: OperationId,
    now: number,
  ): Promise<ReserveResult> {
    const stored = this.operations.get(operationId);
    if (stored !== undefined) {
      return stored.kind === "reserve"
        ? stored.result
        : { status: "rejected", reason: "invalid-claim" };
    }
    if (this.operationCapacityExceeded) {
      return { status: "rejected", reason: "capacity-exhausted" };
    }

    const validated = validateResourceClaim(claim, this.options.maxScopesPerClaim);
    if (!validated.ok) {
      return this.recordReserveResult(
        operationId,
        {
          status: "rejected",
          reason: "invalid-claim",
        },
        now,
      );
    }

    const quotaStates: QuotaState[] = [];
    for (const scope of validated.scopes) {
      const quota = this.quotas.get(quotaScopeKey(scope));
      if (quota === undefined) {
        return this.recordReserveResult(
          operationId,
          {
            status: "rejected",
            reason: "limit-not-configured",
          },
          now,
        );
      }
      quotaStates.push(quota);
    }

    const exceedsQuota = quotaStates.some(
      (quota) =>
        quota.usedCount + 1 > quota.maxCount || quota.usedBytes + claim.sizeBytes > quota.maxBytes,
    );
    if (exceedsQuota) {
      return this.recordReserveResult(
        operationId,
        {
          status: "rejected",
          reason: "quota-exceeded",
        },
        now,
      );
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

    for (const quota of quotaStates) {
      quota.usedCount += 1;
      quota.usedBytes += claim.sizeBytes;
    }
    this.reservations.set(reservation.id, reservation);

    return this.recordReserveResult(
      operationId,
      {
        status: "reserved",
        reservation: cloneReservation(reservation),
      },
      now,
    );
  }

  public async applyEvent(event: ResourceEvent, now: number): Promise<ApplyEventResult> {
    const stored = this.operations.get(event.operationId);
    if (stored !== undefined) {
      if (stored.kind === "event") {
        return stored.result;
      }
      return { status: "rejected", reason: "correlation-mismatch" };
    }
    if (this.operationCapacityExceeded) {
      return { status: "rejected", reason: "capacity-exhausted" };
    }

    if (event.type === "allocated") {
      const reservation = this.reservations.get(event.reservationId);
      if (reservation !== undefined) {
        const plan = planTransition(reservation, event, now, this.options);
        if (plan.kind === "apply") {
          try {
            this.assertReconciliationTargetCapacity(
              event.workerId,
              event.bootId,
              event.reservationId,
              event.resourceId,
            );
          } catch (error) {
            if (!(error instanceof ReconciliationCapacityError)) {
              throw error;
            }
            const result = {
              status: "rejected",
              reason: "capacity-exhausted",
            } satisfies ApplyEventResult;
            this.operations.set(event.operationId, {
              kind: "event",
              result,
              occurredAt: event.at,
              recordedAt: now,
            });
            return result;
          }
        }
      }
    }

    const result =
      event.type === "worker-stopped"
        ? ({
            status: "reconciliation-started",
            job: await this.startReconciliation(event, now),
          } satisfies ApplyEventResult)
        : this.applyTransition(event, now);
    if (event.type === "allocated" && result.status === "applied") {
      this.appendReconciliationTarget(result.reservation, now);
    }
    this.operations.set(event.operationId, {
      kind: "event",
      result,
      occurredAt: event.at,
      recordedAt: now,
    });
    return result;
  }

  public async expire(
    now: number,
    options: { readonly limit?: number } = {},
  ): Promise<ExpireBatchResult> {
    const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
    const candidates = [...this.reservations.values()]
      .filter((reservation) => isExpiredCandidate(reservation, now))
      .toSorted(
        (left, right) =>
          (left.expiresAt ?? 0) - (right.expiresAt ?? 0) || left.id.localeCompare(right.id),
      )
      .slice(0, limit);

    const released: ReservationId[] = [];
    const isolated: ReservationId[] = [];
    for (const reservation of candidates) {
      const plan = planExpiry(reservation, now);
      if (plan === undefined) {
        continue;
      }
      if (plan.releaseQuota) {
        this.releaseQuota(reservation);
      }
      this.reservations.set(plan.next.id, plan.next);
      if (plan.next.state === "released") {
        released.push(reservation.id);
      } else {
        isolated.push(reservation.id);
      }
    }

    return {
      released,
      isolated,
      hasMore: [...this.reservations.values()].some((reservation) =>
        isExpiredCandidate(reservation, now),
      ),
    };
  }

  public async getReservation(id: ReservationId): Promise<Reservation | undefined> {
    const reservation = this.reservations.get(id);
    return reservation === undefined ? undefined : cloneReservation(reservation);
  }

  public async getOperationOccurredAt(operationId: OperationId): Promise<number | undefined> {
    return this.operations.get(operationId)?.occurredAt;
  }

  public async getOperationRecordedAt(operationId: OperationId): Promise<number | undefined> {
    return this.operations.get(operationId)?.recordedAt;
  }

  public async startReconciliation(
    event: WorkerStoppedEvent,
    now: number,
  ): Promise<ReconciliationJob> {
    const workerBoot = workerBootKey(event.workerId, event.bootId);
    const existingId = this.reconciliationByWorkerBoot.get(workerBoot);
    if (existingId !== undefined) {
      const existing = this.reconciliations.get(existingId);
      if (existing !== undefined) {
        return existing.job;
      }
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

    const candidates = [...this.reservations.values()]
      .filter(
        (reservation) =>
          reservation.workerId === event.workerId &&
          reservation.bootId === event.bootId &&
          reservation.state !== "released",
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const targetSpecs = candidates.map((reservation) => ({
      reservation,
      confirmed: reservation.resourceId !== undefined && confirmed.has(reservation.resourceId),
      sizeBytes: reconciliationTargetSize(reservation.id, reservation.resourceId),
    }));
    const targetBytes = targetSpecs.reduce((total, target) => total + target.sizeBytes, 0);
    if (
      targetSpecs.length > this.options.maxReconciliationTargets ||
      targetBytes > this.options.maxReconciliationTargetBytes
    ) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }

    const jobId = newReconciliationJobId();
    const status: ReconciliationJobStatus = targetSpecs.length === 0 ? "completed" : "pending";
    const job: ReconciliationJob = {
      id: jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      status,
      lastTargetSeq: 0,
      targetCount: targetSpecs.length,
      targetBytes,
      createdAt: now,
      updatedAt: now,
    };
    const targets = new Map<number, ReconciliationTargetState>();
    for (const spec of targetSpecs) {
      const targetSeq = this.nextTargetSeq++;
      targets.set(targetSeq, {
        targetSeq,
        reservationId: spec.reservation.id,
        ...(spec.reservation.resourceId === undefined
          ? {}
          : { resourceId: spec.reservation.resourceId }),
        confirmed: spec.confirmed,
        state: "pending",
        sizeBytes: spec.sizeBytes,
      });
    }

    this.reconciliations.set(jobId, { job, confirmed, targets });
    this.reconciliationByWorkerBoot.set(workerBoot, jobId);
    return job;
  }

  public async continueReconciliation(
    jobId: ReconciliationJobId,
    options: ReconciliationBatchOptions,
    now: number,
  ): Promise<ReconciliationBatchResult> {
    const state = this.reconciliations.get(jobId);
    if (state === undefined) {
      throw new ReconciliationJobNotFoundError(jobId);
    }
    if (options.cursor !== state.job.lastTargetSeq) {
      throw new ReconciliationCursorMismatchError(state.job.lastTargetSeq, options.cursor);
    }
    const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
    if (state.job.status === "completed" || state.job.status === "failed") {
      return {
        reclaimed: [],
        isolated: [],
        unchanged: [],
        hasMore: false,
        status: state.job.status,
      };
    }

    const selected = [...state.targets.values()]
      .filter((target) => target.state === "pending" && target.targetSeq > options.cursor)
      .toSorted((left, right) => left.targetSeq - right.targetSeq)
      .slice(0, limit);
    const reclaimed: ReservationId[] = [];
    const isolated: ReservationId[] = [];
    const unchanged: ReservationId[] = [];
    let lastTargetSeq = state.job.lastTargetSeq;

    for (const target of selected) {
      lastTargetSeq = target.targetSeq;
      const reservation = this.reservations.get(target.reservationId);
      if (reservation === undefined) {
        target.state = "skipped";
        target.processedAt = now;
        unchanged.push(target.reservationId);
        continue;
      }
      if (
        reservation.workerId !== state.job.workerId ||
        reservation.bootId !== state.job.bootId ||
        (target.resourceId !== undefined && target.resourceId !== reservation.resourceId) ||
        (target.resourceId === undefined && reservation.resourceId !== undefined)
      ) {
        target.state = "skipped";
        target.processedAt = now;
        unchanged.push(target.reservationId);
        continue;
      }
      if (reservation.state === "released" || reservation.state === "isolated") {
        target.state = "skipped";
        target.processedAt = now;
        unchanged.push(target.reservationId);
        continue;
      }

      const confirmed = new Set<ResourceId>();
      if (target.confirmed && target.resourceId !== undefined) {
        confirmed.add(target.resourceId);
      }
      const plan = planWorkerStopForReservation(
        reservation,
        confirmed,
        state.job.workerId,
        state.job.bootId,
        now,
      );
      if (plan === undefined) {
        target.state = "skipped";
        target.processedAt = now;
        unchanged.push(target.reservationId);
        continue;
      }
      if (plan.action === "release") {
        this.releaseQuota(reservation);
        if (plan.next !== undefined) {
          this.reservations.set(plan.next.id, plan.next);
        }
        reclaimed.push(target.reservationId);
      } else if (plan.action === "isolate") {
        if (plan.next !== undefined) {
          this.reservations.set(plan.next.id, plan.next);
        }
        isolated.push(target.reservationId);
      } else {
        unchanged.push(target.reservationId);
      }
      target.state = "processed";
      target.processedAt = now;
    }

    const hasMore = [...state.targets.values()].some(
      (target) => target.state === "pending" && target.targetSeq > lastTargetSeq,
    );
    const status: ReconciliationJobStatus = hasMore ? "running" : "completed";
    state.job = {
      ...state.job,
      lastTargetSeq,
      status,
      updatedAt: now,
    };
    return {
      reclaimed,
      isolated,
      unchanged,
      ...(lastTargetSeq > options.cursor ? { nextCursor: lastTargetSeq } : {}),
      hasMore,
      status,
    };
  }

  public async getReconciliationJob(
    jobId: ReconciliationJobId,
  ): Promise<ReconciliationJob | undefined> {
    return this.reconciliations.get(jobId)?.job;
  }

  private assertReconciliationTargetCapacity(
    workerId: WorkerId,
    bootId: BootId,
    reservationId: ReservationId,
    resourceId: ResourceId,
  ): void {
    const jobId = this.reconciliationByWorkerBoot.get(workerBootKey(workerId, bootId));
    if (jobId === undefined) {
      return;
    }
    const state = this.reconciliations.get(jobId);
    if (state === undefined || state.job.status === "failed") {
      return;
    }
    const sizeBytes = reconciliationTargetSize(reservationId, resourceId);
    const existing = [...state.targets.values()].find(
      (target) => target.reservationId === reservationId,
    );
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return;
      }
      if (
        state.job.targetBytes - existing.sizeBytes + sizeBytes >
        this.options.maxReconciliationTargetBytes
      ) {
        throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
      }
      return;
    }
    if (
      state.job.targetCount + 1 > this.options.maxReconciliationTargets ||
      state.job.targetBytes + sizeBytes > this.options.maxReconciliationTargetBytes
    ) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }
  }

  private appendReconciliationTarget(reservation: Reservation, now: number): void {
    const resourceId = reservation.resourceId;
    if (
      reservation.workerId === undefined ||
      reservation.bootId === undefined ||
      resourceId === undefined
    ) {
      return;
    }
    const workerBoot = workerBootKey(reservation.workerId, reservation.bootId);
    const jobId = this.reconciliationByWorkerBoot.get(workerBoot);
    if (jobId === undefined) {
      return;
    }
    const state = this.reconciliations.get(jobId);
    if (state === undefined || state.job.status === "failed") {
      return;
    }

    const existing = [...state.targets.values()].find(
      (target) => target.reservationId === reservation.id,
    );
    const sizeBytes = reconciliationTargetSize(reservation.id, resourceId);
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return;
      }
      const targetBytes = state.job.targetBytes - existing.sizeBytes + sizeBytes;
      if (targetBytes > this.options.maxReconciliationTargetBytes) {
        throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
      }
      existing.resourceId = resourceId;
      existing.confirmed = state.confirmed.has(resourceId);
      existing.sizeBytes = sizeBytes;
      state.job = {
        ...state.job,
        status: state.job.status === "completed" ? "pending" : state.job.status,
        targetBytes,
        updatedAt: now,
      };
      return;
    }

    if (
      state.job.targetCount + 1 > this.options.maxReconciliationTargets ||
      state.job.targetBytes + sizeBytes > this.options.maxReconciliationTargetBytes
    ) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }
    const targetSeq = this.nextTargetSeq++;
    state.targets.set(targetSeq, {
      targetSeq,
      reservationId: reservation.id,
      resourceId,
      confirmed: state.confirmed.has(resourceId),
      state: "pending",
      sizeBytes,
    });
    state.job = {
      ...state.job,
      status: state.job.status === "completed" ? "pending" : state.job.status,
      targetCount: state.job.targetCount + 1,
      targetBytes: state.job.targetBytes + sizeBytes,
      updatedAt: now,
    };
  }

  public async cleanup(now: number): Promise<RetentionCleanupResult> {
    const operationCutoff = now - this.options.operationRetentionMs;
    const expiredOperations = [...this.operations.entries()]
      .filter(([, operation]) => operation.recordedAt <= operationCutoff)
      .toSorted(
        ([leftId, left], [rightId, right]) =>
          left.recordedAt - right.recordedAt || leftId.localeCompare(rightId),
      )
      .slice(0, this.options.cleanupBatchSize);
    for (const [operationId] of expiredOperations) {
      this.operations.delete(operationId);
    }

    const reservationCutoff = now - this.options.releasedReservationRetentionMs;
    const expiredReservations = [...this.reservations.entries()]
      .filter(
        ([, reservation]) =>
          reservation.state === "released" && reservation.updatedAt <= reservationCutoff,
      )
      .toSorted(
        ([leftId, left], [rightId, right]) =>
          left.updatedAt - right.updatedAt || leftId.localeCompare(rightId),
      )
      .slice(0, this.options.cleanupBatchSize);
    for (const [reservationId] of expiredReservations) {
      this.reservations.delete(reservationId);
    }

    const releasedReservations = [...this.reservations.values()].filter(
      (reservation) => reservation.state === "released",
    );
    const evictedCount = Math.max(
      0,
      releasedReservations.length - this.options.maxReleasedReservations,
    );
    const evictedReservations = releasedReservations
      .toSorted(
        (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
      )
      .slice(0, evictedCount);
    for (const reservation of evictedReservations) {
      this.reservations.delete(reservation.id);
    }

    const releasedReservationCount = releasedReservations.length - evictedReservations.length;
    const operationCount = this.operations.size;
    this.operationCapacityExceeded = operationCount >= this.options.maxOperationRecords;

    const reconciliationCutoff = now - this.options.reconciliationJobRetentionMs;
    const expiredReconciliations = [...this.reconciliations.entries()]
      .filter(
        ([, state]) =>
          (state.job.status === "completed" || state.job.status === "failed") &&
          state.job.updatedAt <= reconciliationCutoff,
      )
      .toSorted(
        ([leftId, left], [rightId, right]) =>
          left.job.updatedAt - right.job.updatedAt || leftId.localeCompare(rightId),
      )
      .slice(0, this.options.cleanupBatchSize);
    for (const [jobId, state] of expiredReconciliations) {
      this.reconciliations.delete(jobId);
      const workerBoot = workerBootKey(state.job.workerId, state.job.bootId);
      if (this.reconciliationByWorkerBoot.get(workerBoot) === jobId) {
        this.reconciliationByWorkerBoot.delete(workerBoot);
      }
    }

    return {
      deletedOperations: expiredOperations.length,
      deletedReleasedReservations: expiredReservations.length,
      evictedReleasedReservations: evictedReservations.length,
      operationCount,
      releasedReservationCount,
      operationCapacityExceeded: this.operationCapacityExceeded,
      deletedReconciliationJobs: expiredReconciliations.length,
    };
  }

  /** @internal 照合・テスト用。公開 ResourceStore 契約には含めない。 */
  public async listReservationsPage(
    filter: ReservationFilter = {},
    options: ReservationPageOptions = {},
  ): Promise<ReservationPage> {
    const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
    const matches = [...this.reservations.values()]
      .filter(
        (reservation) =>
          (options.cursor === undefined || reservation.id.localeCompare(options.cursor) > 0) &&
          matchesReservationFilter(reservation, filter),
      )
      .map(cloneReservation)
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const reservations = matches.slice(0, limit);
    const nextCursor =
      matches.length > limit ? reservations[reservations.length - 1]?.id : undefined;
    return {
      reservations,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private recordReserveResult(
    operationId: OperationId,
    result: ReserveResult,
    at: number,
  ): ReserveResult {
    this.operations.set(operationId, {
      kind: "reserve",
      result,
      occurredAt: at,
      recordedAt: at,
    });
    return result;
  }

  private applyTransition(
    event: Exclude<ResourceEvent, { type: "worker-stopped" }>,
    now: number,
  ): TransitionResult {
    const reservation = this.reservations.get(event.reservationId);
    if (reservation === undefined) {
      return { status: "rejected", reason: "not-found" };
    }

    const plan = planTransition(reservation, event, now, this.options);
    if (plan.kind === "ignore") {
      return { status: "ignored", reason: plan.reason };
    }
    if (plan.kind === "reject") {
      return { status: "rejected", reason: plan.reason };
    }

    if (plan.releaseQuota) {
      this.releaseQuota(reservation);
    }
    this.reservations.set(plan.next.id, plan.next);
    return { status: "applied", reservation: cloneReservation(plan.next) };
  }

  private releaseQuota(reservation: Reservation): void {
    for (const scope of reservation.scopes) {
      const quota = this.quotas.get(quotaScopeKey(scope));
      if (quota === undefined) {
        throw new Error(`quota is missing for ${quotaScopeKey(scope)}`);
      }
      if (quota.usedCount <= 0 || quota.usedBytes < reservation.sizeBytes) {
        throw new Error(`quota accounting is inconsistent for ${quotaScopeKey(scope)}`);
      }
      quota.usedCount -= 1;
      quota.usedBytes -= reservation.sizeBytes;
    }
  }
}

export function createInMemoryResourceStore(options: ResourceStoreOptions): InMemoryResourceStore {
  return new InMemoryResourceStore(options);
}
