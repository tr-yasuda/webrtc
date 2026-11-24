import {
  parseAccountId,
  parseParticipantId,
  parseProjectId,
  parseProjectUserId,
  parseRoomId,
  type AccountId,
  type ParticipantId,
  type ProjectId,
  type ProjectUserId,
  type RoomId,
} from "@webrtc/domain";
import type { AuthorizationDecision } from "../decision.js";
import {
  isManagementOperation,
  isProjectState,
  isProjectUserRole,
  type ManagementOperation,
  type ProjectState,
  type ProjectUserRole,
  type ProjectUserAuthorizationReason,
} from "./identifiers.js";
import {
  invalid,
  isRecord,
  isString,
  parseDomainIdValue,
  parseOptionalDomainIdValue,
  valid,
  type ValidationResult,
} from "./validation.js";

export type { ManagementOperation, ProjectState, ProjectUserRole, ProjectUserAuthorizationReason };

export type ProjectUserAuthorizationTarget = {
  readonly projectId: ProjectId;
  readonly accountId?: AccountId;
  readonly projectUserId?: ProjectUserId;
  readonly roomId?: RoomId;
  readonly sessionId?: string;
  readonly participantId?: ParticipantId;
  readonly resourceId?: string;
  readonly currentRole?: ProjectUserRole;
  readonly nextRole?: ProjectUserRole;
};

export type ProjectUserAuthorizationDecision = AuthorizationDecision<
  ManagementOperation,
  ProjectUserAuthorizationTarget,
  ProjectUserAuthorizationReason
>;

export type ProjectUserAuthorizationInput = {
  readonly actor: {
    readonly projectId: ProjectId;
    readonly role: ProjectUserRole | null;
  };
  readonly project: {
    readonly id: ProjectId;
    readonly state: ProjectState;
  };
  readonly operation: ManagementOperation;
  readonly target: ProjectUserAuthorizationTarget;
};

export type ValidatedProjectUserAuthorizationInput = ProjectUserAuthorizationInput;

export function validateProjectUserAuthorizationInput(
  raw: unknown,
): ValidationResult<ValidatedProjectUserAuthorizationInput> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  if (!isManagementOperation(raw.operation)) {
    return invalid("unsupported-operation");
  }
  if (!isRecord(raw.actor)) {
    return invalid("input-invalid");
  }
  const actorProjectId = parseDomainIdValue(raw.actor.projectId, parseProjectId);
  if (!actorProjectId.ok) {
    return actorProjectId;
  }
  const actorRole = validateActorRole(raw.actor.role);
  if (!actorRole.ok) {
    return actorRole;
  }
  if (!isRecord(raw.project) || !isProjectState(raw.project.state)) {
    return invalid("input-invalid");
  }
  const projectId = parseDomainIdValue(raw.project.id, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  const target = validateProjectUserTarget(raw.operation, raw.target);
  if (!target.ok) {
    return target;
  }

  return valid({
    actor: {
      projectId: actorProjectId.value,
      role: actorRole.value,
    },
    project: {
      id: projectId.value,
      state: raw.project.state,
    },
    operation: raw.operation,
    target: target.value,
  });
}

function validateActorRole(raw: unknown): ValidationResult<ProjectUserRole | null> {
  if (raw === null) {
    return valid(null);
  }
  if (!isProjectUserRole(raw)) {
    return invalid("unsupported-role");
  }
  return valid(raw);
}

function allowedTargetKeys(operation: ManagementOperation): ReadonlySet<string> {
  switch (operation) {
    case "projectUser.add":
      return new Set(["projectId", "accountId", "nextRole"]);
    case "projectUser.remove":
    case "projectUser.changeRole":
      return new Set(["projectId", "projectUserId", "currentRole", "nextRole"]);
    case "room.update":
    case "room.delete":
      return new Set(["projectId", "roomId"]);
    case "session.disconnect":
      return new Set(["projectId", "sessionId"]);
    case "participant.disconnect":
      return new Set(["projectId", "participantId"]);
    default:
      return new Set(["projectId", "resourceId"]);
  }
}

function validateProjectUserTarget(
  operation: ManagementOperation,
  raw: unknown,
): ValidationResult<ProjectUserAuthorizationTarget> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  const allowedKeys = allowedTargetKeys(operation);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      return invalid("target-invalid");
    }
  }

  const currentRole = validateOptionalRole(raw.currentRole);
  if (!currentRole.ok) {
    return currentRole;
  }
  const nextRole = validateOptionalRole(raw.nextRole);
  if (!nextRole.ok) {
    return nextRole;
  }
  const projectId = parseDomainIdValue(raw.projectId, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  const accountId = parseOptionalDomainIdValue(raw.accountId, parseAccountId);
  if (!accountId.ok) {
    return accountId;
  }
  const projectUserId = parseOptionalDomainIdValue(raw.projectUserId, parseProjectUserId);
  if (!projectUserId.ok) {
    return projectUserId;
  }
  const roomId = parseOptionalDomainIdValue(raw.roomId, parseRoomId);
  if (!roomId.ok) {
    return roomId;
  }
  const participantId = parseOptionalDomainIdValue(raw.participantId, parseParticipantId);
  if (!participantId.ok) {
    return participantId;
  }
  if (
    (raw.sessionId !== undefined && !isString(raw.sessionId)) ||
    (raw.resourceId !== undefined && !isString(raw.resourceId))
  ) {
    return invalid("input-invalid");
  }

  return valid({
    projectId: projectId.value,
    ...(accountId.value === undefined ? {} : { accountId: accountId.value }),
    ...(projectUserId.value === undefined ? {} : { projectUserId: projectUserId.value }),
    ...(roomId.value === undefined ? {} : { roomId: roomId.value }),
    ...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId as string }),
    ...(participantId.value === undefined ? {} : { participantId: participantId.value }),
    ...(raw.resourceId === undefined ? {} : { resourceId: raw.resourceId as string }),
    ...(currentRole.value === undefined ? {} : { currentRole: currentRole.value }),
    ...(nextRole.value === undefined ? {} : { nextRole: nextRole.value }),
  });
}

function validateOptionalRole(raw: unknown): ValidationResult<ProjectUserRole | undefined> {
  if (raw === undefined) {
    return valid(undefined);
  }
  if (!isProjectUserRole(raw)) {
    return invalid("unsupported-role");
  }
  return valid(raw);
}
