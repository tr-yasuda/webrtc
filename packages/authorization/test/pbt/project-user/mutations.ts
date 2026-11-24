import { fc } from "@fast-check/vitest";
import type { ManagementOperation, ProjectUserRole } from "../../../src/management-operation.js";
import type {
  ProjectUserAuthorizationReason,
  ProjectUserAuthorizationTarget,
} from "../../../src/project-user.js";
import {
  allManagementOperations,
  allProjectUserRoles,
  expectedProjectUserAllowedOperations,
} from "../../policy.js";
import { unknownStringArbitrary } from "../support.js";
import type { ProjectUserCaseBase } from "./baseline.js";

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

const projectUserValidationMutationIds = new Set([
  "role-unknown",
  "current-role-unknown",
  "next-role-unknown",
  "unknown-operation",
]);

export const projectUserAuthorizationMutations = projectUserMutations.filter(
  (candidate) => !projectUserValidationMutationIds.has(candidate.id),
);

export const projectUserValidationMutations = projectUserMutations.filter((candidate) =>
  projectUserValidationMutationIds.has(candidate.id),
);

export function projectUserUnknownRoleArbitrary(): fc.Arbitrary<ProjectUserRole> {
  return unknownStringArbitrary(allProjectUserRoles) as fc.Arbitrary<ProjectUserRole>;
}

export function projectUserUnknownOperationArbitrary(): fc.Arbitrary<ManagementOperation> {
  return unknownStringArbitrary(allManagementOperations) as fc.Arbitrary<ManagementOperation>;
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

function removeRequiredTargetId(
  target: ProjectUserAuthorizationTarget,
  operation: ManagementOperation,
): ProjectUserAuthorizationTarget | undefined {
  switch (operation) {
    case "projectUser.add": {
      return {
        projectId: target.projectId,
        ...(target.nextRole === undefined ? {} : { nextRole: target.nextRole }),
      };
    }
    case "projectUser.remove":
    case "projectUser.changeRole": {
      return {
        projectId: target.projectId,
        ...(target.currentRole === undefined ? {} : { currentRole: target.currentRole }),
        ...(target.nextRole === undefined ? {} : { nextRole: target.nextRole }),
      };
    }
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
