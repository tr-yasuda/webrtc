import { describe, expect, test } from "vitest";
import { resolveResourceAuditOptions } from "../src/audit/contract.js";

describe("監査設定", () => {
  test("空白だけの secret を拒否する", () => {
    expect(() =>
      resolveResourceAuditOptions({
        keys: [{ version: 1, secret: "   " }],
        activeKeyVersion: 1,
      }),
    ).toThrow("audit key secrets must not be blank");
  });

  test("cleanupBatchSize は上限を超えると拒否する", () => {
    expect(() =>
      resolveResourceAuditOptions({
        keys: [{ version: 1, secret: "secret" }],
        activeKeyVersion: 1,
        cleanupBatchSize: 10_001,
      }),
    ).toThrow("audit cleanupBatchSize must not exceed 10000");
  });

  test("鍵バージョンは PostgreSQL integer の範囲に収める", () => {
    expect(() =>
      resolveResourceAuditOptions({
        keys: [{ version: 2_147_483_648, secret: "secret" }],
        activeKeyVersion: 2_147_483_648,
      }),
    ).toThrow("audit key versions must not exceed 2147483647");
  });
});
