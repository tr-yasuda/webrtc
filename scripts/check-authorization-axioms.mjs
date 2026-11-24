import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./authorization-policy.mjs";

const outputPath = process.argv[2];
if (outputPath === undefined) {
  console.error("Lean の公理出力ファイルを指定してください。");
  process.exit(1);
}

const allowedAxioms = new Set(["propext", "Classical.choice", "Quot.sound"]);
const nativeDecideAxiom = /\._native\.native_decide\.ax_\d+_\d+$/u;
const output = fs.readFileSync(outputPath, "utf8");
const lines = output.split(/\r?\n/u);
const unexpected = [];
let axiomResults = 0;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line.includes("does not depend on any axioms")) {
    axiomResults += 1;
    continue;
  }
  const start = line.indexOf("depends on axioms: [");
  if (start === -1) continue;
  axiomResults += 1;
  let body = line.slice(start + "depends on axioms: [".length);
  let closed = body.includes("]");
  while (!closed) {
    index += 1;
    if (index >= lines.length) {
      console.error("公理出力の括弧が閉じていません。");
      process.exit(1);
    }
    if (
      lines[index].includes("depends on axioms:") ||
      lines[index].includes("does not depend on any axioms")
    ) {
      console.error("公理出力の括弧が閉じていません。");
      process.exit(1);
    }
    body += `\n${lines[index]}`;
    closed = lines[index].includes("]");
  }
  body = body.slice(0, body.indexOf("]"));
  for (const axiom of body
    .split(/,\s*/u)
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (!allowedAxioms.has(axiom) && !nativeDecideAxiom.test(axiom)) unexpected.push(axiom);
  }
}

const proofRoot = path.join(repoRoot, "packages/authorization/proofs");

const expectedTheorems = new Set(
  fs
    .readFileSync(path.join(proofRoot, "Authorization/Theorems.lean"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*theorem\s+([^\s(:]+)/u)?.[1])
    .filter(Boolean),
);

const axiomsFile = path.join(proofRoot, "Axioms.lean");
const actualTheorems = new Set(
  fs
    .readFileSync(axiomsFile, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.match(/^#print axioms\s+([^\s]+)/u)?.[1])
    .filter(Boolean),
);

const missing = [...expectedTheorems].filter((name) => !actualTheorems.has(name)).toSorted();
const extra = [...actualTheorems].filter((name) => !expectedTheorems.has(name)).toSorted();

if (unexpected.length > 0) {
  console.error(`許可されていない公理があります:\n${[...new Set(unexpected)].join("\n")}`);
}
if (missing.length > 0) {
  console.error(`公理検査対象に追加されていない定理があります:\n${missing.join("\n")}`);
}
if (extra.length > 0) {
  console.error(`auth_spec 属性を持たない定理が公理検査対象に含まれています:\n${extra.join("\n")}`);
}
if (axiomResults !== actualTheorems.size) {
  console.error(
    `公理検査結果の数が一致しません: results=${axiomResults} expected=${actualTheorems.size}`,
  );
}
if (
  unexpected.length > 0 ||
  missing.length > 0 ||
  extra.length > 0 ||
  axiomResults !== actualTheorems.size
) {
  process.exit(1);
}

console.log(`公理検査を確認しました: ${axiomResults} 定理、許可公理のみ`);
