import type { AccountId, ParticipantId, ProjectId, ProjectUserId, RoomId } from "@webrtc/domain";
import type { AuthorizationDecision } from "./decision.js";
import {
  adminOwnerManagementFields,
  projectUserTargetFields,
  roleOperations,
} from "./generated/policy.js";
import {
  isManagementOperation,
  isProjectUserRole,
  type ManagementOperation,
  type ProjectUserRole,
} from "./management-operation.js";
import type { ProjectState } from "./project-state.js";

export type ProjectUserAuthorizationTarget =
  | {
      readonly projectId: ProjectId;
      readonly accountId: AccountId;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    }
  | {
      readonly projectId: ProjectId;
      readonly projectUserId: ProjectUserId;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    }
  | {
      readonly projectId: ProjectId;
      readonly roomId: RoomId;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    }
  | {
      readonly projectId: ProjectId;
      readonly sessionId: string;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    }
  | {
      readonly projectId: ProjectId;
      readonly participantId: ParticipantId;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    }
  | {
      readonly projectId: ProjectId;
      readonly resourceId?: string;
      readonly currentRole?: ProjectUserRole;
      readonly nextRole?: ProjectUserRole;
    };

export type ProjectUserAuthorizationReason =
  | "allowed"
  | "project-not-active"
  | "actor-project-mismatch"
  | "target-project-mismatch"
  | "project-user-role-missing"
  | "project-user-role-invalid"
  | "target-id-required"
  | "insufficient-role"
  | "owner-management-forbidden"
  | "project-user-current-role-required"
  | "project-user-next-role-required"
  | "unsupported-operation";

export type ProjectUserAuthorizationDecision = AuthorizationDecision<
  ManagementOperation,
  ProjectUserAuthorizationTarget,
  ProjectUserAuthorizationReason
>;

export type ProjectUserAuthorizationInput = {
  readonly actor: {
    readonly projectId: ProjectId;
    readonly role: ProjectUserRole | null;
  };
  readonly project: {
    readonly id: ProjectId;
    readonly state: ProjectState;
  };
  readonly operation: ManagementOperation;
  readonly target: ProjectUserAuthorizationTarget;
};

export function authorizeProjectUserAction(
  input: ProjectUserAuthorizationInput,
): ProjectUserAuthorizationDecision {
  if (input.project.state !== "active") {
    return deny(input, "project-not-active");
  }
  if (input.actor.projectId !== input.project.id) {
    return deny(input, "actor-project-mismatch");
  }
  if (input.target.projectId !== input.project.id) {
    return deny(input, "target-project-mismatch");
  }
  if (!isManagementOperation(input.operation)) {
    return deny(input, "unsupported-operation");
  }
  if (input.actor.role === null) {
    return deny(input, "project-user-role-missing");
  }
  if (!isProjectUserRole(input.actor.role)) {
    return deny(input, "project-user-role-invalid");
  }
  if (
    (input.target.currentRole !== undefined && !isProjectUserRole(input.target.currentRole)) ||
    (input.target.nextRole !== undefined && !isProjectUserRole(input.target.nextRole))
  ) {
    return deny(input, "project-user-role-invalid");
  }
  if (!hasRequiredTargetId(input)) {
    return deny(input, "target-id-required");
  }
  const allowedOperations = roleOperations[input.actor.role];
  if (!allowedOperations.has(input.operation)) {
    return deny(input, "insufficient-role");
  }
  if (
    (input.operation === "projectUser.add" || input.operation === "projectUser.changeRole") &&
    input.target.nextRole === undefined
  ) {
    return deny(input, "project-user-next-role-required");
  }
  if (
    (input.operation === "projectUser.remove" || input.operation === "projectUser.changeRole") &&
    input.target.currentRole === undefined
  ) {
    return deny(input, "project-user-current-role-required");
  }
  if (
    input.actor.role === "admin" &&
    (adminOwnerManagementFields[input.operation] ?? []).some((field) =>
      field === "currentRole"
        ? input.target.currentRole === "owner"
        : input.target.nextRole === "owner",
    )
  ) {
    return deny(input, "owner-management-forbidden");
  }

  return allow(input);
}

function hasRequiredTargetId(input: ProjectUserAuthorizationInput): boolean {
  const field = projectUserTargetFields[input.operation];
  if (field === undefined) return true;
  const value = (input.target as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0;
}

function allow(input: ProjectUserAuthorizationInput): ProjectUserAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target: input.target,
    reason: "allowed",
  };
}

function deny(
  input: ProjectUserAuthorizationInput,
  reason: Exclude<ProjectUserAuthorizationReason, "allowed">,
): ProjectUserAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target: input.target,
    reason,
  };
}
