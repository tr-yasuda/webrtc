import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asReconciliationJobId,
  asResourceId,
  asWorkerId,
  createPostgresRateLimitTable,
  createPostgresResourceStore as createPostgresResourceStoreRaw,
  ReconciliationCapacityError,
  ReconciliationCursorMismatchError,
  ReconciliationJobNotFoundError,
  type QuotaScope,
  type RateLimitOptions,
  type RateLimitTable,
  type PostgresResourceStore,
  type PostgresResourceStoreOptions,
  type ReservationId,
  type ResourceClaim,
} from "../../src/index.js";
import * as schema from "../../src/postgres/schema.js";

const serverScope: QuotaScope = { kind: "server", key: "pg-server" };
const userScope: QuotaScope = { kind: "user", key: "pg-user" };
const workerId = asWorkerId("pg-worker");
const bootId = asBootId("pg-boot-1");
const DAY_MS = 24 * 60 * 60 * 1_000;
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

function rateLimitOptions(overrides: Partial<RateLimitOptions> = {}): RateLimitOptions {
  return {
    maxEntries: 2,
    maxBytes: 100,
    entryOverheadBytes: 8,
    idleTtlMs: 10,
    windowMs: 100,
    maxRequestsPerKey: 2,
    maxBytesPerKey: 100,
    maxRequestsGlobal: 100,
    maxBytesGlobal: 1_000,
    ...overrides,
  };
}

