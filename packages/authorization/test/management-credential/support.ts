import type { ManagementOperation } from "../../src/management-operation.js";
import type {
  ManagementCredentialAuthorizationInput,
  ManagementCredentialAuthorizationTarget,
  ManagementCredentialScope,
} from "../../src/management-credential.js";
import { participantId, projectId, roomId, sessionId } from "../fixtures.js";

export const allScopes: readonly ManagementCredentialScope[] = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
];

export const allOperations: readonly ManagementOperation[] = [
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
];

export const expectedScopeOperations: Record<
  ManagementCredentialScope,
  readonly ManagementOperation[]
> = {
  "room.manage": ["room.read", "room.update", "room.delete"],
  "session.manage": [
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
  ],
  "usage.read": ["usage.read"],
  "audit.read": ["audit.read"],
};

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
