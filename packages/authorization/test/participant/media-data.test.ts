import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
  type ParticipantOperation,
} from "../../src/participant.js";
import {
  otherParticipantId,
  otherProjectId,
  otherRoomId,
  participantId,
  projectId,
  roomId,
  sessionId,
  subject,
} from "../fixtures.js";
import { grants, baseMediaInput, expectedTarget } from "./support.js";

describe("参加 JWT の認可", () => {
  test.each<ParticipantOperation>(["media.publish", "media.subscribe", "data.send"])(
    authSpecName("AUTH-PART-03", "%s は同じ Room の有効な Session と Participant なら許可する"),
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
          id: otherProjectId,
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
          projectId: otherProjectId,
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
          projectId: otherProjectId,
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
          roomId: otherRoomId,
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
          participantId: otherParticipantId,
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
          roomId: otherRoomId,
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
});
