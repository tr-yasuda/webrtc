import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./authorization-policy.mjs";

const proofsRoot = path.join(repoRoot, "packages/authorization/proofs");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "authorization-lean-mutation-"));

try {
  fs.cpSync(proofsRoot, temporaryRoot, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).includes(".lake");
    },
  });

  const modelPath = path.join(temporaryRoot, "Authorization/GeneratedPolicy.lean");
  const original = fs.readFileSync(modelPath, "utf8");
  const target = "  | .owner, .projectRead => true";
  if (!original.includes(target)) {
    throw new Error("Lean モデル mutation の対象文字列が見つかりません");
  }
  fs.writeFileSync(modelPath, original.replace(target, "  | .owner, .projectRead => false"));

  let detected = false;
  try {
    execFileSync(
      "elan",
      [
        "run",
        "--install",
        fs.readFileSync(path.join(temporaryRoot, "lean-toolchain"), "utf8").trim(),
        "lake",
        "-d",
        temporaryRoot,
        "build",
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (!/error:/u.test(output)) {
      process.stderr.write(output);
      throw new Error("Lean モデル mutation がビルドエラー以外の理由で失敗しました", {
        cause: error,
      });
    }
    console.log("Lean モデル mutation を検出しました: Owner の project.read 許可を削除");
    detected = true;
  }
  if (!detected) throw new Error("Lean モデル mutation が検出されませんでした");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
