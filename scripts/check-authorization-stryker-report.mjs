import fs from "node:fs";
import path from "node:path";
import { loadPolicy, repoRoot } from "./authorization-policy.mjs";

const packageRoot = path.join(repoRoot, "packages/authorization");
const reportPath = path.join(packageRoot, "reports/mutation.json");
const exclusionsPath = path.join(packageRoot, "mutation-exclusions.json");
const policy = loadPolicy();

if (!fs.existsSync(reportPath)) {
  console.error(`Stryker の JSON レポートがありません: ${path.relative(repoRoot, reportPath)}`);
  process.exit(1);
}

const scopesByOperation = new Map();
for (const scope of policy.scopes) {
  for (const operation of scope.operations) {
    const current = scopesByOperation.get(operation) ?? [];
    current.push(scope.id);
    scopesByOperation.set(operation, current);
  }
}
const multiScopeOperations = [...scopesByOperation.entries()].filter(
  ([, scopes]) => scopes.length > 1,
);
if (multiScopeOperations.length > 0) {
  console.error(
    "複数 scope に属する operation が追加されています。some/every の mutation 除外根拠を見直してください:",
  );
  for (const [operation, scopes] of multiScopeOperations) {
    console.error(`- ${operation}: ${scopes.join(", ")}`);
  }
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const exclusions = fs.existsSync(exclusionsPath)
  ? JSON.parse(fs.readFileSync(exclusionsPath, "utf8"))
  : [];
const usedExclusions = new Set();
const remaining = [];
let killed = 0;
let valid = 0;

for (const [file, fileResult] of Object.entries(report.files ?? {})) {
  for (const mutant of fileResult.mutants ?? []) {
    if (!["Killed", "Survived", "NoCoverage", "Timeout"].includes(mutant.status)) continue;
    valid += 1;
    if (mutant.status === "Killed") killed += 1;
    if (!["Survived", "NoCoverage", "Timeout"].includes(mutant.status)) continue;
    const exclusionIndex = exclusions.findIndex(
      (exclusion) =>
        exclusion.file === file &&
        exclusion.line === mutant.location?.start?.line &&
        exclusion.mutatorName === mutant.mutatorName &&
        exclusion.replacement === mutant.replacement,
    );
    if (exclusionIndex === -1) {
      remaining.push({
        file,
        line: mutant.location?.start?.line,
        mutatorName: mutant.mutatorName,
        status: mutant.status,
        replacement: mutant.replacement,
      });
      continue;
    }
    usedExclusions.add(exclusionIndex);
  }
}

const stale = exclusions.filter((_exclusion, index) => !usedExclusions.has(index));
if (remaining.length > 0) {
  console.error("セキュリティ上重要な未処理 mutation が残っています:");
  for (const mutant of remaining) {
    console.error(
      `- ${mutant.file}:${mutant.line} ${mutant.status} ${mutant.mutatorName}: ${mutant.replacement}`,
    );
  }
  process.exit(1);
}
if (stale.length > 0) {
  console.error("使われていない mutation 除外があります:");
  for (const exclusion of stale) {
    console.error(`- ${exclusion.file} ${exclusion.mutatorName}: ${exclusion.replacement}`);
  }
  process.exit(1);
}

const mutationScore = valid === 0 ? 0 : (killed / valid) * 100;
console.log(
  `Stryker mutation を確認しました: ${mutationScore.toFixed(2)} score、未処理の生存 mutation なし、除外 ${usedExclusions.size} 件`,
);
