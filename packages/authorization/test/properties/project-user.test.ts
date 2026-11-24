import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  authorizeProjectUserAction,
  authorizeProjectUserFromRaw,
  validateProjectUserAuthorizationInput,
} from "../../src/project-user.js";
import { managementOperations, projectUserRoles } from "../../src/contracts/identifiers.js";
import { accountId, projectId, projectUserId } from "../fixtures.js";
import { expectedAllowedOperations, targetFor } from "../project-user/support.js";

describe("ProjectUser 認可の性質", () => {
  test("ロールに許可されていない operation は拒否する", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...projectUserRoles),
        fc.constantFrom(...managementOperations),
        (role, operation) => {
          const decision = authorizeProjectUserAction({
            actor: { projectId, role },
            project: { id: projectId, state: "active" },
            operation,
            target: targetFor(operation),
          });

          if (!expectedAllowedOperations[role].includes(operation)) {
            expect(decision.allowed).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test("Admin は Owner を付与・除外・降格できない", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          {
            operation: "projectUser.add" as const,
            target: { projectId, accountId, nextRole: "owner" as const },
          },
          {
            operation: "projectUser.remove" as const,
            target: { projectId, projectUserId, currentRole: "owner" as const },
          },
          {
            operation: "projectUser.changeRole" as const,
            target: {
              projectId,
              projectUserId,
              currentRole: "owner" as const,
              nextRole: "admin" as const,
            },
          },
        ),
        ({ operation, target }) => {
          const decision = authorizeProjectUserAction({
            actor: { projectId, role: "admin" },
            project: { id: projectId, state: "active" },
            operation,
            target,
          });

          expect(decision).toMatchObject({
            allowed: false,
            reason: "owner-management-forbidden",
          });
        },
      ),
      { numRuns: 30 },
    );
  });

  test("必須target IDがない操作はtarget-id-requiredで拒否する", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "projectUser.add",
          "projectUser.remove",
          "projectUser.changeRole",
          "room.update",
          "room.delete",
          "session.disconnect",
          "participant.disconnect",
        ),
        (operation) => {
          const decision = authorizeProjectUserAction({
            actor: { projectId, role: "owner" },
            project: { id: projectId, state: "active" },
            operation,
            target: { projectId },
          });

          expect(decision).toMatchObject({
            allowed: false,
            reason: "target-id-required",
          });
        },
      ),
      { numRuns: 30 },
    );
  });

  test("任意の値を受け取っても検証と生入力認可はthrowしない", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof validateProjectUserAuthorizationInput(value).ok).toBe("boolean");
        expect(typeof authorizeProjectUserFromRaw(value).ok).toBe("boolean");
      }),
      { numRuns: 300 },
    );
  });
});
