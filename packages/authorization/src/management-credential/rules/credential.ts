import type { ManagementCredentialAuthorizationReason } from "../../contracts/identifiers.js";
import type { ManagementCredentialAuthorizationInput } from "../../contracts/management-credential.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkCredentialRevoked(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (input.credential.revoked !== false) {
    return { reason: "credential-revoked" };
  }
  return null;
}

export function checkExpiryValid(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (!Number.isFinite(input.credential.expiresAt) || !Number.isFinite(input.now)) {
    return { reason: "credential-expiry-invalid" };
  }
  return null;
}

export function checkExpired(
  input: ManagementCredentialAuthorizationInput,
): RuleViolation<ManagementCredentialAuthorizationReason> | null {
  if (input.now >= input.credential.expiresAt) {
    return { reason: "credential-expired" };
  }
  return null;
}
