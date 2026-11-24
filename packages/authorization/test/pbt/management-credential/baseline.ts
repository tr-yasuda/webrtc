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

export type ManagementCredentialExpiry = {
  readonly now: number;
  readonly expiresAt: number;
};

const defaultExpiry: ManagementCredentialExpiry = {
  now: 1_000,
  expiresAt: 2_000,
};

export function managementCredentialBaselineCaseArbitrary(): fc.Arbitrary<ManagementCredentialCaseBase> {
  return fc
    .tuple(fc.constantFrom(...allCredentialOperations), idPoolArbitrary(), expiryArbitrary())
    .chain(([operation, ids, expiry]) => {
      const requiredScopes = credentialRequiredScopesByOperation[operation];
      if (requiredScopes === undefined || requiredScopes.length === 0) {
        throw new Error(`credential operation ${operation} に scope がありません`);
      }
      return fc.constantFrom(...requiredScopes).map((scope) => ({
        input: managementCredentialBaseline(operation, scope, ids, expiry),
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
  expiry: ManagementCredentialExpiry = defaultExpiry,
): ManagementCredentialAuthorizationInput {
  return {
    credential: {
      projectId: ids.projectId,
      scopes: [scope],
      revoked: false,
      expiresAt: expiry.expiresAt,
    },
    project: { id: ids.projectId, state: "active" },
    operation,
    target: managementCredentialTargetFor(operation, ids),
    now: expiry.now,
  };
}

function expiryArbitrary(): fc.Arbitrary<ManagementCredentialExpiry> {
  return fc.integer({ min: 2, max: 10_000 }).chain((expiresAt) =>
    fc.oneof(
      fc.constant({ now: expiresAt - 1, expiresAt }),
      fc.integer({ min: 0, max: expiresAt - 1 }).map((now) => ({ now, expiresAt })),
    ),
  );
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
