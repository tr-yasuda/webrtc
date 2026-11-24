import { test as pbtTest, fc } from "@fast-check/vitest";
import { describe, expect, test as baseTest } from "vitest";
import { isProjectUserRole } from "../../src/management-operation.js";
import {
  authorizeProjectUserAction,
  type ProjectUserAuthorizationInput,
  type ProjectUserAuthorizationTarget,
} from "../../src/project-user.js";
import {
  allManagementOperations,
  allProjectUserRoles,
  expectedProjectUserAllowedOperations,
} from "../policy.js";
import { projectUserBaseline, projectUserBaselineCaseArbitrary } from "./project-user/baseline.js";
import {
  projectUserCaseArbitrary,
  projectUserMultiFaultCaseArbitrary,
  projectUserSingleFaultCaseArbitrary,
  projectUserValidCaseArbitrary,
} from "./project-user/cases.js";
import {
  projectUserMutations,
  projectUserUnknownOperationArbitrary,
  projectUserUnknownRoleArbitrary,
} from "./project-user/mutations.js";
import {
  projectUserHasRequiredTargetId,
  projectUserManagesOwner,
  projectUserViolations,
} from "./project-user/oracle.js";
import {
  fixedIdPool,
  idPoolArbitrary,
  type IdPool,
  pbtParameters,
  pbtTestTimeout,
} from "./support.js";

const baselineCases = allManagementOperations.flatMap((operation) =>
  allProjectUserRoles
    .filter((role) => expectedProjectUserAllowedOperations[role].includes(operation))
    .map((role) => ({ operation, role })),
);

const validTargetRoleCases = [
  ...allProjectUserRoles.map((nextRole) => ({
    label: `projectUser.add / owner / ${nextRole}`,
    operation: "projectUser.add" as const,
    role: "owner" as const,
    targetRoles: { nextRole },
  })),
  ...allProjectUserRoles
    .filter((role) => role !== "owner")
    .map((nextRole) => ({
      label: `projectUser.add / admin / ${nextRole}`,
      operation: "projectUser.add" as const,
      role: "admin" as const,
      targetRoles: { nextRole },
    })),
  ...allProjectUserRoles.map((currentRole) => ({
    label: `projectUser.remove / owner / ${currentRole}`,
    operation: "projectUser.remove" as const,
    role: "owner" as const,
    targetRoles: { currentRole },
  })),
  ...allProjectUserRoles
    .filter((role) => role !== "owner")
    .map((currentRole) => ({
      label: `projectUser.remove / admin / ${currentRole}`,
      operation: "projectUser.remove" as const,
      role: "admin" as const,
      targetRoles: { currentRole },
    })),
  ...allProjectUserRoles.flatMap((currentRole) =>
    allProjectUserRoles.map((nextRole) => ({
      label: `projectUser.changeRole / owner / ${currentRole} -> ${nextRole}`,
      operation: "projectUser.changeRole" as const,
      role: "owner" as const,
      targetRoles: { currentRole, nextRole },
    })),
  ),
  ...allProjectUserRoles
    .filter((role) => role !== "owner")
    .flatMap((currentRole) =>
      allProjectUserRoles
        .filter((role) => role !== "owner")
        .map((nextRole) => ({
          label: `projectUser.changeRole / admin / ${currentRole} -> ${nextRole}`,
          operation: "projectUser.changeRole" as const,
          role: "admin" as const,
          targetRoles: { currentRole, nextRole },
        })),
    ),
];

