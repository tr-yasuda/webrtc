import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserFromRaw,
  validateProjectUserAuthorizationInput,
} from "../../src/project-user.js";
import { participantId, projectId, sessionId } from "../fixtures.js";

const validInput = {
  actor: { projectId, role: "owner" },
  project: { id: projectId, state: "active" },
  operation: "project.read",
  target: { projectId },
};

describe("ProjectUser 認可入力の検証", () => {
  test("有効な入力を検証済み入力へ変換する", () => {
    expect(validateProjectUserAuthorizationInput(validInput).ok).toBe(true);
  });

  test("定義外の role は unsupported-role で拒否する", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        actor: { projectId, role: "superuser" },
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-role" });
  });

  test("operation に不要な target ID は target-invalid で拒否する", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        target: { projectId, roomId: "room-a" },
      }),
    ).toStrictEqual({ ok: false, reason: "target-invalid" });
  });

  test("入力がobjectでない場合は input-invalid で拒否する", () => {
    expect(validateProjectUserAuthorizationInput(null)).toStrictEqual({
      ok: false,
      reason: "input-invalid",
    });
  });

  test("actor・project・targetが不正なら拒否する", () => {
    for (const patch of [{ actor: {} }, { project: {} }, { target: {} }]) {
      expect(validateProjectUserAuthorizationInput({ ...validInput, ...patch })).toStrictEqual({
        ok: false,
        reason: "input-invalid",
      });
    }
  });

  test("currentRole と nextRole が定義外なら unsupported-role で拒否する", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        operation: "projectUser.changeRole",
        target: {
          projectId,
          projectUserId: "project-user-a",
          currentRole: "superuser",
          nextRole: "admin",
        },
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-role" });
  });

  test("target ID が文字列でない場合は input-invalid で拒否する", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        operation: "room.update",
        target: { projectId, roomId: 1 },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("actor の role が null でも検証できる", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        actor: { projectId, role: null },
      }).ok,
    ).toBe(true);
  });

  test("Session と Participant の強制切断targetを検証できる", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        actor: { projectId, role: "owner" },
        operation: "session.disconnect",
        target: { projectId, sessionId },
      }).ok,
    ).toBe(true);
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        actor: { projectId, role: "owner" },
        operation: "participant.disconnect",
        target: { projectId, participantId },
      }).ok,
    ).toBe(true);
  });

  test("生入力の認可は有効な入力で成功する", () => {
    const outcome = authorizeProjectUserFromRaw(validInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.allowed).toBe(true);
    }
  });

  test("生入力の認可は検証失敗を outcome として返す", () => {
    expect(
      authorizeProjectUserFromRaw({
        ...validInput,
        operation: "unknown.operation",
      }),
    ).toStrictEqual({ ok: false, failure: "unsupported-operation" });
  });
});
