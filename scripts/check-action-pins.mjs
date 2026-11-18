import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0");

const definitions = [];
for (const path of new Set(paths)) {
  const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
  const isAction = /(?:^|\/)action\.ya?ml$/.test(path);
  if (!isWorkflow && !isAction) continue;

  const file = lstatSync(path, { throwIfNoEntry: false });
  if (!file) continue;
  if (!file.isFile()) throw new Error(`Expected a regular file at ${JSON.stringify(path)}`);
  definitions.push(`./${path}`);
}

if (definitions.length > 0) {
  // A lockfile can resolve a tag while the repository still requires a SHA in uses.
  const audit = spawnSync(
    "zizmor",
    [
      "--offline",
      "--no-config",
      "--no-ignores",
      "--ignore-lockfile",
      "--strict-collection",
      "--no-exit-codes",
      "--format=json-v1",
      "--quiet",
      "--",
      ...definitions,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  if (audit.error) throw audit.error;
  if (audit.status !== 0) throw new Error(`zizmor failed (${audit.signal ?? audit.status})`);

  for (const finding of JSON.parse(audit.stdout)) {
    if (finding.ident !== "unpinned-uses") continue;

    const primary = finding.locations.find((location) => location.symbolic.kind === "Primary");
    const path = primary.symbolic.key.Local.verbatim_path;
    const line = primary.concrete.location.start_point.row + 1;
    console.error(`${JSON.stringify(path)}:${line}: pin uses to a full commit SHA`);
    process.exitCode = 1;
  }
}
