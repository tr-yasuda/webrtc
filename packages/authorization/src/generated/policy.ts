/* @generated from docs/auth/authorization-spec/authorization-policy.json schemaVersion=1 sourceSha256=0c61aa8044498255277f08c9c633799619671405039d6e93bd4892466967402d; do not edit. */

export const projectUserRoleValues = ["owner", "admin", "operator", "auditor"] as const;
export type ProjectUserRole = (typeof projectUserRoleValues)[number];
export const projectUserRoleSet: ReadonlySet<ProjectUserRole> = new Set(projectUserRoleValues);

export const managementOperationValues = [
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
export type ManagementOperation = (typeof managementOperationValues)[number];
export const managementOperationSet: ReadonlySet<ManagementOperation> = new Set(
  managementOperationValues,
);

export const managementCredentialScopeValues = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
] as const;
export type ManagementCredentialScope = (typeof managementCredentialScopeValues)[number];
export const managementCredentialScopeSet: ReadonlySet<ManagementCredentialScope> = new Set(
  managementCredentialScopeValues,
);

export const participantOperationValues = [
  "room.create",
  "room.join",
  "media.publish",
  "media.subscribe",
  "data.send",
] as const;
export type ParticipantOperation = (typeof participantOperationValues)[number];
export const participantOperationSet: ReadonlySet<ParticipantOperation> = new Set(
  participantOperationValues,
);

export const participantGrantNames = [
  "room.create",
  "room.join",
  "media.publish",
  "media.subscribe",
  "data.send",
] as const;
export type ParticipantGrantName = (typeof participantGrantNames)[number];
export const participantGrantByOperation: Record<ParticipantOperation, ParticipantGrantName> = {
  "room.create": "room.create",
  "room.join": "room.join",
  "media.publish": "media.publish",
  "media.subscribe": "media.subscribe",
  "data.send": "data.send",
};
export const participantRequiredGrants: Record<
  ParticipantOperation,
  readonly ParticipantGrantName[]
> = {
  "room.create": ["room.join"],
  "room.join": [],
  "media.publish": [],
  "media.subscribe": [],
  "data.send": [],
};
export const participantRequiredGrantsWhenRoomAbsent: Record<
  ParticipantOperation,
  readonly ParticipantGrantName[]
> = {
  "room.create": [],
  "room.join": ["room.create"],
  "media.publish": [],
  "media.subscribe": [],
  "data.send": [],
};
export const participantRequiresExistingRoom: Record<ParticipantOperation, boolean> = {
  "room.create": false,
  "room.join": true,
  "media.publish": true,
  "media.subscribe": true,
  "data.send": true,
};
export const operationScope: Partial<Record<ManagementOperation, ManagementCredentialScope>> = {
  "room.read": "room.manage",
  "room.update": "room.manage",
  "room.delete": "room.manage",
  "session.read": "session.manage",
  "session.disconnect": "session.manage",
  "participant.read": "session.manage",
  "participant.disconnect": "session.manage",
  "usage.read": "usage.read",
  "audit.read": "audit.read",
};

export const roleOperations: Record<ProjectUserRole, ReadonlySet<ManagementOperation>> = {
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

export const projectUserTargetFields: Partial<Record<ManagementOperation, string>> = {
  "projectUser.add": "accountId",
  "projectUser.remove": "projectUserId",
  "projectUser.changeRole": "projectUserId",
  "room.update": "roomId",
  "room.delete": "roomId",
  "session.disconnect": "sessionId",
  "participant.disconnect": "participantId",
};

export const credentialTargetFields: Partial<Record<ManagementOperation, string>> = {
  "room.update": "roomId",
  "room.delete": "roomId",
  "session.disconnect": "sessionId",
  "participant.disconnect": "participantId",
};

export const adminOwnerManagementFields: Partial<
  Record<ManagementOperation, readonly ("currentRole" | "nextRole")[]>
> = {
  "projectUser.add": ["nextRole"],
  "projectUser.remove": ["currentRole"],
  "projectUser.changeRole": ["currentRole", "nextRole"],
};

export const credentialProjectUserOperations = [
  "projectUser.read",
  "projectUser.add",
  "projectUser.remove",
  "projectUser.changeRole",
] as const;

export const participantSubjectConstraints = {
  required: true,
  matchParticipantExternalUserId: true,
} as const;

export const timeContract = {
  unit: "unixEpochMilliseconds",
  type: "safeInteger",
  minSafeInteger: -9007199254740991,
  maxSafeInteger: 9007199254740991,
} as const;
