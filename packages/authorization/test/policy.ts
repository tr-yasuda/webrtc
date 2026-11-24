import type { ManagementCredentialScope } from "../src/management-credential.js";
import type { ManagementOperation, ProjectUserRole } from "../src/management-operation.js";
import type { ParticipantOperation } from "../src/participant.js";

export const allProjectUserRoles = ["owner", "admin", "operator", "auditor"] as const;

export const allParticipantOperations = [
  "room.create",
  "room.join",
  "media.publish",
  "media.subscribe",
  "data.send",
] as const satisfies readonly ParticipantOperation[];

export const allManagementOperations = [
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
] as const satisfies readonly ManagementOperation[];

export const allManagementCredentialScopes = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
] as const satisfies readonly ManagementCredentialScope[];

export const expectedProjectUserAllowedOperations: Record<
  ProjectUserRole,
  readonly ManagementOperation[]
> = {
  owner: allManagementOperations,
  admin: [
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
  ],
  operator: [
    "project.read",
    "room.read",
    "room.update",
    "room.delete",
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
    "usage.read",
  ],
  auditor: [
    "project.read",
    "room.read",
    "session.read",
    "participant.read",
    "usage.read",
    "audit.read",
  ],
};

export const expectedCredentialScopeOperations: Record<
  ManagementCredentialScope,
  readonly ManagementOperation[]
> = {
  "room.manage": ["room.read", "room.update", "room.delete"],
  "session.manage": [
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
  ],
  "usage.read": ["usage.read"],
  "audit.read": ["audit.read"],
};

export const credentialRequiredScopesByOperation = Object.fromEntries(
  allManagementOperations.flatMap((operation) => {
    const scopes = allManagementCredentialScopes.filter((scope) =>
      expectedCredentialScopeOperations[scope].includes(operation),
    );
    return scopes.length === 0 ? [] : [[operation, scopes] as const];
  }),
) as Partial<Record<ManagementOperation, readonly ManagementCredentialScope[]>>;

export const allCredentialOperations = Object.keys(
  credentialRequiredScopesByOperation,
) as ManagementOperation[];
