import { fc } from "@fast-check/vitest";
import type {
  ManagementCredentialAuthorizationInput,
  ManagementCredentialAuthorizationTarget,
  ManagementCredentialScope,
} from "../../../src/management-credential.js";
import type { ManagementOperation } from "../../../src/management-operation.js";
import { allCredentialOperations, credentialRequiredScopesByOperation } from "../../policy.js";
import { idPoolArbitrary, type IdPool } from "../support.js";

export type ManagementCredentialCaseBase = {
  readonly input: ManagementCredentialAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ManagementOperation;
  readonly scope: ManagementCredentialScope;
};

export function managementCredentialBaselineCaseArbitrary(): fc.Arbitrary<ManagementCredentialCaseBase> {
  return fc
    .tuple(fc.constantFrom(...allCredentialOperations), idPoolArbitrary())
    .chain(([operation, ids]) => {
      const requiredScopes = credentialRequiredScopesByOperation[operation];
      if (requiredScopes === undefined || requiredScopes.length === 0) {
        throw new Error(`credential operation ${operation} に scope がありません`);
      }
      return fc.constantFrom(...requiredScopes).map((scope) => ({
        input: managementCredentialBaseline(operation, scope, ids),
        ids,
        operation,
        scope,
      }));
    });
}

export function managementCredentialBaseline(
  operation: ManagementOperation,
  scope: ManagementCredentialScope,
  ids: IdPool,
): ManagementCredentialAuthorizationInput {
  return {
    credential: {
      projectId: ids.projectId,
      scopes: [scope],
      revoked: false,
      expiresAt: 2_000,
    },
    project: { id: ids.projectId, state: "active" },
    operation,
    target: managementCredentialTargetFor(operation, ids),
    now: 1_000,
  };
}

function managementCredentialTargetFor(
  operation: ManagementOperation,
  ids: IdPool,
): ManagementCredentialAuthorizationTarget {
  switch (operation) {
    case "room.update":
    case "room.delete":
      return { projectId: ids.projectId, roomId: ids.roomId };
    case "session.disconnect":
      return { projectId: ids.projectId, sessionId: ids.sessionId };
    case "participant.disconnect":
      return { projectId: ids.projectId, participantId: ids.participantId };
    default:
      return { projectId: ids.projectId, resourceId: "resource-a" };
  }
}
