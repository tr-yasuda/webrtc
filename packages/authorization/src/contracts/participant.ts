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
  isParticipantOperation,
  isParticipantState,
  isProjectState,
  isRoomState,
  isSessionState,
  type ParticipantAuthorizationReason,
  type ParticipantOperation,
  type ParticipantState,
  type ProjectState,
  type RoomState,
  type SessionState,
} from "./identifiers.js";
import {
  invalid,
  isBoolean,
  isRecord,
  isString,
  parseDomainIdValue,
  valid,
  type ValidationResult,
} from "./validation.js";

export type ParticipantGrants = Readonly<Partial<Record<ParticipantOperation, boolean>>>;

export type {
  ParticipantAuthorizationReason,
  ParticipantOperation,
  ParticipantState,
  ProjectState,
  RoomState,
  SessionState,
};

export type ParticipantAuthorizationTarget = {
  readonly projectId: ProjectId;
  readonly roomName: string;
  readonly roomId?: RoomId;
  readonly sessionId?: string;
  readonly participantId?: ParticipantId;
};

export type ParticipantAuthorizationDecision = AuthorizationDecision<
  ParticipantOperation,
  ParticipantAuthorizationTarget,
  ParticipantAuthorizationReason
>;

export type ParticipantAuthorizationInput = {
  readonly operation: ParticipantOperation;
  readonly credential: {
    readonly projectId: ProjectId;
    readonly roomName: string;
    readonly subject: string;
    readonly grants: ParticipantGrants;
  };
  readonly project: {
    readonly id: ProjectId;
    readonly state: ProjectState;
  };
  readonly room:
    | {
        readonly state: "absent";
        readonly projectId: ProjectId;
        readonly name: string;
      }
    | {
        readonly state: RoomState;
        readonly id: RoomId;
        readonly projectId: ProjectId;
        readonly name: string;
      };
  readonly session?: {
    readonly id: string;
    readonly projectId: ProjectId;
    readonly roomId: RoomId;
    readonly participantId: ParticipantId;
    readonly state: SessionState;
  };
  readonly participant?: {
    readonly id: ParticipantId;
    readonly roomId: RoomId;
    readonly externalUserId: string;
    readonly state: ParticipantState;
  };
};

export type ValidatedParticipantAuthorizationInput = ParticipantAuthorizationInput;

export function validateParticipantAuthorizationInput(
  raw: unknown,
): ValidationResult<ValidatedParticipantAuthorizationInput> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  if (!isParticipantOperation(raw.operation)) {
    return invalid("unsupported-operation");
  }
  if (!isRecord(raw.credential)) {
    return invalid("input-invalid");
  }
  const credentialProjectId = parseDomainIdValue(raw.credential.projectId, parseProjectId);
  if (!credentialProjectId.ok) {
    return credentialProjectId;
  }
  if (!isString(raw.credential.roomName) || !isString(raw.credential.subject)) {
    return invalid("input-invalid");
  }
  const grants = validateParticipantGrants(raw.credential.grants);
  if (!grants.ok) {
    return grants;
  }
  if (!isRecord(raw.project) || !isProjectState(raw.project.state)) {
    return invalid("input-invalid");
  }
  const projectId = parseDomainIdValue(raw.project.id, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  const room = validateParticipantRoom(raw.room);
  if (!room.ok) {
    return room;
  }
  const session = validateParticipantSession(raw.session);
  if (!session.ok) {
    return session;
  }
  const participant = validateParticipantParticipant(raw.participant);
  if (!participant.ok) {
    return participant;
  }

  return valid({
    operation: raw.operation,
    credential: {
      projectId: credentialProjectId.value,
      roomName: raw.credential.roomName,
      subject: raw.credential.subject,
      grants: grants.value,
    },
    project: {
      id: projectId.value,
      state: raw.project.state,
    },
    room: room.value,
    ...(session.value === undefined ? {} : { session: session.value }),
    ...(participant.value === undefined ? {} : { participant: participant.value }),
  });
}

function validateParticipantGrants(raw: unknown): ValidationResult<ParticipantGrants> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  const grants: Partial<Record<ParticipantOperation, boolean>> = {};
  for (const key of Object.keys(raw)) {
    if (!isParticipantOperation(key)) {
      return invalid("unsupported-grant");
    }
    const value = raw[key];
    if (!isBoolean(value)) {
      return invalid("grant-invalid");
    }
    grants[key] = value;
  }
  return valid(grants);
}

function validateParticipantRoom(
  raw: unknown,
): ValidationResult<ParticipantAuthorizationInput["room"]> {
  if (!isRecord(raw)) {
    return invalid("input-invalid");
  }
  if (raw.state === "absent") {
    const projectId = parseDomainIdValue(raw.projectId, parseProjectId);
    if (!projectId.ok) {
      return projectId;
    }
    if (!isString(raw.name)) {
      return invalid("input-invalid");
    }
    return valid({
      state: "absent",
      projectId: projectId.value,
      name: raw.name,
    });
  }
  if (!isRoomState(raw.state) || !isString(raw.name)) {
    return invalid("input-invalid");
  }
  const id = parseDomainIdValue(raw.id, parseRoomId);
  if (!id.ok) {
    return id;
  }
  const projectId = parseDomainIdValue(raw.projectId, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  return valid({
    state: raw.state,
    id: id.value,
    projectId: projectId.value,
    name: raw.name,
  });
}

function validateParticipantSession(
  raw: unknown,
): ValidationResult<ParticipantAuthorizationInput["session"]> {
  if (raw === undefined) {
    return valid(undefined);
  }
  if (!isRecord(raw) || !isString(raw.id) || !isSessionState(raw.state)) {
    return invalid("input-invalid");
  }
  const projectId = parseDomainIdValue(raw.projectId, parseProjectId);
  if (!projectId.ok) {
    return projectId;
  }
  const roomId = parseDomainIdValue(raw.roomId, parseRoomId);
  if (!roomId.ok) {
    return roomId;
  }
  const participantId = parseDomainIdValue(raw.participantId, parseParticipantId);
  if (!participantId.ok) {
    return participantId;
  }
  return valid({
    id: raw.id,
    projectId: projectId.value,
    roomId: roomId.value,
    participantId: participantId.value,
    state: raw.state,
  });
}

function validateParticipantParticipant(
  raw: unknown,
): ValidationResult<ParticipantAuthorizationInput["participant"]> {
  if (raw === undefined) {
    return valid(undefined);
  }
  if (!isRecord(raw) || !isString(raw.externalUserId) || !isParticipantState(raw.state)) {
    return invalid("input-invalid");
  }
  const id = parseDomainIdValue(raw.id, parseParticipantId);
  if (!id.ok) {
    return id;
  }
  const roomId = parseDomainIdValue(raw.roomId, parseRoomId);
  if (!roomId.ok) {
    return roomId;
  }
  return valid({
    id: id.value,
    roomId: roomId.value,
    externalUserId: raw.externalUserId,
    state: raw.state,
  });
}
