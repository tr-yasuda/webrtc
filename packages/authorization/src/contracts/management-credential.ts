import type { ParticipantId, ProjectId, RoomId } from "@webrtc/domain";
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
  if (
    !isString(raw.credential.projectId) ||
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
  if (!isRecord(raw.project) || !isString(raw.project.id) || !isProjectState(raw.project.state)) {
    return invalid("input-invalid");
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
      projectId: raw.credential.projectId as ProjectId,
      scopes: scopes.value,
      revoked: raw.credential.revoked,
      expiresAt: raw.credential.expiresAt,
    },
    project: {
      id: raw.project.id as ProjectId,
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
  if (!isRecord(raw) || !isString(raw.projectId)) {
    return invalid("input-invalid");
  }
  const allowedKeys = allowedTargetKeys(operation);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      return invalid("target-invalid");
    }
  }
  for (const key of ["roomId", "sessionId", "participantId", "resourceId"] as const) {
    if (raw[key] !== undefined && !isString(raw[key])) {
      return invalid("input-invalid");
    }
  }
  return valid({
    projectId: raw.projectId as ProjectId,
    ...(raw.roomId === undefined ? {} : { roomId: raw.roomId as RoomId }),
    ...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId as string }),
    ...(raw.participantId === undefined
      ? {}
      : { participantId: raw.participantId as ParticipantId }),
    ...(raw.resourceId === undefined ? {} : { resourceId: raw.resourceId as string }),
  });
}
