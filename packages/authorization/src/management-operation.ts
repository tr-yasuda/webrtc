import {
  managementOperationSet,
  managementOperationValues,
  projectUserRoleSet,
  projectUserRoleValues,
} from "./generated/policy.js";

export type ProjectUserRole = (typeof projectUserRoleValues)[number];
export type ManagementOperation = (typeof managementOperationValues)[number];

export function isProjectUserRole(value: unknown): value is ProjectUserRole {
  return typeof value === "string" && projectUserRoleSet.has(value as ProjectUserRole);
}

export function isManagementOperation(value: unknown): value is ManagementOperation {
  return typeof value === "string" && managementOperationSet.has(value as ManagementOperation);
}
