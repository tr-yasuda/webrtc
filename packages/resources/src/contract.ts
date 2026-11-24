import type {
  BootId,
  OperationId,
  ReconciliationJobId,
  ReservationId,
  ResourceId,
  WorkerId,
} from "./id.js";
import type { ResourceState } from "./state.js";

export type QuotaScopeKind = "user" | "room" | "server";

export interface QuotaScope {
  readonly kind: QuotaScopeKind;
  readonly key: string;
}

export interface QuotaLimit {
  readonly scope: QuotaScope;
  readonly maxCount: number;
  readonly maxBytes: number;
}

export interface QuotaUsage {
  readonly scope: QuotaScope;
  readonly maxCount: number;
  readonly maxBytes: number;
  readonly usedCount: number;
  readonly usedBytes: number;
}

export type QuotaDeleteResult =
  | { readonly status: "deleted" }
  | { readonly status: "in-use"; readonly usage: QuotaUsage }
  | { readonly status: "not-found" };

export interface ResourceClaim {
  /** サーバー全体の上限を適用するため、`server` スコープを1つ以上含める。 */
  readonly scopes: readonly QuotaScope[];
  readonly sizeBytes: number;
  readonly ttlMs?: number;
}

export interface Reservation {
  readonly id: ReservationId;
  readonly state: ResourceState;
  readonly scopes: readonly QuotaScope[];
  readonly sizeBytes: number;
  readonly resourceId?: ResourceId;
  readonly workerId?: WorkerId;
  readonly bootId?: BootId;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt?: number;
}

interface ResourceEventBase {
  readonly operationId: OperationId;
  /** 通知元で発生した時刻。状態遷移と TTL はストアの now を使い、この値は操作記録の監査時刻として保存する。 */
  readonly at: number;
}

export interface AllocatedEvent extends ResourceEventBase {
  readonly type: "allocated";
  readonly reservationId: ReservationId;
  readonly resourceId: ResourceId;
  readonly workerId: WorkerId;
  readonly bootId: BootId;
}

export interface ReleaseRequestedEvent extends ResourceEventBase {
  readonly type: "release-requested";
  readonly reservationId: ReservationId;
}

export interface ReleasedEvent extends ResourceEventBase {
  readonly type: "released";
  readonly reservationId: ReservationId;
  readonly resourceId: ResourceId;
  readonly workerId: WorkerId;
  readonly bootId: BootId;
}

export interface ReleaseFailedEvent extends ResourceEventBase {
  readonly type: "release-failed";
  readonly reservationId: ReservationId;
  readonly resourceId: ResourceId;
  readonly workerId: WorkerId;
  readonly bootId: BootId;
}

export interface OutcomeUnknownEvent extends ResourceEventBase {
  readonly type: "outcome-unknown";
  readonly reservationId: ReservationId;
}

export interface IsolateEvent extends ResourceEventBase {
  readonly type: "isolate";
  readonly reservationId: ReservationId;
}

export interface WorkerStoppedEvent extends ResourceEventBase {
  readonly type: "worker-stopped";
  readonly workerId: WorkerId;
  readonly bootId: BootId;
  readonly confirmedResourceIds: readonly ResourceId[];
}

export type ResourceEvent =
  | AllocatedEvent
  | ReleaseRequestedEvent
  | ReleasedEvent
  | ReleaseFailedEvent
  | OutcomeUnknownEvent
  | IsolateEvent
  | WorkerStoppedEvent;

export type ReserveRejectionReason =
  | "invalid-claim"
  | "limit-not-configured"
  | "quota-exceeded"
  | "capacity-exhausted";

export type TransitionRejectionReason =
  | "not-found"
  | "invalid-transition"
  | "correlation-mismatch"
  | "capacity-exhausted";

export type IgnoreReason = "duplicate" | "already-released" | "stale-boot";

export interface ReserveApplied {
  readonly status: "reserved";
  readonly reservation: Reservation;
}

export interface ReserveRejected {
  readonly status: "rejected";
  readonly reason: ReserveRejectionReason;
}

export type ReserveResult = ReserveApplied | ReserveRejected;

export interface TransitionApplied {
  readonly status: "applied";
  readonly reservation: Reservation;
}

export interface TransitionIgnored {
  readonly status: "ignored";
  readonly reason: IgnoreReason;
}

export interface TransitionRejected {
  readonly status: "rejected";
  readonly reason: TransitionRejectionReason;
}

export type TransitionResult = TransitionApplied | TransitionIgnored | TransitionRejected;

export interface ReconciliationStarted {
  readonly status: "reconciliation-started";
  readonly job: ReconciliationJob;
}

export type ApplyEventResult = TransitionResult | ReconciliationStarted;

