import { describe, expect, test } from "vitest";
import { compareQuotaScopes, type QuotaScope } from "../src/index.js";

describe("quota スコープの順序", () => {
  test("ロケールで同値になる異なるキーも決定的に順序付ける", () => {
    const composed: QuotaScope = { kind: "user", key: "é" };
    const decomposed: QuotaScope = { kind: "user", key: "e\u0301" };

    expect(compareQuotaScopes(composed, decomposed)).not.toBe(0);
    const forward = [composed, decomposed].toSorted(compareQuotaScopes).map((scope) => scope.key);
    const reverse = [decomposed, composed].toSorted(compareQuotaScopes).map((scope) => scope.key);
    expect(forward).toEqual(reverse);
  });
});
