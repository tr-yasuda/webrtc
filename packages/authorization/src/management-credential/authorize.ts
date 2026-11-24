import type { ValidationFailureReason } from "../contracts/identifiers.js";
import {
  validateManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationDecision,
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationTarget,
  type ValidatedManagementCredentialAuthorizationInput,
} from "../contracts/management-credential.js";
import type { RuleViolation } from "../contracts/rules.js";
import { buildManagementCredentialTarget } from "./target.js";
import { checkCredentialRevoked, checkExpired, checkExpiryValid } from "./rules/credential.js";
import { checkProjectActive, checkTargetMatch } from "./rules/project-target.js";
import { checkOperationAllowed, checkScopePresent } from "./rules/scope.js";
import { checkRequiredTargetId } from "./rules/target-id.js";

const managementCredentialRules = [
  checkCredentialRevoked,
  checkExpiryValid,
  checkExpired,
  checkTargetMatch,
  checkProjectActive,
  checkRequiredTargetId,
  checkOperationAllowed,
  checkScopePresent,
] as const;

export type ManagementCredentialAuthorizationOutcome =
  | {
      readonly ok: true;
      readonly decision: ManagementCredentialAuthorizationDecision;
    }
  | {
      readonly ok: false;
      readonly failure: ValidationFailureReason;
    };

export function authorizeManagementCredentialAction(
  input: ValidatedManagementCredentialAuthorizationInput,
): ManagementCredentialAuthorizationDecision {
  const target = buildManagementCredentialTarget(input);
  for (const rule of managementCredentialRules) {
    const violation = rule(input);
    if (violation !== null) {
      return deny(input, target, violation);
    }
  }
  return allow(input, target);
}

export function authorizeManagementCredentialFromRaw(
  raw: unknown,
): ManagementCredentialAuthorizationOutcome {
  const validated = validateManagementCredentialAuthorizationInput(raw);
  if (!validated.ok) {
    return { ok: false, failure: validated.reason };
  }
  return {
    ok: true,
    decision: authorizeManagementCredentialAction(validated.value),
  };
}

function allow(
  input: ManagementCredentialAuthorizationInput,
  target: ManagementCredentialAuthorizationTarget,
): ManagementCredentialAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target,
    reason: "allowed",
  };
}

function deny(
  input: ManagementCredentialAuthorizationInput,
  target: ManagementCredentialAuthorizationTarget,
  violation: RuleViolation<ManagementCredentialAuthorizationDecision["reason"]>,
): ManagementCredentialAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target,
    reason: violation.reason,
  };
}
