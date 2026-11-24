import type { ParticipantAuthorizationReason } from "../../contracts/identifiers.js";
import type { ParticipantAuthorizationInput } from "../../contracts/participant.js";
import type { RuleViolation } from "../../contracts/rules.js";
import { checkMediaData } from "./media-data.js";
import { checkRoomCreate } from "./room-create.js";
import { checkRoomJoin } from "./room-join.js";

export function checkOperationSpecific(
  input: ParticipantAuthorizationInput,
): RuleViolation<ParticipantAuthorizationReason> | null {
  switch (input.operation) {
    case "room.create":
      return checkRoomCreate(input);
    case "room.join":
      return checkRoomJoin(input);
    case "media.publish":
    case "media.subscribe":
    case "data.send":
      return checkMediaData(input);
  }
}
