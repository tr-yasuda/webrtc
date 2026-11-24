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

describe("PostgreSQL 資源管理のライフサイクル", () => {
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
});
