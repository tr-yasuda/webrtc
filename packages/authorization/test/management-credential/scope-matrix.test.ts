import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialScope,
} from "../../src/management-credential.js";
import { credentialProjectUserOperations } from "../../src/generated/policy.js";
import { projectId } from "../fixtures.js";
import {
  allOperations,
  allScopes,
  baseInput,
  expectedScopeOperations,
  targetFor,
} from "./support.js";

describe("Management API credential の認可", () => {
  test(authSpecName("AUTH-MC-01", "room.manage scope は Room の読み取りを許可する"), () => {
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

  test.each(credentialProjectUserOperations)(
    authSpecName("AUTH-MC-02", "credential は ProjectUser 管理 %s を許可しない"),
    (operation) => {
      const target = targetFor(operation);
      const decision = authorizeManagementCredentialAction({
        ...baseInput,
        operation,
        target,
      });

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target,
        reason: "credential-operation-not-allowed",
      });
    },
  );

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

  test.each<ManagementCredentialScope>(allScopes)(
    "%s scope の操作可否が scope マトリクスと一致する",
    (scope) => {
      for (const operation of allOperations) {
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
          expectedScopeOperations[scope].includes(operation),
        );
      }
    },
  );
});
