import type {
  ParticipantAuthorizationInput,
  ParticipantAuthorizationTarget,
} from "../../src/participant.js";
import { participantId, projectId, roomId, sessionId, subject } from "../fixtures.js";

export const grants = {
  "room.create": false,
  "room.join": true,
  "media.publish": false,
  "media.subscribe": false,
  "data.send": false,
} as const;

export const baseMediaInput = {
  operation: "media.publish",
  credential: {
    projectId,
    subject,
    roomName: "room-a",
    grants: {
      ...grants,
      "media.publish": true,
    },
  },
  project: {
    id: projectId,
    state: "active",
  },
  room: {
    state: "active",
    id: roomId,
    projectId,
    name: "room-a",
  },
  session: {
    id: sessionId,
    projectId,
    roomId,
    participantId,
    state: "active",
  },
  participant: {
    id: participantId,
    roomId,
    externalUserId: subject,
    state: "active",
  },
} satisfies ParticipantAuthorizationInput;

export const baseJoinInput = {
  operation: "room.join",
  credential: {
    projectId,
    subject,
    roomName: "room-a",
    grants: {
      ...grants,
      "room.join": true,
    },
  },
  project: {
    id: projectId,
    state: "active",
  },
  room: {
    state: "active",
    id: roomId,
    projectId,
    name: "room-a",
  },
  session: baseMediaInput.session!,
  participant: baseMediaInput.participant!,
} satisfies ParticipantAuthorizationInput;

const { session: _baseJoinSession, ...baseJoinWithoutSession } = baseJoinInput;

export { baseJoinWithoutSession };

export function expectedTarget(
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
