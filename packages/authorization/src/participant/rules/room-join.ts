import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkRoomJoin(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (input.room.state === "absent") {
    if (input.credential.grants["room.create"] !== true) {
      return { reason: "room-create-required" };
    }
    if (input.session !== undefined) {
      return { reason: "session-target-mismatch" };
    }
    if (input.participant !== undefined) {
      return { reason: "participant-target-mismatch" };
    }
    return null;
  }
  if (input.room.state !== "active") {
    return { reason: "room-not-active" };
  }
  if (input.session !== undefined && input.participant === undefined) {
    return { reason: "participant-required" };
  }
  if (input.session !== undefined) {
    if (input.session.state !== "active") {
      return { reason: "session-not-active" };
    }
    if (
      input.session.projectId !== input.project.id ||
      input.session.roomId !== input.room.id ||
      input.session.participantId !== input.participant!.id
    ) {
      return { reason: "session-target-mismatch" };
    }
  }
  if (input.participant !== undefined) {
    if (input.participant.state !== "active") {
      return { reason: "participant-not-active" };
    }
    if (input.participant.roomId !== input.room.id) {
      return { reason: "participant-target-mismatch" };
    }
  }
  return null;
}
