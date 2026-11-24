import type { QuotaScope, QuotaScopeKind } from "../contract.js";
import type {
  BootId,
  OperationId,
  ReconciliationJobId,
  ReservationId,
  ResourceId,
  WorkerId,
} from "../id.js";
import type { ResourceState } from "../state.js";

export interface ResourceAuditKey {
  readonly version: number;
  readonly secret: string;
}

export interface ResourceAuditOptions {
  readonly keys: readonly ResourceAuditKey[];
  readonly activeKeyVersion: number;
  readonly retentionMs?: number;
  readonly cleanupBatchSize?: number;
}

export interface ResolvedResourceAuditOptions {
  readonly keys: readonly ResourceAuditKey[];
  readonly activeKeyVersion: number;
  readonly retentionMs: number;
  readonly cleanupBatchSize: number;
}

export const DEFAULT_AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const DEFAULT_AUDIT_CLEANUP_BATCH_SIZE = 10_000;
export const MAX_AUDIT_CLEANUP_BATCH_SIZE = 10_000;
export const MAX_AUDIT_KEY_VERSION = 2_147_483_647;

export function resolveResourceAuditOptions(
  options: ResourceAuditOptions,
): ResolvedResourceAuditOptions {
  if (options.keys.length === 0) {
    throw new Error("audit keys must not be empty");
  }
  const versions = new Set<number>();
  for (const key of options.keys) {
    if (!Number.isSafeInteger(key.version) || key.version <= 0) {
      throw new Error("audit key versions must be positive safe integers");
    }
    if (key.version > MAX_AUDIT_KEY_VERSION) {
      throw new Error(`audit key versions must not exceed ${MAX_AUDIT_KEY_VERSION}`);
    }
    if (versions.has(key.version)) {
      throw new Error("audit key versions must be unique");
    }
    if (key.secret.trim().length === 0) {
      throw new Error("audit key secrets must not be blank");
    }
    versions.add(key.version);
  }
  if (!versions.has(options.activeKeyVersion)) {
    throw new Error("active audit key version is not configured");
  }
  const retentionMs = options.retentionMs ?? DEFAULT_AUDIT_RETENTION_MS;
  const cleanupBatchSize = options.cleanupBatchSize ?? DEFAULT_AUDIT_CLEANUP_BATCH_SIZE;
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new Error("audit retentionMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(cleanupBatchSize) || cleanupBatchSize <= 0) {
    throw new Error("audit cleanupBatchSize must be a positive safe integer");
  }
  if (cleanupBatchSize > MAX_AUDIT_CLEANUP_BATCH_SIZE) {
    throw new Error(`audit cleanupBatchSize must not exceed ${MAX_AUDIT_CLEANUP_BATCH_SIZE}`);
  }
  return {
    keys: options.keys,
    activeKeyVersion: options.activeKeyVersion,
    retentionMs,
    cleanupBatchSize,
  };
}

export type ResourceAuditEventType =
  | "reserve"
  | "allocated"
  | "release-requested"
  | "released"
  | "release-failed"
  | "outcome-unknown"
  | "isolate"
  | "expire"
  | "reconciliation-start"
  | "reconciliation-complete"
  | "reconciliation-reclaimed"
  | "reconciliation-isolated"
  | "quota-set"
  | "quota-delete";

export type ResourceAuditOutcome = "applied" | "started" | "completed" | "deleted";

export interface ResourceAuditScope {
  readonly kind: QuotaScopeKind;
  readonly ref: string;
  readonly keyVersion: number;
}

export interface ResourceAuditEvent {
  readonly id: string;
  readonly recordedAt: number;
  readonly occurredAt: number;
  readonly type: ResourceAuditEventType;
  readonly outcome: ResourceAuditOutcome;
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
  readonly scopes: readonly ResourceAuditScope[];
}

export interface ResourceAuditFilter {
  readonly scope?: QuotaScope;
  readonly eventTypes?: readonly ResourceAuditEventType[];
  readonly from?: number;
  readonly to?: number;
}

export interface ResourceAuditPageOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ResourceAuditPage {
  readonly events: readonly ResourceAuditEvent[];
  readonly nextCursor?: string;
}

export interface ResourceAuditCleanupResult {
  readonly deletedAuditEvents: number;
}

export const DEFAULT_AUDIT_PAGE_SIZE = 100;
export const MAX_AUDIT_PAGE_SIZE = 1_000;
