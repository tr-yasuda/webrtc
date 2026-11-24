import { describe, expect, test } from "vitest";
import {
  canTransition,
  isCounted,
  RESOURCE_STATES,
  ResourceTransitionError,
  assertTransition,
  type ResourceState,
} from "../src/index.js";

describe("資源状態の遷移契約", () => {
  test("予約から解放までの主要な遷移を許可する", () => {
    expect(canTransition("reserved", "in-use")).toBe(true);
    expect(canTransition("in-use", "release-pending")).toBe(true);
    expect(canTransition("release-pending", "released")).toBe(true);
    expect(canTransition("result-unknown", "released")).toBe(true);
    expect(canTransition("isolated", "released")).toBe(true);
  });

  test("解放済みから他の状態へ遷移しない", () => {
    for (const state of RESOURCE_STATES) {
      expect(canTransition("released", state)).toBe(false);
    }
  });

  test("解放済みだけを計上対象外とする", () => {
    for (const state of RESOURCE_STATES) {
      expect(isCounted(state)).toBe(state !== "released");
    }
  });

  test("許可されない遷移は例外にする", () => {
    expect(() => {
      assertTransition("released", "in-use");
    }).toThrow(ResourceTransitionError);
  });

  test("全ての状態から少なくとも1つの遷移先または終端を持つ", () => {
    const statesWithOutgoing = new Set<ResourceState>();
    for (const from of RESOURCE_STATES) {
      for (const to of RESOURCE_STATES) {
        if (canTransition(from, to)) {
          statesWithOutgoing.add(from);
        }
      }
    }

    expect(statesWithOutgoing).toEqual(
      new Set(RESOURCE_STATES.filter((state) => state !== "released")),
    );
  });
});
