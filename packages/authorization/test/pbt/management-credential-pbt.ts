import { fc } from "@fast-check/vitest";
import type { ParticipantId, RoomId } from "@webrtc/domain";
import {
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialAuthorizationTarget,
  type ManagementCredentialScope,
} from "../../src/management-credential.js";
import { isManagementOperation, type ManagementOperation } from "../../src/management-operation.js";
import {
  allCredentialOperations,
  allManagementCredentialScopes,
  allManagementOperations,
  credentialRequiredScopesByOperation,
  expectedCredentialScopeOperations,
} from "../policy-expectations.js";
import { idPoolArbitrary, type IdPool, unknownStringArbitrary } from "../pbt-support.js";

export type ManagementCredentialCaseBase = {
  readonly input: ManagementCredentialAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ManagementOperation;
  readonly scope: ManagementCredentialScope;
};

export type ManagementCredentialCase = {
  readonly input: ManagementCredentialAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ManagementOperation;
  readonly scope: ManagementCredentialScope;
};

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

const credentialScopeSet = new Set<string>(allManagementCredentialScopes);

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

export function managementCredentialValidCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    scope: base.scope,
  }));
}

export function managementCredentialSingleFaultCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialCaseWithMutationsArbitrary(1, 1);
}

export function managementCredentialMultiFaultCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialCaseWithMutationsArbitrary(2, 4);
}

export function managementCredentialCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return fc.oneof(
    { arbitrary: managementCredentialValidCaseArbitrary(), weight: 1 },
    { arbitrary: managementCredentialSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: managementCredentialMultiFaultCaseArbitrary(), weight: 2 },
  );
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

export function managementCredentialUnknownOperationArbitrary(): fc.Arbitrary<ManagementOperation> {
  return unknownStringArbitrary(allManagementOperations) as fc.Arbitrary<ManagementOperation>;
}

export function managementCredentialUnknownScopeArbitrary(): fc.Arbitrary<ManagementCredentialScope> {
  return unknownStringArbitrary(
    allManagementCredentialScopes,
  ) as fc.Arbitrary<ManagementCredentialScope>;
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

function managementCredentialCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialBaselineCaseArbitrary().chain((base) => {
    const applicable = managementCredentialMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = managementCredentialViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ManagementCredentialCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        scope: base.scope,
      };
      return fc.constant(emptyCase).filter(() => false);
    }
    return fc
      .uniqueArray(fc.constantFrom(...categories), {
        minLength: minMutations,
        maxLength: Math.min(maxMutations, categories.length),
      })
      .map((selectedCategories) => {
        let current = base;
        const applied: string[] = [];
        for (const category of selectedCategories) {
          const candidate = applicable.find((entry) => entry.category === category);
          const next = candidate?.apply(current);
          if (candidate !== undefined && next !== undefined) {
            current = next;
            applied.push(candidate.id);
          }
        }
        if (applied.length < minMutations) {
          return undefined;
        }
        return {
          input: current.input,
          mutations: applied,
          operation: current.operation,
          scope: current.scope,
        };
      })
      .filter(
        (value): value is ManagementCredentialCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          managementCredentialViolations(value.input).size >= minMutations,
      );
  });
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

function removeRequiredTargetId(
  target: ManagementCredentialAuthorizationTarget,
  operation: ManagementOperation,
): ManagementCredentialAuthorizationTarget | undefined {
  switch (operation) {
    case "room.update":
    case "room.delete": {
      const { roomId: _roomId, ...rest } = target as Extract<
        ManagementCredentialAuthorizationTarget,
        { roomId: RoomId }
      >;
      return rest;
    }
    case "session.disconnect": {
      const { sessionId: _sessionId, ...rest } = target as Extract<
        ManagementCredentialAuthorizationTarget,
        { sessionId: string }
      >;
      return rest;
    }
    case "participant.disconnect": {
      const { participantId: _participantId, ...rest } = target as Extract<
        ManagementCredentialAuthorizationTarget,
        { participantId: ParticipantId }
      >;
      return rest;
    }
    default:
      return undefined;
  }
}

function isManagementCredentialScope(value: unknown): value is ManagementCredentialScope {
  return typeof value === "string" && credentialScopeSet.has(value);
}
