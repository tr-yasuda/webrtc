import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkSubject(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (input.credential.subject.length === 0) {
    return { reason: "subject-required" };
  }
  if (input.participant === undefined) {
    return null;
  }
  if (input.participant.externalUserId.length === 0) {
    return { reason: "subject-required" };
  }
  if (input.participant.externalUserId !== input.credential.subject) {
    return { reason: "subject-mismatch" };
  }
  return null;
}
