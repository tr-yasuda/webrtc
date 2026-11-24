import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./authorization-policy.mjs";

const proofsRoot = path.join(repoRoot, "packages/authorization/proofs");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "authorization-lean-mutation-"));

const mutations = [
  {
    description: "Owner の project.read 許可を削除",
    file: "Authorization/GeneratedPolicy.lean",
    target: "  | .owner, .projectRead => true",
    replacement: "  | .owner, .projectRead => false",
  },
  {
    description: "Admin の変更後 Owner チェックを削除",
    file: "Authorization/ProjectUser.lean",
    target: "      | .nextRole => input.nextRole == some .owner",
    replacement: "      | .nextRole => false",
  },
  {
    description: "ProjectUser 除外操作に credential scope を追加",
    file: "Authorization/GeneratedPolicy.lean",
    target: "  | .roomRead => [.roomManage]",
    replacement: "  | .projectUserRemove => [.roomManage]\n  | .roomRead => [.roomManage]",
  },
];

try {
  fs.cpSync(proofsRoot, temporaryRoot, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).includes(".lake");
    },
  });

  for (const mutation of mutations) {
    const modelPath = path.join(temporaryRoot, mutation.file);
    const original = fs.readFileSync(modelPath, "utf8");
    if (!original.includes(mutation.target)) {
      throw new Error(`Lean モデル mutation の対象文字列が見つかりません: ${mutation.description}`);
    }

    fs.writeFileSync(modelPath, original.replace(mutation.target, mutation.replacement));
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
        throw new Error(
          `Lean モデル mutation がビルドエラー以外の理由で失敗しました: ${mutation.description}`,
          { cause: error },
        );
      }
      console.log(`Lean モデル mutation を検出しました: ${mutation.description}`);
      detected = true;
    } finally {
      fs.writeFileSync(modelPath, original);
    }

    if (!detected) {
      throw new Error(`Lean モデル mutation が検出されませんでした: ${mutation.description}`);
    }
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
