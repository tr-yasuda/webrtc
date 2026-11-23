import type { ProjectId } from "@webrtc/domain";
import { describe, expect, test } from "vitest";
import type { ManagementOperation } from "../src/management-operation.js";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialAuthorizationReason,
  type ManagementCredentialScope,
} from "../src/management-credential.js";

const projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as ProjectId;
const allScopes: readonly ManagementCredentialScope[] = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
];
const allOperations: readonly ManagementOperation[] = [
  "project.read",
  "project.update",
  "project.delete",
  "projectUser.read",
  "projectUser.add",
  "projectUser.remove",
  "projectUser.changeRole",
  "application.manage",
  "applicationSigningKey.manage",
  "managementApiCredential.manage",
  "room.read",
  "room.update",
  "room.delete",
  "session.read",
  "session.disconnect",
  "participant.read",
  "participant.disconnect",
  "usage.read",
  "audit.read",
];
const expectedScopeOperations: Record<ManagementCredentialScope, readonly ManagementOperation[]> = {
  "room.manage": ["room.read", "room.update", "room.delete"],
  "session.manage": [
    "session.read",
    "session.disconnect",
    "participant.read",
    "participant.disconnect",
  ],
  "usage.read": ["usage.read"],
  "audit.read": ["audit.read"],
};

const baseInput: ManagementCredentialAuthorizationInput = {
  credential: {
    projectId,
    scopes: allScopes,
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

    expect(decision).toMatchObject({
      allowed: true,
      operation: "room.read",
      reason: "allowed",
      target: {
        projectId,
        resourceId: "room-a",
      },
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
        });

        expect(decision.allowed, `${scope} / ${operation}`).toBe(
          expectedScopeOperations[scope].includes(operation),
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
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
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
          projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY" as ProjectId,
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

    expect(decision).toMatchObject({
      allowed: false,
      operation: input.operation,
      reason,
    });
  });
});
