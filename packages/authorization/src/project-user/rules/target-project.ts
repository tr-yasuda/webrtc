import type { ProjectUserAuthorizationReason } from "../../contracts/identifiers.js";
import type { ProjectUserAuthorizationInput } from "../../contracts/project-user.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkTargetProject(
  input: ProjectUserAuthorizationInput,
): RuleViolation<ProjectUserAuthorizationReason> | null {
  if (input.target.projectId !== input.project.id) {
    return { reason: "target-project-mismatch" };
  }
  return null;
}
