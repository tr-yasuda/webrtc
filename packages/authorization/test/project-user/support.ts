import type { ManagementOperation, ProjectUserRole } from "../../src/management-operation.js";
import type { ProjectUserAuthorizationTarget } from "../../src/project-user.js";
import {
  accountId,
  participantId,
  projectId,
  projectUserId,
  roomId,
  sessionId,
} from "../fixtures.js";

export function targetFor(operation: ManagementOperation): ProjectUserAuthorizationTarget {
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

export const expectedAllowedOperations: Record<ProjectUserRole, readonly ManagementOperation[]> = {
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

export const allOperations = expectedAllowedOperations.owner;
