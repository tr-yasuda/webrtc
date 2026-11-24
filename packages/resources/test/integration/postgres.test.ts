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
