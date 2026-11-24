import type {
  ParticipantAuthorizationInput,
  ParticipantAuthorizationReason,
  ParticipantAuthorizationTarget,
  ParticipantOperation,
} from "../../../src/participant.js";
import { allParticipantOperations } from "../../policy.js";

const participantOperationSet = new Set<string>(allParticipantOperations);

export function participantExpectedTarget(
  input: ParticipantAuthorizationInput,
): ParticipantAuthorizationTarget {
  return {
    projectId: input.project.id,
    roomName: input.room.name,
    ...(input.room.state === "absent" ? {} : { roomId: input.room.id }),
    ...(input.session === undefined ? {} : { sessionId: input.session.id }),
    ...(input.participant === undefined ? {} : { participantId: input.participant.id }),
  };
}

export function participantViolations(
  input: ParticipantAuthorizationInput,
): ReadonlySet<ParticipantAuthorizationReason> {
  const violations = new Set<ParticipantAuthorizationReason>();
  const operationIsKnown = isParticipantOperation(input.operation);

  if (!operationIsKnown) {
    violations.add("unsupported-operation");
  }
  if (input.project.state !== "active") {
    violations.add("project-not-active");
  }
  if (
    input.credential.projectId !== input.project.id ||
    input.credential.roomName !== input.room.name ||
    input.room.projectId !== input.project.id
  ) {
    violations.add("credential-target-mismatch");
  }
  if (!isNonEmptyString(input.credential.subject)) {
    violations.add("subject-required");
  } else if (input.participant !== undefined) {
    if (!isNonEmptyString(input.participant.externalUserId)) {
      violations.add("subject-required");
    } else if (input.participant.externalUserId !== input.credential.subject) {
      violations.add("subject-mismatch");
    }
  }
  if (operationIsKnown && input.credential.grants[input.operation] !== true) {
    violations.add("grant-not-granted");
  }

  switch (input.operation) {
    case "room.create":
      if (input.room.state !== "absent") {
        violations.add("room-already-exists");
      }
      if (input.credential.grants["room.join"] !== true) {
        violations.add("room-join-required");
      }
      if (input.session !== undefined) {
        violations.add("session-target-mismatch");
      }
      if (input.participant !== undefined) {
        violations.add("participant-target-mismatch");
      }
      break;
    case "room.join":
      if (input.room.state === "absent") {
        if (input.credential.grants["room.create"] !== true) {
          violations.add("room-create-required");
        }
        if (input.session !== undefined) {
          violations.add("session-target-mismatch");
        }
        if (input.participant !== undefined) {
          violations.add("participant-target-mismatch");
        }
        break;
      }
      if (input.room.state !== "active") {
        violations.add("room-not-active");
      }
      if (input.session !== undefined && input.participant === undefined) {
        violations.add("participant-required");
      }
      if (input.session !== undefined) {
        if (input.session.state !== "active") {
          violations.add("session-not-active");
        }
        if (
          input.session.projectId !== input.project.id ||
          input.session.roomId !== input.room.id ||
          (input.participant !== undefined && input.session.participantId !== input.participant.id)
        ) {
          violations.add("session-target-mismatch");
        }
      }
      if (input.participant !== undefined) {
        if (input.participant.state !== "active") {
          violations.add("participant-not-active");
        }
        if (input.participant.roomId !== input.room.id) {
          violations.add("participant-target-mismatch");
        }
      }
      break;
    case "media.publish":
    case "media.subscribe":
    case "data.send": {
      const roomId = input.room.state === "absent" ? undefined : input.room.id;
      if (input.room.state !== "active") {
        violations.add("room-not-active");
      }
      if (input.session === undefined) {
        violations.add("session-required");
      } else {
        if (input.session.state !== "active") {
          violations.add("session-not-active");
        }
        if (
          input.session.projectId !== input.project.id ||
          input.session.roomId !== roomId ||
          (input.participant !== undefined && input.session.participantId !== input.participant.id)
        ) {
          violations.add("session-target-mismatch");
        }
      }
      if (input.participant === undefined) {
        violations.add("participant-required");
      } else {
        if (input.participant.state !== "active") {
          violations.add("participant-not-active");
        }
        if (input.participant.roomId !== roomId) {
          violations.add("participant-target-mismatch");
        }
      }
      break;
    }
    default:
      break;
  }

  return violations;
}

function isParticipantOperation(value: string): value is ParticipantOperation {
  return participantOperationSet.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
