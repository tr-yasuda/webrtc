import type {
  QuotaScope,
  QuotaUsage,
  ReconciliationJob,
  ReconciliationJobStatus,
  Reservation,
} from "../contract.js";
import {
  asBootId,
  asReconciliationJobId,
  asReservationId,
  asResourceId,
  asWorkerId,
} from "../id.js";
import { RESOURCE_STATES, type ResourceState } from "../state.js";

export interface ReservationRowLike {
  readonly id: string;
  readonly state: string;
  readonly scopes: readonly QuotaScope[];
  readonly sizeBytes: number;
  readonly resourceId: string | null;
  readonly workerId: string | null;
  readonly bootId: string | null;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}

export interface QuotaRowLike {
  readonly scopeKind: string;
  readonly scopeKey: string;
  readonly maxCount: number;
  readonly maxBytes: number;
  readonly usedCount: number;
  readonly usedBytes: number;
}

export interface ReconciliationJobRowLike {
  readonly jobId: string;
  readonly workerId: string;
  readonly bootId: string;
  readonly status: string;
  readonly lastTargetSeq: number;
  readonly targetCount: number;
  readonly targetBytes: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error: string | null;
}

export function toResourceState(value: string): ResourceState {
  if (!RESOURCE_STATES.includes(value as ResourceState)) {
    throw new Error(`unknown resource state: ${value}`);
  }
  return value as ResourceState;
}

export function toQuotaScopeKind(value: string): QuotaScope["kind"] {
  if (value !== "user" && value !== "room" && value !== "server") {
    throw new Error(`unknown quota scope kind: ${value}`);
  }
  return value;
}

export function toReservation(row: ReservationRowLike): Reservation {
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

export function toQuotaUsage(row: QuotaRowLike): QuotaUsage {
  return {
    scope: { kind: toQuotaScopeKind(row.scopeKind), key: row.scopeKey },
    maxCount: row.maxCount,
    maxBytes: row.maxBytes,
    usedCount: row.usedCount,
    usedBytes: row.usedBytes,
  };
}

export function toReconciliationJob(row: ReconciliationJobRowLike): ReconciliationJob {
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

export function toReconciliationJobStatus(value: string): ReconciliationJobStatus {
  if (value !== "pending" && value !== "running" && value !== "completed" && value !== "failed") {
    throw new Error(`unknown reconciliation job status: ${value}`);
  }
  return value;
}
