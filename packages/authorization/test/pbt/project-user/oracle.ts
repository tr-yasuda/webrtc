import { isManagementOperation, isProjectUserRole } from "../../../src/management-operation.js";
import type {
  ProjectUserAuthorizationInput,
  ProjectUserAuthorizationReason,
} from "../../../src/project-user.js";
import { expectedProjectUserAllowedOperations } from "../../policy.js";

export function projectUserViolations(
  input: ProjectUserAuthorizationInput,
): ReadonlySet<ProjectUserAuthorizationReason> {
  const violations = new Set<ProjectUserAuthorizationReason>();
  const operationIsKnown = isManagementOperation(input.operation);
  const actorRole = input.actor.role;
  const actorRoleIsKnown = actorRole !== null && isProjectUserRole(actorRole);
  const targetRolesAreKnown =
    (input.target.currentRole === undefined || isProjectUserRole(input.target.currentRole)) &&
    (input.target.nextRole === undefined || isProjectUserRole(input.target.nextRole));

  if (input.project.state !== "active") {
    violations.add("project-not-active");
  }
  if (input.actor.projectId !== input.project.id) {
    violations.add("actor-project-mismatch");
  }
  if (input.target.projectId !== input.project.id) {
    violations.add("target-project-mismatch");
  }
  if (!operationIsKnown) {
    violations.add("unsupported-operation");
  }
  if (actorRole === null) {
    violations.add("project-user-role-missing");
  } else if (!isProjectUserRole(actorRole)) {
    violations.add("project-user-role-invalid");
  }
  if (!targetRolesAreKnown) {
    violations.add("project-user-role-invalid");
  }

  if (operationIsKnown && actorRoleIsKnown && targetRolesAreKnown) {
    if (!projectUserHasRequiredTargetId(input)) {
      violations.add("target-id-required");
    } else if (!expectedProjectUserAllowedOperations[actorRole].includes(input.operation)) {
      violations.add("insufficient-role");
    } else {
      if (
        (input.operation === "projectUser.add" || input.operation === "projectUser.changeRole") &&
        input.target.nextRole === undefined
      ) {
        violations.add("project-user-next-role-required");
      }
      if (
        (input.operation === "projectUser.remove" ||
          input.operation === "projectUser.changeRole") &&
        input.target.currentRole === undefined
      ) {
        violations.add("project-user-current-role-required");
      }
      if (actorRole === "admin" && projectUserManagesOwner(input)) {
        violations.add("owner-management-forbidden");
      }
    }
  }

  return violations;
}

export function projectUserHasRequiredTargetId(input: ProjectUserAuthorizationInput): boolean {
  switch (input.operation) {
    case "projectUser.add":
      return "accountId" in input.target;
    case "projectUser.remove":
    case "projectUser.changeRole":
      return "projectUserId" in input.target;
    case "room.update":
    case "room.delete":
      return "roomId" in input.target;
    case "session.disconnect":
      return "sessionId" in input.target;
    case "participant.disconnect":
      return "participantId" in input.target;
    default:
      return true;
  }
}

export function projectUserManagesOwner(input: ProjectUserAuthorizationInput): boolean {
  return (
    (input.operation === "projectUser.add" && input.target.nextRole === "owner") ||
    (input.operation === "projectUser.remove" && input.target.currentRole === "owner") ||
    (input.operation === "projectUser.changeRole" &&
      (input.target.currentRole === "owner" || input.target.nextRole === "owner"))
  );
}
