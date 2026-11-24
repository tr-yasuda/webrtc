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

describe("PostgreSQL 隔離と quota 削除", () => {
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
