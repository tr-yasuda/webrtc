import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createPostgresRateLimitTable,
  type RateLimitOptions,
  type RateLimitTable,
} from "../../src/index.js";
import * as schema from "../../src/postgres/schema.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;

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
  await pool.query("TRUNCATE rate_limit_entry, rate_limit_global");
});

describe("PostgreSQL レート制限表", () => {
  test("期限切れがない空の表を sweep しても全体行を作らない", async () => {
    const table = await createRateLimitTable("empty-sweep", rateLimitOptions());

    await table.sweep(0);

    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM rate_limit_global WHERE table_key = $1",
      ["empty-sweep"],
    );
    expect(result.rows[0]?.count).toBe("0");
    expect(await table.getUsage()).toMatchObject({ entries: 0, bytes: 0 });
  });

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