export interface ReservationFilter {
  readonly workerId?: WorkerId;
  readonly bootId?: BootId;
  readonly state?: ResourceState;
}

export interface ReservationPageOptions {
  readonly cursor?: ReservationId;
  readonly limit?: number;
}

export interface ReservationPage {
  readonly reservations: readonly Reservation[];
  readonly nextCursor?: ReservationId;
}

export interface ResourceStoreOptions {
  readonly reservationTtlMs: number;
  readonly inUseTtlMs?: number;
  readonly operationRetentionMs?: number;
  readonly releasedReservationRetentionMs?: number;
  readonly cleanupBatchSize?: number;
  readonly maxOperationRecords?: number;
  readonly maxReleasedReservations?: number;
  readonly maxScopesPerClaim?: number;
  readonly reconciliationBatchSize?: number;
  readonly reconciliationJobRetentionMs?: number;
  readonly maxConfirmedResourceIds?: number;
  readonly maxConfirmedResourceBytes?: number;
  readonly maxReconciliationTargets?: number;
  readonly maxReconciliationTargetBytes?: number;
}

export const DEFAULT_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_RELEASED_RESERVATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_CLEANUP_BATCH_SIZE = 1_000;
export const DEFAULT_MAX_OPERATION_RECORDS = 100_000;
export const DEFAULT_MAX_RELEASED_RESERVATIONS = 100_000;
export const DEFAULT_MAX_SCOPES_PER_CLAIM = 16;
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 1_000;
export const DEFAULT_RECONCILIATION_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_CONFIRMED_RESOURCE_IDS = 10_000;
export const DEFAULT_MAX_CONFIRMED_RESOURCE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_RECONCILIATION_TARGETS = 100_000;
export const DEFAULT_MAX_RECONCILIATION_TARGET_BYTES = 16 * 1024 * 1024;

export interface ResolvedResourceStoreOptions {
  readonly reservationTtlMs: number;
  readonly inUseTtlMs?: number;
  readonly operationRetentionMs: number;
  readonly releasedReservationRetentionMs: number;
  readonly cleanupBatchSize: number;
  readonly maxOperationRecords: number;
  readonly maxReleasedReservations: number;
  readonly maxScopesPerClaim: number;
  readonly reconciliationBatchSize: number;
  readonly reconciliationJobRetentionMs: number;
  readonly maxConfirmedResourceIds: number;
  readonly maxConfirmedResourceBytes: number;
  readonly maxReconciliationTargets: number;
  readonly maxReconciliationTargetBytes: number;
}

