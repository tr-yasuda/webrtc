import { fc } from "@fast-check/vitest";
import type {
  ManagementCredentialAuthorizationInput,
  ManagementCredentialScope,
} from "../../../src/management-credential.js";
import type { ManagementOperation } from "../../../src/management-operation.js";
import { managementCredentialBaselineCaseArbitrary } from "./baseline.js";
import { managementCredentialMutations } from "./mutations.js";
import { managementCredentialViolations } from "./oracle.js";

export type ManagementCredentialCase = {
  readonly input: ManagementCredentialAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ManagementOperation;
  readonly scope: ManagementCredentialScope;
};

export function managementCredentialValidCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    scope: base.scope,
  }));
}

export function managementCredentialSingleFaultCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialCaseWithMutationsArbitrary(1, 1);
}

export function managementCredentialMultiFaultCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialCaseWithMutationsArbitrary(2, 4);
}

export function managementCredentialCaseArbitrary(): fc.Arbitrary<ManagementCredentialCase> {
  return fc.oneof(
    { arbitrary: managementCredentialValidCaseArbitrary(), weight: 1 },
    { arbitrary: managementCredentialSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: managementCredentialMultiFaultCaseArbitrary(), weight: 2 },
  );
}

function managementCredentialCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ManagementCredentialCase> {
  return managementCredentialBaselineCaseArbitrary().chain((base) => {
    const applicable = managementCredentialMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = managementCredentialViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ManagementCredentialCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        scope: base.scope,
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
          scope: current.scope,
        };
      })
      .filter(
        (value): value is ManagementCredentialCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          managementCredentialViolations(value.input).size >= minMutations,
      );
  });
}
