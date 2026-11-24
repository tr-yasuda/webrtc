import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  generatedLeanPath,
  generatedTypeScriptPath,
  generateLean,
  generateTypeScript,
  loadPolicy,
  repoRoot,
  validatePolicy,
} from "./authorization-policy.mjs";

const check = process.argv.includes("--check");
const policy = loadPolicy();
const errors = validatePolicy(policy);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

function formatTypeScript(content, root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "authorization-policy-"));
  const file = path.join(directory, "policy.ts");
  try {
    fs.writeFileSync(file, content);
    execFileSync("pnpm", ["exec", "oxfmt", "--write", file], {
      cwd: root,
      stdio: "pipe",
    });
    return fs.readFileSync(file, "utf8");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const outputs = [
  {
    path: generatedTypeScriptPath,
    content: formatTypeScript(generateTypeScript(policy), repoRoot),
  },
  { path: generatedLeanPath, content: generateLean(policy) },
];

let failed = false;
for (const output of outputs) {
  const current = fs.existsSync(output.path) ? fs.readFileSync(output.path, "utf8") : "";
  if (current !== output.content) {
    if (check) {
      console.error(
        `生成物が仕様 JSON と一致しません: ${path.relative(process.cwd(), output.path)}`,
      );
      failed = true;
    } else {
      fs.mkdirSync(path.dirname(output.path), { recursive: true });
      fs.writeFileSync(output.path, output.content);
    }
  }
}

if (failed) process.exit(1);
