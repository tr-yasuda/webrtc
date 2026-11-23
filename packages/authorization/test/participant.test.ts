import type { ParticipantId, ProjectId, RoomId } from "@webrtc/domain";
import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
  type ParticipantAuthorizationTarget,
  type ParticipantOperation,
} from "../src/participant.js";

const projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as ProjectId;
const roomId = "01ARZ3NDEKTSV4RRFFQ69G5FAW" as RoomId;
const participantId = "01ARZ3NDEKTSV4RRFFQ69G5FAX" as ParticipantId;
const otherRoomId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ" as RoomId;
const otherParticipantId = "01ARZ3NDEKTSV4RRFFQ69G5FA0" as ParticipantId;
const sessionId = "session-a";
const subject = "user-a";

const grants = {
  "room.create": false,
  "room.join": true,
  "media.publish": false,
  "media.subscribe": false,
  "data.send": false,
} as const;

const baseMediaInput: ParticipantAuthorizationInput = {
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
};

const baseJoinInput: ParticipantAuthorizationInput = {
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
};
const { session: _baseJoinSession, ...baseJoinWithoutSession } = baseJoinInput;

function expectedTarget(input: ParticipantAuthorizationInput): ParticipantAuthorizationTarget {
  return {
    projectId: input.project.id,
    roomName: input.room.name,
    ...(input.room.state === "absent" ? {} : { roomId: input.room.id }),
    ...(input.session === undefined ? {} : { sessionId: input.session.id }),
    ...(input.participant === undefined ? {} : { participantId: input.participant.id }),
  };
}

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
        allowed: true,
        operation: "room.create",
        target: { projectId, roomName: "new-room" },
        reason: "allowed",
      },
      {
        allowed: false,
        operation: "room.join",
        target: { projectId, roomName: "new-room" },
        reason: "grant-not-granted",
      },
    ]);
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
      name: "media.publish の Participant が JWT subject と一致しない",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          externalUserId: "user-b",
        },
      },
      reason: "subject-mismatch",
    },
    {
      name: "room.join の Participant が JWT subject と一致しない",
      input: {
        ...baseJoinInput,
        participant: {
          ...baseJoinInput.participant!,
          externalUserId: "user-b",
        },
      },
      reason: "subject-mismatch",
    },
    {
      name: "JWT subject が空である",
      input: {
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          subject: "",
        },
      },
      reason: "subject-required",
    },
    {
      name: "Participant の ExternalUser が空である",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          externalUserId: "",
        },
      },
      reason: "subject-required",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: expectedTarget(input),
      reason,
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

  test.each<ParticipantOperation>(["media.publish", "media.subscribe", "data.send"])(
    "%s は同じ Room の有効な Session と Participant なら許可する",
    (operation) => {
      const decision = authorizeParticipantAction({
        operation,
        credential: {
          projectId,
          subject,
          roomName: "room-a",
          grants: {
            ...grants,
            [operation]: true,
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
      });

      expect(decision).toStrictEqual({
        allowed: true,
        operation,
        reason: "allowed",
        target: {
          projectId,
          roomName: "room-a",
          roomId,
          sessionId,
          participantId,
        },
      });
    },
  );

  test.each(["unknown.operation", "constructor"] as ParticipantOperation[])(
    "定義外の participant operation %s は拒否する",
    (operation) => {
      const decision = authorizeParticipantAction({
        ...baseMediaInput,
        operation,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            [operation]: true,
          },
        },
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: expectedTarget(baseMediaInput),
        reason: "unsupported-operation",
      });
    },
  );

  test.each([
    {
      name: "grant がない",
      input: {
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            "media.publish": false,
          },
        },
      },
      reason: "grant-not-granted",
    },
    {
      name: "Project が停止している",
      input: {
        ...baseMediaInput,
        project: {
          ...baseMediaInput.project,
          state: "suspended",
        },
      },
      reason: "project-not-active",
    },
    {
      name: "Project が credential と一致しない",
      input: {
        ...baseMediaInput,
        project: {
          ...baseMediaInput.project,
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
        },
      },
      reason: "credential-target-mismatch",
    },
    {
      name: "Room 名が credential と一致しない",
      input: {
        ...baseMediaInput,
        room: {
          ...baseMediaInput.room,
          name: "room-b",
        },
      },
      reason: "credential-target-mismatch",
    },
    {
      name: "Room の Project が一致しない",
      input: {
        ...baseMediaInput,
        room: {
          ...baseMediaInput.room,
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
        },
      },
      reason: "credential-target-mismatch",
    },
    {
      name: "Room が削除中である",
      input: {
        ...baseMediaInput,
        room: {
          ...baseMediaInput.room,
          state: "deleting",
        },
      },
      reason: "room-not-active",
    },
    {
      name: "Session がない",
      input: (({ session: _session, ...rest }) => rest)(baseMediaInput),
      reason: "session-required",
    },
    {
      name: "Session が失効している",
      input: {
        ...baseMediaInput,
        session: {
          ...baseMediaInput.session!,
          state: "revoked",
        },
      },
      reason: "session-not-active",
    },
    {
      name: "Participant がない",
      input: (({ participant: _participant, ...rest }) => rest)(baseMediaInput),
      reason: "participant-required",
    },
    {
      name: "Participant が失効している",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          state: "revoked",
        },
      },
      reason: "participant-not-active",
    },
    {
      name: "Session の Project が一致しない",
      input: {
        ...baseMediaInput,
        session: {
          ...baseMediaInput.session!,
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Session の Room が一致しない",
      input: {
        ...baseMediaInput,
        session: {
          ...baseMediaInput.session!,
          roomId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ" as RoomId,
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Session の Participant が一致しない",
      input: {
        ...baseMediaInput,
        session: {
          ...baseMediaInput.session!,
          participantId: "01ARZ3NDEKTSV4RRFFQ69G5FA0" as ParticipantId,
        },
      },
      reason: "session-target-mismatch",
    },
    {
      name: "Participant の Room が一致しない",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          roomId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ" as RoomId,
        },
      },
      reason: "participant-target-mismatch",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
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

  test.each<ParticipantOperation>(["media.publish", "media.subscribe", "data.send"])(
    "%s の grant がない場合は拒否する",
    (operation) => {
      const decision = authorizeParticipantAction({
        ...baseMediaInput,
        operation,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            [operation]: false,
          },
        },
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: expectedTarget(baseMediaInput),
        reason: "grant-not-granted",
      });
    },
  );

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

  test.each([
    {
      name: "Room が削除済みである",
      input: {
        ...baseMediaInput,
        room: {
          ...baseMediaInput.room,
          state: "deleted",
        },
      },
      reason: "room-not-active",
    },
    {
      name: "Session が終了している",
      input: {
        ...baseMediaInput,
        session: {
          ...baseMediaInput.session!,
          state: "ended",
        },
      },
      reason: "session-not-active",
    },
    {
      name: "Participant が退出している",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          state: "left",
        },
      },
      reason: "participant-not-active",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: expectedTarget(input),
      reason,
    });
  });

  test.each([
    {
      name: "room.create の grant が真偽値でない",
      input: {
        operation: "room.create" as const,
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: {
            ...grants,
            "room.create": "yes" as unknown as boolean,
          },
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        room: {
          state: "absent" as const,
          projectId,
          name: "new-room",
        },
      },
      reason: "grant-not-granted",
    },
    {
      name: "media.publish の grant が真偽値でない",
      input: {
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            "media.publish": "yes" as unknown as boolean,
          },
        },
      },
      reason: "grant-not-granted",
    },
    {
      name: "未作成 Room への参加で room.create の grant が真偽値でない",
      input: {
        operation: "room.join" as const,
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: {
            ...grants,
            "room.create": "yes" as unknown as boolean,
            "room.join": true,
          },
        },
        project: {
          id: projectId,
          state: "active" as const,
        },
        room: {
          state: "absent" as const,
          projectId,
          name: "new-room",
        },
      },
      reason: "room-create-required",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: expectedTarget(input),
      reason,
    });
  });
});
