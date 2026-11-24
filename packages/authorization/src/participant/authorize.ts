import type { ValidationFailureReason } from "../contracts/identifiers.js";
import {
  validateParticipantAuthorizationInput,
  type ParticipantAuthorizationDecision,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationTarget,
  type ValidatedParticipantAuthorizationInput,
} from "../contracts/participant.js";
import type { RuleViolation } from "../contracts/rules.js";
import { buildParticipantTarget } from "./target.js";
import { checkCredentialTarget } from "./rules/credential-target.js";
import { checkGrant } from "./rules/grant.js";
import { checkOperationSpecific } from "./rules/operation-specific.js";
import { checkProject } from "./rules/project.js";
import { checkSubject } from "./rules/subject.js";

const participantRules = [
  checkProject,
  checkCredentialTarget,
  checkSubject,
  checkGrant,
  checkOperationSpecific,
] as const;

export type ParticipantAuthorizationOutcome =
  | {
      readonly ok: true;
      readonly decision: ParticipantAuthorizationDecision;
    }
  | {
      readonly ok: false;
      readonly failure: ValidationFailureReason;
    };

export function authorizeParticipantAction(
  input: ValidatedParticipantAuthorizationInput,
): ParticipantAuthorizationDecision {
  const target = buildParticipantTarget(input);
  for (const rule of participantRules) {
    const violation = rule(input);
    if (violation !== null) {
      return deny(input, target, violation);
    }
  }
  return allow(input, target);
}

export function authorizeParticipantFromRaw(raw: unknown): ParticipantAuthorizationOutcome {
  const validated = validateParticipantAuthorizationInput(raw);
  if (!validated.ok) {
    return { ok: false, failure: validated.reason };
  }
  return { ok: true, decision: authorizeParticipantAction(validated.value) };
}

function allow(
  input: ParticipantAuthorizationInput,
  target: ParticipantAuthorizationTarget,
): ParticipantAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target,
    reason: "allowed",
  };
}

function deny(
  input: ParticipantAuthorizationInput,
  target: ParticipantAuthorizationTarget,
  violation: RuleViolation<ParticipantAuthorizationDecision["reason"]>,
): ParticipantAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target,
    reason: violation.reason,
  };
}
