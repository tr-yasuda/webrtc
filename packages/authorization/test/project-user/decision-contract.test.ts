import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserAction,
  authorizeProjectUserFromRaw,
  type ManagementOperation,
  type ProjectUserRole,
} from "../../src/project-user.js";
import { projectId } from "../fixtures.js";
import { targetFor } from "./support.js";

function targetKeys(target: object) {
  return Object.keys(target).toSorted();
}

function inputFor(operation: ManagementOperation, role: ProjectUserRole = "owner") {
  return {
    actor: { projectId, role },
    project: { id: projectId, state: "active" as const },
    operation,
    target: targetFor(operation),
  };
}

describe("ProjectUser 認可の監査target契約", () => {
  test("ProjectUser 追加のtargetは accountId と nextRole を含める", () => {
    expect(
      targetKeys(authorizeProjectUserAction(inputFor("projectUser.add")).target),
    ).toStrictEqual(["accountId", "nextRole", "projectId"]);
  });

  test("ProjectUser 除外のtargetは projectUserId と currentRole を含める", () => {
    expect(
      targetKeys(authorizeProjectUserAction(inputFor("projectUser.remove")).target),
    ).toStrictEqual(["currentRole", "projectId", "projectUserId"]);
  });

  test("ProjectUser ロール変更のtargetは projectUserId と両ロールを含める", () => {
    expect(
      targetKeys(authorizeProjectUserAction(inputFor("projectUser.changeRole")).target),
    ).toStrictEqual(["currentRole", "nextRole", "projectId", "projectUserId"]);
  });

  test("Room 操作のtargetは roomId を含める", () => {
    expect(targetKeys(authorizeProjectUserAction(inputFor("room.update")).target)).toStrictEqual([
      "projectId",
      "roomId",
    ]);
    expect(targetKeys(authorizeProjectUserAction(inputFor("room.delete")).target)).toStrictEqual([
      "projectId",
      "roomId",
    ]);
  });

  test("Session と Participant の強制切断targetは対象IDを含める", () => {
    expect(
      targetKeys(authorizeProjectUserAction(inputFor("session.disconnect")).target),
    ).toStrictEqual(["projectId", "sessionId"]);
    expect(
      targetKeys(authorizeProjectUserAction(inputFor("participant.disconnect")).target),
    ).toStrictEqual(["participantId", "projectId"]);
  });

  test("一覧取得のtargetは resourceId の有無を反映する", () => {
    expect(
      targetKeys(
        authorizeProjectUserAction({
          actor: { projectId, role: "owner" },
          project: { id: projectId, state: "active" },
          operation: "project.read",
          target: { projectId, resourceId: "resource-a" },
        }).target,
      ),
    ).toStrictEqual(["projectId", "resourceId"]);
    expect(
      targetKeys(
        authorizeProjectUserAction({
          actor: { projectId, role: "owner" },
          project: { id: projectId, state: "active" },
          operation: "project.read",
          target: { projectId },
        }).target,
      ),
    ).toStrictEqual(["projectId"]);
  });

  test("Admin は Owner 以外の ProjectUser を付与・除外・変更できる", () => {
    for (const operation of [
      "projectUser.add",
      "projectUser.remove",
      "projectUser.changeRole",
    ] as const) {
      expect(authorizeProjectUserAction(inputFor(operation, "admin")).allowed).toBe(true);
    }
  });

  test("Admin の操作では別操作の role 条件を参照しない", () => {
    const cases = [
      {
        operation: "projectUser.add" as const,
        target: {
          ...targetFor("projectUser.add"),
          currentRole: "owner" as const,
          nextRole: "auditor" as const,
        },
      },
      {
        operation: "projectUser.remove" as const,
        target: {
          ...targetFor("projectUser.remove"),
          currentRole: "auditor" as const,
          nextRole: "owner" as const,
        },
      },
    ];

    for (const { operation, target } of cases) {
      expect(
        authorizeProjectUserAction({
          actor: { projectId, role: "admin" },
          project: { id: projectId, state: "active" },
          operation,
          target,
        }).allowed,
      ).toBe(true);
    }
  });

  test("生入力の認可は有効な入力で成功する", () => {
    const outcome = authorizeProjectUserFromRaw(inputFor("project.read"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.allowed).toBe(true);
    }
  });
});
