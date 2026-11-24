import { test as pbtTest, fc } from "@fast-check/vitest";
import { describe, expect, test as baseTest } from "vitest";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialAuthorizationInput,
  type ManagementCredentialScope,
} from "../../src/management-credential.js";
import {
  allCredentialOperations,
  allManagementCredentialScopes,
  credentialRequiredScopesByOperation,
} from "../policy.js";
import {
  managementCredentialBaseline,
  managementCredentialBaselineCaseArbitrary,
} from "./management-credential/baseline.js";
import {
  managementCredentialCaseArbitrary,
  managementCredentialMultiFaultCaseArbitrary,
  managementCredentialSingleFaultCaseArbitrary,
  managementCredentialValidCaseArbitrary,
} from "./management-credential/cases.js";
import {
  managementCredentialMutations,
  managementCredentialUnknownOperationArbitrary,
  managementCredentialUnknownScopeArbitrary,
} from "./management-credential/mutations.js";
import {
  managementCredentialHasRequiredTargetId,
  managementCredentialProjectUserOnlyOperations,
  managementCredentialScopeAllows,
  managementCredentialViolations,
} from "./management-credential/oracle.js";
import { fixedIdPool, idPoolArbitrary, pbtParameters, pbtTestTimeout } from "./support.js";

const baselineCases = allCredentialOperations.flatMap((operation) =>
  (credentialRequiredScopesByOperation[operation] ?? []).map((scope) => ({ operation, scope })),
);