async function createRateLimitTable(
  tableKey: string,
  options: RateLimitOptions,
): Promise<RateLimitTable> {
  return createPostgresRateLimitTable({ pool, tableKey, rateLimit: options });
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

describe("PostgreSQL 資源管理の受け入れ条件", () => {
  test("空き枠1への並行要求では1件だけ確保に成功する", async () => {
    const store = await createStore(1, 10);
    const results = await Promise.all([
      store.reserve(claim(), operation("reserve-1"), 0),
      store.reserve(claim(), operation("reserve-2"), 0),
      store.reserve(claim(), operation("reserve-3"), 0),
    ]);

    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 1,
      usedBytes: 1,
    });
  });

  test("同じ予約操作IDの同時再送は同じ結果を返し計上を重複させない", async () => {
    const store = await createStore(1, 10);
    const [first, second] = await Promise.all([
      store.reserve(claim(), operation("reserve-same"), 0),
      store.reserve(claim(), operation("reserve-same"), 0),
    ]);

    expect(first).toMatchObject({ status: "reserved" });
    expect(second).toEqual(first);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("同じ解放操作IDの同時再送は二重返却しない", async () => {
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
      0,
    );

    const releaseEvent = {
      type: "released" as const,
      reservationId: reserved.reservation.id,
      resourceId: asResourceId("resource-1"),
      workerId,
      bootId,
      operationId: operation("release-same"),
      at: 2,
    };
    const [first, second] = await Promise.all([
      store.applyEvent(releaseEvent, 0),
      store.applyEvent(releaseEvent, 0),
    ]);

    expect(first).toMatchObject({ status: "applied" });
    expect(second).toEqual(first);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("解放通知の消失・重複・遅延でも二重返却しない", async () => {
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
      0,
    );
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: reserved.reservation.id,
        operationId: operation("release-request"),
        at: 2,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("release-unknown"),
        at: 3,
      },
      0,
    );

    const releaseEvent = {
      type: "released" as const,
      reservationId: reserved.reservation.id,
      resourceId: asResourceId("resource-1"),
      workerId,
      bootId,
      operationId: operation("release-confirmed"),
      at: 4,
    };
    expect(await store.applyEvent(releaseEvent, 0)).toMatchObject({ status: "applied" });
    expect(await store.applyEvent(releaseEvent, 0)).toMatchObject({ status: "applied" });
    expect(
      await store.applyEvent({ ...releaseEvent, operationId: operation("release-late"), at: 5 }, 0),
    ).toMatchObject({ status: "ignored", reason: "already-released" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 0,
      usedBytes: 0,
    });
  });

  test("遅延した解放通知が再利用後の別資源を変更しない", async () => {
    const store = await createStore(1, 10);
    const first = await store.reserve(claim(), operation("reserve-1"), 0);
    if (first.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 1,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "released",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 2,
      },
      0,
    );

    const second = await store.reserve(claim(), operation("reserve-2"), 3);
    if (second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-2"),
        at: 4,
      },
      0,
    );
    const delayed = await store.applyEvent(
      {
        type: "released",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-late"),
        at: 5,
      },
      0,
    );

    expect(delayed).toMatchObject({ status: "ignored", reason: "already-released" });
    expect(await store.getReservation(second.reservation.id)).toMatchObject({
      state: "in-use",
      resourceId: "resource-2",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("Worker 再起動後は解放を確認できた資源だけを回収する", async () => {
    const store = await createStore(3, 10);
    const first = await store.reserve(claim(), operation("reserve-1"), 0);
    const second = await store.reserve(claim(), operation("reserve-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 1,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-2"),
        at: 1,
      },
      0,
    );

    const started = await store.applyEvent(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [asResourceId("resource-1")],
        operationId: operation("worker-stopped-1"),
        at: 2,
      },
      0,
    );
    if (started.status !== "reconciliation-started") {
      throw new Error("reconciliation did not start");
    }
    const reclaimed = await store.continueReconciliation(started.job.id, { cursor: 0 }, 0);
    expect(reclaimed.reclaimed).toHaveLength(1);
    expect(reclaimed.isolated).toHaveLength(1);
    expect(reclaimed).toMatchObject({
      reclaimed: expect.arrayContaining([first.reservation.id]),
      isolated: expect.arrayContaining([second.reservation.id]),
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });

    const stale = await store.applyEvent(
      {
        type: "released",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId: asBootId("pg-boot-2"),
        operationId: operation("release-stale"),
        at: 3,
      },
      0,
    );
    expect(stale).toMatchObject({ status: "ignored", reason: "stale-boot" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("期限切れの予約は解放し、使用中の資源は隔離して計上を続ける", async () => {
    const store = createPostgresResourceStore({ pool, reservationTtlMs: 10 });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await store.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    expect((await store.expire(10)).released).toEqual([reserved.reservation.id]);
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "released",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("expire はバッチ件数だけ処理し、並行予約を妨げない", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      reconciliationBatchSize: 2,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 10, maxBytes: 20 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 10, maxBytes: 20 });
    const first = await store.reserve(claim(1, 5), operation("reserve-1"), 0);
    const second = await store.reserve(claim(1, 5), operation("reserve-2"), 0);
    const third = await store.reserve(claim(1, 5), operation("reserve-3"), 0);
    const active = await store.reserve(claim(1, 1_000), operation("reserve-4"), 0);
    if (
      first.status !== "reserved" ||
      second.status !== "reserved" ||
      third.status !== "reserved" ||
      active.status !== "reserved"
    ) {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-2"),
        at: 0,
      },
      0,
    );

    const [batch, concurrent] = await Promise.all([
      store.expire(5, { limit: 2 }),
      store.reserve(claim(1, 1_000), operation("concurrent"), 5),
    ]);
    expect(batch.released.length + batch.isolated.length).toBe(2);
    expect(batch.hasMore).toBe(true);
    expect(concurrent).toMatchObject({ status: "reserved" });
    expect(await store.getReservation(active.reservation.id)).toMatchObject({
      state: "reserved",
    });

    const remaining = await store.expire(5, { limit: 2 });
    expect(remaining.released.length + remaining.isolated.length).toBe(1);
    expect(remaining.hasMore).toBe(false);
    expect(await store.getReservation(second.reservation.id)).toMatchObject({
      state: "isolated",
    });
  });

  test("expire は limit 件だけロックし、対象外の行のロックを待たない", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const first = await store.reserve(claim(1, 5), operation("reserve-1"), 0);
    const second = await store.reserve(claim(1, 6), operation("reserve-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM resource_reservation WHERE id = $1 FOR UPDATE", [
        second.reservation.id,
      ]);
      const result = await Promise.race([
        store.expire(6, { limit: 1 }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("expire waited for an out-of-batch row lock")), 2_000);
        }),
      ]);

      expect(result.released).toEqual([first.reservation.id]);
      expect(result.hasMore).toBe(true);
      expect(await store.getReservation(second.reservation.id)).toMatchObject({
        state: "reserved",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  test("操作記録の監査時刻には通知の at を使い、状態更新には処理時刻を使う", async () => {
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
        at: 20,
      },
      30,
    );

    expect(await store.getOperationOccurredAt(operation("allocate-1"))).toBe(20);
    expect(await store.getOperationRecordedAt(operation("allocate-1"))).toBe(30);
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      updatedAt: 30,
    });
  });

  test("解放失敗では使用中に戻り計上を維持する", async () => {
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
      0,
    );
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: reserved.reservation.id,
        operationId: operation("release-request"),
        at: 2,
      },
      0,
    );
    const failed = await store.applyEvent(
      {
        type: "release-failed",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-failed"),
        at: 3,
      },
      0,
    );

    expect(failed).toMatchObject({ status: "applied" });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("使用中の TTL が確保後の期限を上書きする", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      inUseTtlMs: 5,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
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
        at: 0,
      },
      0,
    );

    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
      expiresAt: 5,
    });
    expect((await store.expire(4)).released).toEqual([]);
    expect((await store.expire(5)).isolated).toEqual([reserved.reservation.id]);
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "isolated",
    });
  });

  test("ルーム単位の上限を超える予約を拒否する", async () => {
    const roomScope: QuotaScope = { kind: "room", key: "pg-room" };
    const store = await createStore(5, 10);
    await store.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 });
    const roomClaim: ResourceClaim = {
      scopes: [serverScope, roomScope, userScope],
      sizeBytes: 1,
    };

    expect(await store.reserve(roomClaim, operation("room-1"), 0)).toMatchObject({
      status: "reserved",
    });
    expect(await store.reserve(roomClaim, operation("room-2"), 0)).toMatchObject({
      status: "rejected",
      reason: "quota-exceeded",
    });
    expect(await store.getQuotaUsage(roomScope)).toMatchObject({ usedCount: 1 });
  });

  test("server スコープがない予約を拒否する", async () => {
    const store = await createStore();
    const userOnlyClaim: ResourceClaim = {
      scopes: [userScope],
      sizeBytes: 1,
    };

    expect(await store.reserve(userOnlyClaim, operation("reserve-user-only"), 0)).toMatchObject({
      status: "rejected",
      reason: "invalid-claim",
    });
    expect(await store.getQuotaUsage(userScope)).toMatchObject({ usedCount: 0 });
  });

  test("保持期間を過ぎた操作記録と解放済み tombstone だけを削除する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      operationRetentionMs: DAY_MS,
      releasedReservationRetentionMs: 7 * DAY_MS,
      cleanupBatchSize: 10,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
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
        at: 0,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 0,
      },
      0,
    );

    expect(await store.cleanup(DAY_MS - 1)).toMatchObject({
      deletedOperations: 0,
      deletedReleasedReservations: 0,
    });
    expect(await store.getOperationRecordedAt(operation("reserve-1"))).toBe(0);
    expect(await store.getReservation(reserved.reservation.id)).not.toBeUndefined();

    expect(await store.cleanup(DAY_MS)).toMatchObject({
      deletedOperations: 3,
      deletedReleasedReservations: 0,
    });
    expect(await store.getOperationRecordedAt(operation("reserve-1"))).toBeUndefined();
    expect(await store.getReservation(reserved.reservation.id)).not.toBeUndefined();

    expect(await store.cleanup(7 * DAY_MS)).toMatchObject({
      deletedOperations: 0,
      deletedReleasedReservations: 1,
    });
    expect(await store.getReservation(reserved.reservation.id)).toBeUndefined();
  });

  test("cleanup はバッチ件数ずつ削除する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      cleanupBatchSize: 1,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    await store.reserve(claim(), operation("reserve-1"), 0);
    await store.reserve(claim(), operation("reserve-2"), 0);

    expect(await store.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 1 });
    expect(await store.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 1 });
    expect(await store.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 0 });
  });

  test("cleanup は使用中の予約を削除しない", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      cleanupBatchSize: 10,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
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
        at: 0,
      },
      0,
    );

    expect(await store.cleanup(30 * DAY_MS)).toMatchObject({
      deletedReleasedReservations: 0,
    });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("操作記録が上限に達すると cleanup 後は新規操作を拒否する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxOperationRecords: 1,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    expect(await store.reserve(claim(), operation("reserve-1"), 0)).toMatchObject({
      status: "reserved",
    });

    const atCapacity = await store.cleanup(0);
    expect(atCapacity.operationCount).toBe(1);
    expect(atCapacity.operationCapacityExceeded).toBe(true);
    expect(await store.reserve(claim(), operation("reserve-2"), 0)).toMatchObject({
      status: "rejected",
      reason: "capacity-exhausted",
    });

    const afterExpiry = await store.cleanup(DAY_MS);
    expect(afterExpiry.operationCount).toBe(0);
    expect(afterExpiry.operationCapacityExceeded).toBe(false);
    expect(await store.reserve(claim(), operation("reserve-3"), DAY_MS)).toMatchObject({
      status: "reserved",
    });
  });

  test("操作記録が上限に達すると新規通知も拒否する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxOperationRecords: 1,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await store.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.cleanup(0);

    expect(
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
      ),
    ).toMatchObject({ status: "rejected", reason: "capacity-exhausted" });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "reserved",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("tombstone が上限を超えると古いものから削除する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxReleasedReservations: 1,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const first = await store.reserve(claim(), operation("reserve-1"), 0);
    const second = await store.reserve(claim(), operation("reserve-2"), 1);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    for (const [reservation, now, resource] of [
      [first.reservation, 0, "resource-1"],
      [second.reservation, 1, "resource-2"],
    ] as const) {
      await store.applyEvent(
        {
          type: "allocated",
          reservationId: reservation.id,
          resourceId: asResourceId(resource),
          workerId,
          bootId,
          operationId: operation(`allocate-${now}`),
          at: now,
        },
        now,
      );
      await store.applyEvent(
        {
          type: "released",
          reservationId: reservation.id,
          resourceId: asResourceId(resource),
          workerId,
          bootId,
          operationId: operation(`release-${now}`),
          at: now,
        },
        now,
      );
    }

    const evicted = await store.cleanup(2);
    expect(evicted.releasedReservationCount).toBe(1);
    expect(evicted.evictedReleasedReservations).toBe(1);
    expect(await store.getReservation(first.reservation.id)).toBeUndefined();
    expect(await store.getReservation(second.reservation.id)).not.toBeUndefined();
  });

  test("スコープ数が上限を超える予約を拒否する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxScopesPerClaim: 2,
    });
    const roomScope: QuotaScope = { kind: "room", key: "pg-room-scopes" };
    expect(
      await store.reserve(
        {
          scopes: [serverScope, roomScope, userScope],
          sizeBytes: 1,
        },
        operation("too-many-scopes"),
        0,
      ),
    ).toMatchObject({ status: "rejected", reason: "invalid-claim" });
  });

  test("内部一覧は ID 順にページングし、重複・欠落しない", async () => {
    const store = await createStore(5, 10);
    const expected: ReservationId[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await store.reserve(claim(), operation(`reserve-${index}`), 0);
      if (result.status !== "reserved") {
        throw new Error("reservation failed");
      }
      expected.push(result.reservation.id);
    }

    const collected: ReservationId[] = [];
    let cursor: ReservationId | undefined;
    for (;;) {
      const page = await store.listReservationsPage(
        {},
        { limit: 2, ...(cursor === undefined ? {} : { cursor }) },
      );
      collected.push(...page.reservations.map((reservation) => reservation.id));
      if (page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toEqual(expected.toSorted());
    expect(new Set(collected).size).toBe(collected.length);
  });
});

