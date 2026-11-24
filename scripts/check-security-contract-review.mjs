import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (eventPath === undefined) {
  console.log("security contract review: skipped outside GitHub Actions");
  process.exit(0);
}

const event = JSON.parse(readFileSync(eventPath, "utf8"));
if (event.pull_request === undefined) {
  console.log("security contract review: skipped for non-PR event");
  process.exit(0);
}

const labels = new Set((event.pull_request.labels ?? []).map((label) => label.name));
if (labels.has("security-contract-change")) {
  console.log("security contract review: label present");
  process.exit(0);
}

const baseSha = process.env.GITHUB_BASE_SHA;
const baseRef = process.env.GITHUB_BASE_REF;
if (!baseSha && !baseRef) {
  console.error("security contract review: base commit is missing");
  process.exit(1);
}

const base = baseSha ?? `origin/${baseRef}`;
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean);

const protectedPrefixes = [
  "specs/security/",
  "packages/security/src/",
  "crates/security/src/",
  "scripts/generate-security-contract.mjs",
  "scripts/check-security-components.mjs",
  "scripts/check-security-boundaries.mjs",
];

const protectedChanges = changed.filter((path) =>
  protectedPrefixes.some((prefix) => path.startsWith(prefix)),
);

if (protectedChanges.length > 0) {
  console.error("security contract change requires the `security-contract-change` label:");
  for (const path of protectedChanges) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("security contract review: no protected changes");
