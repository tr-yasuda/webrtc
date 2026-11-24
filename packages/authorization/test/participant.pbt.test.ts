import { test as pbtTest, fc } from "@fast-check/vitest";
import { describe, expect, test as baseTest } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
} from "../src/participant.js";
import { allParticipantOperations } from "./policy-expectations.js";
import {
  allParticipantBaselineVariants,
  participantBaseline,
  participantBaselineCaseArbitrary,
  participantBaselineVariants,
  participantCaseArbitrary,
  participantExpectedTarget,
  participantMutations,
  participantMultiFaultCaseArbitrary,
  participantSingleFaultCaseArbitrary,
  participantUnknownOperationArbitrary,
  participantValidCaseArbitrary,
  participantViolations,
} from "./pbt/participant-pbt.js";
import { fixedIdPool, pbtParameters, pbtTestTimeout } from "./pbt-support.js";

const baselineCases = allParticipantOperations.flatMap((operation) =>
  participantBaselineVariants(operation).map((variant) => ({ operation, variant })),
);

describe("参加 JWT の Property-based Testing", () => {
  baseTest.each(baselineCases)(
    "基準シナリオ $operation / $variant は許可される",
    ({ operation, variant }) => {
      const input = participantBaseline(operation, variant, fixedIdPool, fixedIdPool.subject);

      expect(participantViolations(input).size).toBe(0);
      expect(authorizeParticipantAction(input)).toStrictEqual({
        allowed: true,
        operation,
        target: participantExpectedTarget(input),
        reason: "allowed",
      });
    },
  );

  baseTest.each(participantMutations)("単一故障 $id は $reason で拒否される", (mutation) => {
    const base = {
      input: participantBaseline(
        mutation.catalog.operation,
        mutation.catalog.variant,
        fixedIdPool,
        fixedIdPool.subject,
      ),
      ids: fixedIdPool,
      operation: mutation.catalog.operation,
      variant: mutation.catalog.variant,
    };
    const next = mutation.apply(base);

    expect(next).toBeDefined();
    const input = next!.input;
    const violations = participantViolations(input);
    expect([...violations]).toStrictEqual([mutation.reason]);
    expect(authorizeParticipantAction(input)).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: participantExpectedTarget(input),
      reason: mutation.reason,
    });
  });

  pbtTest.prop([participantValidCaseArbitrary()], pbtParameters())(
    "基準シナリオは常に許可され、監査対象が一致する",
    (caseValue) => {
      const decision = authorizeParticipantAction(caseValue.input);

      expect(participantViolations(caseValue.input).size).toBe(0);
      expect(decision).toStrictEqual({
        allowed: true,
        operation: caseValue.input.operation,
        target: participantExpectedTarget(caseValue.input),
        reason: "allowed",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([participantSingleFaultCaseArbitrary()], pbtParameters())(
    "単一故障は違反条件に対応する理由で拒否される",
    (caseValue) => {
      const violations = participantViolations(caseValue.input);
      const decision = authorizeParticipantAction(caseValue.input);

      expect(violations.size).toBe(1);
      expect(decision).toStrictEqual({
        allowed: false,
        operation: caseValue.input.operation,
        target: participantExpectedTarget(caseValue.input),
        reason: [...violations][0],
      });
      expect(caseValue.mutations).toHaveLength(1);
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([participantMultiFaultCaseArbitrary()], pbtParameters())(
    "複合故障は違反理由のいずれかで拒否される",
    (caseValue) => {
      const violations = participantViolations(caseValue.input);
      const decision = authorizeParticipantAction(caseValue.input);

      expect(violations.size).toBeGreaterThanOrEqual(2);
      expect(decision.allowed).toBe(false);
      expect(violations.has(decision.reason)).toBe(true);
      expect(caseValue.mutations.length).toBeGreaterThanOrEqual(2);
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([participantCaseArbitrary()], pbtParameters())(
    "許可と拒否は独立オラクルと一致し、許可条件を満たす",
    (caseValue) => {
      const input = caseValue.input;
      const violations = participantViolations(input);
      const decision = authorizeParticipantAction(input);

      expect(decision.operation).toBe(input.operation);
      expect(decision.target).toStrictEqual(participantExpectedTarget(input));
      expect(authorizeParticipantAction(input)).toStrictEqual(decision);
      expect(decision.allowed).toBe(violations.size === 0);
      if (decision.allowed) {
        assertParticipantAllowInvariants(input);
      } else {
        expect(violations.has(decision.reason)).toBe(true);
      }
    },
    pbtTestTimeout(),
  );

  pbtTest.prop(
    [participantBaselineCaseArbitrary(), participantUnknownOperationArbitrary()],
    pbtParameters(),
  )(
    "未知の operation は固定候補でも任意文字列でも拒否される",
    (base, operation) => {
      const input = { ...base.input, operation };
      const decision = authorizeParticipantAction(input);

      expect(decision).toStrictEqual({
        allowed: false,
        operation,
        target: participantExpectedTarget(input),
        reason: "unsupported-operation",
      });
    },
    pbtTestTimeout(),
  );

  pbtTest.prop([participantBaselineCaseArbitrary(), fc.string()], pbtParameters())(
    "任意の subject でも判定は独立オラクルと一致する",
    (base, subject) => {
      const input = {
        ...base.input,
        credential: { ...base.input.credential, subject },
      };
      const violations = participantViolations(input);
      const decision = authorizeParticipantAction(input);

      expect(decision.allowed).toBe(violations.size === 0);
      if (decision.allowed) {
        assertParticipantAllowInvariants(input);
      } else {
        expect(violations.has(decision.reason)).toBe(true);
      }
    },
    pbtTestTimeout(),
  );

  baseTest("生成分布が操作・基準シナリオ・故障種別を網羅する", () => {
    const samples = fc.sample(participantCaseArbitrary(), {
      numRuns: 5_000,
      seed: 42,
    });
    const mutationById = new Map(participantMutations.map((mutation) => [mutation.id, mutation]));

    expect(new Set(samples.map((sample) => sample.operation))).toStrictEqual(
      new Set(allParticipantOperations),
    );
    expect(new Set(samples.map((sample) => sample.variant))).toStrictEqual(
      new Set(allParticipantBaselineVariants),
    );
    expect(
      new Set(
        samples.flatMap((sample) => sample.mutations).map((id) => mutationById.get(id)?.category),
      ),
    ).toStrictEqual(new Set(participantMutations.map((mutation) => mutation.category)));
  });
});

function assertParticipantAllowInvariants(input: ParticipantAuthorizationInput): void {
  expect(input.project.state).toBe("active");
  expect(input.credential.projectId).toBe(input.project.id);
  expect(input.credential.roomName).toBe(input.room.name);
  expect(input.room.projectId).toBe(input.project.id);
  expect(input.credential.subject.length).toBeGreaterThan(0);

  if (input.participant !== undefined && input.room.state !== "absent") {
    expect(input.participant.externalUserId).toBe(input.credential.subject);
    expect(input.participant.state).toBe("active");
    expect(input.participant.roomId).toBe(input.room.id);
  }

  expect(input.credential.grants[input.operation]).toBe(true);

  switch (input.operation) {
    case "room.create":
      expect(input.room.state).toBe("absent");
      expect(input.credential.grants["room.join"]).toBe(true);
      expect(input.session).toBeUndefined();
      expect(input.participant).toBeUndefined();
      return;
    case "room.join":
      if (input.room.state === "absent") {
        expect(input.credential.grants["room.create"]).toBe(true);
        expect(input.session).toBeUndefined();
        expect(input.participant).toBeUndefined();
        return;
      }
      expect(input.room.state).toBe("active");
      if (input.session !== undefined) {
        expect(input.participant).toBeDefined();
      }
      break;
    case "media.publish":
    case "media.subscribe":
    case "data.send":
      expect(input.room.state).toBe("active");
      expect(input.session).toBeDefined();
      break;
  }

  if (input.session !== undefined && input.room.state !== "absent") {
    expect(input.session.state).toBe("active");
    expect(input.session.projectId).toBe(input.project.id);
    expect(input.session.roomId).toBe(input.room.id);
    if (input.participant !== undefined) {
      expect(input.session.participantId).toBe(input.participant.id);
    }
  }
}
