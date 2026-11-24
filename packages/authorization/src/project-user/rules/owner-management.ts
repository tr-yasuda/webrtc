import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkOwnerManagement(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (
    input.actor.role === "admin" &&
    ((input.operation === "projectUser.add" && input.target.nextRole === "owner") ||
      (input.operation === "projectUser.remove" && input.target.currentRole === "owner") ||
      (input.operation === "projectUser.changeRole" &&
        (input.target.currentRole === "owner" || input.target.nextRole === "owner")))
  ) {
    return { reason: "owner-management-forbidden" };
  }
  return null;
}
