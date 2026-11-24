import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationReason,
} from "../../src/management-credential.js";
import { otherProjectId } from "../fixtures.js";
import { baseInput } from "./support.js";

describe("Management API credential の認可", () => {
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
  }>)(authSpecName("AUTH-MC-03", "$name 場合は拒否する"), ({ input, reason }) => {
    const decision = authorizeManagementCredentialAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: input.target,
      reason,
    });
  });

  test.each([
    { name: "小数", expiresAt: 2_000.5, now: 1_000 },
    { name: "safe integer 範囲外", expiresAt: Number.MAX_SAFE_INTEGER + 1, now: 1_000 },
    { name: "now が小数", expiresAt: 2_000, now: 1_000.5 },
  ])(authSpecName("AUTH-MC-06", "期限が$nameの場合は拒否する"), ({ expiresAt, now }) => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        expiresAt,
      },
      now,
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation: baseInput.operation,
      target: baseInput.target,
      reason: "credential-expiry-invalid",
    });
  });
});
