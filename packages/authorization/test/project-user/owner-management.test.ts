import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationTarget,
} from "../../src/project-user.js";
import { type ManagementOperation, type ProjectUserRole } from "../../src/management-operation.js";
import { accountId, projectId, projectUserId } from "../fixtures.js";

describe("ProjectUser ロールの認可", () => {
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
      name: "Admin は Auditor を Owner へ昇格できない",
      role: "admin",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "owner",
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
});
