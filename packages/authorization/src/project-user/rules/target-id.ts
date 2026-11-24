import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkRequiredTargetId(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (!hasRequiredTargetId(input)) {
    return { reason: "target-id-required" };
  }
  return null;
}

function hasRequiredTargetId(input: ProjectUserAuthorizationInput): boolean {
  switch (input.operation) {
    case "projectUser.add":
      return input.target.accountId !== undefined;
    case "projectUser.remove":
    case "projectUser.changeRole":
      return input.target.projectUserId !== undefined;
    case "room.update":
    case "room.delete":
      return input.target.roomId !== undefined;
    case "session.disconnect":
      return input.target.sessionId !== undefined;
    case "participant.disconnect":
      return input.target.participantId !== undefined;
    default:
      return true;
  }
}
