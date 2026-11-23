import type { ParticipantId, ProjectId, RoomId } from "@webrtc/domain";
import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
  type ParticipantOperation,
} from "../src/participant.js";

const projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as ProjectId;
const roomId = "01ARZ3NDEKTSV4RRFFQ69G5FAW" as RoomId;
const participantId = "01ARZ3NDEKTSV4RRFFQ69G5FAX" as ParticipantId;
const sessionId = "session-a";

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
    state: "active",
  },
};

describe("参加 JWT の認可", () => {
  test("有効な room.join grant と参加可能な Room なら参加を許可する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
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
        state: "active",
      },
    });

    expect(decision).toMatchObject({
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

    expect(decisions).toEqual([
      expect.objectContaining({ allowed: true, operation: "room.create", reason: "allowed" }),
      expect.objectContaining({
        allowed: false,
        operation: "room.join",
        reason: "grant-not-granted",
      }),
    ]);
  });

  test("未作成 Room への参加は room.create と room.join の両方を必要とする", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: true,
      operation: "room.join",
      reason: "allowed",
      target: {
        projectId,
        roomName: "new-room",
      },
    });
  });

  test.each<ParticipantOperation>(["media.publish", "media.subscribe", "data.send"])(
    "%s は同じ Room の有効な Session と Participant なら許可する",
    (operation) => {
      const decision = authorizeParticipantAction({
        operation,
        credential: {
          projectId,
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
          state: "active",
        },
      });

      expect(decision).toMatchObject({
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: input.operation,
      reason,
      target: {
        projectId: input.project.id,
        roomName: input.room.name,
      },
    });
  });

  test("room.create の grant がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.create",
      credential: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: "room.create",
      reason: "grant-not-granted",
    });
  });

  test("room.join の grant がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: "room.join",
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

      expect(decision).toMatchObject({
        allowed: false,
        operation,
        reason: "grant-not-granted",
      });
    },
  );

  test("既存 Room への room.create は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.create",
      credential: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: "room.create",
      reason: "room-already-exists",
    });
  });

  test("未作成 Room への参加で room.create がない場合は拒否する", () => {
    const decision = authorizeParticipantAction({
      operation: "room.join",
      credential: {
        projectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: "room.join",
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

    expect(decision).toMatchObject({
      allowed: false,
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

    expect(decision).toMatchObject({
      allowed: false,
      reason,
    });
  });
});
