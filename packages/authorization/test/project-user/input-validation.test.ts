import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import {
  authorizeProjectUserFromRaw,
  validateProjectUserAuthorizationInput,
  type ProjectUserRole,
} from "../../src/project-user.js";
import { accountId, projectId, projectUserId } from "../fixtures.js";

describe("ProjectUser 認可入力の検証", () => {
  test.each(["superuser", "__proto__", "constructor"] as unknown as ProjectUserRole[])(
    authSpecName("AUTH-PU-04", "定義外の ProjectUser ロール %s は unsupported-role で拒否する"),
    (role) => {
      expect(
        validateProjectUserAuthorizationInput({
          actor: { projectId, role },
          project: { id: projectId, state: "active" },
          operation: "project.read",
          target: { projectId },
        }),
      ).toStrictEqual({ ok: false, reason: "unsupported-role" });
    },
  );

  test.each([
    {
      name: "付与後ロールが定義外である",
      operation: "projectUser.add",
      target: {
        projectId,
        accountId,
        nextRole: "Owner",
      },
    },
    {
      name: "現在ロールが定義外である",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "Owner",
        nextRole: "auditor",
      },
    },
    {
      name: "変更後ロールが定義外である",
      operation: "projectUser.changeRole",
      target: {
        projectId,
        projectUserId,
        currentRole: "auditor",
        nextRole: "superuser",
      },
    },
  ])("$name場合は unsupported-role で拒否する", ({ operation, target }) => {
    expect(
      validateProjectUserAuthorizationInput({
        actor: { projectId, role: "admin" },
        project: { id: projectId, state: "active" },
        operation,
        target,
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-role" });
  });

  test("定義外の Management operation は unsupported-operation で拒否する", () => {
    expect(
      authorizeProjectUserFromRaw({
        actor: { projectId, role: "owner" },
        project: { id: projectId, state: "active" },
        operation: "unknown.operation",
        target: { projectId },
      }),
    ).toStrictEqual({ ok: false, failure: "unsupported-operation" });
  });
});
