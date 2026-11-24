import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { participantSubjectConstraints } from "../../generated/policy.js";

export function checkSubject(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (participantSubjectConstraints.required && input.credential.subject.length === 0) {
    return { reason: "subject-required" };
  }
  if (input.participant === undefined) {
    return null;
  }
  if (participantSubjectConstraints.required && input.participant.externalUserId.length === 0) {
    return { reason: "subject-required" };
  }
  if (
    participantSubjectConstraints.matchParticipantExternalUserId &&
    input.participant.externalUserId !== input.credential.subject
  ) {
    return { reason: "subject-mismatch" };
  }
  return null;
}
