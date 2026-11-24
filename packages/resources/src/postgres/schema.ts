import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { QuotaScope } from "../contract.js";

export const resourceQuota = pgTable(
  "resource_quota",
  {
    scopeKind: text("scope_kind").notNull(),
    scopeKey: text("scope_key").notNull(),
    maxCount: bigint("max_count", { mode: "number" }).notNull(),
    maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
    usedCount: bigint("used_count", { mode: "number" }).notNull().default(0),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.scopeKind, table.scopeKey] })],
);

export const resourceReservation = pgTable(
  "resource_reservation",
  {
    id: text("id").primaryKey(),
    state: text("state").notNull(),
    scopes: jsonb("scopes").$type<readonly QuotaScope[]>().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    resourceId: text("resource_id"),
    workerId: text("worker_id"),
    bootId: text("boot_id"),
    version: integer("version").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }),
  },
  (table) => [
    index("resource_reservation_worker_idx").on(table.workerId, table.bootId),
    index("resource_reservation_state_idx").on(table.state),
    index("resource_reservation_released_updated_idx").on(table.state, table.updatedAt),
    index("resource_reservation_expires_at_idx").on(table.expiresAt, table.id),
  ],
);

export const resourceOperation = pgTable(
  "resource_operation",
  {
    operationId: text("operation_id").primaryKey(),
    kind: text("kind").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
  },
  (table) => [index("resource_operation_recorded_at_idx").on(table.recordedAt)],
);

export const rateLimitEntry = pgTable(
  "rate_limit_entry",
  {
    tableKey: text("table_key").notNull(),
    entryKey: text("entry_key").notNull(),
    windowStartedAt: bigint("window_started_at", { mode: "number" }).notNull(),
    count: bigint("count", { mode: "number" }).notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tableKey, table.entryKey] })],
);

export const rateLimitGlobal = pgTable("rate_limit_global", {
  tableKey: text("table_key").primaryKey(),
  windowStartedAt: bigint("window_started_at", { mode: "number" }).notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
});

export const workerBoot = pgTable(
  "worker_boot",
  {
    workerId: text("worker_id").notNull(),
    bootId: text("boot_id").notNull(),
    state: text("state").notNull(),
    jobId: text("job_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workerId, table.bootId] }),
    index("worker_boot_job_idx").on(table.jobId),
  ],
);

export const reconciliationJob = pgTable(
  "reconciliation_job",
  {
    jobId: text("job_id").primaryKey(),
    workerId: text("worker_id").notNull(),
    bootId: text("boot_id").notNull(),
    status: text("status").notNull(),
    lastTargetSeq: bigint("last_target_seq", { mode: "number" }).notNull().default(0),
    targetCount: bigint("target_count", { mode: "number" }).notNull().default(0),
    targetBytes: bigint("target_bytes", { mode: "number" }).notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("reconciliation_job_worker_boot_idx").on(table.workerId, table.bootId),
    index("reconciliation_job_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

export const reconciliationConfirmedResource = pgTable(
  "reconciliation_confirmed_resource",
  {
    jobId: text("job_id").notNull(),
    resourceId: text("resource_id").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.resourceId] }),
    index("reconciliation_confirmed_job_idx").on(table.jobId),
  ],
);

export const reconciliationTarget = pgTable(
  "reconciliation_target",
  {
    jobId: text("job_id").notNull(),
    targetSeq: bigserial("target_seq", { mode: "number" }).notNull(),
    reservationId: text("reservation_id").notNull(),
    resourceId: text("resource_id"),
    confirmed: boolean("confirmed").notNull(),
    state: text("state").notNull(),
    processedAt: bigint("processed_at", { mode: "number" }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.targetSeq] }),
    uniqueIndex("reconciliation_target_job_reservation_idx").on(table.jobId, table.reservationId),
    index("reconciliation_target_pending_idx").on(table.jobId, table.state, table.targetSeq),
  ],
);

export const resourceAuditEvent = pgTable(
  "resource_audit_event",
  {
    eventId: text("event_id").primaryKey(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    operationId: text("operation_id"),
    reservationId: text("reservation_id"),
    resourceId: text("resource_id"),
    workerId: text("worker_id"),
    bootId: text("boot_id"),
    reconciliationJobId: text("reconciliation_job_id"),
    stateBefore: text("state_before"),
    stateAfter: text("state_after"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    maxCountBefore: bigint("max_count_before", { mode: "number" }),
    maxCountAfter: bigint("max_count_after", { mode: "number" }),
    maxBytesBefore: bigint("max_bytes_before", { mode: "number" }),
    maxBytesAfter: bigint("max_bytes_after", { mode: "number" }),
  },
  (table) => [
    index("resource_audit_event_recorded_idx").on(table.recordedAt, table.eventId),
    index("resource_audit_event_type_recorded_idx").on(table.eventType, table.recordedAt),
  ],
);

export const resourceAuditScope = pgTable(
  "resource_audit_scope",
  {
    eventId: text("event_id").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeRef: text("scope_ref").notNull(),
    keyVersion: integer("key_version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.scopeKind, table.scopeRef] }),
    index("resource_audit_scope_lookup_idx").on(table.scopeKind, table.scopeRef, table.eventId),
  ],
);
