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
  createPostgresResourceStore as createPostgresResourceStoreRaw,
  ReconciliationCapacityError,
  ReconciliationCursorMismatchError,
  ReconciliationJobNotFoundError,
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

describe("PostgreSQL 照合ジョブ", () => {
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

  test("照合対象が処理前に解放された場合は unchanged に含めない", async () => {
    const store = await createStore();
    const reserved = await store.reserve(
      claim(),
      operation("reserve-released-before-reconciliation"),
      0,
    );
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
    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-before-release"),
        at: 2,
      },
      2,
    );
    expect(job.targetCount).toBe(1);

    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-before-reconciliation"),
        at: 3,
      },
      3,
    );

    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 3)).toMatchObject({
      reclaimed: [],
      isolated: [],
      unchanged: [],
      hasMore: false,
      status: "completed",
    });
  });

  test("隔離済みの資源も停止確認後に解放する", async () => {
    const store = await createStore();
    const reserved = await store.reserve(claim(), operation("reserve-isolated-confirmed"), 0);
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
    await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-1"),
        at: 2,
      },
      2,
    );
    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [asResourceId("resource-1")],
        operationId: operation("worker-stopped-isolated"),
        at: 3,
      },
      3,
    );

    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 3)).toMatchObject({
      reclaimed: [reserved.reservation.id],
      isolated: [],
      unchanged: [],
      hasMore: false,
      status: "completed",
    });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "released",
    });
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
});
