import {
  parseParticipantId,
  parseProjectId,
  parseRoomId,
  type ParticipantId,
  type ProjectId,
  type RoomId,
} from "@webrtc/domain";
import type { AuthorizationDecision } from "../decision.js";
import {
  isManagementCredentialScope,
  isManagementOperation,
  isProjectState,
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialScope,
  type ManagementOperation,
  type ProjectState,
} from "./identifiers.js";
import {
  invalid,
  isBoolean,
  isFiniteNumber,
  isRecord,
  isString,
  parseDomainIdValue,
  parseOptionalDomainIdValue,
  valid,
  type ValidationResult,
} from "./validation.js";

export type {
  ManagementCredentialAuthorizationReason,
  ManagementCredentialScope,
  ManagementOperation,
  ProjectState,
};

export type ManagementCredentialAuthorizationTarget = {
  readonly projectId: ProjectId;
  readonly roomId?: RoomId;
  readonly sessionId?: string;
  readonly participantId?: ParticipantId;
  readonly resourceId?: string;
};

export type ManagementCredentialAuthorizationDecision = AuthorizationDecision<
  ManagementOperation,
  ManagementCredentialAuthorizationTarget,
  ManagementCredentialAuthorizationReason
>;

export type ManagementCredentialAuthorizationInput = {
  readonly credential: {
    readonly projectId: ProjectId;
    readonly scopes: readonly ManagementCredentialScope[];
    readonly revoked: boolean;
    readonly expiresAt: number;
  };
  readonly project: {
    readonly id: ProjectId;
    readonly state: ProjectState;
  };
  readonly operation: ManagementOperation;
  readonly target: ManagementCredentialAuthorizationTarget;
  readonly now: number;
};

export type ValidatedManagementCredentialAuthorizationInput =
  ManagementCredentialAuthorizationInput;

export function validateManagementCredentialAuthorizationInput(
  raw: unknown,
): ValidationResult<ValidatedManagementCredentialAuthorizationInput> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  if (!isRecord(raw.credential)) {
    return invalid("input-invalid");
  }
  const credentialProjectId = parseDomainIdValue(raw.credential.projectId, parseProjectId);
  if (!credentialProjectId.ok) {
    return credentialProjectId;
  }
  if (
    !isBoolean(raw.credential.revoked) ||
    !isFiniteNumber(raw.credential.expiresAt) ||
    !isFiniteNumber(raw.now)
  ) {
    return invalid("input-invalid");
  }
  const scopes = validateScopes(raw.credential.scopes);
  if (!scopes.ok) {
    return scopes;
  }
  if (!isRecord(raw.project) || !isProjectState(raw.project.state)) {
    return invalid("input-invalid");
  }
  const projectId = parseDomainIdValue(raw.project.id, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  if (!isManagementOperation(raw.operation)) {
    return invalid("unsupported-operation");
  }
  const target = validateTarget(raw.operation, raw.target);
  if (!target.ok) {
    return target;
  }

  return valid({
    credential: {
      projectId: credentialProjectId.value,
      scopes: scopes.value,
      revoked: raw.credential.revoked,
      expiresAt: raw.credential.expiresAt,
    },
    project: {
      id: projectId.value,
      state: raw.project.state,
    },
    operation: raw.operation,
    target: target.value,
    now: raw.now,
  });
}

function validateScopes(raw: unknown): ValidationResult<readonly ManagementCredentialScope[]> {
  if (!Array.isArray(raw)) {
    return invalid("input-invalid");
  }
  const scopes: ManagementCredentialScope[] = [];
  for (const value of raw) {
    if (!isManagementCredentialScope(value)) {
      return invalid("unsupported-scope");
    }
    scopes.push(value);
  }
  return valid(scopes);
}

function allowedTargetKeys(operation: ManagementOperation): ReadonlySet<string> {
  switch (operation) {
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

function validateTarget(
  operation: ManagementOperation,
  raw: unknown,
): ValidationResult<ManagementCredentialAuthorizationTarget> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  const allowedKeys = allowedTargetKeys(operation);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      return invalid("target-invalid");
    }
  }
  const projectId = parseDomainIdValue(raw.projectId, parseProjectId);
  if (!projectId.ok) {
    return projectId;
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
    ...(roomId.value === undefined ? {} : { roomId: roomId.value }),
    ...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId as string }),
    ...(participantId.value === undefined ? {} : { participantId: participantId.value }),
    ...(raw.resourceId === undefined ? {} : { resourceId: raw.resourceId as string }),
  });
}