describe("Management API credential の Property-based Testing", () => {
  baseTest.each(baselineCases)(
    "基準シナリオ $operation / $scope は許可される",
    ({ operation, scope }) => {
      const input = managementCredentialBaseline(operation, scope, fixedIdPool);

      expect(managementCredentialViolations(input).size).toBe(0);
      expect(authorizeManagementCredentialAction(input)).toStrictEqual({
        allowed: true,
        operation,
        target: input.target,
        reason: "allowed",
      });
    },
  );

  baseTest("期限直前の now は許可される", () => {
    const input = managementCredentialBaseline("room.read", "room.manage", fixedIdPool, {
      now: 1_999,
      expiresAt: 2_000,
    });

    expect(managementCredentialViolations(input).size).toBe(0);
    expect(authorizeManagementCredentialAction(input)).toStrictEqual({
      allowed: true,
      operation: "room.read",
      target: input.target,
      reason: "allowed",
    });
  });

  baseTest.each(managementCredentialMutations)(
    "単一故障 $id は $reason で拒否される",
    (mutation) => {
      const base = {
        input: managementCredentialBaseline(
          mutation.catalog.operation,
          mutation.catalog.scope,
          fixedIdPool,
        ),
        ids: fixedIdPool,
        operation: mutation.catalog.operation,
        scope: mutation.catalog.scope,
      };
      const next = mutation.apply(base);

      expect(next).toBeDefined();
      const input = next!.input;
      const violations = managementCredentialViolations(input);
      expect([...violations]).toStrictEqual([mutation.reason]);
      expect(authorizeManagementCredentialAction(input)).toStrictEqual({
        allowed: false,
        operation: input.operation,
        target: input.target,
        reason: mutation.reason,
      });
    },
  );

  pbtTest.prop([managementCredentialValidCaseArbitrary()], pbtParameters())(
    "基準シナリオは常に許可され、監査対象が一致する",
    (caseValue) => {
      const decision = authorizeManagementCredentialAction(caseValue.input);

      expect(managementCredentialViolations(caseValue.input).size).toBe(0);
      expect(decision).toStrictEqual({
        allowed: true,
        operation: caseValue.input.operation,
        target: caseValue.input.target,
        reason: "allowed",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([managementCredentialSingleFaultCaseArbitrary()], pbtParameters())(
    "単一故障は違反条件に対応する理由で拒否される",
    (caseValue) => {
      const violations = managementCredentialViolations(caseValue.input);
      const decision = authorizeManagementCredentialAction(caseValue.input);

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

  pbtTest.prop([managementCredentialMultiFaultCaseArbitrary()], pbtParameters())(
    "複合故障は違反理由のいずれかで拒否される",
    (caseValue) => {
      const violations = managementCredentialViolations(caseValue.input);
      const decision = authorizeManagementCredentialAction(caseValue.input);

      expect(violations.size).toBeGreaterThanOrEqual(2);
      expect(decision.allowed).toBe(false);
      expect(violations.has(decision.reason)).toBe(true);
      expect(caseValue.mutations.length).toBeGreaterThanOrEqual(2);
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([managementCredentialCaseArbitrary()], pbtParameters())(
    "許可と拒否は独立オラクルと一致し、許可条件を満たす",
    (caseValue) => {
      const input = caseValue.input;
      const violations = managementCredentialViolations(input);
      const decision = authorizeManagementCredentialAction(input);

      expect(decision.operation).toBe(input.operation);
      expect(decision.target).toStrictEqual(input.target);
      expect(authorizeManagementCredentialAction(input)).toStrictEqual(decision);
      expect(decision.allowed).toBe(violations.size === 0);
      if (decision.allowed) {
        assertManagementCredentialAllowInvariants(input);
      } else {
        expect(violations.has(decision.reason)).toBe(true);
      }
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [managementCredentialBaselineCaseArbitrary(), managementCredentialUnknownOperationArbitrary()],
    pbtParameters(),
  )(
    "未知の operation は固定候補でも任意文字列でも拒否される",
    (base, operation) => {
      const input = { ...base.input, operation };
      const decision = authorizeManagementCredentialAction(input);

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
    [managementCredentialBaselineCaseArbitrary(), managementCredentialUnknownScopeArbitrary()],
    pbtParameters(),
  )(
    "未知の scope は固定候補でも任意文字列でも拒否される",
    (base, scope) => {
      const input = {
        ...base.input,
        credential: {
          ...base.input.credential,
          scopes: [...base.input.credential.scopes, scope],
        },
      };
      const decision = authorizeManagementCredentialAction(input);

      expect(decision).toStrictEqual({
        allowed: false,
        operation: base.input.operation,
        target: input.target,
        reason: "credential-input-invalid",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [
      managementCredentialBaselineCaseArbitrary(),
      fc.constantFrom(...managementCredentialProjectUserOnlyOperations),
    ],
    pbtParameters(),
  )(
    "Management API credential は ProjectUser 専用操作を許可しない",
    (base, operation) => {
      const input = { ...base.input, operation };
      const decision = authorizeManagementCredentialAction(input);

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: input.target,
        reason: "credential-operation-not-allowed",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [
      fc.constantFrom(...allCredentialOperations),
      fc.constantFrom(...allManagementCredentialScopes),
      idPoolArbitrary(),
    ],
    pbtParameters(),
  )(
    "credential の許可は明示 scope だけで決まる",
    (operation, scope, ids) => {
      const input = managementCredentialBaseline(operation, scope, ids);
      const decision = authorizeManagementCredentialAction(input);

      if (managementCredentialScopeAllows(operation, scope)) {
        expect(decision.allowed).toBe(true);
      } else {
        expect(decision).toStrictEqual({
          allowed: false,
          operation,
          target: input.target,
          reason: "credential-scope-missing",
        });
      }
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [managementCredentialBaselineCaseArbitrary(), fc.subarray([...allManagementCredentialScopes])],
    pbtParameters(),
  )(
    "必要 scope に追加 scope を加えても許可される",
    (base, extraScopes) => {
      const input = {
        ...base.input,
        credential: {
          ...base.input.credential,
          scopes: [...new Set([base.scope, ...extraScopes])],
        },
      };

      expect(authorizeManagementCredentialAction(input).allowed).toBe(true);
    },
    pbtTestTimeout(),
  );

  baseTest("生成分布が操作・scope・故障種別を網羅する", () => {
    const samples = fc.sample(managementCredentialCaseArbitrary(), {
      numRuns: 5_000,
      seed: 42,
    });

    expect(new Set(samples.map((sample) => sample.operation))).toStrictEqual(
      new Set(allCredentialOperations),
    );
    expect(new Set(samples.map((sample) => sample.scope))).toStrictEqual(
      new Set(allManagementCredentialScopes),
    );
    expect(new Set(samples.flatMap((sample) => sample.mutations))).toStrictEqual(
      new Set(managementCredentialMutations.map((mutation) => mutation.id)),
    );
  });
});

function assertManagementCredentialAllowInvariants(
  input: ManagementCredentialAuthorizationInput,
): void {
  expect(input.credential.projectId).toBe(input.project.id);
  expect(input.target.projectId).toBe(input.project.id);
  expect(input.credential.revoked).toBe(false);
  expect(Number.isFinite(input.credential.expiresAt)).toBe(true);
  expect(Number.isFinite(input.now)).toBe(true);
  expect(input.now).toBeLessThan(input.credential.expiresAt);
  expect(input.project.state).toBe("active");
  expect(Array.isArray(input.credential.scopes)).toBe(true);
  for (const scope of input.credential.scopes) {
    expect(allManagementCredentialScopes).toContain(scope as ManagementCredentialScope);
  }
  const requiredScopes = credentialRequiredScopesByOperation[input.operation];
  expect(requiredScopes).toBeDefined();
  expect(requiredScopes?.some((scope) => input.credential.scopes.includes(scope))).toBe(true);
  expect(managementCredentialHasRequiredTargetId(input)).toBe(true);
}
