import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "specs/security/contract.json");
const schemaPath = resolve(root, "specs/security/contract.schema.json");
const tsPath = resolve(root, "packages/security/src/generated/contract.ts");
const tsSchemaPath = resolve(root, "packages/security/src/generated/contract-schema.ts");
const rustPath = resolve(root, "crates/security/src/generated.rs");
const check = process.argv.includes("--check");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function json(value) {
  return JSON.stringify(value, null, 2);
}

function quotedArray(values) {
  return values.map((value) => `"${value}"`).join(", ");
}

const ts =
  `// Generated from specs/security/contract.json. Do not edit by hand.\n` +
  `export const SECURITY_CONTRACT = ${json(contract)} as const;\n` +
  `export type SecurityContract = typeof SECURITY_CONTRACT;\n` +
  `export const SECURITY_CONTRACT_VERSION = ${contract.version} as const;\n` +
  `export const TRANSPORT_PROFILE_IDS = [${quotedArray(contract.transportProfiles.map((profile) => profile.id))}] as const;\n` +
  `export const OUTPUT_BOUNDARY_IDS = [${quotedArray(contract.outputBoundaries.map((boundary) => boundary.id))}] as const;\n` +
  `export const AUDIT_EVENT_KINDS = [${quotedArray(contract.audit.eventKinds.map((kind) => kind.id))}] as const;\n` +
  `export const VALIDATION_STAGE_IDS = [${quotedArray(contract.validationStages.map((stage) => stage.id))}] as const;\n`;

const tsSchema =
  `// Generated from specs/security/contract.schema.json. Do not edit by hand.\n` +
  `export const SECURITY_CONTRACT_SCHEMA = ${json(schema)} as const;\n`;

const rust =
  `// Generated from specs/security/contract.json. Do not edit by hand.\n` +
  `#[rustfmt::skip]\n` +
  `pub const SECURITY_CONTRACT_JSON: &str = include_str!("../../../specs/security/contract.json");\n` +
  `#[rustfmt::skip]\n` +
  `pub const SECURITY_CONTRACT_VERSION: u64 = ${contract.version};\n` +
  `#[rustfmt::skip]\n` +
  `pub const TRANSPORT_PROFILE_IDS: &[&str] = &[${quotedArray(contract.transportProfiles.map((profile) => profile.id))}];\n` +
  `#[rustfmt::skip]\n` +
  `pub const OUTPUT_BOUNDARY_IDS: &[&str] = &[${quotedArray(contract.outputBoundaries.map((boundary) => boundary.id))}];\n` +
  `#[rustfmt::skip]\n` +
  `pub const AUDIT_EVENT_KINDS: &[&str] = &[${quotedArray(contract.audit.eventKinds.map((kind) => kind.id))}];\n` +
  `#[rustfmt::skip]\n` +
  `pub const VALIDATION_STAGE_IDS: &[&str] = &[${quotedArray(contract.validationStages.map((stage) => stage.id))}];\n`;

const files = [
  [tsPath, ts],
  [tsSchemaPath, tsSchema],
  [rustPath, rust],
];

let failed = false;
for (const [path, content] of files) {
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(`out of date: ${path}`);
      failed = true;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

if (failed) {
  process.exit(1);
}
