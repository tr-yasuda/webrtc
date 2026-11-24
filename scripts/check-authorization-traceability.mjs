import fs from "node:fs";
import path from "node:path";
import { loadPolicy, repoRoot, validatePolicy } from "./authorization-policy.mjs";

const packageRoot = path.join(repoRoot, "packages/authorization");
const proofsRoot = path.join(packageRoot, "proofs");
const cacheRoot = path.join(packageRoot, ".cache");
const vitestReportPath = path.join(cacheRoot, "vitest-authorization.json");
const mutationReportPath = path.join(cacheRoot, "authorization-policy-mutations.json");
const conformanceManifestPath = path.join(cacheRoot, "authorization-conformance.json");
const conformanceScriptPath = path.join(packageRoot, "scripts/run-authorization-conformance.mjs");

const policy = loadPolicy();
const errors = validatePolicy(policy);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const knownSpecIds = new Set(policy.specRules.map((rule) => rule.id));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function extractSpecIds(text) {
  return [...text.matchAll(/AUTH-[A-Z]+(?:-[A-Z0-9]+)+/g)].map((match) => match[0]);
}

function collectLeanProofs() {
  const findings = [];
  for (const leanFile of walk(proofsRoot).filter((file) => file.endsWith(".lean"))) {
    const lines = fs.readFileSync(leanFile, "utf8").split(/\r?\n/u);
    let pending = [];
    for (const line of lines) {
      const attribute = line.match(/@\[([^\]]*)\]/u);
      if (attribute !== null) {
        pending = [...attribute[1].matchAll(/auth_spec\s+"([^"]+)"/gu)].map((match) => match[1]);
        continue;
      }
      const theorem = line.match(/^\s*(?:private\s+|protected\s+)?theorem\s+([^\s(:]+)/u);
      if (theorem !== null && pending.length > 0) {
        findings.push({
          file: path.relative(repoRoot, leanFile),
          theorem: theorem[1],
          specIds: pending,
        });
        pending = [];
        continue;
      }
      if (line.trim() !== "" && !line.trim().startsWith("--")) pending = [];
    }
  }
  return findings;
}

function collectVitestTests() {
  if (!fs.existsSync(vitestReportPath)) {
    throw new Error(
      `Vitest の JSON レポートがありません: ${path.relative(repoRoot, vitestReportPath)}`,
    );
  }
  const report = JSON.parse(fs.readFileSync(vitestReportPath, "utf8"));
  const tests = [];
  for (const fileResult of report.testResults ?? []) {
    for (const assertion of fileResult.assertionResults ?? []) {
      const name = assertion.fullName ?? assertion.title ?? "";
      const specIds = extractSpecIds(name);
      if (specIds.length === 0) continue;
      const file = path.relative(repoRoot, fileResult.name ?? "");
      tests.push({
        file,
        name,
        status: assertion.status,
        method: file.split(path.sep).includes("pbt") ? "property_test" : "typescript_test",
        specIds,
      });
    }
  }
  return tests;
}

function collectMutationResults() {
  if (!fs.existsSync(mutationReportPath)) return [];
  const report = JSON.parse(fs.readFileSync(mutationReportPath, "utf8"));
  return report.results ?? [];
}

