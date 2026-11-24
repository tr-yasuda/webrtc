import { fc } from "@fast-check/vitest";
import type {
  ParticipantAuthorizationInput,
  ParticipantOperation,
} from "../../../src/participant.js";
import { participantBaselineCaseArbitrary, type ParticipantBaselineVariant } from "./baseline.js";
import { participantAuthorizationMutations } from "./mutations.js";
import { participantViolations } from "./oracle.js";

export type ParticipantCase = {
  readonly input: ParticipantAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ParticipantOperation;
  readonly variant: ParticipantBaselineVariant;
};

export function participantValidCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    variant: base.variant,
  }));
}

export function participantSingleFaultCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantCaseWithMutationsArbitrary(1, 1);
}

export function participantMultiFaultCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantCaseWithMutationsArbitrary(2, 4);
}

export function participantCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return fc.oneof(
    { arbitrary: participantValidCaseArbitrary(), weight: 1 },
    { arbitrary: participantSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: participantMultiFaultCaseArbitrary(), weight: 2 },
  );
}

function participantCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ParticipantCase> {
  return participantBaselineCaseArbitrary().chain((base) => {
    const applicable = participantAuthorizationMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = participantViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ParticipantCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        variant: base.variant,
      };
      return fc.constant(emptyCase).filter(() => false);
    }
    const categoryById = new Map(applicable.map((candidate) => [candidate.id, candidate.category]));
    return fc
      .uniqueArray(fc.constantFrom(...applicable.map((candidate) => candidate.id)), {
        minLength: minMutations,
        maxLength: Math.min(maxMutations, categories.length),
        selector: (id) => categoryById.get(id),
      })
      .map((selectedIds) => {
        let current = base;
        const applied: string[] = [];
        for (const id of selectedIds) {
          const candidate = applicable.find((entry) => entry.id === id);
          const next = candidate?.apply(current);
          if (candidate !== undefined && next !== undefined) {
            current = next;
            applied.push(candidate.id);
          }
        }
        if (applied.length < minMutations) {
          return undefined;
        }
        return {
          input: current.input,
          mutations: applied,
          operation: current.operation,
          variant: current.variant,
        };
      })
      .filter(
        (value): value is ParticipantCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          participantViolations(value.input).size >= minMutations,
      );
  });
}
