import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type SpecEntry = {
  readonly description: string;
  readonly theorems: readonly string[];
  readonly tests: readonly { readonly file: string; readonly name: string }[];
  readonly cases: readonly string[];
  readonly scripts?: readonly string[];
};

type SpecMap = {
  readonly specIds: Readonly<Record<string, SpecEntry>>;
};

type LeanManifest = {
  readonly participant: readonly { readonly name: string }[];
  readonly projectUser: readonly { readonly name: string }[];
  readonly credential: readonly { readonly name: string }[];
};

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const specMap = JSON.parse(
  readFileSync(new URL("./spec-map.json", import.meta.url), "utf8"),
) as SpecMap;
const manifest = JSON.parse(
  readFileSync(`${packageRoot}.cache/lean-authorization-cases.json`, "utf8"),
) as LeanManifest;
const axiomOutput = readFileSync(`${packageRoot}.cache/lean-axioms.txt`, "utf8");

const axiomTheorems = new Set(
  [...axiomOutput.matchAll(/'AuthorizationVerification\.([^']+)'/g)].map((match) => match[1]),
);
const caseGroups = new Set([
  ...manifest.participant.map((group) => `participant.${group.name}`),
  ...manifest.projectUser.map((group) => `projectUser.${group.name}`),
  ...manifest.credential.map((group) => `credential.${group.name}`),
]);

describe("仕様 ID と検証成果物の対応", () => {
  test("各仕様 ID に定理・テスト・照合ケースまたはスクリプトが対応する", () => {
    for (const [specId, entry] of Object.entries(specMap.specIds)) {
      expect(entry.description.length, specId).toBeGreaterThan(0);
      expect(entry.theorems.length, specId).toBeGreaterThan(0);
      expect(entry.tests.length + (entry.scripts?.length ?? 0), specId).toBeGreaterThan(0);

      if (
        specId.startsWith("AUTH-PART-") ||
        specId.startsWith("AUTH-PU-") ||
        specId.startsWith("AUTH-MC-")
      ) {
        expect(entry.cases.length, specId).toBeGreaterThan(0);
      }
    }
  });

  test("参照された定理は Lean の公理出力に存在する", () => {
    for (const [specId, entry] of Object.entries(specMap.specIds)) {
      for (const theorem of entry.theorems) {
        expect(axiomTheorems.has(theorem), `${specId} / ${theorem}`).toBe(true);
      }
    }
  });

  test("Lean の全対象定理が仕様 ID に対応する", () => {
    const mapped = new Set(Object.values(specMap.specIds).flatMap((entry) => entry.theorems));

    for (const theorem of axiomTheorems) {
      expect(mapped.has(theorem), theorem).toBe(true);
    }
  });

  test("参照されたテストとスクリプトが存在する", () => {
    for (const [specId, entry] of Object.entries(specMap.specIds)) {
      for (const referencedTest of entry.tests) {
        const source = readFileSync(`${repoRoot}${referencedTest.file}`, "utf8");
        expect(source.includes(referencedTest.name), `${specId} / ${referencedTest.file}`).toBe(
          true,
        );
      }

      for (const script of entry.scripts ?? []) {
        expect(
          () => readFileSync(`${repoRoot}${script}`, "utf8"),
          `${specId} / ${script}`,
        ).not.toThrow();
      }
    }
  });

  test("参照された照合ケースが Lean のケース一覧に存在する", () => {
    for (const [specId, entry] of Object.entries(specMap.specIds)) {
      for (const caseName of entry.cases) {
        expect(caseGroups.has(caseName), `${specId} / ${caseName}`).toBe(true);
      }
    }
  });

  test("Lean の全照合ケースが仕様 ID に対応する", () => {
    const mapped = new Set(Object.values(specMap.specIds).flatMap((entry) => entry.cases));

    for (const caseName of caseGroups) {
      expect(mapped.has(caseName), caseName).toBe(true);
    }
  });
});
