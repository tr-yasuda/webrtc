import {
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialScope,
} from "../../../src/management-credential.js";
import {
  isManagementOperation,
  type ManagementOperation,
} from "../../../src/management-operation.js";
import {
  allManagementCredentialScopes,
  allManagementOperations,
  credentialRequiredScopesByOperation,
  expectedCredentialScopeOperations,
} from "../../policy.js";

const credentialScopeSet = new Set<string>(allManagementCredentialScopes);

export function managementCredentialViolations(
  input: ManagementCredentialAuthorizationInput,
): ReadonlySet<ManagementCredentialAuthorizationReason> {
  const violations = new Set<ManagementCredentialAuthorizationReason>();
  const scopesAreValid =
    Array.isArray(input.credential.scopes) &&
    input.credential.scopes.every(isManagementCredentialScope);
  const operationIsKnown = isManagementOperation(input.operation);
  const expiryIsUsable = Number.isFinite(input.credential.expiresAt) && Number.isFinite(input.now);

  if (input.credential.revoked !== false) {
    violations.add("credential-revoked");
  }
  if (!expiryIsUsable) {
    violations.add("credential-expiry-invalid");
  } else if (input.now >= input.credential.expiresAt) {
    violations.add("credential-expired");
  }
  if (
    input.credential.projectId !== input.project.id ||
    input.target.projectId !== input.project.id
  ) {
    violations.add("credential-target-mismatch");
  }
  if (input.project.state !== "active") {
    violations.add("project-not-active");
  }
  if (!scopesAreValid) {
    violations.add("credential-input-invalid");
  }
  if (!operationIsKnown) {
    violations.add("unsupported-operation");
  }

  if (operationIsKnown && scopesAreValid) {
    if (!managementCredentialHasRequiredTargetId(input)) {
      violations.add("target-id-required");
    } else {
      const requiredScopes = credentialRequiredScopesByOperation[input.operation];
      if (requiredScopes === undefined) {
        violations.add("credential-operation-not-allowed");
      } else if (!requiredScopes.some((scope) => input.credential.scopes.includes(scope))) {
        violations.add("credential-scope-missing");
      }
    }
  }

  return violations;
}

export const managementCredentialProjectUserOnlyOperations: readonly ManagementOperation[] =
  allManagementOperations.filter(
    (operation) => credentialRequiredScopesByOperation[operation] === undefined,
  );

export function managementCredentialScopeAllows(
  operation: ManagementOperation,
  scope: ManagementCredentialScope,
): boolean {
  return expectedCredentialScopeOperations[scope].includes(operation);
}

export function managementCredentialHasRequiredTargetId(
  input: ManagementCredentialAuthorizationInput,
): boolean {
  switch (input.operation) {
    case "room.update":
    case "room.delete":
      return "roomId" in input.target;
    case "session.disconnect":
      return "sessionId" in input.target;
    case "participant.disconnect":
      return "participantId" in input.target;
    default:
      return true;
  }
}

function isManagementCredentialScope(value: unknown): value is ManagementCredentialScope {
  return typeof value === "string" && credentialScopeSet.has(value);
}
