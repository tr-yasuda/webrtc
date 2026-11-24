import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationTarget,
} from "../../src/project-user.js";
import { type ManagementOperation } from "../../src/management-operation.js";
import { projectId } from "../fixtures.js";

describe("ProjectUser ロールの認可", () => {
  test.each([
    {
      name: "ProjectUser の追加",
      operation: "projectUser.add",
      target: {
        projectId,
        nextRole: "auditor",
      },
    },
    {
      name: "ProjectUser の除外",
      operation: "projectUser.remove",
      target: {
        projectId,
        currentRole: "auditor",
      },
    },
    {
      name: "ProjectUser のロール変更",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        currentRole: "auditor",
        nextRole: "operator",
      },
    },
    {
      name: "Room の設定変更",
      operation: "room.update",
      target: {
        projectId,
      },
    },
    {
      name: "Room の削除",
      operation: "room.delete",
      target: {
        projectId,
      },
    },
    {
      name: "Session の強制切断",
      operation: "session.disconnect",
      target: {
        projectId,
      },
    },
    {
      name: "Participant の強制切断",
      operation: "participant.disconnect",
      target: {
        projectId,
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    target: ProjectUserAuthorizationTarget;
  }>)("$name に対象 ID がない場合は拒否する", ({ operation, target: requestedTarget }) => {
    const decision = authorizeProjectUserAction({
      actor: {
        projectId,
        role: "owner",
      },
      project: {
        id: projectId,
        state: "active",
      },
      operation,
      target: requestedTarget,
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation,
      target: requestedTarget,
      reason: "target-id-required",
    });
  });
});
