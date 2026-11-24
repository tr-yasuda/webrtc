import { describe, expect, test } from "vitest";
import {
  authorizeManagementCredentialFromRaw,
  validateManagementCredentialAuthorizationInput,
} from "../../src/management-credential.js";
import { participantId, projectId, sessionId } from "../fixtures.js";

const validInput = {
  credential: {
    projectId,
    scopes: ["room.manage"],
    revoked: false,
    expiresAt: 2_000,
  },
  project: { id: projectId, state: "active" },
  operation: "room.read",
  target: { projectId, resourceId: "room-a" },
  now: 1_000,
};

describe("Management API credential 認可入力の検証", () => {
  test("有効な入力を検証済み入力へ変換する", () => {
    expect(validateManagementCredentialAuthorizationInput(validInput).ok).toBe(true);
  });

  test("scopes が配列でない場合は input-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        credential: { ...validInput.credential, scopes: "room.manage" },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("未知の scope は unsupported-scope で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        credential: { ...validInput.credential, scopes: ["unknown.scope"] },
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-scope" });
  });

  test("revoked が boolean でない場合は input-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        credential: { ...validInput.credential, revoked: "false" },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("期限が有限数でない場合は input-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        credential: {
          ...validInput.credential,
          expiresAt: Number.POSITIVE_INFINITY,
        },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("operation に不要な target ID は target-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        target: { projectId, roomId: "room-a" },
      }),
    ).toStrictEqual({ ok: false, reason: "target-invalid" });
  });

  test("入力がobjectでない場合は input-invalid で拒否する", () => {
    expect(validateManagementCredentialAuthorizationInput(null)).toStrictEqual({
      ok: false,
      reason: "input-invalid",
    });
  });

  test("credential・project・targetが不正なら拒否する", () => {
    for (const patch of [
      { credential: undefined },
      { project: {} },
      { target: {} },
      { now: Number.NaN },
    ]) {
      expect(
        validateManagementCredentialAuthorizationInput({ ...validInput, ...patch }),
      ).toStrictEqual({ ok: false, reason: "input-invalid" });
    }
  });

  test("定義外の operation は unsupported-operation で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        operation: "unknown.operation",
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-operation" });
  });

  test("target ID が文字列でない場合は input-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        operation: "room.update",
        target: { projectId, roomId: 1 },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("Session と Participant の強制切断targetを検証できる", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        operation: "session.disconnect",
        target: { projectId, sessionId },
      }).ok,
    ).toBe(true);
    expect(
      validateManagementCredentialAuthorizationInput({
        ...validInput,
        operation: "participant.disconnect",
        target: { projectId, participantId },
      }).ok,
    ).toBe(true);
  });

  test("生入力の認可は有効な入力で成功する", () => {
    const outcome = authorizeManagementCredentialFromRaw(validInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.allowed).toBe(true);
    }
  });

  test("生入力の認可は検証失敗を outcome として返す", () => {
    expect(
      authorizeManagementCredentialFromRaw({
        ...validInput,
        credential: { ...validInput.credential, revoked: "false" },
      }),
    ).toStrictEqual({ ok: false, failure: "input-invalid" });
  });
});
