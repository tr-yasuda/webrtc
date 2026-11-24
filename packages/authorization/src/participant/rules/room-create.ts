import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";

export function checkRoomCreate(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  if (input.room.state !== "absent") {
    return { reason: "room-already-exists" };
  }
  if (input.credential.grants["room.join"] !== true) {
    return { reason: "room-join-required" };
  }
  if (input.session !== undefined) {
    return { reason: "session-target-mismatch" };
  }
  if (input.participant !== undefined) {
    return { reason: "participant-target-mismatch" };
  }
  return null;
}