function collectConformanceManifest() {
  if (!fs.existsSync(conformanceManifestPath)) return null;
  return JSON.parse(fs.readFileSync(conformanceManifestPath, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

const leanFindings = collectLeanProofs();
const vitestTests = collectVitestTests();
const mutationResults = collectMutationResults();
const conformanceManifest = collectConformanceManifest();

for (const finding of leanFindings) {
  for (const id of finding.specIds) {
    if (!knownSpecIds.has(id)) {
      errors.push(`Lean 定理が未知の仕様 ID を参照しています: ${finding.theorem} / ${id}`);
    }
  }
}
for (const test of vitestTests) {
  for (const id of test.specIds) {
    if (!knownSpecIds.has(id)) {
      errors.push(`Vitest が未知の仕様 ID を参照しています: ${test.name} / ${id}`);
    }
  }
}
for (const result of mutationResults) {
  if (!knownSpecIds.has(result.specId)) {
    errors.push(`Mutation 結果が未知の仕様 ID を参照しています: ${result.specId}`);
  }
}

const forbiddenManualMappings = [
  path.join(packageRoot, "test/spec-map.json"),
  path.join(packageRoot, "test/spec-map.test.ts"),
];
for (const file of forbiddenManualMappings) {
  if (fs.existsSync(file)) {
    errors.push(`手動の対応表が残っています: ${path.relative(repoRoot, file)}`);
  }
}

function leanTheoremsFor(id) {
  return leanFindings.filter((finding) => finding.specIds.includes(id));
}

function vitestTestsFor(id) {
  return vitestTests.filter((test) => test.specIds.includes(id));
}

function mutationResultsFor(id) {
  return mutationResults.filter((result) => result.specId === id);
}

const matrix = [];
for (const rule of policy.specRules) {
  const allTests = vitestTestsFor(rule.id);
  const passedTests = allTests.filter((test) => test.status === "passed");
  const coverage = {
    lean_theorem: leanTheoremsFor(rule.id),
    vitest_test: passedTests,
    typescript_test: passedTests.filter((test) => test.method === "typescript_test"),
    property_test: passedTests.filter((test) => test.method === "property_test"),
    mutation: mutationResultsFor(rule.id),
  };
  for (const method of rule.verification) {
    if (method === "lean_proof" && coverage.lean_theorem.length === 0) {
      errors.push(`lean_proof の定理がありません: ${rule.id}`);
    }
    if (method === "typescript_test" && coverage.typescript_test.length === 0) {
      errors.push(`${method} のテストがありません: ${rule.id}`);
    }
    if (method === "property_test" && coverage.property_test.length === 0) {
      errors.push(`${method} のテストがありません: ${rule.id}`);
    }
    if (method === "conformance") {
      if (!fs.existsSync(conformanceScriptPath)) {
        errors.push(`conformance スクリプトがありません: ${rule.id}`);
      }
      if (conformanceManifest === null) {
        errors.push(`conformance manifest がありません: ${rule.id}`);
      } else {
        for (const group of rule.cases ?? []) {
          const result = conformanceManifest.groups?.[group];
          if (result === undefined || result.cases === 0) {
            errors.push(`conformance manifest に caseGroup がありません: ${rule.id} / ${group}`);
            continue;
          }
          if (!result.specIds.includes(rule.id)) {
            errors.push(`conformance manifest の specId が一致しません: ${rule.id} / ${group}`);
          }
        }
      }
    }
    if (method === "mutation") {
      if (coverage.mutation.length === 0) {
        errors.push(`mutation の結果がありません: ${rule.id}`);
      }
      for (const result of coverage.mutation) {
        if (result.detected !== true) {
          errors.push(`mutation が検出されていません: ${rule.id} / ${result.mutation}`);
        }
      }
    }
  }
  matrix.push({
    id: rule.id,
    statement: rule.statement,
    verification: rule.verification,
    leanTheorems: unique(coverage.lean_theorem.map((finding) => finding.theorem)).toSorted(),
    vitestTests: unique(coverage.vitest_test.map((test) => test.name)).toSorted(),
    typescriptTests: unique(coverage.typescript_test.map((test) => test.name)).toSorted(),
    propertyTests: unique(coverage.property_test.map((test) => test.name)).toSorted(),
    caseGroups: (rule.cases ?? []).toSorted(),
    mutations: coverage.mutation,
  });
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

fs.mkdirSync(cacheRoot, { recursive: true });
fs.writeFileSync(
  path.join(cacheRoot, "authorization-traceability.json"),
  `${JSON.stringify({ schemaVersion: policy.schemaVersion, matrix }, null, 2)}\n`,
);

const markdown = [
  "# 認可仕様 Traceability",
  "",
  "CI が仕様 JSON、Lean 定理属性、Vitest レポート、conformance スクリプト、mutation 結果から生成する。手動で編集しない。",
  "",
  "| 仕様 ID | 検証手法 | Lean 定理 | Vitest | 有限ケース | Mutation |",
  "|---|---|---|---|---|---|",
  ...matrix.map(
    (row) =>
      `| ${row.id} | ${row.verification.join(", ")} | ${row.leanTheorems.join("<br>")} | ${row.vitestTests.length} | ${row.caseGroups.join("<br>")} | ${row.mutations.length} |`,
  ),
  "",
];
fs.writeFileSync(path.join(cacheRoot, "authorization-traceability.md"), markdown.join("\n"));
console.log(
  `認可仕様 Traceability を生成しました: ${matrix.length} 仕様、${leanFindings.length} 定理、${vitestTests.filter((test) => test.status === "passed").length} テスト`,
);
