import { fc } from "@fast-check/vitest";
import { expect, test } from "vitest";
import { pbtParameters } from "./support.js";

test("PBT_TIMEOUT_MS を超えた同期実行は失敗する", () => {
  const previous = {
    runs: process.env.PBT_RUNS,
    timeout: process.env.PBT_TIMEOUT_MS,
    seed: process.env.PBT_SEED,
    path: process.env.PBT_PATH,
  };
  process.env.PBT_RUNS = "10";
  process.env.PBT_TIMEOUT_MS = "10";
  delete process.env.PBT_SEED;
  delete process.env.PBT_PATH;

  try {
    const property = fc.property(fc.constant(1), () => {
      const startedAt = Date.now();
      let elapsed = 0;
      while (elapsed < 20) {
        elapsed = Date.now() - startedAt;
      }
    });

    expect(() => fc.assert(property, pbtParameters())).toThrow();
  } finally {
    restoreEnv("PBT_RUNS", previous.runs);
    restoreEnv("PBT_TIMEOUT_MS", previous.timeout);
    restoreEnv("PBT_SEED", previous.seed);
    restoreEnv("PBT_PATH", previous.path);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
