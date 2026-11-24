import type { ManagementCredentialAuthorizationReason } from "../../contracts/identifiers.js";
import type { ManagementCredentialAuthorizationInput } from "../../contracts/management-credential.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { operationScope } from "../scope-matrix.js";

export function checkOperationAllowed(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (operationScope[input.operation] === undefined) {
    return { reason: "credential-operation-not-allowed" };
  }
  return null;
}

export function checkScopePresent(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  const requiredScope = operationScope[input.operation]!;
  if (!input.credential.scopes.includes(requiredScope)) {
    return { reason: "credential-scope-missing" };
  }
  return null;
}
