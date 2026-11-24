import type { ManagementOperation } from "../../src/management-operation.js";
import type { ProjectUserAuthorizationTarget } from "../../src/project-user.js";
import { allManagementOperations, expectedProjectUserAllowedOperations } from "../policy.js";
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

export const expectedAllowedOperations = expectedProjectUserAllowedOperations;
export const allOperations = allManagementOperations;
