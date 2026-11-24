import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function command(file, args) {
  return execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function normalized(path) {
  return relative(root, path).split(sep).join("/");
}

function componentPath(registry) {
  const pnpm = JSON.parse(command("pnpm", ["m", "ls", "--depth", "-1", "--json"]))
    .filter((entry) => entry.path !== root)
    .map((entry) => ({ key: `pnpm:${entry.name}`, path: entry.path }));
  const cargo = JSON.parse(
    command("cargo", ["metadata", "--no-deps", "--format-version", "1"]),
  ).packages.map((entry) => ({ key: `cargo:${entry.name}`, path: dirname(entry.manifest_path) }));
  const map = new Map([...pnpm, ...cargo].map((entry) => [entry.key, entry.path]));
  for (const component of registry.components) {
    const key = `${component.kind}:${component.name}`;
    if (!map.has(key)) {
      throw new Error(`workspace component not found: ${key}`);
    }
  }
  return map;
}

function scanText(text, language) {
  const violations = [];
  if (language === "typescript") {
    const consoleUse = /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(text);
    const loggerImport = /from\s+["'](?:pino|winston|bunyan|tslog|tracing)["']/.test(text);
    if (consoleUse) {
      violations.push("console-output");
    }
    if (loggerImport) {
      violations.push("direct-logger-import");
    }
    if (/\brevealSecret\s*\(/.test(text)) {
      violations.push("secret-reveal");
    }
    if ((consoleUse || loggerImport) && /\bJSON\.stringify\s*\(/.test(text)) {
      violations.push("json-stringify-in-log-path");
    }
  } else {
    if (/\b(?:println|eprintln|dbg)!\s*\(/.test(text)) {
      violations.push("direct-print-macro");
    }
    if (/\btracing::(?:info|warn|error|debug|trace)!\s*\(/.test(text)) {
      violations.push("direct-tracing-macro");
    }
    if (/\.reveal\s*\(/.test(text)) {
      violations.push("secret-reveal");
    }
    if (
      /\b(?:println|eprintln|dbg)!\s*\(|\btracing::(?:info|warn|error|debug|trace)!\s*\(/.test(
        text,
      ) &&
      /\bserde_json::to_string(?:_pretty)?\s*\(/.test(text)
    ) {
      violations.push("serde-json-in-log-path");
    }
  }
  return violations;
}

function isAllowed(componentRoot, file, allowedModules) {
  const local = relative(componentRoot, file).split(sep).join("/");
  return allowedModules.includes(local);
}

function selfTest() {
  const tsBad = scanText('console.log(JSON.stringify({ token: "x" }));', "typescript");
  const rustBad = scanText(
    'println!("{}", serde_json::to_string(&value).unwrap()); value.reveal("test");',
    "rust",
  );
  const allowed = isAllowed("/repo/pkg", "/repo/pkg/src/output.ts", ["src/output.ts"]);
  const denied = isAllowed("/repo/pkg", "/repo/pkg/src/app.ts", ["src/output.ts"]);
  if (
    tsBad.includes("console-output") &&
    tsBad.includes("json-stringify-in-log-path") &&
    rustBad.includes("direct-print-macro") &&
    rustBad.includes("serde-json-in-log-path") &&
    rustBad.includes("secret-reveal") &&
    allowed &&
    !denied
  ) {
    console.log("security boundary checker self-test: ok");
    return;
  }
  console.error("security boundary checker self-test: failed");
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const registry = JSON.parse(readFileSync(resolve(root, "specs/security/components.json"), "utf8"));
const paths = componentPath(registry);
const errors = [];

for (const component of registry.components) {
  const key = `${component.kind}:${component.name}`;
  if (component.status === "exempt") {
    continue;
  }
  const componentRoot = paths.get(key);
  if (componentRoot === undefined) {
    errors.push(`${key}: component path not found`);
    continue;
  }
  const sourceRoot = join(componentRoot, "src");
  if (!statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
    continue;
  }
  const allowedOutputModules = component.allowedOutputModules ?? [];
  const allowedSecretModules = component.allowedSecretModules ?? [];
  const language = component.kind === "pnpm" ? "typescript" : "rust";
  const extension = language === "typescript" ? ".ts" : ".rs";
  for (const file of walk(sourceRoot).filter((path) => path.endsWith(extension))) {
    const text = readFileSync(file, "utf8");
    const violations = scanText(text, language);
    for (const violation of violations) {
      const allowed =
        violation === "secret-reveal"
          ? isAllowed(componentRoot, file, allowedSecretModules)
          : isAllowed(componentRoot, file, allowedOutputModules);
      if (!allowed) {
        errors.push(`${normalized(file)}: ${violation}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("security output boundary check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("security output boundaries: ok");
