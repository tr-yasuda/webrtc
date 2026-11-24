import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asResourceId,
  asWorkerId,
  createPostgresResourceStore as createPostgresResourceStoreRaw,
  type QuotaScope,
  type PostgresResourceStore,
  type PostgresResourceStoreOptions,
  type ResourceClaim,
} from "../../src/index.js";
import * as schema from "../../src/postgres/schema.js";

const serverScope: QuotaScope = { kind: "server", key: "pg-server" };
const userScope: QuotaScope = { kind: "user", key: "pg-user" };
const workerId = asWorkerId("pg-worker");
const bootId = asBootId("pg-boot-1");
const auditOptions = {
  keys: [{ version: 1, secret: "integration-audit-secret" }],
  activeKeyVersion: 1,
} as const;

let container: StartedPostgreSqlContainer;
let pool: Pool;

function createPostgresResourceStore(
  options: Omit<PostgresResourceStoreOptions, "audit">,
): PostgresResourceStore {
  return createPostgresResourceStoreRaw({ ...options, audit: auditOptions });
}

async function expectAuditWriteFailure(action: () => Promise<unknown>): Promise<void> {
  await pool.query("ALTER TABLE resource_audit_event RENAME TO resource_audit_event_disabled");
  try {
    await expect(action()).rejects.toThrow();
  } finally {
    await pool.query("ALTER TABLE resource_audit_event_disabled RENAME TO resource_audit_event");
  }
}

async function expectAuditScopeWriteFailure(action: () => Promise<unknown>): Promise<void> {
  await pool.query("ALTER TABLE resource_audit_scope RENAME TO resource_audit_scope_disabled");
  try {
    await expect(action()).rejects.toThrow();
  } finally {
    await pool.query("ALTER TABLE resource_audit_scope_disabled RENAME TO resource_audit_scope");
  }
}

function claim(sizeBytes = 1, ttlMs?: number): ResourceClaim {
  return {
    scopes: [serverScope, userScope],
    sizeBytes,
    ...(ttlMs === undefined ? {} : { ttlMs }),
  };
}

function operation(value: string) {
  return asOperationId(value);
}

