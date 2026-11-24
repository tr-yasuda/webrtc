import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
} from "../../src/participant.js";
import { projectId, roomId, subject } from "../fixtures.js";
import { grants, baseJoinInput, baseJoinWithoutSession, expectedTarget } from "./support.js";

describe("参加 JWT の認可", () => {
  test("room.create は room.join を自動許可しない", () => {
    const decisions = [
      authorizeParticipantAction({
        operation: "room.create",
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: {
            ...grants,
            "room.create": true,
            "room.join": false,
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
      }),
      authorizeParticipantAction({
        operation: "room.join",
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: {
            ...grants,
            "room.create": true,
            "room.join": false,
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
      }),
    ];

    expect(decisions).toStrictEqual([
      {
        allowed: false,
        operation: "room.create",
        target: { projectId, roomName: "new-room" },
        reason: "room-join-required",
      },
      {
        allowed: false,
        operation: "room.join",
        target: { projectId, roomName: "new-room" },
        reason: "grant-not-granted",
      },
    ]);
  });

  test("room.create は room.join と同時なら許可する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.create",
      credential: {
        projectId,
        subject,
        roomName: "new-room",
        grants: {
          ...grants,
          "room.create": true,
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
      allowed: true,
      operation: "room.create",
      target: { projectId, roomName: "new-room" },
      reason: "allowed",
    });
  });

  test("未作成 Room への参加は room.create と room.join の両方を必要とする", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
        subject,
        roomName: "new-room",
        grants: {
          ...grants,
          "room.create": true,
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
      allowed: true,
      operation: "room.join",
      reason: "allowed",
      target: {
        projectId,
        roomName: "new-room",
      },
    });
  });

  test.each([
    {
      name: "Session",
      input: {
        ...baseJoinInput,
        operation: "room.create" as const,
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
        operation: "room.create" as const,
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
  }>)("未作成 Room への room.create で $name を渡す場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: "room.create",
      target: expectedTarget(input),
      reason,
    });
  });

  test("room.create の grant がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.create",
      credential: {
        projectId,
        subject,
        roomName: "new-room",
        grants: {
          ...grants,
          "room.create": false,
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
      operation: "room.create",
      target: { projectId, roomName: "new-room" },
      reason: "grant-not-granted",
    });
  });

  test("既存 Room への room.create は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.create",
      credential: {
        projectId,
        subject,
        roomName: "room-a",
        grants: {
          ...grants,
          "room.create": true,
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
      operation: "room.create",
      target: { projectId, roomName: "room-a", roomId },
      reason: "room-already-exists",
    });
  });
});
