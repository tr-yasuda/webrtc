import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const readmePath = path.join(packageRoot, "README.md");
const outputPath = path.join(packageRoot, "traceability.md");
const writeMode = process.argv.includes("--write");

const sectionReasons = new Map();
const rules = [];

function parseTableRow(line, section) {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length < 3 || !cells[0].startsWith("`")) {
    return;
  }
  const id = cells[0].replaceAll("`", "");
  const reason = cells[2].replaceAll("`", "");
  if (!/^[A-Z]+-[A-Z]+-\d{3}$/.test(id)) {
    return;
  }
  rules.push({ id, reason, section });
  sectionReasons.set(section, [...(sectionReasons.get(section) ?? []), reason]);
}

function parseReadme(markdown) {
  let section = "";
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("### ")) {
      section = line.slice(4).trim();
    }
    if (line.startsWith("|")) {
      parseTableRow(line, section);
    }
  }
}

function testFileFor(rule) {
  const { id } = rule;
  if (id.startsWith("P-INPUT-")) {
    return id === "P-INPUT-002"
      ? "test/participant/input-validation.test.ts"
      : "test/contract/participant-validation.test.ts";
  }
  if (id === "P-PROJ-001" || id.startsWith("P-MD-") || id === "P-ALLOW-001") {
    return "test/participant/media-data.test.ts";
  }
  if (id === "P-TGT-001") {
    return "test/participant/credential-target.test.ts";
  }
  if (id.startsWith("P-SUB-")) {
    return "test/participant/subject.test.ts";
  }
  if (id === "P-GRANT-001") {
    return "test/participant/media-data.test.ts";
  }
  if (id.startsWith("P-RC-")) {
    return "test/participant/room-create.test.ts";
  }
  if (id === "P-RJ-004") {
    return "test/participant/room-join-state.test.ts";
  }
  if (id.startsWith("P-RJ-")) {
    return "test/participant/room-join.test.ts";
  }
  if (id.startsWith("PU-INPUT-")) {
    return id === "PU-INPUT-001"
      ? "test/contract/project-user-validation.test.ts"
      : "test/project-user/input-validation.test.ts";
  }
  if (id === "PU-ROLE-004") {
    return "test/project-user/project-target.test.ts";
  }
  if (id === "PU-ROLE-005" || id === "PU-ROLE-006") {
    return "test/project-user/role-target.test.ts";
  }
  if (id === "PU-OWNER-001") {
    return "test/project-user/owner-management.test.ts";
  }
  if (id === "PU-ID-001") {
    return "test/project-user/target-id.test.ts";
  }
  if (id === "PU-ALLOW-001") {
    return "test/project-user/decision-contract.test.ts";
  }
  if (id.startsWith("PU-")) {
    return "test/project-user/project-target.test.ts";
  }
  if (id.startsWith("MC-INPUT-")) {
    return id === "MC-INPUT-004"
      ? "test/management-credential/input-validation.test.ts"
      : "test/contract/management-credential-validation.test.ts";
  }
  if (id === "MC-ID-001") {
    return "test/management-credential/target-id.test.ts";
  }
  if (id === "MC-ALLOW-001") {
    return "test/management-credential/scope-matrix.test.ts";
  }
  if (id.startsWith("MC-")) {
    return "test/management-credential/credential-state.test.ts";
  }
  if (id.startsWith("DI-")) {
    return "../domain/test/project-owner.test.ts";
  }
  throw new Error(`no test mapping for ${id}`);
}

function specFor(rule) {
  if (rule.id.startsWith("MC-")) {
    return {
      file: "docs/platform/management.md",
      heading: "Management API credential",
    };
  }
  if (rule.id.startsWith("PU-") || rule.id.startsWith("DI-")) {
    return {
      file: "docs/platform/management.md",
      heading: "ProjectUser の権限ロール",
    };
  }
  return {
    file: "docs/auth/credentials.md",
    heading: "顧客アプリサーバーが署名して Browser SDK へ渡すまで",
  };
}

function verificationFor(rule) {
  if (rule.id.startsWith("DI-")) {
    return { kind: "tla", name: "ProjectOwner.tla" };
  }
  if (rule.id.startsWith("P-")) {
    if (rule.reason === "unsupported-grant") {
      return { kind: "lean", name: "validation_rejects_unknown_grant" };
    }
    if (rule.reason === "grant-invalid") {
      return { kind: "lean", name: "validation_rejects_non_boolean_grant" };
    }
    return { kind: "lean", name: "participant_allow_sound" };
  }
  if (rule.id.startsWith("PU-")) {
    return { kind: "lean", name: "project_user_allow_sound" };
  }
  return { kind: "lean", name: "management_credential_allow_sound" };
}

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findFiles(entryPath, predicate);
      }
      return predicate(entryPath) ? [entryPath] : [];
    }),
  );
  return files.flat();
}