describe("ProjectUser ロールの Property-based Testing", () => {
  baseTest.each(baselineCases)(
    "基準シナリオ $operation / $role は許可される",
    ({ operation, role }) => {
      const input = projectUserBaseline(operation, role, fixedIdPool);

      expect(projectUserViolations(input).size).toBe(0);
      expect(authorizeProjectUserAction(input)).toStrictEqual({
        allowed: true,
        operation,
        target: input.target,
        reason: "allowed",
      });
    },
  );

  baseTest.each(validTargetRoleCases)("$label は許可される", ({ operation, role, targetRoles }) => {
    const input = projectUserBaseline(operation, role, fixedIdPool, targetRoles);

    expect(projectUserViolations(input).size).toBe(0);
    expect(authorizeProjectUserAction(input)).toStrictEqual({
      allowed: true,
      operation,
      target: input.target,
      reason: "allowed",
    });
  });

  baseTest.each(projectUserMutations)("単一故障 $id は $reason で拒否される", (mutation) => {
    const base = {
      input: projectUserBaseline(mutation.catalog.operation, mutation.catalog.role, fixedIdPool),
      ids: fixedIdPool,
      operation: mutation.catalog.operation,
      role: mutation.catalog.role,
    };
    const next = mutation.apply(base);

    expect(next).toBeDefined();
    const input = next!.input;
    const violations = projectUserViolations(input);
    expect([...violations]).toStrictEqual([mutation.reason]);
    expect(authorizeProjectUserAction(input)).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: input.target,
      reason: mutation.reason,
    });
  });

  pbtTest.prop([projectUserValidCaseArbitrary()], pbtParameters())(
    "基準シナリオは常に許可され、監査対象が一致する",
    (caseValue) => {
      const decision = authorizeProjectUserAction(caseValue.input);

      expect(projectUserViolations(caseValue.input).size).toBe(0);
      expect(decision).toStrictEqual({
        allowed: true,
        operation: caseValue.input.operation,
        target: caseValue.input.target,
        reason: "allowed",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([projectUserSingleFaultCaseArbitrary()], pbtParameters())(
    "単一故障は違反条件に対応する理由で拒否される",
    (caseValue) => {
      const violations = projectUserViolations(caseValue.input);
      const decision = authorizeProjectUserAction(caseValue.input);

      expect(violations.size).toBe(1);
      expect(decision).toStrictEqual({
        allowed: false,
        operation: caseValue.input.operation,
        target: caseValue.input.target,
        reason: [...violations][0],
      });
      expect(caseValue.mutations).toHaveLength(1);
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([projectUserMultiFaultCaseArbitrary()], pbtParameters())(
    "複合故障は違反理由のいずれかで拒否される",
    (caseValue) => {
      const violations = projectUserViolations(caseValue.input);
      const decision = authorizeProjectUserAction(caseValue.input);

      expect(violations.size).toBeGreaterThanOrEqual(2);
      expect(decision.allowed).toBe(false);
      expect(violations.has(decision.reason)).toBe(true);
      expect(caseValue.mutations.length).toBeGreaterThanOrEqual(2);
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([projectUserCaseArbitrary()], pbtParameters())(
    "許可と拒否は独立オラクルと一致し、許可条件を満たす",
    (caseValue) => {
      const input = caseValue.input;
      const violations = projectUserViolations(input);
      const decision = authorizeProjectUserAction(input);

      expect(decision.operation).toBe(input.operation);
      expect(decision.target).toStrictEqual(input.target);
      expect(authorizeProjectUserAction(input)).toStrictEqual(decision);
      expect(decision.allowed).toBe(violations.size === 0);
      if (decision.allowed) {
        assertProjectUserAllowInvariants(input);
      } else {
        expect(violations.has(decision.reason)).toBe(true);
      }
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [projectUserBaselineCaseArbitrary(), projectUserUnknownRoleArbitrary()],
    pbtParameters(),
  )(
    "未知の role は固定候補でも任意文字列でも拒否される",
    (base, role) => {
      const input = {
        ...base.input,
        actor: { ...base.input.actor, role },
      };
      const decision = authorizeProjectUserAction(input);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("project-user-role-invalid");
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [projectUserBaselineCaseArbitrary(), projectUserUnknownRoleArbitrary(), fc.boolean()],
    pbtParameters(),
  )(
    "未知の target role は固定候補でも任意文字列でも拒否される",
    (base, role, useNextRole) => {
      const input = {
        ...base.input,
        target: {
          ...base.input.target,
          ...(useNextRole ? { nextRole: role } : { currentRole: role }),
        },
      };
      const decision = authorizeProjectUserAction(input);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("project-user-role-invalid");
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [projectUserBaselineCaseArbitrary(), projectUserUnknownOperationArbitrary()],
    pbtParameters(),
  )(
    "未知の operation は固定候補でも任意文字列でも拒否される",
    (base, operation) => {
      const input = { ...base.input, operation };
      const decision = authorizeProjectUserAction(input);

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: input.target,
        reason: "unsupported-operation",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [
      fc.constantFrom("projectUser.add", "projectUser.remove", "projectUser.changeRole"),
      fc.boolean(),
      idPoolArbitrary(),
    ],
    pbtParameters(),
  )(
    "Admin は Owner を付与・変更・除外できない",
    (operation, ownerIsCurrent, ids) => {
      const target = ownerTarget(operation, ownerIsCurrent, ids);
      const input: ProjectUserAuthorizationInput = {
        actor: { projectId: ids.projectId, role: "admin" },
        project: { id: ids.projectId, state: "active" },
        operation,
        target,
      };

      expect(projectUserViolations(input).has("owner-management-forbidden")).toBe(true);
      expect(authorizeProjectUserAction(input)).toStrictEqual({
        allowed: false,
        operation,
        target,
        reason: "owner-management-forbidden",
      });
    },
    pbtTestTimeout(),
  );

  baseTest("生成分布が操作・ロール・故障種別を網羅する", () => {
    const samples = fc.sample(projectUserCaseArbitrary(), {
      numRuns: 5_000,
      seed: 42,
    });

    expect(new Set(samples.map((sample) => sample.operation))).toStrictEqual(
      new Set(allManagementOperations),
    );
    expect(new Set(samples.map((sample) => sample.role))).toStrictEqual(
      new Set(allProjectUserRoles),
    );
    expect(new Set(samples.flatMap((sample) => sample.mutations))).toStrictEqual(
      new Set(projectUserMutations.map((mutation) => mutation.id)),
    );
  });
});

function assertProjectUserAllowInvariants(input: ProjectUserAuthorizationInput): void {
  expect(input.project.state).toBe("active");
  expect(input.actor.projectId).toBe(input.project.id);
  expect(input.target.projectId).toBe(input.project.id);
  expect(input.actor.role).not.toBeNull();
  const role = input.actor.role;
  if (!isProjectUserRole(role)) {
    throw new Error("許可された判定の actor.role が有効ではありません");
  }
  expect(expectedProjectUserAllowedOperations[role].includes(input.operation)).toBe(true);
  expect(projectUserHasRequiredTargetId(input)).toBe(true);
  if (input.target.currentRole !== undefined) {
    expect(isProjectUserRole(input.target.currentRole)).toBe(true);
  }
  if (input.target.nextRole !== undefined) {
    expect(isProjectUserRole(input.target.nextRole)).toBe(true);
  }
  if (input.operation === "projectUser.add" || input.operation === "projectUser.changeRole") {
    expect(input.target.nextRole).toBeDefined();
  }
  if (input.operation === "projectUser.remove" || input.operation === "projectUser.changeRole") {
    expect(input.target.currentRole).toBeDefined();
  }
  if (input.actor.role === "admin") {
    expect(projectUserManagesOwner(input)).toBe(false);
  }
}

function ownerTarget(
  operation: "projectUser.add" | "projectUser.remove" | "projectUser.changeRole",
  ownerIsCurrent: boolean,
  ids: IdPool,
): ProjectUserAuthorizationTarget {
  switch (operation) {
    case "projectUser.add":
      return {
        projectId: ids.projectId,
        accountId: ids.accountId,
        nextRole: "owner",
      };
    case "projectUser.remove":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: "owner",
      };
    case "projectUser.changeRole":
      return {
        projectId: ids.projectId,
        projectUserId: ids.projectUserId,
        currentRole: ownerIsCurrent ? "owner" : "auditor",
        nextRole: ownerIsCurrent ? "auditor" : "owner",
      };
  }
}
