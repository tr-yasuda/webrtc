import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { projectUserTargetFields } from "../../generated/policy.js";

export function checkRequiredTargetId(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (!hasRequiredTargetId(input)) {
    return { reason: "target-id-required" };
  }
  return null;
}

function hasRequiredTargetId(input: ProjectUserAuthorizationInput): boolean {
  const field = projectUserTargetFields[input.operation];
  if (field === undefined) return true;
  const value = (input.target as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0;
}