async function main() {
  parseReadme(await readFile(readmePath, "utf8"));
  const seenIds = new Set();
  for (const rule of rules) {
    if (seenIds.has(rule.id)) {
      throw new Error(`duplicate rule id: ${rule.id}`);
    }
    seenIds.add(rule.id);
  }

  const ruleFiles = await findFiles(
    path.join(packageRoot, "src"),
    (file) => file.endsWith(".ts") && file.includes(`${path.sep}rules${path.sep}`),
  );
  const ruleReasons = new Set();
  for (const file of ruleFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/reason:\s*"([^"]+)"/g)) {
      ruleReasons.add(match[1]);
    }
  }
  const documentedReasons = new Set(rules.map((rule) => rule.reason));
  for (const reason of ruleReasons) {
    if (!documentedReasons.has(reason)) {
      throw new Error(`rule reason is not documented in README: ${reason}`);
    }
  }

  const leanFiles = await findFiles(path.join(packageRoot, "proofs"), (file) =>
    file.endsWith(".lean"),
  );
  const leanSource = (await Promise.all(leanFiles.map((file) => readFile(file, "utf8")))).join(
    "\n",
  );
  const specCache = new Map();
  const testCache = new Map();

  const rows = [];
  for (const rule of rules) {
    const testFile = testFileFor(rule);
    const testPath = path.resolve(packageRoot, testFile);
    if (!testCache.has(testPath)) {
      testCache.set(testPath, await readFile(testPath, "utf8"));
    }
    const testSource = testCache.get(testPath);
    if (!rule.id.startsWith("DI-") && !testSource.includes(rule.reason)) {
      throw new Error(`${rule.id}: ${testFile} does not contain ${rule.reason}`);
    }
    if (rule.id.startsWith("DI-") && !testSource.includes("last-owner")) {
      throw new Error(`${rule.id}: ${testFile} does not contain last-owner`);
    }

    const spec = specFor(rule);
    const specPath = path.resolve(repoRoot, spec.file);
    if (!specCache.has(specPath)) {
      specCache.set(specPath, await readFile(specPath, "utf8"));
    }
    if (
      !specCache.get(specPath).includes(`## ${spec.heading}`) &&
      !specCache.get(specPath).includes(`### ${spec.heading}`)
    ) {
      throw new Error(`${rule.id}: heading not found in ${spec.file}: ${spec.heading}`);
    }

    const verification = verificationFor(rule);
    if (verification.kind === "lean" && !leanSource.includes(`theorem ${verification.name}`)) {
      throw new Error(`${rule.id}: Lean theorem not found: ${verification.name}`);
    }
    if (verification.kind === "tla") {
      const tlaPath = path.join(repoRoot, "packages/domain/specs/ProjectOwner.tla");
      await readFile(tlaPath, "utf8");
    }

    rows.push({
      id: rule.id,
      spec,
      testFile,
      verification,
    });
  }

  const lines = [
    "# 認可ルール追跡",
    "",
    "この表は `scripts/check-traceability.mjs` が `README.md` のルール表から生成する。手で編集しない。",
    "",
    "| ルールID | 仕様 | テスト | 形式検証 |",
    "|---|---|---|---|",
    ...rows.map((row) => {
      const specLink = `[${path.basename(row.spec.file)}「${row.spec.heading}」](../../${row.spec.file})`;
      const testLink = `[${path.basename(row.testFile)}](${row.testFile})`;
      const verification =
        row.verification.kind === "lean"
          ? `Lean \`${row.verification.name}\``
          : `TLA+ \`${row.verification.name}\``;
      return `| \`${row.id}\` | ${specLink} | ${testLink} | ${verification} |`;
    }),
    "",
  ];
  const output = `${lines.join("\n")}\n`;
  if (writeMode) {
    await writeFile(outputPath, output, "utf8");
    process.stdout.write(`wrote ${path.relative(repoRoot, outputPath)}\n`);
    return;
  }
  const current = await readFile(outputPath, "utf8");
  if (current !== output) {
    process.stderr.write("traceability.md is out of date. Run check:traceability --write.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`traceability passed: ${rows.length} rules\n`);
}

await main();
