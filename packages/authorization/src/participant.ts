import type { ParticipantId, ProjectId, RoomId } from "@webrtc/domain";
import type { AuthorizationDecision } from "./decision.js";
import {
  participantGrantNames,
  participantOperationSet,
  participantSubjectConstraints,
  type ParticipantGrants,
  type ParticipantOperation,
} from "./generated/policy.js";
import type { ProjectState } from "./project-state.js";

export type { ProjectState } from "./project-state.js";
export type { ParticipantGrants, ParticipantOperation } from "./generated/policy.js";

export type RoomState = "active" | "deleting" | "deleted";
export type SessionState = "active" | "revoked" | "ended";
export type ParticipantState = "active" | "revoked" | "left";

export type ParticipantAuthorizationTarget = {
  readonly projectId: ProjectId;
  readonly roomName: string;
  readonly roomId?: RoomId;
  readonly sessionId?: string;
  readonly participantId?: ParticipantId;
};

export type ParticipantAuthorizationReason =
  | "allowed"
  | "unsupported-operation"
  | "subject-required"
  | "subject-mismatch"
  | "project-not-active"
  | "credential-target-mismatch"
  | "room-already-exists"
  | "room-create-required"
  | "room-join-required"
  | "room-not-active"
  | "grant-not-granted"
  | "grant-input-invalid"
  | "session-required"
  | "session-not-active"
  | "session-target-mismatch"
  | "participant-required"
  | "participant-not-active"
  | "participant-target-mismatch";

const participantGrantNameSet = new Set<string>(participantGrantNames);

function isParticipantOperation(value: unknown): value is ParticipantOperation {
  return typeof value === "string" && participantOperationSet.has(value as ParticipantOperation);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

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

export function authorizeParticipantAction(
  input: ParticipantAuthorizationInput,
): ParticipantAuthorizationDecision {
  const target = buildTarget(input);

  if (!isParticipantOperation(input.operation)) {
    return deny(input, target, "unsupported-operation");
  }
  if (input.project.state !== "active") {
    return deny(input, target, "project-not-active");
  }
  if (
    input.credential.projectId !== input.project.id ||
    input.credential.roomName !== input.room.name ||
    input.room.projectId !== input.project.id
  ) {
    return deny(input, target, "credential-target-mismatch");
  }
  if (participantSubjectConstraints.required && !isNonEmptyString(input.credential.subject)) {
    return deny(input, target, "subject-required");
  }
  if (input.participant !== undefined) {
    if (
      participantSubjectConstraints.required &&
      !isNonEmptyString(input.participant.externalUserId)
    ) {
      return deny(input, target, "subject-required");
    }
    if (
      participantSubjectConstraints.matchParticipantExternalUserId &&
      input.participant.externalUserId !== input.credential.subject
    ) {
      return deny(input, target, "subject-mismatch");
    }
  }
  if (!hasValidGrants(input.credential.grants)) {
    return deny(input, target, "grant-input-invalid");
  }
  if (input.credential.grants[input.operation] !== true) {
    return deny(input, target, "grant-not-granted");
  }

  switch (input.operation) {
    case "room.create":
      if (input.room.state !== "absent") {
        return deny(input, target, "room-already-exists");
      }
      if (input.credential.grants["room.join"] !== true) {
        return deny(input, target, "room-join-required");
      }
      if (input.session !== undefined) {
        return deny(input, target, "session-target-mismatch");
      }
      if (input.participant !== undefined) {
        return deny(input, target, "participant-target-mismatch");
      }
      return allow(input, target);
    case "room.join":
      if (input.room.state === "absent") {
        if (input.credential.grants["room.create"] !== true) {
          return deny(input, target, "room-create-required");
        }
        if (input.session !== undefined) {
          return deny(input, target, "session-target-mismatch");
        }
        if (input.participant !== undefined) {
          return deny(input, target, "participant-target-mismatch");
        }
        return allow(input, target);
      }
      if (input.room.state !== "active") {
        return deny(input, target, "room-not-active");
      }
      if (input.session !== undefined && input.participant === undefined) {
        return deny(input, target, "participant-required");
      }
      if (input.session !== undefined) {
        if (input.session.state !== "active") {
          return deny(input, target, "session-not-active");
        }
        if (
          input.session.projectId !== input.project.id ||
          input.session.roomId !== input.room.id ||
          (input.participant !== undefined && input.session.participantId !== input.participant.id)
        ) {
          return deny(input, target, "session-target-mismatch");
        }
      }
      if (input.participant !== undefined) {
        if (input.participant.state !== "active") {
          return deny(input, target, "participant-not-active");
        }
        if (input.participant.roomId !== input.room.id) {
          return deny(input, target, "participant-target-mismatch");
        }
      }
      return allow(input, target);
    case "media.publish":
    case "media.subscribe":
    case "data.send":
      if (input.room.state !== "active") {
        return deny(input, target, "room-not-active");
      }
      if (input.session === undefined) {
        return deny(input, target, "session-required");
      }
      if (input.session.state !== "active") {
        return deny(input, target, "session-not-active");
      }
      if (input.participant === undefined) {
        return deny(input, target, "participant-required");
      }
      if (input.participant.state !== "active") {
        return deny(input, target, "participant-not-active");
      }
      if (
        input.session.projectId !== input.project.id ||
        input.session.roomId !== input.room.id ||
        input.session.participantId !== input.participant.id
      ) {
        return deny(input, target, "session-target-mismatch");
      }
      if (input.participant.roomId !== input.room.id) {
        return deny(input, target, "participant-target-mismatch");
      }
      return allow(input, target);
  }
}

function hasValidGrants(value: unknown): value is ParticipantGrants {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== participantGrantNames.length) return false;
  if (!keys.every((key) => participantGrantNameSet.has(key))) return false;
  return Object.values(value).every((grant) => typeof grant === "boolean");
}

function buildTarget(input: ParticipantAuthorizationInput): ParticipantAuthorizationTarget {
  return {
    projectId: input.project.id,
    roomName: input.room.name,
    ...(input.room.state === "absent" ? {} : { roomId: input.room.id }),
    ...(input.session === undefined ? {} : { sessionId: input.session.id }),
    ...(input.participant === undefined ? {} : { participantId: input.participant.id }),
  };
}

function allow(
  input: ParticipantAuthorizationInput,
  target: ParticipantAuthorizationTarget,
): ParticipantAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target,
    reason: "allowed",
  };
}

function deny(
  input: ParticipantAuthorizationInput,
  target: ParticipantAuthorizationTarget,
  reason: Exclude<ParticipantAuthorizationReason, "allowed">,
): ParticipantAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target,
    reason,
  };
}
