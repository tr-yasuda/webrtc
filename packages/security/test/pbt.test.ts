import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { redactUnknown, secret } from "../src/index.js";

function syntheticSecret(prefix: string) {
  return (value: string) => `${prefix}_${value}`;
}

describe("秘密値の非干渉性", () => {
  test("秘密値だけを変えても公開出力は変化しない", () => {
    const secretValue = syntheticSecret("SYNTHETIC_SECRET");
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.integer(), (first, second, count) => {
        const base = { projectId: "project-1", count, safe: "visible" };
        const left = redactUnknown({
          ...base,
          token: secret(secretValue(first)),
          nested: { password: secret(secretValue(first)) },
        });
        const right = redactUnknown({
          ...base,
          token: secret(secretValue(second)),
          nested: { password: secret(secretValue(second)) },
        });
        expect(left).toStrictEqual(right);
      }),
      { numRuns: 1_000 },
    );
  });

  test("秘密マーカーが公開出力へ現れない", () => {
    const marker = "SYNTHETIC_SECRET_MARKER";
    fc.assert(
      fc.property(fc.string(), (value) => {
        const output = redactUnknown({
          projectId: "project-1",
          token: `${marker}_${value}`,
          body: `${marker}_${value}`,
        });
        expect(JSON.stringify(output)).not.toContain(marker);
      }),
      { numRuns: 1_000 },
    );
  });
});
