import type { ProjectId } from "@webrtc/domain";
import { describe, expect, test } from "vitest";
import type { ManagementOperation, ProjectUserRole } from "../src/management-operation.js";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationReason,
  type ProjectUserAuthorizationTarget,
} from "../src/project-user.js";

const projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as ProjectId;
const target: ProjectUserAuthorizationTarget = {
  projectId,
  currentRole: "auditor",
  nextRole: "auditor",
};

const expectedAllowedOperations: Record<ProjectUserRole, readonly ManagementOperation[]> = {
  owner: [
    "project.read",
    "project.update",
    "project.delete",
    "projectUser.read",
    "projectUser.add",
    "projectUser.remove",
    "projectUser.changeRole",
    "application.manage",
    "applicationSigningKey.manage",
    "managementApiCredential.manage",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
    "audit.read",
  ],
  admin: [
    "project.read",
    "project.update",
    "projectUser.read",
    "projectUser.add",
    "projectUser.remove",
    "projectUser.changeRole",
    "application.manage",
    "applicationSigningKey.manage",
    "managementApiCredential.manage",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
    "audit.read",
  ],
  operator: [
    "project.read",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
  ],
  auditor: [
    "project.read",
    "room.read",
    "session.read",
    "participant.read",
    "usage.read",
    "audit.read",
  ],
};
const allOperations = expectedAllowedOperations.owner;

describe("ProjectUser ロールの認可", () => {
  test("Owner は Project を削除できる", () => {
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

    expect(decision).toMatchObject({
      allowed: true,
      operation: "project.delete",
      reason: "allowed",
      target: {
        projectId,
      },
    });
  });

  test.each(Object.keys(expectedAllowedOperations) as ProjectUserRole[])(
    "%s ロールの操作可否が権限マトリクスと一致する",
    (role) => {
      for (const operation of allOperations) {
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
          target,
        });

        expect(decision.allowed, `${role} / ${operation}`).toBe(
          expectedAllowedOperations[role].includes(operation),
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
  }>)("$name", ({ role, operation, target: requestedTarget, allowed }) => {
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

    expect(decision).toMatchObject({
      allowed,
      operation,
      ...(allowed ? { reason: "allowed" } : { reason: "owner-management-forbidden" }),
    });
  });

  test.each([
    {
      name: "ProjectUser の付与に付与後ロールがない",
      operation: "projectUser.add",
      target: {
        projectId,
      },
      reason: "project-user-next-role-required",
    },
    {
      name: "ProjectUser のロール変更に変更後ロールがない",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        currentRole: "auditor",
      },
      reason: "project-user-next-role-required",
    },
    {
      name: "ProjectUser のロール変更に現在ロールがない",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        nextRole: "admin",
      },
      reason: "project-user-current-role-required",
    },
    {
      name: "ProjectUser の除外に現在ロールがない",
      operation: "projectUser.remove",
      target: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation,
      reason,
    });
  });

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
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
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
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
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
  ])("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeProjectUserAction(input);

    expect(decision).toMatchObject({
      allowed: false,
      operation: input.operation,
      reason,
    });
  });

  test("定義外の ProjectUser ロールは拒否する", () => {
    const decision = authorizeProjectUserAction({
      actor: {
        projectId,
        role: "superuser" as ProjectUserRole,
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

    expect(decision).toMatchObject({
      allowed: false,
      reason: "project-user-role-missing",
    });
  });
});
