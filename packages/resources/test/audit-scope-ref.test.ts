import { describe, expect, test } from "vitest";
import { computeScopeRef } from "../src/audit/scope-ref.js";
import type { QuotaScope } from "../src/index.js";

const userScope: QuotaScope = { kind: "user", key: "user-a" };

describe("監査スコープ参照", () => {
  test("同じスコープと同じ鍵バージョンは同じ参照になる", () => {
    expect(computeScopeRef("secret", 1, userScope)).toBe(computeScopeRef("secret", 1, userScope));
  });

  test("スコープまたは鍵バージョンが違えば参照が変わる", () => {
    const roomScope: QuotaScope = { kind: "room", key: "user-a" };
    expect(computeScopeRef("secret", 1, userScope)).not.toBe(
      computeScopeRef("secret", 1, roomScope),
    );
    expect(computeScopeRef("secret", 1, userScope)).not.toBe(
      computeScopeRef("secret", 2, userScope),
    );
    expect(computeScopeRef("secret", 1, userScope)).not.toBe(
      computeScopeRef("other-secret", 1, userScope),
    );
  });

  test("参照は生のスコープキーを含まない", () => {
    const ref = computeScopeRef("secret", 1, userScope);
    expect(ref).not.toContain(userScope.key);
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
