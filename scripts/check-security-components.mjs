import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function command(file, args) {
  return execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

const registry = JSON.parse(readFileSync(resolve(root, "specs/security/components.json"), "utf8"));
const contract = JSON.parse(readFileSync(resolve(root, "specs/security/contract.json"), "utf8"));

const pnpmComponents = JSON.parse(command("pnpm", ["m", "ls", "--depth", "-1", "--json"]))
  .filter((entry) => entry.path !== root)
  .map((entry) => ({ name: entry.name, kind: "pnpm", path: entry.path }));

const cargoPackages = JSON.parse(
  command("cargo", ["metadata", "--no-deps", "--format-version", "1"]),
).packages.map((entry) => ({
  name: entry.name,
  kind: "cargo",
  path: dirname(entry.manifest_path),
}));

const actual = new Map(
  [...pnpmComponents, ...cargoPackages].map((entry) => [`${entry.kind}:${entry.name}`, entry]),
);
const registered = new Map(
  registry.components.map((entry) => [`${entry.kind}:${entry.name}`, entry]),
);

const errors = [];
for (const [key, component] of actual) {
  if (!registered.has(key)) {
    errors.push(`missing registry entry: ${key} (${component.path})`);
  }
}
for (const [key] of registered) {
  if (!actual.has(key)) {
    errors.push(`registry entry has no workspace component: ${key}`);
  }
}

const exemptionIds = new Set(registry.exemptions.map((entry) => entry.id));
const referencedExemptions = new Set();
const today = new Date().toISOString().slice(0, 10);
const profileIds = new Set(contract.transportProfiles.map((entry) => entry.id));
const boundaryIds = new Set(contract.outputBoundaries.map((entry) => entry.id));
const stageIds = new Set(contract.validationStages.map((entry) => entry.id));

for (const component of registry.components) {
  const key = `${component.kind}:${component.name}`;
  if (component.status === "exempt") {
    if (typeof component.exemptionId !== "string" || !exemptionIds.has(component.exemptionId)) {
      errors.push(`${key}: invalid exemptionId`);
    } else {
      referencedExemptions.add(component.exemptionId);
    }
  }
  for (const profile of component.profiles ?? []) {
    if (!profileIds.has(profile)) {
      errors.push(`${key}: unknown profile ${profile}`);
    }
  }
  for (const boundary of component.outputBoundaries ?? []) {
    if (!boundaryIds.has(boundary)) {
      errors.push(`${key}: unknown output boundary ${boundary}`);
    }
  }
  for (const stage of component.validationStages ?? []) {
    if (!stageIds.has(stage)) {
      errors.push(`${key}: unknown validation stage ${stage}`);
    }
  }
}

for (const exemption of registry.exemptions) {
  if (!referencedExemptions.has(exemption.id)) {
    errors.push(`unused exemption: ${exemption.id}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exemption.expires)) {
    errors.push(`invalid exemption expiry: ${exemption.id}`);
  }
  if (exemption.expires < today) {
    errors.push(`expired exemption: ${exemption.id}`);
  }
}

if (errors.length > 0) {
  console.error("security component registry check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `security component registry: ${actual.size} workspace components, ${registry.exemptions.length} exemptions`,
);
