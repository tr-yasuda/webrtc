import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { adminOwnerManagementFields } from "../../generated/policy.js";

export function checkOwnerManagement(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (
    input.actor.role === "admin" &&
    (adminOwnerManagementFields[input.operation] ?? []).some((field) =>
      field === "currentRole"
        ? input.target.currentRole === "owner"
        : input.target.nextRole === "owner",
    )
  ) {
    return { reason: "owner-management-forbidden" };
  }
  return null;
}
