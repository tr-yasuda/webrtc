import { fc } from "@fast-check/vitest";
import {
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialAuthorizationTarget,
  type ManagementCredentialScope,
} from "../../../src/management-credential.js";
import type { ManagementOperation } from "../../../src/management-operation.js";
import { allManagementCredentialScopes, allManagementOperations } from "../../policy.js";
import { unknownStringArbitrary } from "../support.js";
import type { ManagementCredentialCaseBase } from "./baseline.js";

export type ManagementCredentialMutation = {
  readonly id: string;
  readonly category: string;
  readonly reason: ManagementCredentialAuthorizationReason;
  readonly multiFault?: boolean;
  readonly apply: (base: ManagementCredentialCaseBase) => ManagementCredentialCaseBase | undefined;
  readonly catalog: {
    readonly operation: ManagementOperation;
    readonly scope: ManagementCredentialScope;
  };
};

export const managementCredentialMutations: readonly ManagementCredentialMutation[] = [
  mutation("credential-revoked", "revoked", "credential-revoked", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: { ...base.input.credential, revoked: true },
    },
  })),
  mutation("expires-at-nan", "expiry-invalid", "credential-expiry-invalid", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: { ...base.input.credential, expiresAt: Number.NaN },
    },
  })),
  mutation("expires-at-infinity", "expiry-invalid", "credential-expiry-invalid", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: {
        ...base.input.credential,
        expiresAt: Number.POSITIVE_INFINITY,
      },
    },
  })),
  mutation("now-nan", "expiry-invalid", "credential-expiry-invalid", (base) => ({
    ...base,
    input: { ...base.input, now: Number.NaN },
  })),
  mutation("now-infinity", "expiry-invalid", "credential-expiry-invalid", (base) => ({
    ...base,
    input: { ...base.input, now: Number.POSITIVE_INFINITY },
  })),
  mutation("now-equals-expires", "expiry-boundary", "credential-expired", (base) => ({
    ...base,
    input: { ...base.input, now: base.input.credential.expiresAt },
  })),
  mutation("now-after-expires", "expiry-boundary", "credential-expired", (base) => ({
    ...base,
    input: { ...base.input, now: base.input.credential.expiresAt + 1 },
  })),
  mutation(
    "credential-project-mismatch",
    "credential-project",
    "credential-target-mismatch",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        credential: { ...base.input.credential, projectId: base.ids.otherProjectId },
      },
    }),
  ),
  mutation("target-project-mismatch", "target-project", "credential-target-mismatch", (base) => ({
    ...base,
    input: {
      ...base.input,
      target: { ...base.input.target, projectId: base.ids.otherProjectId },
    },
  })),
  mutation("project-suspended", "project", "project-not-active", (base) => ({
    ...base,
    input: {
      ...base.input,
      project: { ...base.input.project, state: "suspended" },
    },
  })),
  mutation("scope-unknown", "scope-validity", "credential-input-invalid", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: {
        ...base.input.credential,
        scopes: [...base.input.credential.scopes, "unknown.scope" as ManagementCredentialScope],
      },
    },
  })),
  mutation("scopes-empty", "scope-presence", "credential-scope-missing", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: { ...base.input.credential, scopes: [] },
    },
  })),
  mutation(
    "target-id-missing",
    "target-id",
    "target-id-required",
    (base) => {
      const target = removeRequiredTargetId(base.input.target, base.input.operation);
      return target === undefined ? undefined : { ...base, input: { ...base.input, target } };
    },
    { operation: "room.update", scope: "room.manage" },
  ),
  mutation(
    "operation-not-allowed",
    "operation-scope",
    "credential-operation-not-allowed",
    (base) => ({
      ...base,
      input: { ...base.input, operation: "project.read" },
    }),
  ),
  mutation(
    "unknown-operation",
    "unknown-operation",
    "unsupported-operation",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        operation: "unknown.operation" as ManagementOperation,
      },
    }),
    { operation: "room.read", scope: "room.manage" },
    false,
  ),
];

const managementCredentialValidationMutationIds = new Set(["scope-unknown", "unknown-operation"]);

export const managementCredentialAuthorizationMutations = managementCredentialMutations.filter(
  (candidate) => !managementCredentialValidationMutationIds.has(candidate.id),
);

export const managementCredentialValidationMutations = managementCredentialMutations.filter(
  (candidate) => managementCredentialValidationMutationIds.has(candidate.id),
);

export function managementCredentialUnknownOperationArbitrary(): fc.Arbitrary<ManagementOperation> {
  return unknownStringArbitrary(allManagementOperations) as fc.Arbitrary<ManagementOperation>;
}

export function managementCredentialUnknownScopeArbitrary(): fc.Arbitrary<ManagementCredentialScope> {
  return unknownStringArbitrary(
    allManagementCredentialScopes,
  ) as fc.Arbitrary<ManagementCredentialScope>;
}

function mutation(
  id: string,
  category: string,
  reason: ManagementCredentialAuthorizationReason,
  apply: (base: ManagementCredentialCaseBase) => ManagementCredentialCaseBase | undefined,
  catalog: ManagementCredentialMutation["catalog"] = {
    operation: "room.read",
    scope: "room.manage",
  },
  multiFault = true,
): ManagementCredentialMutation {
  return { id, category, reason, multiFault, apply, catalog };
}

function removeRequiredTargetId(
  target: ManagementCredentialAuthorizationTarget,
  operation: ManagementOperation,
): ManagementCredentialAuthorizationTarget | undefined {
  switch (operation) {
    case "room.update":
    case "room.delete": {
      return { projectId: target.projectId };
    }
    case "session.disconnect": {
      return { projectId: target.projectId };
    }
    case "participant.disconnect": {
      return { projectId: target.projectId };
    }
    default:
      return undefined;
  }
}
