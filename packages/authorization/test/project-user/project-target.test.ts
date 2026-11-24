import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import { authorizeProjectUserAction } from "../../src/project-user.js";
import { otherProjectId, projectId } from "../fixtures.js";

describe("ProjectUser ロールの認可", () => {
  test.each([
    {
      name: "Project が停止している",
      input: {
        actor: {
          projectId,
          role: "owner" as const,
        },
        project: {
          id: projectId,
          state: "suspended" as const,
        },
        operation: "project.read" as const,
        target: {
          projectId,
        },
      },
      reason: "project-not-active",
    },
    {
      name: "ProjectUser の Project が対象 Project と一致しない",
      input: {
        actor: {
          projectId: otherProjectId,
          role: "owner" as const,
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        operation: "project.read" as const,
        target: {
          projectId,
        },
      },
      reason: "actor-project-mismatch",
    },
    {
      name: "対象資源の Project が一致しない",
      input: {
        actor: {
          projectId,
          role: "owner" as const,
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        operation: "room.read" as const,
        target: {
          projectId: otherProjectId,
          resourceId: "room-a",
        },
      },
      reason: "target-project-mismatch",
    },
    {
      name: "ProjectUser の権限を失っている",
      input: {
        actor: {
          projectId,
          role: null,
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        operation: "project.read" as const,
        target: {
          projectId,
        },
      },
      reason: "project-user-role-missing",
    },
    {
      name: "ロールに許可されていない操作である",
      input: {
        actor: {
          projectId,
          role: "auditor" as const,
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        operation: "project.delete" as const,
        target: {
          projectId,
        },
      },
      reason: "insufficient-role",
    },
  ])(authSpecName("AUTH-PU-04", "$name 場合は拒否する"), ({ input, reason }) => {
    const decision = authorizeProjectUserAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: input.target,
      reason,
    });
  });
});
