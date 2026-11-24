import type { ManagementCredentialAuthorizationReason } from "../../contracts/identifiers.js";
import type { ManagementCredentialAuthorizationInput } from "../../contracts/management-credential.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkRequiredTargetId(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (!hasRequiredTargetId(input)) {
    return { reason: "target-id-required" };
  }
  return null;
}

function hasRequiredTargetId(input: ManagementCredentialAuthorizationInput): boolean {
  switch (input.operation) {
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
