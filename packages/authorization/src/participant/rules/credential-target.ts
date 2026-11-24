import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkCredentialTarget(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (
    input.credential.projectId !== input.project.id ||
    input.credential.roomName !== input.room.name ||
    input.room.projectId !== input.project.id
  ) {
    return { reason: "credential-target-mismatch" };
  }
  return null;
}