export function resolveResourceStoreOptions(
  options: ResourceStoreOptions,
): ResolvedResourceStoreOptions {
  if (!Number.isSafeInteger(options.reservationTtlMs) || options.reservationTtlMs <= 0) {
    throw new Error("reservationTtlMs must be a positive safe integer");
  }
  if (
    options.inUseTtlMs !== undefined &&
    (!Number.isSafeInteger(options.inUseTtlMs) || options.inUseTtlMs <= 0)
  ) {
    throw new Error("inUseTtlMs must be a positive safe integer");
  }
  const operationRetentionMs = options.operationRetentionMs ?? DEFAULT_OPERATION_RETENTION_MS;
  const releasedReservationRetentionMs =
    options.releasedReservationRetentionMs ?? DEFAULT_RELEASED_RESERVATION_RETENTION_MS;
  const cleanupBatchSize = options.cleanupBatchSize ?? DEFAULT_CLEANUP_BATCH_SIZE;
  const maxOperationRecords = options.maxOperationRecords ?? DEFAULT_MAX_OPERATION_RECORDS;
  const maxReleasedReservations =
    options.maxReleasedReservations ?? DEFAULT_MAX_RELEASED_RESERVATIONS;
  const maxScopesPerClaim = options.maxScopesPerClaim ?? DEFAULT_MAX_SCOPES_PER_CLAIM;
  const reconciliationBatchSize =
    options.reconciliationBatchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE;
  const reconciliationJobRetentionMs =
    options.reconciliationJobRetentionMs ?? DEFAULT_RECONCILIATION_JOB_RETENTION_MS;
  const maxConfirmedResourceIds =
    options.maxConfirmedResourceIds ?? DEFAULT_MAX_CONFIRMED_RESOURCE_IDS;
  const maxConfirmedResourceBytes =
    options.maxConfirmedResourceBytes ?? DEFAULT_MAX_CONFIRMED_RESOURCE_BYTES;
  const maxReconciliationTargets =
    options.maxReconciliationTargets ?? DEFAULT_MAX_RECONCILIATION_TARGETS;
  const maxReconciliationTargetBytes =
    options.maxReconciliationTargetBytes ?? DEFAULT_MAX_RECONCILIATION_TARGET_BYTES;
  if (!Number.isSafeInteger(operationRetentionMs) || operationRetentionMs <= 0) {
    throw new Error("operationRetentionMs must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(releasedReservationRetentionMs) ||
    releasedReservationRetentionMs <= 0
  ) {
    throw new Error("releasedReservationRetentionMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(cleanupBatchSize) || cleanupBatchSize <= 0) {
    throw new Error("cleanupBatchSize must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxOperationRecords) || maxOperationRecords <= 0) {
    throw new Error("maxOperationRecords must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxReleasedReservations) || maxReleasedReservations <= 0) {
    throw new Error("maxReleasedReservations must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxScopesPerClaim) || maxScopesPerClaim <= 0) {
    throw new Error("maxScopesPerClaim must be a positive safe integer");
  }
  if (!Number.isSafeInteger(reconciliationBatchSize) || reconciliationBatchSize <= 0) {
    throw new Error("reconciliationBatchSize must be a positive safe integer");
  }
  for (const [name, value] of [
    ["reconciliationJobRetentionMs", reconciliationJobRetentionMs],
    ["maxConfirmedResourceIds", maxConfirmedResourceIds],
    ["maxConfirmedResourceBytes", maxConfirmedResourceBytes],
    ["maxReconciliationTargets", maxReconciliationTargets],
    ["maxReconciliationTargetBytes", maxReconciliationTargetBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }

  return {
    reservationTtlMs: options.reservationTtlMs,
    ...(options.inUseTtlMs === undefined ? {} : { inUseTtlMs: options.inUseTtlMs }),
    operationRetentionMs,
    releasedReservationRetentionMs,
    cleanupBatchSize,
    maxOperationRecords,
    maxReleasedReservations,
    maxScopesPerClaim,
    reconciliationBatchSize,
    reconciliationJobRetentionMs,
    maxConfirmedResourceIds,
    maxConfirmedResourceBytes,
    maxReconciliationTargets,
    maxReconciliationTargetBytes,
  };
}

export interface ExpireBatchResult {
  readonly released: readonly ReservationId[];
  readonly isolated: readonly ReservationId[];
  readonly hasMore: boolean;
}

export interface RetentionCleanupResult {
  readonly deletedOperations: number;
  readonly deletedReleasedReservations: number;
  readonly evictedReleasedReservations: number;
  readonly operationCount: number;
  readonly releasedReservationCount: number;
  readonly operationCapacityExceeded: boolean;
  readonly deletedReconciliationJobs: number;
}

export type ReconciliationJobStatus = "pending" | "running" | "completed" | "failed";

export interface ReconciliationJob {
  readonly id: ReconciliationJobId;
  readonly workerId: WorkerId;
  readonly bootId: BootId;
  readonly status: ReconciliationJobStatus;
  readonly lastTargetSeq: number;
  readonly targetCount: number;
  readonly targetBytes: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error?: string;
}

export interface ReconciliationBatchOptions {
  readonly cursor: number;
  readonly limit?: number;
}

export interface ReconciliationBatchResult {
  readonly reclaimed: readonly ReservationId[];
  readonly isolated: readonly ReservationId[];
  readonly unchanged: readonly ReservationId[];
  readonly nextCursor?: number;
  readonly hasMore: boolean;
  readonly status: ReconciliationJobStatus;
}

export class ReconciliationJobNotFoundError extends Error {
  public readonly jobId: ReconciliationJobId;

  public constructor(jobId: ReconciliationJobId) {
    super(`reconciliation job not found: ${jobId}`);
    this.name = "ReconciliationJobNotFoundError";
    this.jobId = jobId;
  }
}

export class ReconciliationCursorMismatchError extends Error {
  public readonly expected: number;
  public readonly actual: number;

  public constructor(expected: number, actual: number) {
    super(`reconciliation cursor mismatch: expected ${expected}, got ${actual}`);
    this.name = "ReconciliationCursorMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class ReconciliationCapacityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReconciliationCapacityError";
  }
}

export interface ResourceStore {
  setQuotaLimit(limit: QuotaLimit, now?: number): Promise<void>;
  getQuotaUsage(scope: QuotaScope): Promise<QuotaUsage | undefined>;
  deleteQuotaScope(scope: QuotaScope, now?: number): Promise<QuotaDeleteResult>;
  reserve(claim: ResourceClaim, operationId: OperationId, now: number): Promise<ReserveResult>;
  applyEvent(event: ResourceEvent, now: number): Promise<ApplyEventResult>;
  expire(now: number, options?: { readonly limit?: number }): Promise<ExpireBatchResult>;
  getReservation(id: ReservationId): Promise<Reservation | undefined>;
  getOperationOccurredAt(operationId: OperationId): Promise<number | undefined>;
  getOperationRecordedAt(operationId: OperationId): Promise<number | undefined>;
  startReconciliation(event: WorkerStoppedEvent, now: number): Promise<ReconciliationJob>;
  continueReconciliation(
    jobId: ReconciliationJobId,
    options: ReconciliationBatchOptions,
    now: number,
  ): Promise<ReconciliationBatchResult>;
  getReconciliationJob(jobId: ReconciliationJobId): Promise<ReconciliationJob | undefined>;
  cleanup(now: number): Promise<RetentionCleanupResult>;
}

export type RateLimitRejectionReason =
  | "invalid-request"
  | "entry-limit"
  | "byte-limit"
  | "request-limit"
  | "bandwidth-limit";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly reason?: RateLimitRejectionReason;
  readonly retryAfterMs?: number;
}

export interface RateLimitOptions {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly entryOverheadBytes: number;
  readonly idleTtlMs: number;
  readonly windowMs: number;
  readonly maxRequestsPerKey: number;
  readonly maxBytesPerKey: number;
  readonly maxRequestsGlobal: number;
  readonly maxBytesGlobal: number;
}

export interface RateLimitUsage {
  readonly entries: number;
  readonly bytes: number;
}

export interface RateLimitTable {
  consume(key: string, costBytes: number, now: number): Promise<RateLimitDecision>;
  sweep(now: number): Promise<void>;
  getUsage(): Promise<RateLimitUsage>;
}

export function validateRateLimitOptions(options: RateLimitOptions): void {
  if (
    !Number.isSafeInteger(options.maxEntries) ||
    options.maxEntries <= 0 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes <= 0 ||
    !Number.isSafeInteger(options.idleTtlMs) ||
    options.idleTtlMs <= 0 ||
    !Number.isSafeInteger(options.windowMs) ||
    options.windowMs <= 0
  ) {
    throw new Error("rate limit capacities and durations must be positive safe integers");
  }
  if (
    !Number.isSafeInteger(options.entryOverheadBytes) ||
    options.entryOverheadBytes < 0 ||
    !Number.isSafeInteger(options.maxRequestsPerKey) ||
    options.maxRequestsPerKey <= 0 ||
    !Number.isSafeInteger(options.maxBytesPerKey) ||
    options.maxBytesPerKey <= 0 ||
    !Number.isSafeInteger(options.maxRequestsGlobal) ||
    options.maxRequestsGlobal <= 0 ||
    !Number.isSafeInteger(options.maxBytesGlobal) ||
    options.maxBytesGlobal <= 0
  ) {
    throw new Error("rate limit values must be positive");
  }
}

export function quotaScopeKey(scope: QuotaScope): string {
  return `${scope.kind}:${scope.key}`;
}

export function compareQuotaScopes(left: QuotaScope, right: QuotaScope): number {
  const kindOrder: Readonly<Record<QuotaScopeKind, number>> = {
    server: 0,
    room: 1,
    user: 2,
  };
  const kindDifference = kindOrder[left.kind] - kindOrder[right.kind];
  if (kindDifference !== 0) {
    return kindDifference;
  }

  if (left.key === right.key) {
    return 0;
  }
  return left.key < right.key ? -1 : 1;
}

export function validateResourceClaim(
  claim: ResourceClaim,
  maxScopes: number = DEFAULT_MAX_SCOPES_PER_CLAIM,
): { readonly ok: true; readonly scopes: readonly QuotaScope[] } | { readonly ok: false } {
  if (!Number.isSafeInteger(claim.sizeBytes) || claim.sizeBytes < 0) {
    return { ok: false };
  }
  if (claim.ttlMs !== undefined && (!Number.isSafeInteger(claim.ttlMs) || claim.ttlMs <= 0)) {
    return { ok: false };
  }
  if (claim.scopes.length === 0 || claim.scopes.length > maxScopes) {
    return { ok: false };
  }

  const seen = new Set<string>();
  let hasServerScope = false;
  for (const scope of claim.scopes) {
    if (scope.key.length === 0) {
      return { ok: false };
    }
    if (scope.kind !== "user" && scope.kind !== "room" && scope.kind !== "server") {
      return { ok: false };
    }
    const key = quotaScopeKey(scope);
    if (seen.has(key)) {
      return { ok: false };
    }
    seen.add(key);
    hasServerScope ||= scope.kind === "server";
  }
  if (!hasServerScope) {
    return { ok: false };
  }

  return { ok: true, scopes: claim.scopes.toSorted(compareQuotaScopes) };
}

export function resolveBatchLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined) {
    return maximum;
  }
  if (!Number.isSafeInteger(requested)) {
    throw new Error("batch limit must be a safe integer");
  }
  return Math.max(1, Math.min(requested, maximum));
}
