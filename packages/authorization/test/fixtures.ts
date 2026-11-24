import type { AccountId, ParticipantId, ProjectId, ProjectUserId, RoomId } from "@webrtc/domain";
import { ulid } from "ulid";

export const projectId = ulid() as ProjectId;
export const otherProjectId = ulid() as ProjectId;
export const roomId = ulid() as RoomId;
export const otherRoomId = ulid() as RoomId;
export const participantId = ulid() as ParticipantId;
export const otherParticipantId = ulid() as ParticipantId;
export const accountId = ulid() as AccountId;
export const projectUserId = ulid() as ProjectUserId;
export const sessionId = ulid();
export const otherSessionId = ulid();
export const subject = ulid();
export const otherSubject = ulid();
