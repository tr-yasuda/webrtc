import type { AccountId, ParticipantId, ProjectUserId, RoomId } from "@webrtc/domain";
import { fc } from "@fast-check/vitest";
import type { ManagementOperation, ProjectUserRole } from "../../src/management-operation.js";
import { isManagementOperation, isProjectUserRole } from "../../src/management-operation.js";
import type {
  ProjectUserAuthorizationInput,
  ProjectUserAuthorizationReason,
  ProjectUserAuthorizationTarget,
} from "../../src/project-user.js";
import {
  allManagementOperations,
  allProjectUserRoles,
  expectedProjectUserAllowedOperations,
} from "../policy-expectations.js";
import { idPoolArbitrary, type IdPool, unknownStringArbitrary } from "../pbt-support.js";

export type ProjectUserCaseBase = {
  readonly input: ProjectUserAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ManagementOperation;
  readonly role: ProjectUserRole;
};

export type ProjectUserCase = {
  readonly input: ProjectUserAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ManagementOperation;
  readonly role: ProjectUserRole;
};

export type ProjectUserMutation = {
  readonly id: string;
  readonly category: string;
  readonly reason: ProjectUserAuthorizationReason;
  readonly multiFault?: boolean;
  readonly apply: (base: ProjectUserCaseBase) => ProjectUserCaseBase | undefined;
  readonly catalog: {
    readonly operation: ManagementOperation;
    readonly role: ProjectUserRole;
  };
};

export function projectUserBaselineCaseArbitrary(): fc.Arbitrary<ProjectUserCaseBase> {
  return fc
    .tuple(fc.constantFrom(...allManagementOperations), idPoolArbitrary())
    .chain(([operation, ids]) => {
      const roles = allowedRolesFor(operation);
      return fc.constantFrom(...roles).map((role) => ({
        input: projectUserBaseline(operation, role, ids),
        ids,
        operation,
        role,
      }));
    });
}

export function projectUserValidCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    role: base.role,
  }));
}

export function projectUserSingleFaultCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserCaseWithMutationsArbitrary(1, 1);
}

export function projectUserMultiFaultCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserCaseWithMutationsArbitrary(2, 4);
}

export function projectUserCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return fc.oneof(
    { arbitrary: projectUserValidCaseArbitrary(), weight: 1 },
    { arbitrary: projectUserSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: projectUserMultiFaultCaseArbitrary(), weight: 2 },
  );
}

export function projectUserBaseline(
  operation: ManagementOperation,
  role: ProjectUserRole,
  ids: IdPool,
): ProjectUserAuthorizationInput {
  return {
    actor: { projectId: ids.projectId, role },
    project: { id: ids.projectId, state: "active" },
    operation,
    target: projectUserTargetFor(operation, ids),
  };
}

export function projectUserViolations(
  input: ProjectUserAuthorizationInput,
): ReadonlySet<ProjectUserAuthorizationReason> {
  const violations = new Set<ProjectUserAuthorizationReason>();
  const operationIsKnown = isManagementOperation(input.operation);
  const actorRole = input.actor.role;
  const actorRoleIsKnown = actorRole !== null && isProjectUserRole(actorRole);
  const targetRolesAreKnown =
    (input.target.currentRole === undefined || isProjectUserRole(input.target.currentRole)) &&
    (input.target.nextRole === undefined || isProjectUserRole(input.target.nextRole));

  if (input.project.state !== "active") {
    violations.add("project-not-active");
  }
  if (input.actor.projectId !== input.project.id) {
    violations.add("actor-project-mismatch");
  }
  if (input.target.projectId !== input.project.id) {
    violations.add("target-project-mismatch");
  }
  if (!operationIsKnown) {
    violations.add("unsupported-operation");
  }
  if (actorRole === null) {
    violations.add("project-user-role-missing");
  } else if (!isProjectUserRole(actorRole)) {
    violations.add("project-user-role-invalid");
  }
  if (!targetRolesAreKnown) {
    violations.add("project-user-role-invalid");
  }

  if (operationIsKnown && actorRoleIsKnown && targetRolesAreKnown) {
    if (!projectUserHasRequiredTargetId(input)) {
      violations.add("target-id-required");
    } else if (!expectedProjectUserAllowedOperations[actorRole].includes(input.operation)) {
      violations.add("insufficient-role");
    } else {
      if (
        (input.operation === "projectUser.add" || input.operation === "projectUser.changeRole") &&
        input.target.nextRole === undefined
      ) {
        violations.add("project-user-next-role-required");
      }
      if (
        (input.operation === "projectUser.remove" ||
          input.operation === "projectUser.changeRole") &&
        input.target.currentRole === undefined
      ) {
        violations.add("project-user-current-role-required");
      }
      if (actorRole === "admin" && projectUserManagesOwner(input)) {
        violations.add("owner-management-forbidden");
      }
    }
  }

  return violations;
}

