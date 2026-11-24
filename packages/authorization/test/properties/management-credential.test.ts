import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  authorizeManagementCredentialAction,
  authorizeManagementCredentialFromRaw,
  validateManagementCredentialAuthorizationInput,
} from "../../src/management-credential.js";
import { projectId } from "../fixtures.js";
import {
  allOperations,
  allScopes,
  baseInput,
  expectedScopeOperations,
  targetFor,
} from "../management-credential/support.js";

describe("Management API credential 認可の性質", () => {
  test("scope ごとの操作可否が権限マトリクスと一致する", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allScopes),
        fc.constantFrom(...allOperations),
        (scope, operation) => {
          const decision = authorizeManagementCredentialAction({
            ...baseInput,
            credential: {
              ...baseInput.credential,
              scopes: [scope],
            },
            operation,
            target: targetFor(operation),
          });

          expect(decision.allowed).toBe(expectedScopeOperations[scope].includes(operation));
        },
      ),
      { numRuns: 200 },
    );
  });

  test("失効・期限到達したcredentialは許可しない", () => {
    fc.assert(
      fc.property(fc.constantFrom("expired", "revoked"), (kind) => {
        const decision = authorizeManagementCredentialAction({
          ...baseInput,
          ...(kind === "expired"
            ? { now: baseInput.credential.expiresAt }
            : {
                credential: {
                  ...baseInput.credential,
                  revoked: true,
                },
              }),
        });

        expect(decision.allowed).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  test("必須target IDがない操作はtarget-id-requiredで拒否する", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "room.update",
          "room.delete",
          "session.disconnect",
          "participant.disconnect",
        ),
        (operation) => {
          const decision = authorizeManagementCredentialAction({
            ...baseInput,
            operation,
            target: { projectId },
          });

          expect(decision).toMatchObject({
            allowed: false,
            reason: "target-id-required",
          });
        },
      ),
      { numRuns: 20 },
    );
  });

  test("任意の値を受け取っても検証と生入力認可はthrowしない", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof validateManagementCredentialAuthorizationInput(value).ok).toBe("boolean");
        expect(typeof authorizeManagementCredentialFromRaw(value).ok).toBe("boolean");
      }),
      { numRuns: 300 },
    );
  });
});
