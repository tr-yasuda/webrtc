import type {
  ProjectUserAuthorizationInput,
  ProjectUserAuthorizationTarget,
} from "../contracts/project-user.js";

export function buildProjectUserTarget(
  input: ProjectUserAuthorizationInput,
): ProjectUserAuthorizationTarget {
  const target = input.target;
  switch (input.operation) {
    case "projectUser.add":
      return {
        projectId: target.projectId,
        ...(target.accountId === undefined ? {} : { accountId: target.accountId }),
        ...(target.nextRole === undefined ? {} : { nextRole: target.nextRole }),
      };
    case "projectUser.remove":
    case "projectUser.changeRole":
      return {
        projectId: target.projectId,
        ...(target.projectUserId === undefined ? {} : { projectUserId: target.projectUserId }),
        ...(target.currentRole === undefined ? {} : { currentRole: target.currentRole }),
        ...(target.nextRole === undefined ? {} : { nextRole: target.nextRole }),
      };
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