export const projectUserMutations: readonly ProjectUserMutation[] = [
  mutation("project-suspended", "project", "project-not-active", (base) => ({
    ...base,
    input: {
      ...base.input,
      project: { ...base.input.project, state: "suspended" },
    },
  })),
  mutation("actor-project-mismatch", "actor-project", "actor-project-mismatch", (base) => ({
    ...base,
    input: {
      ...base.input,
      actor: { ...base.input.actor, projectId: base.ids.otherProjectId },
    },
  })),
  mutation("target-project-mismatch", "target-project", "target-project-mismatch", (base) => ({
    ...base,
    input: {
      ...base.input,
      target: { ...base.input.target, projectId: base.ids.otherProjectId },
    },
  })),
  mutation("role-missing", "actor-role", "project-user-role-missing", (base) => ({
    ...base,
    input: {
      ...base.input,
      actor: { ...base.input.actor, role: null },
    },
  })),
  mutation("role-unknown", "actor-role", "project-user-role-invalid", (base) => ({
    ...base,
    input: {
      ...base.input,
      actor: { ...base.input.actor, role: "superuser" as ProjectUserRole },
    },
  })),
  mutation(
    "current-role-unknown",
    "target-role",
    "project-user-role-invalid",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        target: {
          ...base.input.target,
          currentRole: "superuser" as ProjectUserRole,
        },
      },
    }),
    { operation: "projectUser.changeRole", role: "owner" },
  ),
  mutation(
    "next-role-unknown",
    "target-role",
    "project-user-role-invalid",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        target: {
          ...base.input.target,
          nextRole: "superuser" as ProjectUserRole,
        },
      },
    }),
    { operation: "projectUser.add", role: "owner" },
  ),
  mutation(
    "target-id-missing",
    "target-id",
    "target-id-required",
    (base) => {
      const target = removeRequiredTargetId(base.input.target, base.input.operation);
      return target === undefined ? undefined : { ...base, input: { ...base.input, target } };
    },
    { operation: "room.update", role: "owner" },
  ),
  mutation(
    "insufficient-role",
    "role-permission",
    "insufficient-role",
    (base) => {
      const denyingRole = allProjectUserRoles.find(
        (role) => !expectedProjectUserAllowedOperations[role].includes(base.operation),
      );
      if (denyingRole === undefined) {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          actor: { ...base.input.actor, role: denyingRole },
        },
      };
    },
    { operation: "project.delete", role: "owner" },
  ),
  mutation(
    "next-role-missing",
    "role-requirement",
    "project-user-next-role-required",
    (base) => {
      if (
        base.input.operation !== "projectUser.add" &&
        base.input.operation !== "projectUser.changeRole"
      ) {
        return undefined;
      }
      const { nextRole: _nextRole, ...target } = base.input.target;
      return { ...base, input: { ...base.input, target } };
    },
    { operation: "projectUser.add", role: "owner" },
  ),
  mutation(
    "current-role-missing",
    "role-requirement",
    "project-user-current-role-required",
    (base) => {
      if (
        base.input.operation !== "projectUser.remove" &&
        base.input.operation !== "projectUser.changeRole"
      ) {
        return undefined;
      }
      const { currentRole: _currentRole, ...target } = base.input.target;
      return { ...base, input: { ...base.input, target } };
    },
    { operation: "projectUser.remove", role: "owner" },
  ),
  mutation(
    "admin-owner-add",
    "owner-management",
    "owner-management-forbidden",
    (base) => {
      if (base.input.actor.role !== "admin" || base.input.operation !== "projectUser.add") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          target: { ...base.input.target, nextRole: "owner" },
        },
      };
    },
    { operation: "projectUser.add", role: "admin" },
  ),
  mutation(
    "admin-owner-remove",
    "owner-management",
    "owner-management-forbidden",
    (base) => {
      if (base.input.actor.role !== "admin" || base.input.operation !== "projectUser.remove") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          target: { ...base.input.target, currentRole: "owner" },
        },
      };
    },
    { operation: "projectUser.remove", role: "admin" },
  ),
  mutation(
    "admin-owner-change-from",
    "owner-management",
    "owner-management-forbidden",
    (base) => {
      if (base.input.actor.role !== "admin" || base.input.operation !== "projectUser.changeRole") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          target: { ...base.input.target, currentRole: "owner" },
        },
      };
    },
    { operation: "projectUser.changeRole", role: "admin" },
  ),
  mutation(
    "admin-owner-change-to",
    "owner-management",
    "owner-management-forbidden",
    (base) => {
      if (base.input.actor.role !== "admin" || base.input.operation !== "projectUser.changeRole") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          target: { ...base.input.target, nextRole: "owner" },
        },
      };
    },
    { operation: "projectUser.changeRole", role: "admin" },
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
    { operation: "room.update", role: "owner" },
    false,
  ),
];

