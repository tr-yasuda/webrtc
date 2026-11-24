import { inArray, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { monotonicFactory } from "ulid";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_PAGE_SIZE,
  type ResourceAuditCleanupResult,
  type ResourceAuditEvent,
  type ResourceAuditEventType,
  type ResourceAuditFilter,
  type ResourceAuditOutcome,
  type ResourceAuditPage,
  type ResourceAuditPageOptions,
  type ResolvedResourceAuditOptions,
} from "../audit/contract.js";
import { computeScopeRef } from "../audit/scope-ref.js";
import type { QuotaScope } from "../contract.js";
import {
  asBootId,
  asOperationId,
  asReconciliationJobId,
  asReservationId,
  asResourceId,
  asWorkerId,
  type BootId,
  type OperationId,
  type ReconciliationJobId,
  type ReservationId,
  type ResourceId,
  type WorkerId,
} from "../id.js";
import type { ResourceState } from "../state.js";
import { toQuotaScopeKind, toResourceState } from "./codec.js";
import type { ResourcesDatabase, ResourcesTransaction } from "./db.js";
import * as schema from "./schema.js";

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

// 同一 recorded_at の監査イベントを挿入順でページングするため、プロセス内で単調増加させる。
const nextAuditEventId = monotonicFactory();

export interface AuditWriteInput {
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

export class PostgresAuditLog {
  public constructor(
    private readonly db: ResourcesDatabase,
    private readonly pool: Pool,
    private readonly options: ResolvedResourceAuditOptions,
  ) {}

  public async write(tx: ResourcesTransaction, input: AuditWriteInput): Promise<void> {
    const activeKey = this.options.keys.find(
      (key) => key.version === this.options.activeKeyVersion,
    );
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

  public async list(
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
      const refs = this.options.keys.map((key) => computeScopeRef(key.secret, key.version, scope));
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
    const page = pageRows.map((row) => this.toEvent(row, scopesByEvent.get(row.event_id) ?? []));
    const last = page[page.length - 1];
    return {
      events: page,
      ...(events.rows.length > limit && last !== undefined
        ? { nextCursor: `${last.recordedAt}:${last.id}` }
        : {}),
    };
  }

  public async cleanup(now: number): Promise<ResourceAuditCleanupResult> {
    const cutoff = now - this.options.retentionMs;
    return this.db.transaction(async (tx) => {
      const deleted = await tx.execute(sql`
        DELETE FROM resource_audit_event
        WHERE event_id IN (
          SELECT event_id FROM resource_audit_event
          WHERE recorded_at <= ${cutoff}
          ORDER BY recorded_at
          LIMIT ${this.options.cleanupBatchSize}
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

  private toEvent(
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
}
