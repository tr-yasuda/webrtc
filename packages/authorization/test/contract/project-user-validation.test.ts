import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserFromRaw,
  validateProjectUserAuthorizationInput,
} from "../../src/project-user.js";
import { participantId, projectId, projectUserId, sessionId } from "../fixtures.js";

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
    for (const patch of [
      { actor: null },
      { actor: {} },
      { project: {} },
      { target: null },
      { target: {} },
    ]) {
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
          projectUserId,
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

  test("sessionId と resourceId が文字列でない場合は input-invalid で拒否する", () => {
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        operation: "session.disconnect",
        target: { projectId, sessionId: 1 },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
    expect(
      validateProjectUserAuthorizationInput({
        ...validInput,
        target: { projectId, resourceId: 1 },
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

  test("必須のDomain IDが空またはULIDでない場合は input-invalid で拒否する", () => {
    const cases = [
      {
        name: "actor.projectId",
        input: { ...validInput, actor: { ...validInput.actor, projectId: "" } },
      },
      {
        name: "project.id",
        input: { ...validInput, project: { ...validInput.project, id: "" } },
      },
      {
        name: "target.projectId",
        input: { ...validInput, target: { ...validInput.target, projectId: "" } },
      },
      {
        name: "target.accountId",
        input: {
          ...validInput,
          operation: "projectUser.add",
          target: { projectId, accountId: "", nextRole: "auditor" },
        },
      },
      {
        name: "target.projectUserId",
        input: {
          ...validInput,
          operation: "projectUser.changeRole",
          target: {
            projectId,
            projectUserId: "",
            currentRole: "auditor",
            nextRole: "auditor",
          },
        },
      },
      {
        name: "target.roomId",
        input: {
          ...validInput,
          operation: "room.update",
          target: { projectId, roomId: "" },
        },
      },
      {
        name: "target.participantId",
        input: {
          ...validInput,
          operation: "participant.disconnect",
          target: { projectId, participantId: "" },
        },
      },
      {
        name: "ULIDでないactor.projectId",
        input: {
          ...validInput,
          actor: { ...validInput.actor, projectId: "project-a" },
        },
      },
    ];

    for (const { name, input } of cases) {
      expect(validateProjectUserAuthorizationInput(input), name).toStrictEqual({
        ok: false,
        reason: "input-invalid",
      });
    }
  });

  test("小文字のDomain IDは大文字に正規化する", () => {
    const result = validateProjectUserAuthorizationInput({
      ...validInput,
      actor: { ...validInput.actor, projectId: projectId.toLowerCase() },
      project: { ...validInput.project, id: projectId.toLowerCase() },
      target: { ...validInput.target, projectId: projectId.toLowerCase() },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actor.projectId).toBe(projectId);
      expect(result.value.project.id).toBe(projectId);
      expect(result.value.target.projectId).toBe(projectId);
    }
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
