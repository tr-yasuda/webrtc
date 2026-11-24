import { describe, expect, test } from "vitest";
import type { ManagementOperation } from "../src/management-operation.js";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialAuthorizationTarget,
  type ManagementCredentialScope,
} from "../src/management-credential.js";
import { otherProjectId, participantId, projectId, roomId, sessionId } from "./fixtures.js";
import {
  allManagementCredentialScopes,
  allManagementOperations,
  expectedCredentialScopeOperations,
} from "./policy.js";

const baseInput: ManagementCredentialAuthorizationInput = {
  credential: {
    projectId,
    scopes: allManagementCredentialScopes,
    revoked: false,
    expiresAt: 2_000,
  },
  project: {
    id: projectId,
    state: "active",
  },
  operation: "room.read",
  target: {
    projectId,
    resourceId: "room-a",
  },
  now: 1_000,
};

function targetFor(operation: ManagementOperation): ManagementCredentialAuthorizationTarget {
  switch (operation) {
    case "room.update":
    case "room.delete":
      return { projectId, roomId };
    case "session.disconnect":
      return { projectId, sessionId };
    case "participant.disconnect":
      return { projectId, participantId };
    default:
      return { projectId, resourceId: "room-a" };
  }
}

describe("Management API credential の認可", () => {
  test("room.manage scope は Room の読み取りを許可する", () => {
    const decision = authorizeManagementCredentialAction({
      credential: {
        projectId,
        scopes: ["room.manage"],
        revoked: false,
        expiresAt: 2_000,
      },
      project: {
        id: projectId,
        state: "active",
      },
      operation: "room.read",
      target: {
        projectId,
        resourceId: "room-a",
      },
      now: 1_000,
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "room.read",
      reason: "allowed",
      target: {
        projectId,
        resourceId: "room-a",
      },
    });
  });

  test("session.read は対象 ID を指定しない一覧取得を許可する", () => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: ["session.manage"],
      },
      operation: "session.read",
      target: { projectId },
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "session.read",
      target: { projectId },
      reason: "allowed",
    });
  });

  test.each([
    {
      name: "session.disconnect",
      operation: "session.disconnect",
      scope: "session.manage",
    },
    {
      name: "participant.disconnect",
      operation: "participant.disconnect",
      scope: "session.manage",
    },
    {
      name: "room.update",
      operation: "room.update",
      scope: "room.manage",
    },
    {
      name: "room.delete",
      operation: "room.delete",
      scope: "room.manage",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    scope: ManagementCredentialScope;
  }>)("$name は対象 ID がない場合は拒否する", ({ operation, scope }) => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: [scope],
      },
      operation,
      target: { projectId },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation,
      target: { projectId },
      reason: "target-id-required",
    });
  });

  test.each([
    {
      name: "session.disconnect",
      operation: "session.disconnect",
      scope: "session.manage",
      target: { projectId, sessionId },
    },
    {
      name: "participant.disconnect",
      operation: "participant.disconnect",
      scope: "session.manage",
      target: { projectId, participantId },
    },
    {
      name: "room.update",
      operation: "room.update",
      scope: "room.manage",
      target: { projectId, roomId },
    },
    {
      name: "room.delete",
      operation: "room.delete",
      scope: "room.manage",
      target: { projectId, roomId },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    scope: ManagementCredentialScope;
    target: ManagementCredentialAuthorizationTarget;
  }>)("$name は対象 ID がある場合は許可する", ({ operation, scope, target }) => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: [scope],
      },
      operation,
      target,
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation,
      target,
      reason: "allowed",
    });
  });

  test.each([
    { name: "undefined", revoked: undefined },
    { name: "null", revoked: null },
    { name: "0", revoked: 0 },
    { name: "空文字", revoked: "" },
  ] as ReadonlyArray<{ name: string; revoked: unknown }>)(
    "revoked が $name の場合は拒否する",
    ({ revoked }) => {
      const decision = authorizeManagementCredentialAction({
        ...baseInput,
        credential: {
          ...baseInput.credential,
          revoked: revoked as boolean,
        },
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation: baseInput.operation,
        target: baseInput.target,
        reason: "credential-revoked",
      });
    },
  );

  test("scopes が文字列の場合は拒否する", () => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: "session.manage" as unknown as readonly ManagementCredentialScope[],
      },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: baseInput.operation,
      target: baseInput.target,
      reason: "credential-input-invalid",
    });
  });

  test("scopes に未知の値が含まれる場合は拒否する", () => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: ["unknown.scope"] as unknown as readonly ManagementCredentialScope[],
      },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: baseInput.operation,
      target: baseInput.target,
      reason: "credential-input-invalid",
    });
  });

  test.each(["unknown.operation", "constructor"] as ManagementOperation[])(
    "定義外の Management operation %s は拒否する",
    (operation) => {
      const decision = authorizeManagementCredentialAction({
        ...baseInput,
        operation,
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: baseInput.target,
        reason: "unsupported-operation",
      });
    },
  );

  test.each<ManagementCredentialScope>(allManagementCredentialScopes)(
    "%s scope の操作可否が scope マトリクスと一致する",
    (scope) => {
      for (const operation of allManagementOperations) {
        const decision = authorizeManagementCredentialAction({
          ...baseInput,
          credential: {
            ...baseInput.credential,
            scopes: [scope],
          },
          operation,
          target: targetFor(operation),
        });

        expect(decision.allowed, `${scope} / ${operation}`).toBe(
          expectedCredentialScopeOperations[scope].includes(operation),
        );
      }
    },
  );

  test.each([
    {
      name: "credential が失効している",
      input: {
        ...baseInput,
        credential: {
          ...baseInput.credential,
          revoked: true,
        },
      },
      reason: "credential-revoked",
    },
    {
      name: "credential の期限に達している",
      input: {
        ...baseInput,
        now: baseInput.credential.expiresAt,
      },
      reason: "credential-expired",
    },
    {
      name: "credential の期限が数値として扱えない",
      input: {
        ...baseInput,
        credential: {
          ...baseInput.credential,
          expiresAt: Number.NaN,
        },
      },
      reason: "credential-expiry-invalid",
    },
    {
      name: "現在時刻が有限の数値でない",
      input: {
        ...baseInput,
        now: Number.POSITIVE_INFINITY,
      },
      reason: "credential-expiry-invalid",
    },
    {
      name: "credential の Project が一致しない",
      input: {
        ...baseInput,
        credential: {
          ...baseInput.credential,
          projectId: otherProjectId,
        },
      },
      reason: "credential-target-mismatch",
    },
    {
      name: "対象資源の Project が一致しない",
      input: {
        ...baseInput,
        target: {
          ...baseInput.target,
          projectId: otherProjectId,
        },
      },
      reason: "credential-target-mismatch",
    },
    {
      name: "Project が停止している",
      input: {
        ...baseInput,
        project: {
          ...baseInput.project,
          state: "suspended",
        },
      },
      reason: "project-not-active",
    },
    {
      name: "scope がない",
      input: {
        ...baseInput,
        credential: {
          ...baseInput.credential,
          scopes: [],
        },
      },
      reason: "credential-scope-missing",
    },
    {
      name: "ProjectUser ロールでしか許可されない操作である",
      input: {
        ...baseInput,
        operation: "project.read",
      },
      reason: "credential-operation-not-allowed",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ManagementCredentialAuthorizationInput;
    reason: Exclude<ManagementCredentialAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeManagementCredentialAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: input.target,
      reason,
    });
  });
});