export function projectUserUnknownRoleArbitrary(): fc.Arbitrary<ProjectUserRole> {
  return unknownStringArbitrary(allProjectUserRoles) as fc.Arbitrary<ProjectUserRole>;
}

function projectUserCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ProjectUserCase> {
  return projectUserBaselineCaseArbitrary().chain((base) => {
    const applicable = projectUserMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = projectUserViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ProjectUserCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        role: base.role,
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
          role: current.role,
        };
      })
      .filter(
        (value): value is ProjectUserCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          projectUserViolations(value.input).size >= minMutations,
      );
  });
}

function mutation(
  id: string,
  category: string,
  reason: ProjectUserAuthorizationReason,
  apply: (base: ProjectUserCaseBase) => ProjectUserCaseBase | undefined,
  catalog: ProjectUserMutation["catalog"] = { operation: "room.update", role: "owner" },
  multiFault = true,
): ProjectUserMutation {
  return { id, category, reason, multiFault, apply, catalog };
}

function projectUserTargetFor(
  operation: ManagementOperation,
  ids: IdPool,
): ProjectUserAuthorizationTarget {
  switch (operation) {
    case "projectUser.add":
      return { projectId: ids.projectId, accountId: ids.accountId, nextRole: "auditor" };
    case "projectUser.remove":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: "auditor",
      };
    case "projectUser.changeRole":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: "auditor",
        nextRole: "auditor",
      };
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

function allowedRolesFor(operation: ManagementOperation): readonly ProjectUserRole[] {
  const roles = allProjectUserRoles.filter((role) =>
    expectedProjectUserAllowedOperations[role].includes(operation),
  );
  if (roles.length === 0) {
    throw new Error(`operation ${operation} を許可するロールがありません`);
  }
  return roles;
}

export function projectUserHasRequiredTargetId(input: ProjectUserAuthorizationInput): boolean {
  switch (input.operation) {
    case "projectUser.add":
      return "accountId" in input.target;
    case "projectUser.remove":
    case "projectUser.changeRole":
      return "projectUserId" in input.target;
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

export function projectUserManagesOwner(input: ProjectUserAuthorizationInput): boolean {
  return (
    (input.operation === "projectUser.add" && input.target.nextRole === "owner") ||
    (input.operation === "projectUser.remove" && input.target.currentRole === "owner") ||
    (input.operation === "projectUser.changeRole" &&
      (input.target.currentRole === "owner" || input.target.nextRole === "owner"))
  );
}

function removeRequiredTargetId(
  target: ProjectUserAuthorizationTarget,
  operation: ManagementOperation,
): ProjectUserAuthorizationTarget | undefined {
  switch (operation) {
    case "projectUser.add": {
      const { accountId: _accountId, ...rest } = target as Extract<
        ProjectUserAuthorizationTarget,
        { accountId: AccountId }
      >;
      return rest;
    }
    case "projectUser.remove":
    case "projectUser.changeRole": {
      const { projectUserId: _projectUserId, ...rest } = target as Extract<
        ProjectUserAuthorizationTarget,
        { projectUserId: ProjectUserId }
      >;
      return rest;
    }
    case "room.update":
    case "room.delete": {
      const { roomId: _roomId, ...rest } = target as Extract<
        ProjectUserAuthorizationTarget,
        { roomId: RoomId }
      >;
      return rest;
    }
    case "session.disconnect": {
      const { sessionId: _sessionId, ...rest } = target as Extract<
        ProjectUserAuthorizationTarget,
        { sessionId: string }
      >;
      return rest;
    }
    case "participant.disconnect": {
      const { participantId: _participantId, ...rest } = target as Extract<
        ProjectUserAuthorizationTarget,
        { participantId: ParticipantId }
      >;
      return rest;
    }
    default:
      return undefined;
  }
}
