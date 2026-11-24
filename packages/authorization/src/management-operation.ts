const projectUserRoleValues = ["owner", "admin", "operator", "auditor"] as const;
const managementOperationValues = [
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

export type ProjectUserRole = (typeof projectUserRoleValues)[number];
export type ManagementOperation = (typeof managementOperationValues)[number];

const projectUserRoleSet: ReadonlySet<ProjectUserRole> = new Set(projectUserRoleValues);
const managementOperationSet: ReadonlySet<ManagementOperation> = new Set(managementOperationValues);

export function isProjectUserRole(value: unknown): value is ProjectUserRole {
  return typeof value === "string" && projectUserRoleSet.has(value as ProjectUserRole);
}

export function isManagementOperation(value: unknown): value is ManagementOperation {
  return typeof value === "string" && managementOperationSet.has(value as ManagementOperation);
}
