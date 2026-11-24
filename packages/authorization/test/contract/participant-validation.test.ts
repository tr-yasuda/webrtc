import { describe, expect, test } from "vitest";
import {
  authorizeParticipantFromRaw,
  validateParticipantAuthorizationInput,
} from "../../src/participant.js";
import { participantId, projectId, roomId, sessionId } from "../fixtures.js";
import { baseMediaInput } from "../participant/support.js";

describe("参加 JWT 認可入力の検証", () => {
  test("有効な入力を検証済み入力へ変換する", () => {
    const result = validateParticipantAuthorizationInput(baseMediaInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operation).toBe("media.publish");
      expect(result.value.credential.grants["media.publish"]).toBe(true);
    }
  });

  test("定義外の operation は unsupported-operation で拒否する", () => {
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        operation: "unknown.operation",
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-operation" });
  });

  test("未知の grant キーは unsupported-grant で拒否する", () => {
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            recording: true,
          },
        },
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-grant" });
  });

  test("boolean でない grant は grant-invalid で拒否する", () => {
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            "media.publish": "yes",
          },
        },
      }),
    ).toStrictEqual({ ok: false, reason: "grant-invalid" });
  });

  test("grants が object でない場合は input-invalid で拒否する", () => {
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: [],
        },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("入力がobjectでない場合は input-invalid で拒否する", () => {
    expect(validateParticipantAuthorizationInput(null)).toStrictEqual({
      ok: false,
      reason: "input-invalid",
    });
  });

  test("必須のcredential・project・room・session・participantが不正なら拒否する", () => {
    for (const patch of [
      { credential: undefined },
      { project: {} },
      { room: {} },
      { session: {} },
      { participant: {} },
    ]) {
      expect(validateParticipantAuthorizationInput({ ...baseMediaInput, ...patch })).toStrictEqual({
        ok: false,
        reason: "input-invalid",
      });
    }
  });

  test("credential の項目型が不正なら input-invalid で拒否する", () => {
    for (const patch of [{ projectId: 1 }, { roomName: 1 }, { subject: 1 }]) {
      expect(
        validateParticipantAuthorizationInput({
          ...baseMediaInput,
          credential: { ...baseMediaInput.credential, ...patch },
        }),
      ).toStrictEqual({ ok: false, reason: "input-invalid" });
    }
  });

  test("room がobjectでない、または未作成Roomの項目が不正なら拒否する", () => {
    expect(validateParticipantAuthorizationInput({ ...baseMediaInput, room: null })).toStrictEqual({
      ok: false,
      reason: "input-invalid",
    });
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        room: { state: "absent", projectId: 1, name: "new-room" },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
    expect(
      validateParticipantAuthorizationInput({
        ...baseMediaInput,
        room: { state: "absent", projectId, name: 1 },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("Session と Participant を持たない新規Room参加は検証できる", () => {
    expect(
      validateParticipantAuthorizationInput({
        operation: "room.join",
        credential: {
          projectId,
          subject: "subject-a",
          roomName: "new-room",
          grants: { "room.create": true, "room.join": true },
        },
        project: { id: projectId, state: "active" },
        room: { state: "absent", projectId, name: "new-room" },
      }).ok,
    ).toBe(true);
  });

  test("必須のDomain IDが空またはULIDでない場合は input-invalid で拒否する", () => {
    const cases = [
      {
        name: "credential.projectId",
        input: {
          ...baseMediaInput,
          credential: { ...baseMediaInput.credential, projectId: "" },
        },
      },
      {
        name: "project.id",
        input: { ...baseMediaInput, project: { ...baseMediaInput.project, id: "" } },
      },
      {
        name: "room.projectId",
        input: { ...baseMediaInput, room: { ...baseMediaInput.room, projectId: "" } },
      },
      {
        name: "room.id",
        input: { ...baseMediaInput, room: { ...baseMediaInput.room, id: "" } },
      },
      {
        name: "session.projectId",
        input: {
          ...baseMediaInput,
          session: { ...baseMediaInput.session!, projectId: "" },
        },
      },
      {
        name: "session.roomId",
        input: {
          ...baseMediaInput,
          session: { ...baseMediaInput.session!, roomId: "" },
        },
      },
      {
        name: "session.participantId",
        input: {
          ...baseMediaInput,
          session: { ...baseMediaInput.session!, participantId: "" },
        },
      },
      {
        name: "participant.id",
        input: {
          ...baseMediaInput,
          participant: { ...baseMediaInput.participant!, id: "" },
        },
      },
      {
        name: "participant.roomId",
        input: {
          ...baseMediaInput,
          participant: { ...baseMediaInput.participant!, roomId: "" },
        },
      },
      {
        name: "ULIDでないproject.id",
        input: { ...baseMediaInput, project: { ...baseMediaInput.project, id: "project-a" } },
      },
    ];

    for (const { name, input } of cases) {
      expect(validateParticipantAuthorizationInput(input), name).toStrictEqual({
        ok: false,
        reason: "input-invalid",
      });
    }
  });

  test("小文字のDomain IDは大文字に正規化する", () => {
    const result = validateParticipantAuthorizationInput({
      ...baseMediaInput,
      credential: {
        ...baseMediaInput.credential,
        projectId: projectId.toLowerCase(),
      },
      project: { ...baseMediaInput.project, id: projectId.toLowerCase() },
      room: {
        ...baseMediaInput.room,
        id: roomId.toLowerCase(),
        projectId: projectId.toLowerCase(),
      },
      session: {
        ...baseMediaInput.session!,
        projectId: projectId.toLowerCase(),
        roomId: roomId.toLowerCase(),
        participantId: participantId.toLowerCase(),
      },
      participant: {
        ...baseMediaInput.participant!,
        id: participantId.toLowerCase(),
        roomId: roomId.toLowerCase(),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.credential.projectId).toBe(projectId);
      expect(result.value.project.id).toBe(projectId);
      expect(result.value.room.projectId).toBe(projectId);
      expect(result.value.room.state).not.toBe("absent");
      if (result.value.room.state !== "absent") {
        expect(result.value.room.id).toBe(roomId);
      }
      expect(result.value.session?.projectId).toBe(projectId);
      expect(result.value.session?.roomId).toBe(roomId);
      expect(result.value.session?.participantId).toBe(participantId);
      expect(result.value.session?.id).toBe(sessionId);
      expect(result.value.participant?.id).toBe(participantId);
      expect(result.value.participant?.roomId).toBe(roomId);
    }
  });

  test("生入力の認可は有効な入力で成功する", () => {
    const outcome = authorizeParticipantFromRaw(baseMediaInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.allowed).toBe(true);
    }
  });

  test("生入力の認可は検証失敗を outcome として返す", () => {
    expect(
      authorizeParticipantFromRaw({
        ...baseMediaInput,
        operation: "unknown.operation",
      }),
    ).toStrictEqual({ ok: false, failure: "unsupported-operation" });
  });
});