async function createStore(maxCount = 2, maxBytes = 10): Promise<PostgresResourceStore> {
  const store = createPostgresResourceStore({
    pool,
    reservationTtlMs: 1_000,
  });
  await store.setQuotaLimit({ scope: serverScope, maxCount, maxBytes });
  await store.setQuotaLimit({ scope: userScope, maxCount, maxBytes });
  return store;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
  });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE resource_quota, resource_reservation, resource_operation,
       rate_limit_entry, rate_limit_global, worker_boot, reconciliation_job,
       reconciliation_confirmed_resource, reconciliation_target,
       resource_audit_event, resource_audit_scope`,
  );
});

describe("PostgreSQL 監査ログ", () => {
  test("予約成功だけを監査し、生のスコープキーを保存しない", async () => {
    const store = await createStore(1, 10);
    const reserved = await store.reserve(claim(), operation("reserve-audit"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    const events = await pool.query<{
      event_type: string;
      outcome: string;
      reservation_id: string;
    }>(
      "SELECT event_type, outcome, reservation_id FROM resource_audit_event WHERE event_type = 'reserve'",
    );
    expect(events.rows).toEqual([
      {
        event_type: "reserve",
        outcome: "applied",
        reservation_id: reserved.reservation.id,
      },
    ]);
    const scopes = await pool.query<{ scope_kind: string; scope_ref: string }>(
      `SELECT s.scope_kind, s.scope_ref
       FROM resource_audit_scope s
       JOIN resource_audit_event e ON e.event_id = s.event_id
       WHERE e.event_type = 'reserve'
       ORDER BY s.scope_kind`,
    );
    expect(scopes.rows.map((row) => row.scope_kind)).toEqual(["server", "user"]);
    expect(scopes.rows.some((row) => row.scope_ref === serverScope.key)).toBe(false);
    expect(scopes.rows.some((row) => row.scope_ref === userScope.key)).toBe(false);

    expect(await store.reserve(claim(100), operation("reserve-rejected"), 1)).toMatchObject({
      status: "rejected",
      reason: "quota-exceeded",
    });
    const count = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_audit_event WHERE event_type = 'reserve'",
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  test("監査ログの書き込みに失敗すると予約もロールバックする", async () => {
    const store = await createStore(2, 10);
    await pool.query("ALTER TABLE resource_audit_event RENAME TO resource_audit_event_disabled");
    try {
      await expect(store.reserve(claim(), operation("reserve-audit-failure"), 0)).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE resource_audit_event_disabled RENAME TO resource_audit_event");
    }

    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 0,
      usedBytes: 0,
    });
    const reservations = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_reservation",
    );
    expect(reservations.rows[0]?.count).toBe(0);
  });

  test("quota 設定・通知・期限切れでも監査失敗時は状態を戻す", async () => {
    const store = await createStore(3, 10);
    const allocated = await store.reserve(claim(), operation("reserve-rollback"), 0);
    if (allocated.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: allocated.reservation.id,
        resourceId: asResourceId("resource-rollback"),
        workerId,
        bootId,
        operationId: operation("allocate-rollback"),
        at: 1,
      },
      1,
    );
    const roomScope: QuotaScope = { kind: "room", key: "rollback-room" };
    await expectAuditWriteFailure(() =>
      store.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 }, 2),
    );
    expect(await store.getQuotaUsage(roomScope)).toBeUndefined();

    await expectAuditWriteFailure(() =>
      store.applyEvent(
        {
          type: "isolate",
          reservationId: allocated.reservation.id,
          operationId: operation("isolate-rollback"),
          at: 3,
        },
        3,
      ),
    );
    expect(await store.getReservation(allocated.reservation.id)).toMatchObject({
      state: "in-use",
    });

    const expiring = await store.reserve(claim(1, 5), operation("reserve-expire-rollback"), 0);
    if (expiring.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await expectAuditWriteFailure(() => store.expire(5));
    expect(await store.getReservation(expiring.reservation.id)).toMatchObject({
      state: "reserved",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 2 });
  });

  test("quota 削除・照合・scope 書込の監査失敗でも状態を戻す", async () => {
    const store = await createStore(2, 10);
    const roomScope: QuotaScope = { kind: "room", key: "rollback-delete-room" };
    await store.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 }, 0);
    await expectAuditWriteFailure(() => store.deleteQuotaScope(roomScope, 1));
    expect(await store.getQuotaUsage(roomScope)).toBeDefined();

    const reserved = await store.reserve(claim(), operation("reserve-reconcile-rollback"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-reconcile-rollback"),
        workerId,
        bootId,
        operationId: operation("allocate-reconcile-rollback"),
        at: 1,
      },
      1,
    );
    const stopEvent = {
      type: "worker-stopped" as const,
      workerId,
      bootId,
      confirmedResourceIds: [],
      operationId: operation("stop-reconcile-rollback"),
      at: 2,
    };
    await expectAuditWriteFailure(() => store.startReconciliation(stopEvent, 2));
    let jobs = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM reconciliation_job",
    );
    expect(jobs.rows[0]?.count).toBe(0);
    const boots = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM worker_boot",
    );
    expect(boots.rows[0]?.count).toBe(0);
    const targets = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM reconciliation_target",
    );
    expect(targets.rows[0]?.count).toBe(0);

    const job = await store.startReconciliation(stopEvent, 2);
    await expectAuditWriteFailure(() => store.continueReconciliation(job.id, { cursor: 0 }, 3));
    expect(await store.getReconciliationJob(job.id)).toMatchObject({
      status: "pending",
      lastTargetSeq: 0,
    });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
    const pendingTargets = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM reconciliation_target WHERE state = 'pending'",
    );
    expect(pendingTargets.rows[0]?.count).toBe(1);

    const beforeFailure = await pool.query<{ reservations: number; operations: number }>(
      `SELECT
         (SELECT count(*)::int FROM resource_reservation) AS reservations,
         (SELECT count(*)::int FROM resource_operation) AS operations`,
    );
    const beforeUsage = await store.getQuotaUsage(serverScope);
    await expectAuditScopeWriteFailure(() =>
      store.reserve(claim(), operation("reserve-scope-rollback"), 4),
    );
    const afterFailure = await pool.query<{ reservations: number; operations: number }>(
      `SELECT
         (SELECT count(*)::int FROM resource_reservation) AS reservations,
         (SELECT count(*)::int FROM resource_operation) AS operations`,
    );
    expect(afterFailure.rows[0]).toEqual(beforeFailure.rows[0]);
    expect(await store.getQuotaUsage(serverScope)).toEqual(beforeUsage);
  });

  test("状態を変更した通知だけを監査し、無視・拒否は記録しない", async () => {
    const store = await createStore();
    const reserved = await store.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 1,
      },
      1,
    );
    const isolated = await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-1"),
        at: 2,
      },
      2,
    );
    expect(isolated).toMatchObject({ status: "applied" });
    await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-duplicate"),
        at: 3,
      },
      3,
    );
    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("release-mismatch"),
        at: 3,
      },
      3,
    );

    const events = await pool.query<{
      event_type: string;
      state_before: string | null;
      state_after: string | null;
    }>(
      `SELECT event_type, state_before, state_after
       FROM resource_audit_event
       WHERE event_type IN ('allocated', 'isolate')
       ORDER BY recorded_at, event_id`,
    );
    expect(events.rows).toEqual([
      { event_type: "allocated", state_before: "reserved", state_after: "in-use" },
      { event_type: "isolate", state_before: "in-use", state_after: "isolated" },
    ]);
  });

  test("quota の設定と削除を監査し、変更前後の上限を残す", async () => {
    const store = createPostgresResourceStore({ pool, reservationTtlMs: 1_000 });
    const roomScope: QuotaScope = { kind: "room", key: "audit-room" };
    await store.setQuotaLimit({ scope: roomScope, maxCount: 2, maxBytes: 10 }, 0);
    await store.setQuotaLimit({ scope: roomScope, maxCount: 3, maxBytes: 20 }, 1);
    expect(await store.deleteQuotaScope(roomScope, 2)).toEqual({ status: "deleted" });
    expect(await store.deleteQuotaScope(roomScope, 3)).toEqual({ status: "not-found" });

    const events = await pool.query<{
      event_type: string;
      max_count_before: number | null;
      max_count_after: number | null;
      max_bytes_before: number | null;
      max_bytes_after: number | null;
    }>(
      `SELECT event_type, max_count_before::int AS max_count_before,
              max_count_after::int AS max_count_after,
              max_bytes_before::int AS max_bytes_before,
              max_bytes_after::int AS max_bytes_after
       FROM resource_audit_event
       WHERE event_type LIKE 'quota-%'
       ORDER BY recorded_at, event_id`,
    );
    expect(events.rows).toEqual([
      {
        event_type: "quota-set",
        max_count_before: null,
        max_count_after: 2,
        max_bytes_before: null,
        max_bytes_after: 10,
      },
      {
        event_type: "quota-set",
        max_count_before: 2,
        max_count_after: 3,
        max_bytes_before: 10,
        max_bytes_after: 20,
      },
      {
        event_type: "quota-delete",
        max_count_before: 3,
        max_count_after: null,
        max_bytes_before: 20,
        max_bytes_after: null,
      },
    ]);
  });

  test("使用中の quota 削除は監査せず、解放後の削除だけを監査する", async () => {
    const store = createPostgresResourceStore({ pool, reservationTtlMs: 1_000 });
    const roomScope: QuotaScope = { kind: "room", key: "audit-in-use-room" };
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 }, 0);
    await store.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 }, 0);
    const reserved = await store.reserve(
      { scopes: [serverScope, roomScope], sizeBytes: 1 },
      operation("reserve-audit-quota"),
      0,
    );
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    expect(await store.deleteQuotaScope(roomScope, 1)).toMatchObject({ status: "in-use" });
    let count = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_audit_event WHERE event_type = 'quota-delete'",
    );
    expect(count.rows[0]?.count).toBe(0);

    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-audit-quota"),
        workerId,
        bootId,
        operationId: operation("release-audit-quota"),
        at: 2,
      },
      2,
    );
    expect(await store.deleteQuotaScope(roomScope, 3)).toEqual({ status: "deleted" });
    count = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_audit_event WHERE event_type = 'quota-delete'",
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  test("同じ未登録スコープへの同時 quota 設定でも変更前値を欠かさない", async () => {
    const store = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: auditOptions,
    });
    const scope: QuotaScope = { kind: "room", key: "race-quota" };
    await Promise.all([
      store.setQuotaLimit({ scope, maxCount: 2, maxBytes: 10 }, 0),
      store.setQuotaLimit({ scope, maxCount: 3, maxBytes: 20 }, 1),
    ]);

    const events = await pool.query<{
      max_count_before: number | null;
      max_count_after: number;
      max_bytes_before: number | null;
      max_bytes_after: number;
    }>(
      `SELECT max_count_before::int AS max_count_before,
              max_count_after::int AS max_count_after,
              max_bytes_before::int AS max_bytes_before,
              max_bytes_after::int AS max_bytes_after
       FROM resource_audit_event
       WHERE event_type = 'quota-set'
       ORDER BY recorded_at, event_id`,
    );
    expect(events.rows).toHaveLength(2);
    const inserted = events.rows.find((row) => row.max_count_before === null);
    const updated = events.rows.find((row) => row.max_count_before !== null);
    expect(inserted).toBeDefined();
    expect(updated).toBeDefined();
    expect(updated?.max_count_before).toBe(inserted?.max_count_after);
    expect(updated?.max_bytes_before).toBe(inserted?.max_bytes_after);
    expect(events.rows.map((row) => row.max_count_after).toSorted()).toEqual([2, 3]);
  });

  test("quota 設定と削除が競合しても失敗しない", async () => {
    const store = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: auditOptions,
    });
    const scope: QuotaScope = { kind: "room", key: "set-delete-race" };
    await store.setQuotaLimit({ scope, maxCount: 1, maxBytes: 10 }, 0);
    const results = await Promise.allSettled([
      store.setQuotaLimit({ scope, maxCount: 2, maxBytes: 20 }, 1),
      store.deleteQuotaScope(scope, 1),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const usage = await store.getQuotaUsage(scope);
    expect(usage === undefined || usage.maxCount === 2).toBe(true);
  });

  test("期限切れで解放・隔離した予約を監査する", async () => {
    const store = await createStore(2, 10);
    const reserved = await store.reserve(claim(1, 5), operation("reserve-expire-1"), 0);
    const inUse = await store.reserve(claim(1, 5), operation("reserve-expire-2"), 0);
    if (reserved.status !== "reserved" || inUse.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: inUse.reservation.id,
        resourceId: asResourceId("resource-expire"),
        workerId,
        bootId,
        operationId: operation("allocate-expire"),
        at: 1,
      },
      1,
    );
    await store.expire(5);

    const events = await pool.query<{
      event_type: string;
      state_before: string;
      state_after: string;
      resource_id: string | null;
      worker_id: string | null;
      boot_id: string | null;
    }>(
      `SELECT event_type, state_before, state_after, resource_id, worker_id, boot_id
       FROM resource_audit_event
       WHERE event_type = 'expire'
       ORDER BY recorded_at, event_id`,
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows).toEqual(
      expect.arrayContaining([
        {
          event_type: "expire",
          state_before: "reserved",
          state_after: "released",
          resource_id: null,
          worker_id: null,
          boot_id: null,
        },
        {
          event_type: "expire",
          state_before: "in-use",
          state_after: "isolated",
          resource_id: "resource-expire",
          worker_id: workerId,
          boot_id: bootId,
        },
      ]),
    );
  });

  test("照合ジョブの開始・解放・隔離・完了を監査する", async () => {
    const store = await createStore(2, 10);
    const first = await store.reserve(claim(), operation("reserve-reconcile-1"), 0);
    const second = await store.reserve(claim(), operation("reserve-reconcile-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    for (const [reservation, resourceId, index] of [
      [first.reservation, "resource-reconcile-1", 1],
      [second.reservation, "resource-reconcile-2", 2],
    ] as const) {
      await store.applyEvent(
        {
          type: "allocated",
          reservationId: reservation.id,
          resourceId: asResourceId(resourceId),
          workerId,
          bootId,
          operationId: operation(`allocate-reconcile-${index}`),
          at: 1,
        },
        1,
      );
    }
    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [asResourceId("resource-reconcile-1")],
        operationId: operation("worker-stopped-reconcile"),
        at: 2,
      },
      2,
    );
    const batch = await store.continueReconciliation(job.id, { cursor: 0 }, 3);
    expect(batch.reclaimed).toHaveLength(1);
    expect(batch.isolated).toHaveLength(1);
    expect(batch).toMatchObject({
      reclaimed: expect.arrayContaining([first.reservation.id]),
      isolated: expect.arrayContaining([second.reservation.id]),
      hasMore: false,
    });

    const events = await pool.query<{
      event_type: string;
      outcome: string;
      state_before: string | null;
      state_after: string | null;
      resource_id: string | null;
      worker_id: string | null;
      boot_id: string | null;
    }>(
      `SELECT event_type, outcome, state_before, state_after,
              resource_id, worker_id, boot_id
       FROM resource_audit_event
       WHERE event_type LIKE 'reconciliation-%'
       ORDER BY recorded_at, event_id`,
    );
    expect(events.rows).toHaveLength(4);
    expect(events.rows).toEqual(
      expect.arrayContaining([
        {
          event_type: "reconciliation-start",
          outcome: "started",
          state_before: null,
          state_after: null,
          resource_id: null,
          worker_id: workerId,
          boot_id: bootId,
        },
        {
          event_type: "reconciliation-reclaimed",
          outcome: "applied",
          state_before: "in-use",
          state_after: "released",
          resource_id: "resource-reconcile-1",
          worker_id: workerId,
          boot_id: bootId,
        },
        {
          event_type: "reconciliation-isolated",
          outcome: "applied",
          state_before: "in-use",
          state_after: "isolated",
          resource_id: "resource-reconcile-2",
          worker_id: workerId,
          boot_id: bootId,
        },
        {
          event_type: "reconciliation-complete",
          outcome: "completed",
          state_before: null,
          state_after: null,
          resource_id: null,
          worker_id: workerId,
          boot_id: bootId,
        },
      ]),
    );
  });

  test("監査イベントをスコープ参照で照会し、生のキーを返さない", async () => {
    const store = await createStore();
    const reserved = await store.reserve(claim(), operation("reserve-audit-query"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-audit-query"),
        at: 1,
      },
      1,
    );

    const firstPage = await store.listAuditEvents(
      { scope: userScope, eventTypes: ["reserve", "isolate"] },
      { limit: 1 },
    );
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.events[0]).toMatchObject({ type: "reserve", outcome: "applied" });
    expect(firstPage.events[0]?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "user", keyVersion: 1 })]),
    );
    expect(firstPage.events[0]?.scopes.some((scope) => scope.ref === userScope.key)).toBe(false);
    if (firstPage.nextCursor === undefined) {
      throw new Error("next cursor is missing");
    }

    const secondPage = await store.listAuditEvents(
      { scope: userScope, eventTypes: ["reserve", "isolate"] },
      { limit: 1, cursor: firstPage.nextCursor },
    );
    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.events[0]).toMatchObject({ type: "isolate", outcome: "applied" });
    expect(secondPage.nextCursor).toBeUndefined();

    expect(await store.listAuditEvents({ scope: { kind: "user", key: "unknown-user" } })).toEqual({
      events: [],
    });
  });

  test("監査ログを保持期間とバッチ件数で削除する", async () => {
    const store = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: {
        ...auditOptions,
        retentionMs: 100,
        cleanupBatchSize: 1,
      },
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 }, 0);
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 }, 0);
    await store.reserve(claim(), operation("reserve-cleanup-1"), 0);
    await store.reserve(claim(), operation("reserve-cleanup-2"), 0);

    expect(await store.cleanupAuditEvents(99)).toEqual({ deletedAuditEvents: 0 });
    for (let expected = 0; expected < 4; expected += 1) {
      expect(await store.cleanupAuditEvents(100)).toEqual({ deletedAuditEvents: 1 });
    }
    expect(await store.cleanupAuditEvents(100)).toEqual({ deletedAuditEvents: 0 });
    const scopes = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_audit_scope",
    );
    expect(scopes.rows[0]?.count).toBe(0);
  });

  test("鍵バージョン更新後も旧バージョンの監査イベントを照会できる", async () => {
    const oldStore = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: {
        keys: [{ version: 1, secret: "old-audit-secret" }],
        activeKeyVersion: 1,
      },
    });
    await oldStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 }, 0);
    await oldStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 }, 0);
    await oldStore.reserve(claim(), operation("reserve-old-key"), 0);

    const rotatedStore = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: {
        keys: [
          { version: 1, secret: "old-audit-secret" },
          { version: 2, secret: "new-audit-secret" },
        ],
        activeKeyVersion: 2,
      },
    });
    await rotatedStore.reserve(claim(), operation("reserve-new-key"), 1);
    const page = await rotatedStore.listAuditEvents({
      scope: userScope,
      eventTypes: ["reserve"],
    });
    expect(page.events).toHaveLength(2);
    expect(page.events[0]?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "user", keyVersion: 1 })]),
    );
    expect(page.events[1]?.scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "user", keyVersion: 2 })]),
    );
  });

  test("保持判定は occurred_at ではなく recorded_at を使い、from と to の境界を守る", async () => {
    const store = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: {
        ...auditOptions,
        retentionMs: 100,
        cleanupBatchSize: 100,
      },
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 }, 0);
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 }, 0);
    const reserved = await store.reserve(claim(), operation("reserve-retention"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-retention"),
        workerId,
        bootId,
        operationId: operation("allocate-retention"),
        at: 0,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-retention"),
        at: 0,
      },
      1_000,
    );

    await store.cleanupAuditEvents(100);
    const remaining = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM resource_audit_event WHERE event_type = 'isolate'",
    );
    expect(remaining.rows[0]?.count).toBe(1);
    const remainingScopes = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM resource_audit_scope s
       JOIN resource_audit_event e ON e.event_id = s.event_id
       WHERE e.event_type = 'isolate'`,
    );
    expect(remainingScopes.rows[0]?.count).toBe(2);
    expect(
      await store.listAuditEvents({ eventTypes: ["isolate"], from: 1_000, to: 1_001 }),
    ).toMatchObject({ events: [expect.objectContaining({ type: "isolate" })] });
    expect(await store.listAuditEvents({ eventTypes: ["isolate"], from: 0, to: 1_000 })).toEqual({
      events: [],
    });

    await store.cleanupAuditEvents(1_100);
    const after = await pool.query<{ events: number; scopes: number }>(
      `SELECT
         (SELECT count(*)::int FROM resource_audit_event) AS events,
         (SELECT count(*)::int FROM resource_audit_scope) AS scopes`,
    );
    expect(after.rows[0]).toEqual({ events: 0, scopes: 0 });
  });

  test("同じ recorded_at の監査イベントを keyset ページングで重複・欠落なく返す", async () => {
    const store = createPostgresResourceStoreRaw({
      pool,
      reservationTtlMs: 1_000,
      audit: auditOptions,
    });
    await store.setQuotaLimit(
      { scope: { kind: "room", key: "same-time-a" }, maxCount: 1, maxBytes: 10 },
      0,
    );
    await store.setQuotaLimit(
      { scope: { kind: "room", key: "same-time-b" }, maxCount: 1, maxBytes: 10 },
      0,
    );
    const first = await store.listAuditEvents({ eventTypes: ["quota-set"] }, { limit: 1 });
    if (first.nextCursor === undefined) {
      throw new Error("next cursor is missing");
    }
    const second = await store.listAuditEvents(
      { eventTypes: ["quota-set"] },
      { limit: 1, cursor: first.nextCursor },
    );
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const ids = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
  });
});
