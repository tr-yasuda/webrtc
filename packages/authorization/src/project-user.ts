import type { ProjectId } from "@webrtc/domain";
import type { AuthorizationDecision } from "./decision.js";
import type { ManagementOperation, ProjectUserRole } from "./management-operation.js";
import type { ProjectState } from "./project-state.js";

const roleOperations: Record<ProjectUserRole, ReadonlySet<ManagementOperation>> = {
  owner: new Set<ManagementOperation>([
    "project.read",
    "project.update",
    "project.delete",
    "projectUser.read",
    "projectUser.add",
    "projectUser.remove",
    "projectUser.changeRole",
    "application.manage",
    "applicationSigningKey.manage",
    "managementApiCredential.manage",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
    "audit.read",
  ]),
  admin: new Set<ManagementOperation>([
    "project.read",
    "project.update",
    "projectUser.read",
    "projectUser.add",
    "projectUser.remove",
    "projectUser.changeRole",
    "application.manage",
    "applicationSigningKey.manage",
    "managementApiCredential.manage",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
    "audit.read",
  ]),
  operator: new Set<ManagementOperation>([
    "project.read",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
  ]),
  auditor: new Set<ManagementOperation>([
    "project.read",
    "room.read",
    "session.read",
    "participant.read",
    "usage.read",
    "audit.read",
  ]),
};

export type ProjectUserAuthorizationTarget = {
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
  | "insufficient-role"
  | "owner-management-forbidden"
  | "project-user-current-role-required"
  | "project-user-next-role-required";

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
  if (input.actor.role === null) {
    return deny(input, "project-user-role-missing");
  }
  const allowedOperations = roleOperations[input.actor.role];
  if (allowedOperations === undefined) {
    return deny(input, "project-user-role-missing");
  }
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
    ((input.operation === "projectUser.add" && input.target.nextRole === "owner") ||
      (input.operation === "projectUser.remove" && input.target.currentRole === "owner") ||
      (input.operation === "projectUser.changeRole" &&
        (input.target.currentRole === "owner" || input.target.nextRole === "owner")))
  ) {
    return deny(input, "owner-management-forbidden");
  }

  return allow(input);
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
