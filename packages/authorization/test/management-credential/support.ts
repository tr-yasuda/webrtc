import type { ManagementOperation } from "../../src/management-operation.js";
import type {
  ManagementCredentialAuthorizationInput,
  ManagementCredentialAuthorizationTarget,
} from "../../src/management-credential.js";
import {
  allManagementCredentialScopes,
  allManagementOperations,
  expectedCredentialScopeOperations,
} from "../policy.js";
import { participantId, projectId, roomId, sessionId } from "../fixtures.js";

export const allScopes = allManagementCredentialScopes;
export const allOperations = allManagementOperations;
export const expectedScopeOperations = expectedCredentialScopeOperations;

export const baseInput: ManagementCredentialAuthorizationInput = {
  credential: {
    projectId,
    scopes: allScopes,
    revoked: false,
    expiresAt: 2_000,
  },
  project: {
    id: projectId,
    state: "active",
  },
  operation: "room.read",
  target: {
    projectId,
    resourceId: "room-a",
  },
  now: 1_000,
};

export function targetFor(operation: ManagementOperation): ManagementCredentialAuthorizationTarget {
  switch (operation) {
    case "room.update":
    case "room.delete":
      return { projectId, roomId };
    case "session.disconnect":
      return { projectId, sessionId };
    case "participant.disconnect":
      return { projectId, participantId };
    default:
      return { projectId, resourceId: "room-a" };
  }
}
