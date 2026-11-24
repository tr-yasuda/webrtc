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

describe("PostgreSQL 監査ログの照会と保持", () => {
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
