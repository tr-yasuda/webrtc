import { describe, expect, test } from "vitest";
import { authorizeParticipantAction } from "../../src/participant.js";
import { projectId } from "../fixtures.js";
import { baseJoinInput, baseMediaInput, grants } from "./support.js";

function targetKeys(target: object) {
  return Object.keys(target).toSorted();
}

const newRoomJoinInput = {
  operation: "room.join" as const,
  credential: {
    projectId,
    subject: baseJoinInput.credential.subject,
    roomName: "new-room",
    grants: { ...grants, "room.create": true },
  },
  project: baseJoinInput.project,
  room: { state: "absent" as const, projectId, name: "new-room" },
};

describe("参加 JWT 認可の監査target契約", () => {
  test("新規Room参加のtargetはRoom IDを含めない", () => {
    expect(targetKeys(authorizeParticipantAction(newRoomJoinInput).target)).toStrictEqual([
      "projectId",
      "roomName",
    ]);
  });

  test("既存Room参加のtargetはRoom・Session・Participant IDを含める", () => {
    expect(targetKeys(authorizeParticipantAction(baseJoinInput).target)).toStrictEqual([
      "participantId",
      "projectId",
      "roomId",
      "roomName",
      "sessionId",
    ]);
  });

  test("SessionとParticipantを渡さないmedia操作のtargetはRoom IDだけを含める", () => {
    const { session: _session, participant: _participant, ...input } = baseMediaInput;
    expect(targetKeys(authorizeParticipantAction(input).target)).toStrictEqual([
      "projectId",
      "roomId",
      "roomName",
    ]);
  });

  test("既存Roomへのroom.createでも渡されたSessionとParticipantをtargetに含める", () => {
    const input = {
      ...baseMediaInput,
      operation: "room.create" as const,
      credential: {
        ...baseMediaInput.credential,
        grants: { ...baseMediaInput.credential.grants, "room.create": true },
      },
    };
    expect(targetKeys(authorizeParticipantAction(input).target)).toStrictEqual([
      "participantId",
      "projectId",
      "roomId",
      "roomName",
      "sessionId",
    ]);
  });

  test("未作成RoomでSessionとParticipantが渡されてもtargetには含める", () => {
    const input = {
      ...baseMediaInput,
      operation: "room.join" as const,
      credential: {
        ...baseMediaInput.credential,
        roomName: "new-room",
        grants: { ...baseMediaInput.credential.grants, "room.create": true },
      },
      room: { state: "absent" as const, projectId, name: "new-room" },
    };
    expect(targetKeys(authorizeParticipantAction(input).target)).toStrictEqual([
      "participantId",
      "projectId",
      "roomName",
      "sessionId",
    ]);
  });
});
