import { fc } from "@fast-check/vitest";
import type { ManagementOperation, ProjectUserRole } from "../../../src/management-operation.js";
import type { ProjectUserAuthorizationInput } from "../../../src/project-user.js";
import { projectUserBaselineCaseArbitrary } from "./baseline.js";
import { projectUserAuthorizationMutations } from "./mutations.js";
import { projectUserViolations } from "./oracle.js";

export type ProjectUserCase = {
  readonly input: ProjectUserAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ManagementOperation;
  readonly role: ProjectUserRole;
};

export function projectUserValidCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    role: base.role,
  }));
}

export function projectUserSingleFaultCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserCaseWithMutationsArbitrary(1, 1);
}

export function projectUserMultiFaultCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return projectUserCaseWithMutationsArbitrary(2, 4);
}

export function projectUserCaseArbitrary(): fc.Arbitrary<ProjectUserCase> {
  return fc.oneof(
    { arbitrary: projectUserValidCaseArbitrary(), weight: 1 },
    { arbitrary: projectUserSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: projectUserMultiFaultCaseArbitrary(), weight: 2 },
  );
}

function projectUserCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ProjectUserCase> {
  return projectUserBaselineCaseArbitrary().chain((base) => {
    const applicable = projectUserAuthorizationMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = projectUserViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ProjectUserCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        role: base.role,
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
          role: current.role,
        };
      })
      .filter(
        (value): value is ProjectUserCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          projectUserViolations(value.input).size >= minMutations,
      );
  });
}
