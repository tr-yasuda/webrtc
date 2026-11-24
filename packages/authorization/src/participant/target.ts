import type {
  ParticipantAuthorizationInput,
  ParticipantAuthorizationTarget,
} from "../contracts/participant.js";

export function buildParticipantTarget(
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
