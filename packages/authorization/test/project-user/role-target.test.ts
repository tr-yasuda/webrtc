import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationReason,
  type ProjectUserAuthorizationTarget,
} from "../../src/project-user.js";
import { type ManagementOperation } from "../../src/management-operation.js";
import { accountId, projectId, projectUserId } from "../fixtures.js";

describe("ProjectUser ロールの認可", () => {
  test.each([
    {
      name: "ProjectUser の付与に付与後ロールがない",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
      },
      reason: "project-user-next-role-required",
    },
    {
      name: "ProjectUser のロール変更に変更後ロールがない",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
      },
      reason: "project-user-next-role-required",
    },
    {
      name: "ProjectUser のロール変更に現在ロールがない",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        nextRole: "admin",
      },
      reason: "project-user-current-role-required",
    },
    {
      name: "ProjectUser の除外に現在ロールがない",
      operation: "projectUser.remove",
      target: {
        projectId,
        projectUserId,
      },
      reason: "project-user-current-role-required",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    target: ProjectUserAuthorizationTarget;
    reason: Exclude<ProjectUserAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ operation, target: requestedTarget, reason }) => {
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
      reason,
    });
  });
});
