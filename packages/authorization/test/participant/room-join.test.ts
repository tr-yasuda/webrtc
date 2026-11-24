import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
} from "../../src/participant.js";
import {
  otherParticipantId,
  otherRoomId,
  participantId,
  projectId,
  roomId,
  subject,
} from "../fixtures.js";
import { grants, baseJoinInput, baseJoinWithoutSession, expectedTarget } from "./support.js";

describe("参加 JWT の認可", () => {
  test("有効な room.join grant と参加可能な Room なら参加を許可する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
        subject,
        roomName: "room-a",
        grants,
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
      participant: {
        id: participantId,
        roomId,
        externalUserId: subject,
        state: "active",
      },
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "room.join",
      reason: "allowed",
      target: {
        projectId,
        roomName: "room-a",
        roomId,
        participantId,
      },
    });
  });

  test("room.join は Session/Participant を渡さない新規参加を許可する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
        subject,
        roomName: "room-a",
        grants,
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
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "room.join",
      target: {
        projectId,
        roomName: "room-a",
        roomId,
      },
      reason: "allowed",
    });
  });

  test("room.join は Session だけを渡された場合は拒否する", () => {
    const { participant: _baseJoinParticipant, ...input } = baseJoinInput;
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.join",
      target: expectedTarget(input),
      reason: "participant-required",
    });
  });

  test.each([
    {
      name: "Session が失効している",
      input: {
        ...baseJoinInput,
        session: {
          ...baseJoinInput.session!,
          state: "revoked",
        },
      },
      reason: "session-not-active",
    },
    {
      name: "Session が別 Room のものである",
      input: {
        ...baseJoinInput,
        session: {
          ...baseJoinInput.session!,
          roomId: otherRoomId,
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Session の Participant が一致しない",
      input: {
        ...baseJoinInput,
        session: {
          ...baseJoinInput.session!,
          participantId: otherParticipantId,
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Participant が失効している",
      input: {
        ...baseJoinInput,
        participant: {
          ...baseJoinInput.participant!,
          state: "revoked",
        },
      },
      reason: "participant-not-active",
    },
    {
      name: "Participant が別 Room のものである",
      input: {
        ...baseJoinInput,
        participant: {
          ...baseJoinInput.participant!,
          roomId: otherRoomId,
        },
      },
      reason: "participant-target-mismatch",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("room.join で $name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.join",
      target: expectedTarget(input),
      reason,
    });
  });

  test.each([
    {
      name: "Session",
      input: {
        ...baseJoinInput,
        credential: {
          ...baseJoinInput.credential,
          roomName: "new-room",
          grants: {
            ...baseJoinInput.credential.grants,
            "room.create": true,
          },
        },
        room: {
          state: "absent" as const,
          projectId,
          name: "new-room",
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Participant",
      input: {
        ...baseJoinWithoutSession,
        credential: {
          ...baseJoinInput.credential,
          roomName: "new-room",
          grants: {
            ...baseJoinInput.credential.grants,
            "room.create": true,
          },
        },
        room: {
          state: "absent" as const,
          projectId,
          name: "new-room",
        },
      },
      reason: "participant-target-mismatch",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("未作成 Room への room.join で $name を渡す場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.join",
      target: expectedTarget(input),
      reason,
    });
  });

  test("room.join の grant がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
        subject,
        roomName: "room-a",
        grants: {
          ...grants,
          "room.join": false,
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
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.join",
      target: { projectId, roomName: "room-a", roomId },
      reason: "grant-not-granted",
    });
  });

  test("未作成 Room への参加で room.create がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
        subject,
        roomName: "new-room",
        grants: {
          ...grants,
          "room.create": false,
          "room.join": true,
        },
      },
      project: {
        id: projectId,
        state: "active",
      },
      room: {
        state: "absent",
        projectId,
        name: "new-room",
      },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.join",
      target: { projectId, roomName: "new-room" },
      reason: "room-create-required",
    });
  });
});
