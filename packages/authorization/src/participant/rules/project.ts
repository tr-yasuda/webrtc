import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkProject(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (input.project.state !== "active") {
    return { reason: "project-not-active" };
  }
  return null;
}
