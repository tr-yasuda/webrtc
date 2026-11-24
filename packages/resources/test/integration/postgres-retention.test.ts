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

describe("PostgreSQL 資源管理の保持と容量", () => {
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
