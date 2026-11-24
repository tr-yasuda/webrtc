import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { roleOperations } from "../role-matrix.js";

export function checkActorRolePresent(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (input.actor.role === null) {
    return { reason: "project-user-role-missing" };
  }
  return null;
}

export function checkRoleAllowsOperation(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (!roleOperations[input.actor.role!].has(input.operation)) {
    return { reason: "insufficient-role" };
  }
  return null;
}

export function checkRequiredRoles(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (
    (input.operation === "projectUser.add" || input.operation === "projectUser.changeRole") &&
    input.target.nextRole === undefined
  ) {
    return {
      reason: "project-user-next-role-required",
    };
  }
  if (
    (input.operation === "projectUser.remove" || input.operation === "projectUser.changeRole") &&
    input.target.currentRole === undefined
  ) {
    return {
      reason: "project-user-current-role-required",
    };
  }
  return null;
}
