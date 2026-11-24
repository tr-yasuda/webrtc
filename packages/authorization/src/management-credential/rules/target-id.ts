import type { ManagementCredentialAuthorizationReason } from "../../contracts/identifiers.js";
import type { ManagementCredentialAuthorizationInput } from "../../contracts/management-credential.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { credentialTargetFields } from "../../generated/policy.js";

export function checkRequiredTargetId(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (!hasRequiredTargetId(input)) {
    return { reason: "target-id-required" };
  }
  return null;
}

function hasRequiredTargetId(input: ManagementCredentialAuthorizationInput): boolean {
  const field = credentialTargetFields[input.operation];
  if (field === undefined) return true;
  const value = (input.target as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0;
}
