import type { ManagementCredentialAuthorizationReason } from "../../contracts/identifiers.js";
import type { ManagementCredentialAuthorizationInput } from "../../contracts/management-credential.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkTargetMatch(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (
    input.credential.projectId !== input.project.id ||
    input.target.projectId !== input.project.id
  ) {
    return { reason: "credential-target-mismatch" };
  }
  return null;
}

export function checkProjectActive(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (input.project.state !== "active") {
    return { reason: "project-not-active" };
  }
  return null;
}