describe("PostgreSQL レート制限表", () => {
  test("制限期間が残っている項目を TTL で早期削除しない", async () => {
    const table = await createRateLimitTable(
      "ttl",
      rateLimitOptions({ maxEntries: 1, idleTtlMs: 5, windowMs: 100, maxRequestsPerKey: 1 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });

    await table.sweep(20);
    expect(await table.getUsage()).toMatchObject({ entries: 1 });
    expect(await table.consume("source-a", 1, 20)).toMatchObject({
      allowed: false,
      reason: "request-limit",
    });
  });

  test("上限到達時は期限切れの項目だけを回収する", async () => {
    const table = await createRateLimitTable(
      "evict",
      rateLimitOptions({ maxEntries: 1, idleTtlMs: 10, windowMs: 10 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 1, 20)).toMatchObject({ allowed: true });
    expect(await table.getUsage()).toMatchObject({ entries: 1 });
  });

  test("項目を削除して再登録してもサーバー全体の制限をリセットしない", async () => {
    const table = await createRateLimitTable(
      "global",
      rateLimitOptions({
        maxEntries: 1,
        idleTtlMs: 5,
        windowMs: 100,
        maxRequestsPerKey: 10,
        maxRequestsGlobal: 2,
      }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-a", 1, 6)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 1, 7)).toMatchObject({
      allowed: false,
      reason: "request-limit",
    });
  });

  test("総メモリ量の上限を超える登録を抑制する", async () => {
    const table = await createRateLimitTable(
      "bytes",
      rateLimitOptions({ maxEntries: 10, maxBytes: 20, entryOverheadBytes: 8 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 1, 1)).toMatchObject({
      allowed: false,
      reason: "byte-limit",
    });
  });

  test("制限期間が終われば件数をリセットする", async () => {
    const table = await createRateLimitTable(
      "window",
      rateLimitOptions({ maxRequestsPerKey: 1, windowMs: 10, idleTtlMs: 100 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-a", 1, 5)).toMatchObject({
      allowed: false,
      reason: "request-limit",
    });
    expect(await table.consume("source-a", 1, 10)).toMatchObject({ allowed: true });
  });

  test("並行要求でもサーバー全体の制限を超えない", async () => {
    const table = await createRateLimitTable(
      "concurrent",
      rateLimitOptions({ maxEntries: 10, maxRequestsGlobal: 1, maxRequestsPerKey: 10 }),
    );
    const results = await Promise.all([
      table.consume("source-a", 1, 0),
      table.consume("source-b", 1, 0),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
  });

  test("キー単位と全体の帯域上限を超える要求を拒否する", async () => {
    const table = await createRateLimitTable(
      "bandwidth",
      rateLimitOptions({
        maxEntries: 10,
        maxBytesPerKey: 5,
        maxBytesGlobal: 7,
        maxRequestsPerKey: 10,
        maxRequestsGlobal: 10,
      }),
    );

    expect(await table.consume("source-a", 6, 0)).toMatchObject({
      allowed: false,
      reason: "bandwidth-limit",
    });
    expect(await table.consume("source-a", 4, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 4, 0)).toMatchObject({
      allowed: false,
      reason: "bandwidth-limit",
    });
    expect(await table.consume("source-a", 2, 0)).toMatchObject({
      allowed: false,
      reason: "bandwidth-limit",
    });
  });
});

describe("PostgreSQL 照合・隔離・quota 削除", () => {
  test("照合ジョブは別インスタンスでも遅延確保を target_seq で取りこぼさない", async () => {
    const firstStore = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      reconciliationBatchSize: 1,
    });
    await firstStore.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await firstStore.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const delayed = await firstStore.reserve(claim(), operation("reserve-delayed"), 0);
    const allocated = await firstStore.reserve(claim(), operation("reserve-allocated"), 0);
    if (delayed.status !== "reserved" || allocated.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await firstStore.applyEvent(
      {
        type: "allocated",
        reservationId: allocated.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 1,
      },
      1,
    );
    const job = await firstStore.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-1"),
        at: 2,
      },
      2,
    );
    const firstBatch = await firstStore.continueReconciliation(job.id, { cursor: 0 }, 2);
    expect(firstBatch).toMatchObject({
      isolated: [allocated.reservation.id],
      hasMore: false,
      status: "completed",
    });
    if (firstBatch.nextCursor === undefined) {
      throw new Error("cursor is missing");
    }

    const restartedStore = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      reconciliationBatchSize: 1,
    });
    await restartedStore.applyEvent(
      {
        type: "allocated",
        reservationId: delayed.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-late"),
        at: 3,
      },
      3,
    );
    expect(await restartedStore.getReconciliationJob(job.id)).toMatchObject({
      status: "pending",
      targetCount: 2,
      lastTargetSeq: firstBatch.nextCursor,
    });

    const secondBatch = await restartedStore.continueReconciliation(
      job.id,
      { cursor: firstBatch.nextCursor },
      4,
    );
    expect(secondBatch).toMatchObject({
      isolated: [delayed.reservation.id],
      hasMore: false,
      status: "completed",
    });
    expect(await restartedStore.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 2 });
  });

  test("同じカーソルの照合バッチを並行実行しても二重解放しない", async () => {
    const store = await createStore(3, 10);
    const first = await store.reserve(claim(), operation("reserve-1"), 0);
    const second = await store.reserve(claim(), operation("reserve-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    for (const [reservation, resourceId, index] of [
      [first.reservation, "resource-1", 1],
      [second.reservation, "resource-2", 2],
    ] as const) {
      await store.applyEvent(
        {
          type: "allocated",
          reservationId: reservation.id,
          resourceId: asResourceId(resourceId),
          workerId,
          bootId,
          operationId: operation(`allocate-${index}`),
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
        confirmedResourceIds: [asResourceId("resource-1"), asResourceId("resource-2")],
        operationId: operation("worker-stopped-1"),
        at: 2,
      },
      2,
    );
    const results = await Promise.allSettled([
      store.continueReconciliation(job.id, { cursor: 0 }, 2),
      store.continueReconciliation(job.id, { cursor: 0 }, 2),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toBeInstanceOf(
      ReconciliationCursorMismatchError,
    );
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("完了した照合ジョブだけを保持期間後に削除する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      reconciliationJobRetentionMs: 100,
    });
    const event = {
      type: "worker-stopped" as const,
      workerId,
      bootId: asBootId("boot-cleanup"),
      confirmedResourceIds: [],
      operationId: operation("worker-stopped-1"),
      at: 0,
    };
    const job = await store.startReconciliation(event, 0);
    expect(await store.startReconciliation(event, 0)).toEqual(job);

    expect(await store.cleanup(99)).toMatchObject({ deletedReconciliationJobs: 0 });
    expect(await store.getReconciliationJob(job.id)).not.toBeUndefined();
    expect(await store.cleanup(100)).toMatchObject({ deletedReconciliationJobs: 1 });
    expect(await store.getReconciliationJob(job.id)).toBeUndefined();
    await expect(
      store.continueReconciliation(asReconciliationJobId("missing"), { cursor: 0 }, 0),
    ).rejects.toBeInstanceOf(ReconciliationJobNotFoundError);
  });

  test("照合ジョブの容量上限を超えると開始しない", async () => {
    const confirmedStore = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxConfirmedResourceIds: 1,
    });
    await expect(
      confirmedStore.startReconciliation(
        {
          type: "worker-stopped",
          workerId,
          bootId,
          confirmedResourceIds: [asResourceId("resource-1"), asResourceId("resource-2")],
          operationId: operation("worker-stopped-1"),
          at: 0,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(ReconciliationCapacityError);

    const targetStore = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxReconciliationTargets: 1,
    });
    await targetStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await targetStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const first = await targetStore.reserve(claim(), operation("reserve-1"), 0);
    const second = await targetStore.reserve(claim(), operation("reserve-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    for (const [reservation, resourceId, index] of [
      [first.reservation, "resource-1", 1],
      [second.reservation, "resource-2", 2],
    ] as const) {
      await targetStore.applyEvent(
        {
          type: "allocated",
          reservationId: reservation.id,
          resourceId: asResourceId(resourceId),
          workerId,
          bootId,
          operationId: operation(`allocate-${index}`),
          at: 0,
        },
        0,
      );
    }
    await expect(
      targetStore.startReconciliation(
        {
          type: "worker-stopped",
          workerId,
          bootId,
          confirmedResourceIds: [],
          operationId: operation("worker-stopped-2"),
          at: 0,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(ReconciliationCapacityError);
  });

  test("遅延確保と解放失敗の相関情報を補完して照合対象にする", async () => {
    const store = await createStore(2, 10);
    const delayed = await store.reserve(claim(), operation("reserve-delayed-correlation"), 0);
    const failed = await store.reserve(claim(), operation("reserve-failed-correlation"), 0);
    if (delayed.status !== "reserved" || failed.status !== "reserved") {
      throw new Error("reservation failed");
    }
    for (const [reservation, operationId] of [
      [delayed.reservation, "unknown-delayed-correlation"],
      [failed.reservation, "unknown-failed-correlation"],
    ] as const) {
      await store.applyEvent(
        {
          type: "outcome-unknown",
          reservationId: reservation.id,
          operationId: operation(operationId),
          at: 1,
        },
        1,
      );
    }
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: delayed.reservation.id,
        operationId: operation("release-delayed-correlation"),
        at: 2,
      },
      2,
    );
    expect(
      await store.applyEvent(
        {
          type: "allocated",
          reservationId: delayed.reservation.id,
          resourceId: asResourceId("resource-delayed-correlation"),
          workerId,
          bootId,
          operationId: operation("allocate-delayed-correlation"),
          at: 3,
        },
        3,
      ),
    ).toMatchObject({
      status: "applied",
      reservation: { state: "release-pending", resourceId: "resource-delayed-correlation" },
    });
    expect(
      await store.applyEvent(
        {
          type: "release-failed",
          reservationId: failed.reservation.id,
          resourceId: asResourceId("resource-failed-correlation"),
          workerId,
          bootId,
          operationId: operation("release-failed-correlation"),
          at: 3,
        },
        3,
      ),
    ).toMatchObject({
      status: "applied",
      reservation: { state: "in-use", resourceId: "resource-failed-correlation" },
    });

    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-correlation"),
        at: 4,
      },
      4,
    );
    expect(job.targetCount).toBe(2);
    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 4)).toMatchObject({
      isolated: expect.arrayContaining([delayed.reservation.id, failed.reservation.id]),
    });
  });

  test("照合対象の上限を超える確保通知は容量超過で拒否する", async () => {
    const store = createPostgresResourceStore({
      pool,
      reservationTtlMs: 1_000,
      maxReconciliationTargets: 1,
    });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await store.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const first = await store.reserve(claim(), operation("reserve-1"), 0);
    const second = await store.reserve(claim(), operation("reserve-2"), 0);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "allocated",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 0,
      },
      0,
    );
    const started = await store.applyEvent(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-1"),
        at: 1,
      },
      1,
    );
    if (started.status !== "reconciliation-started") {
      throw new Error("reconciliation did not start");
    }

    const late = await store.applyEvent(
      {
        type: "allocated",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-late"),
        at: 2,
      },
      2,
    );
    expect(late).toMatchObject({ status: "rejected", reason: "capacity-exhausted" });
    expect(await store.getReservation(second.reservation.id)).toMatchObject({
      state: "reserved",
    });
    expect(await store.getReconciliationJob(started.job.id)).toMatchObject({
      targetCount: 1,
    });
  });

  test("明示的な隔離は計上を維持し、解放確認で返却する", async () => {
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
    expect(isolated).toMatchObject({
      status: "applied",
      reservation: { state: "isolated" },
    });
    expect(
      await store.applyEvent(
        {
          type: "isolate",
          reservationId: reserved.reservation.id,
          operationId: operation("isolate-1"),
          at: 3,
        },
        3,
      ),
    ).toEqual(isolated);
    expect(
      await store.applyEvent(
        {
          type: "isolate",
          reservationId: reserved.reservation.id,
          operationId: operation("isolate-2"),
          at: 3,
        },
        3,
      ),
    ).toMatchObject({ status: "ignored", reason: "duplicate" });

    expect(await store.expire(2_000)).toMatchObject({
      released: [],
      isolated: [],
      hasMore: false,
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });

    const released = await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 4,
      },
      4,
    );
    expect(released).toMatchObject({ status: "applied" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("使用中のスコープは削除せず、解放後に削除できる", async () => {
    const roomScope: QuotaScope = { kind: "room", key: "pg-room" };
    const store = createPostgresResourceStore({ pool, reservationTtlMs: 1_000 });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 });
    const reserved = await store.reserve(
      { scopes: [serverScope, roomScope], sizeBytes: 1 },
      operation("reserve-room"),
      0,
    );
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    expect(await store.deleteQuotaScope(roomScope)).toMatchObject({
      status: "in-use",
      usage: { usedCount: 1 },
    });
    expect(await store.getQuotaUsage(roomScope)).toBeDefined();

    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-room"),
        workerId,
        bootId,
        operationId: operation("release-room"),
        at: 1,
      },
      1,
    );
    expect(await store.deleteQuotaScope(roomScope)).toEqual({ status: "deleted" });
    expect(await store.getQuotaUsage(roomScope)).toBeUndefined();
    expect(await store.deleteQuotaScope(roomScope)).toEqual({ status: "not-found" });
    expect(
      await store.reserve(
        { scopes: [serverScope, roomScope], sizeBytes: 1 },
        operation("reserve-after-delete"),
        2,
      ),
    ).toMatchObject({ status: "rejected", reason: "limit-not-configured" });
  });

  test("スコープ削除と予約が競合しても計上が不整合にならない", async () => {
    const roomScope: QuotaScope = { kind: "room", key: "pg-race-room" };
    const store = createPostgresResourceStore({ pool, reservationTtlMs: 1_000 });
    await store.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await store.setQuotaLimit({ scope: roomScope, maxCount: 2, maxBytes: 10 });
    const [reserveResult, deleteResult] = await Promise.all([
      store.reserve(
        { scopes: [serverScope, roomScope], sizeBytes: 1 },
        operation("reserve-race"),
        0,
      ),
      store.deleteQuotaScope(roomScope),
    ]);

    if (reserveResult.status === "reserved") {
      expect(deleteResult).toMatchObject({ status: "in-use", usage: { usedCount: 1 } });
      expect(await store.getQuotaUsage(roomScope)).toMatchObject({ usedCount: 1 });
      return;
    }
    expect(reserveResult).toMatchObject({
      status: "rejected",
      reason: "limit-not-configured",
    });
    expect(deleteResult).toEqual({ status: "deleted" });
    expect(await store.getQuotaUsage(roomScope)).toBeUndefined();
  });
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
