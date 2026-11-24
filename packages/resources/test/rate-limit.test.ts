import { describe, expect, test } from "vitest";
import { createInMemoryRateLimitTable, type RateLimitOptions } from "../src/index.js";

function options(overrides: Partial<RateLimitOptions> = {}): RateLimitOptions {
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

describe("送信元ごとのレート制限表", () => {
  test("制限期間が残っている項目を TTL で早期削除しない", async () => {
    const table = createInMemoryRateLimitTable(
      options({ maxEntries: 1, idleTtlMs: 5, windowMs: 100, maxRequestsPerKey: 1 }),
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
    const table = createInMemoryRateLimitTable(
      options({ maxEntries: 1, idleTtlMs: 10, windowMs: 10 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });

    expect(await table.consume("source-b", 1, 20)).toMatchObject({ allowed: true });
    expect(await table.getUsage()).toMatchObject({ entries: 1 });
  });

  test("空きがなければ新規登録を抑制する", async () => {
    const table = createInMemoryRateLimitTable(
      options({ maxEntries: 1, idleTtlMs: 100, windowMs: 100 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 1, 1)).toMatchObject({
      allowed: false,
      reason: "entry-limit",
    });
  });

  test("項目を削除して再登録してもサーバー全体の制限をリセットしない", async () => {
    const table = createInMemoryRateLimitTable(
      options({
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
    const table = createInMemoryRateLimitTable(
      options({ maxEntries: 10, maxBytes: 20, entryOverheadBytes: 8 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-b", 1, 1)).toMatchObject({
      allowed: false,
      reason: "byte-limit",
    });
  });

  test("制限期間が終われば件数をリセットする", async () => {
    const table = createInMemoryRateLimitTable(
      options({ maxRequestsPerKey: 1, windowMs: 10, idleTtlMs: 100 }),
    );
    expect(await table.consume("source-a", 1, 0)).toMatchObject({ allowed: true });
    expect(await table.consume("source-a", 1, 5)).toMatchObject({
      allowed: false,
      reason: "request-limit",
    });
    expect(await table.consume("source-a", 1, 10)).toMatchObject({ allowed: true });
  });

  test("不正なキーやサイズは拒否する", async () => {
    const table = createInMemoryRateLimitTable(options());
    expect(await table.consume("", 1, 0)).toMatchObject({
      allowed: false,
      reason: "invalid-request",
    });
    expect(await table.consume("source-a", -1, 0)).toMatchObject({
      allowed: false,
      reason: "invalid-request",
    });
  });

  test("並行要求でもサーバー全体の制限を超えない", async () => {
    const table = createInMemoryRateLimitTable(
      options({ maxEntries: 10, maxRequestsGlobal: 1, maxRequestsPerKey: 10 }),
    );
    const results = await Promise.all([
      table.consume("source-a", 1, 0),
      table.consume("source-b", 1, 0),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
  });

  test("キー単位と全体の帯域上限を超える要求を拒否する", async () => {
    const table = createInMemoryRateLimitTable(
      options({
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
