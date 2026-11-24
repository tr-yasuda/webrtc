import { fc } from "@fast-check/vitest";
import type { ManagementOperation, ProjectUserRole } from "../../../src/management-operation.js";
import type {
  ProjectUserAuthorizationInput,
  ProjectUserAuthorizationTarget,
} from "../../../src/project-user.js";
import {
  allManagementOperations,
  allProjectUserRoles,
  expectedProjectUserAllowedOperations,
} from "../../policy.js";
import { idPoolArbitrary, type IdPool } from "../support.js";

export type ProjectUserCaseBase = {
  readonly input: ProjectUserAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ManagementOperation;
  readonly role: ProjectUserRole;
};

export type ProjectUserTargetRoles = {
  readonly currentRole?: ProjectUserRole;
  readonly nextRole?: ProjectUserRole;
};

export function projectUserBaselineCaseArbitrary(): fc.Arbitrary<ProjectUserCaseBase> {
  return fc
    .tuple(fc.constantFrom(...allManagementOperations), idPoolArbitrary())
    .chain(([operation, ids]) => {
      const roles = allowedRolesFor(operation);
      return fc.constantFrom(...roles).chain((role) =>
        projectUserTargetRolesArbitrary(operation, role).map((targetRoles) => ({
          input: projectUserBaseline(operation, role, ids, targetRoles),
          ids,
          operation,
          role,
        })),
      );
    });
}

export function projectUserBaseline(
  operation: ManagementOperation,
  role: ProjectUserRole,
  ids: IdPool,
  targetRoles: ProjectUserTargetRoles = {},
): ProjectUserAuthorizationInput {
  return {
    actor: { projectId: ids.projectId, role },
    project: { id: ids.projectId, state: "active" },
    operation,
    target: projectUserTargetFor(operation, ids, targetRoles),
  };
}

function projectUserTargetFor(
  operation: ManagementOperation,
  ids: IdPool,
  targetRoles: ProjectUserTargetRoles,
): ProjectUserAuthorizationTarget {
  switch (operation) {
    case "projectUser.add":
      return {
        projectId: ids.projectId,
        accountId: ids.accountId,
        nextRole: targetRoles.nextRole ?? "auditor",
      };
    case "projectUser.remove":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: targetRoles.currentRole ?? "auditor",
      };
    case "projectUser.changeRole":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: targetRoles.currentRole ?? "auditor",
        nextRole: targetRoles.nextRole ?? "auditor",
      };
    case "room.update":
    case "room.delete":
      return { projectId: ids.projectId, roomId: ids.roomId };
    case "session.disconnect":
      return { projectId: ids.projectId, sessionId: ids.sessionId };
    case "participant.disconnect":
      return { projectId: ids.projectId, participantId: ids.participantId };
    default:
      return { projectId: ids.projectId, resourceId: "resource-a" };
  }
}

function projectUserTargetRolesArbitrary(
  operation: ManagementOperation,
  actorRole: ProjectUserRole,
): fc.Arbitrary<ProjectUserTargetRoles> {
  switch (operation) {
    case "projectUser.add":
      return fc.constantFrom(...validTargetRoles(actorRole)).map((nextRole) => ({ nextRole }));
    case "projectUser.remove":
      return fc
        .constantFrom(...validTargetRoles(actorRole))
        .map((currentRole) => ({ currentRole }));
    case "projectUser.changeRole":
      return fc
        .tuple(
          fc.constantFrom(...validTargetRoles(actorRole)),
          fc.constantFrom(...validTargetRoles(actorRole)),
        )
        .map(([currentRole, nextRole]) => ({ currentRole, nextRole }));
    default:
      return fc.constant({});
  }
}

function validTargetRoles(actorRole: ProjectUserRole): readonly ProjectUserRole[] {
  return actorRole === "admin"
    ? allProjectUserRoles.filter((role) => role !== "owner")
    : allProjectUserRoles;
}

function allowedRolesFor(operation: ManagementOperation): readonly ProjectUserRole[] {
  const roles = allProjectUserRoles.filter((role) =>
    expectedProjectUserAllowedOperations[role].includes(operation),
  );
  if (roles.length === 0) {
    throw new Error(`operation ${operation} を許可するロールがありません`);
  }
  return roles;
}
