import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkGrant(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  const grants = input.credential.grants;
  if (grants[input.operation] !== true) {
    return { reason: "grant-not-granted" };
  }
  return null;
}
