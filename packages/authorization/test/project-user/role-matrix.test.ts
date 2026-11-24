import { describe, expect, test } from "vitest";
import { authSpecName } from "../auth-spec.js";
import { authorizeProjectUserAction } from "../../src/project-user.js";
import { type ProjectUserRole } from "../../src/management-operation.js";
import { projectId } from "../fixtures.js";
import { allOperations, expectedAllowedOperations, targetFor } from "./support.js";

describe("ProjectUser ロールの認可", () => {
  test(authSpecName("AUTH-PU-01", "Owner は Project を削除できる"), () => {
    const decision = authorizeProjectUserAction({
      actor: {
        projectId,
        role: "owner",
      },
      project: {
        id: projectId,
        state: "active",
      },
      operation: "project.delete",
      target: {
        projectId,
      },
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation: "project.delete",
      reason: "allowed",
      target: {
        projectId,
      },
    });
  });

  test.each(Object.keys(expectedAllowedOperations) as ProjectUserRole[])(
    authSpecName("AUTH-PU-02", "%s ロールの操作可否が権限マトリクスと一致する"),
    (role) => {
      for (const operation of allOperations) {
        const decision = authorizeProjectUserAction({
          actor: {
            projectId,
            role,
          },
          project: {
            id: projectId,
            state: "active",
          },
          operation,
          target: targetFor(operation),
        });

        expect(decision.allowed, `${role} / ${operation}`).toBe(
          expectedAllowedOperations[role].includes(operation),
        );
      }
    },
  );
});
