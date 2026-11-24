import { execFileSync } from "node:child_process";
import { policyPath, semanticDiff } from "./authorization-policy.mjs";
import fs from "node:fs";
import path from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const baseRef = argument("--base-ref", "origin/main");
const policyRelativePath = path.relative(process.cwd(), policyPath);
const head = JSON.parse(fs.readFileSync(policyPath, "utf8"));
let base;
try {
  const baseText = execFileSync("git", ["show", `${baseRef}:${policyRelativePath}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = JSON.parse(baseText);
} catch {
  console.log(`基準ブランチ ${baseRef} に認可ポリシーがないため、新規追加として扱います。`);
  console.log(`- role: ${head.roles.join(", ")}`);
  console.log(`- operation: ${head.operations.length} 件`);
  console.log(`- scope: ${head.scopes.length} 件`);
  console.log(`- grant: ${head.grants.length} 件`);
  console.log(`- 仕様 ID: ${head.specRules.map((rule) => rule.id).join(", ")}`);
  process.exit(0);
}
const changes = semanticDiff(base, head);

if (changes.length === 0) {
  console.log("認可ポリシーの意味的な差分はありません。");
} else {
  for (const change of changes) console.log(`- ${change}`);
}
