import { describe, expect, test } from "vitest";
import { authSpecName } from "./auth-spec.js";
import type { ManagementOperation, ProjectUserRole } from "../src/management-operation.js";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationReason,
  type ProjectUserAuthorizationTarget,
} from "../src/project-user.js";
import {
  accountId,
  otherProjectId,
  participantId,
  projectId,
  projectUserId,
  roomId,
  sessionId,
} from "./fixtures.js";
import {
  allManagementOperations,
  allProjectUserRoles,
  expectedProjectUserAllowedOperations,
} from "./policy.js";

function targetFor(operation: ManagementOperation): ProjectUserAuthorizationTarget {
  switch (operation) {
    case "projectUser.add":
      return { projectId, accountId, nextRole: "auditor" };
    case "projectUser.remove":
      return { projectId, projectUserId, currentRole: "auditor" };
    case "projectUser.changeRole":
      return {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "auditor",
      };
    case "room.update":
    case "room.delete":
      return { projectId, roomId };
    case "session.disconnect":
      return { projectId, sessionId };
    case "participant.disconnect":
      return { projectId, participantId };
    default:
      return { projectId, resourceId: "resource-a" };
  }
}

describe("ProjectUser ロールの認可", () => {
  test(authSpecName("AUTH-PU-01", "Owner は Project を削除できる"), () => {
    const decision = authorizeProjectUserAction({
      actor: {
        projectId,
        role: "owner",
      },
      project: {
        id: projectId,
        state: "active",
      },
      operation: "project.delete",
      target: {
        projectId,
      },
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "project.delete",
      reason: "allowed",
      target: {
        projectId,
      },
    });
  });

  test(authSpecName("AUTH-PU-05", "空の Session ID は対象 ID なしとして拒否する"), () => {
    const decision = authorizeProjectUserAction({
      actor: { projectId, role: "owner" },
      project: { id: projectId, state: "active" },
      operation: "session.disconnect",
      target: { projectId, sessionId: "" },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "session.disconnect",
      target: { projectId, sessionId: "" },
      reason: "target-id-required",
    });
  });

  test.each(allProjectUserRoles)(
    authSpecName(["AUTH-PU-01", "AUTH-PU-02"], "%s ロールの操作可否が権限マトリクスと一致する"),
    (role) => {
      for (const operation of allManagementOperations) {
        const decision = authorizeProjectUserAction({
          actor: {
            projectId,
            role,
          },
          project: {
            id: projectId,
            state: "active",
          },
          operation,
          target: targetFor(operation),
        });

        expect(decision.allowed, `${role} / ${operation}`).toBe(
          expectedProjectUserAllowedOperations[role].includes(operation),
        );
      }
    },
  );

  test.each([
    {
      name: "Admin は Owner を新たに付与できない",
      role: "admin",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
        nextRole: "owner",
      },
      allowed: false,
    },
    {
      name: "Admin は Owner のロールを変更できない",
      role: "admin",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "owner",
        nextRole: "admin",
      },
      allowed: false,
    },
    {
      name: "Admin は Owner を除外できない",
      role: "admin",
      operation: "projectUser.remove",
      target: {
        projectId,
        projectUserId,
        currentRole: "owner",
      },
      allowed: false,
    },
    {
      name: "Admin は Owner 以外のロールを変更できる",
      role: "admin",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "admin",
      },
      allowed: true,
    },
    {
      name: "Owner は Owner を付与できる",
      role: "owner",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
        nextRole: "owner",
      },
      allowed: true,
    },
  ] satisfies ReadonlyArray<{
    name: string;
    role: ProjectUserRole;
    operation: ManagementOperation;
    target: ProjectUserAuthorizationTarget;
    allowed: boolean;
  }>)(
    authSpecName("AUTH-PU-03", "$name"),
    ({ role, operation, target: requestedTarget, allowed }) => {
      const decision = authorizeProjectUserAction({
        actor: {
          projectId,
          role,
        },
        project: {
          id: projectId,
          state: "active",
        },
        operation,
        target: requestedTarget,
      });

      expect(decision).toStrictEqual({
        allowed,
        operation,
        target: requestedTarget,
        reason: allowed ? "allowed" : "owner-management-forbidden",
      });
    },
  );

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
  }>)(
    authSpecName("AUTH-PU-04", "$name 場合は拒否する"),
    ({ operation, target: requestedTarget, reason }) => {
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
    },
  );

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

  test.each(["superuser", "__proto__", "constructor"] as ProjectUserRole[])(
    authSpecName("AUTH-PU-04", "定義外の ProjectUser ロール %s は拒否する"),
    (role) => {
      const decision = authorizeProjectUserAction({
        actor: {
          projectId,
          role,
        },
        project: {
          id: projectId,
          state: "active",
        },
        operation: "project.read",
        target: {
          projectId,
        },
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation: "project.read",
        target: { projectId },
        reason: "project-user-role-invalid",
      });
    },
  );

  test.each([
    {
      name: "付与後ロールが定義外である",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
        nextRole: "Owner" as ProjectUserRole,
      },
    },
    {
      name: "現在ロールが定義外である",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "Owner" as ProjectUserRole,
        nextRole: "auditor",
      },
    },
    {
      name: "変更後ロールが定義外である",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "superuser" as ProjectUserRole,
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    target: ProjectUserAuthorizationTarget;
  }>)(
    authSpecName("AUTH-PU-04", "$name場合は拒否する"),
    ({ operation, target: requestedTarget }) => {
      const decision = authorizeProjectUserAction({
        actor: {
          projectId,
          role: "admin",
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
        reason: "project-user-role-invalid",
      });
    },
  );

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
  }>)(
    authSpecName("AUTH-PU-04", "$name に対象 ID がない場合は拒否する"),
    ({ operation, target: requestedTarget }) => {
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
    },
  );

  test.each([
    {
      name: "ProjectUser の追加",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
        nextRole: "auditor",
      },
    },
    {
      name: "ProjectUser の除外",
      operation: "projectUser.remove",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
      },
    },
    {
      name: "ProjectUser のロール変更",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "operator",
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    target: ProjectUserAuthorizationTarget;
  }>)(
    authSpecName("AUTH-PU-04", "$name は対象 ID を監査 target に含める"),
    ({ operation, target: requestedTarget }) => {
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
        allowed: true,
        operation,
        target: requestedTarget,
        reason: "allowed",
      });
    },
  );

  test(authSpecName("AUTH-PU-04", "定義外の Management operation は拒否する"), () => {
    const decision = authorizeProjectUserAction({
      actor: {
        projectId,
        role: "owner",
      },
      project: {
        id: projectId,
        state: "active",
      },
      operation: "unknown.operation" as ManagementOperation,
      target: {
        projectId,
      },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "unknown.operation",
      target: { projectId },
      reason: "unsupported-operation",
    });
  });
});
