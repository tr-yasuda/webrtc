import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkProject(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (input.project.state !== "active") {
    return { reason: "project-not-active" };
  }
  return null;
}
