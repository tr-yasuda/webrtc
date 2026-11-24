import type {
  ManagementCredentialAuthorizationInput,
  ManagementCredentialAuthorizationTarget,
} from "../contracts/management-credential.js";

export function buildManagementCredentialTarget(
  input: ManagementCredentialAuthorizationInput,
): ManagementCredentialAuthorizationTarget {
  const target = input.target;
  switch (input.operation) {
    case "room.update":
    case "room.delete":
      return {
        projectId: target.projectId,
        ...(target.roomId === undefined ? {} : { roomId: target.roomId }),
      };
    case "session.disconnect":
      return {
        projectId: target.projectId,
        ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      };
    case "participant.disconnect":
      return {
        projectId: target.projectId,
        ...(target.participantId === undefined ? {} : { participantId: target.participantId }),
      };
    default:
      return {
        projectId: target.projectId,
        ...(target.resourceId === undefined ? {} : { resourceId: target.resourceId }),
      };
  }
}
