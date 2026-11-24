export const projectStates = ["active", "suspended"] as const;
export type ProjectState = (typeof projectStates)[number];

export const participantOperations = [
  "room.create",
  "room.join",
  "media.publish",
  "media.subscribe",
  "data.send",
] as const;
export type ParticipantOperation = (typeof participantOperations)[number];

export const roomStates = ["active", "deleting", "deleted"] as const;
export type RoomState = (typeof roomStates)[number];

export const sessionStates = ["active", "revoked", "ended"] as const;
export type SessionState = (typeof sessionStates)[number];

export const participantStates = ["active", "revoked", "left"] as const;
export type ParticipantState = (typeof participantStates)[number];

export const participantAuthorizationReasons = [
  "allowed",
  "unsupported-operation",
  "credential-input-invalid",
  "subject-required",
  "subject-mismatch",
  "project-not-active",
  "credential-target-mismatch",
  "room-already-exists",
  "room-create-required",
  "room-join-required",
  "room-not-active",
  "grant-not-granted",
  "session-required",
  "session-not-active",
  "session-target-mismatch",
  "participant-required",
  "participant-not-active",
  "participant-target-mismatch",
] as const;
export type ParticipantAuthorizationReason = (typeof participantAuthorizationReasons)[number];

export const projectUserRoles = ["owner", "admin", "operator", "auditor"] as const;
export type ProjectUserRole = (typeof projectUserRoles)[number];

export const managementOperations = [
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
] as const;
export type ManagementOperation = (typeof managementOperations)[number];

export const projectUserAuthorizationReasons = [
  "allowed",
  "project-not-active",
  "actor-project-mismatch",
  "target-project-mismatch",
  "project-user-role-missing",
  "project-user-role-invalid",
  "credential-input-invalid",
  "target-id-required",
  "insufficient-role",
  "owner-management-forbidden",
  "project-user-current-role-required",
  "project-user-next-role-required",
  "unsupported-operation",
] as const;
export type ProjectUserAuthorizationReason = (typeof projectUserAuthorizationReasons)[number];

export const managementCredentialScopes = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
] as const;
export type ManagementCredentialScope = (typeof managementCredentialScopes)[number];

export const managementCredentialAuthorizationReasons = [
  "allowed",
  "credential-revoked",
  "credential-expiry-invalid",
  "credential-expired",
  "credential-target-mismatch",
  "project-not-active",
  "credential-input-invalid",
  "target-id-required",
  "credential-operation-not-allowed",
  "credential-scope-missing",
  "unsupported-operation",
] as const;
export type ManagementCredentialAuthorizationReason =
  (typeof managementCredentialAuthorizationReasons)[number];

export const validationFailureReasons = [
  "input-invalid",
  "unsupported-operation",
  "unsupported-grant",
  "grant-invalid",
  "unsupported-role",
  "unsupported-scope",
  "target-invalid",
] as const;
export type ValidationFailureReason = (typeof validationFailureReasons)[number];

export const participantOperationSet: ReadonlySet<ParticipantOperation> = new Set(
  participantOperations,
);
export const projectStateSet: ReadonlySet<ProjectState> = new Set(projectStates);
export const roomStateSet: ReadonlySet<RoomState> = new Set(roomStates);
export const sessionStateSet: ReadonlySet<SessionState> = new Set(sessionStates);
export const participantStateSet: ReadonlySet<ParticipantState> = new Set(participantStates);
export const projectUserRoleSet: ReadonlySet<ProjectUserRole> = new Set(projectUserRoles);
export const managementOperationSet: ReadonlySet<ManagementOperation> = new Set(
  managementOperations,
);
export const managementCredentialScopeSet: ReadonlySet<ManagementCredentialScope> = new Set(
  managementCredentialScopes,
);

export function isParticipantOperation(value: unknown): value is ParticipantOperation {
  return typeof value === "string" && participantOperationSet.has(value as ParticipantOperation);
}

export function isProjectState(value: unknown): value is ProjectState {
  return typeof value === "string" && projectStateSet.has(value as ProjectState);
}

export function isRoomState(value: unknown): value is RoomState {
  return typeof value === "string" && roomStateSet.has(value as RoomState);
}

export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && sessionStateSet.has(value as SessionState);
}

export function isParticipantState(value: unknown): value is ParticipantState {
  return typeof value === "string" && participantStateSet.has(value as ParticipantState);
}

export function isProjectUserRole(value: unknown): value is ProjectUserRole {
  return typeof value === "string" && projectUserRoleSet.has(value as ProjectUserRole);
}

export function isManagementOperation(value: unknown): value is ManagementOperation {
  return typeof value === "string" && managementOperationSet.has(value as ManagementOperation);
}

export function isManagementCredentialScope(value: unknown): value is ManagementCredentialScope {
  return (
    typeof value === "string" &&
    managementCredentialScopeSet.has(value as ManagementCredentialScope)
  );
}
