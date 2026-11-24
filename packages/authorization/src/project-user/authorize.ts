import type { ValidationFailureReason } from "../contracts/identifiers.js";
import {
  validateProjectUserAuthorizationInput,
  type ProjectUserAuthorizationDecision,
  type ProjectUserAuthorizationInput,
  type ProjectUserAuthorizationTarget,
  type ValidatedProjectUserAuthorizationInput,
} from "../contracts/project-user.js";
import type { RuleViolation } from "../contracts/rules.js";
import { buildProjectUserTarget } from "./target.js";
import { checkActorProject } from "./rules/actor.js";
import { checkOwnerManagement } from "./rules/owner-management.js";
import { checkProject } from "./rules/project.js";
import {
  checkActorRolePresent,
  checkRequiredRoles,
  checkRoleAllowsOperation,
} from "./rules/role.js";
import { checkRequiredTargetId } from "./rules/target-id.js";
import { checkTargetProject } from "./rules/target-project.js";

const projectUserRules = [
  checkProject,
  checkActorProject,
  checkTargetProject,
  checkActorRolePresent,
  checkRequiredTargetId,
  checkRoleAllowsOperation,
  checkRequiredRoles,
  checkOwnerManagement,
] as const;

export type ProjectUserAuthorizationOutcome =
  | {
      readonly ok: true;
      readonly decision: ProjectUserAuthorizationDecision;
    }
  | {
      readonly ok: false;
      readonly failure: ValidationFailureReason;
    };

export function authorizeProjectUserAction(
  input: ValidatedProjectUserAuthorizationInput,
): ProjectUserAuthorizationDecision {
  const target = buildProjectUserTarget(input);
  for (const rule of projectUserRules) {
    const violation = rule(input);
    if (violation !== null) {
      return deny(input, target, violation);
    }
  }
  return allow(input, target);
}

export function authorizeProjectUserFromRaw(raw: unknown): ProjectUserAuthorizationOutcome {
  const validated = validateProjectUserAuthorizationInput(raw);
  if (!validated.ok) {
    return { ok: false, failure: validated.reason };
  }
  return { ok: true, decision: authorizeProjectUserAction(validated.value) };
}

function allow(
  input: ProjectUserAuthorizationInput,
  target: ProjectUserAuthorizationTarget,
): ProjectUserAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target,
    reason: "allowed",
  };
}

function deny(
  input: ProjectUserAuthorizationInput,
  target: ProjectUserAuthorizationTarget,
  violation: RuleViolation<ProjectUserAuthorizationDecision["reason"]>,
): ProjectUserAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target,
    reason: violation.reason,
  };
}
