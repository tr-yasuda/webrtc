import { describe, expect, test } from "vitest";
import { checkProjectOwnerInvariant } from "../src/project-owner.js";

describe("Project の Owner 不変条件", () => {
  test("最後の Owner を除外すると不変条件違反になる", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: 1,
        change: { kind: "remove", currentIsOwner: true },
      }),
    ).toStrictEqual({ ok: false, reason: "last-owner" });
  });

  test("Owner が2人いれば1人を除外できる", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: 2,
        change: { kind: "remove", currentIsOwner: true },
      }),
    ).toStrictEqual({ ok: true });
  });

  test("最後の Owner を降格すると不変条件違反になる", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: 1,
        change: {
          kind: "changeRole",
          currentIsOwner: true,
          nextIsOwner: false,
        },
      }),
    ).toStrictEqual({ ok: false, reason: "last-owner" });
  });

  test("Owner が2人いれば1人を降格できる", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: 2,
        change: {
          kind: "changeRole",
          currentIsOwner: true,
          nextIsOwner: false,
        },
      }),
    ).toStrictEqual({ ok: true });
  });

  test("Owner 以外の除外は Owner 数を変えない", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: 1,
        change: { kind: "remove", currentIsOwner: false },
      }),
    ).toStrictEqual({ ok: true });
  });

  test("Owner 数を負数として扱えない場合は不変条件を判定しない", () => {
    expect(
      checkProjectOwnerInvariant({
        activeOwnerCount: -1,
        change: { kind: "remove", currentIsOwner: true },
      }),
    ).toStrictEqual({ ok: false, reason: "owner-count-invalid" });
  });
});
