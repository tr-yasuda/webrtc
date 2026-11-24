import { describe, expect, test } from "vitest";
import { validateComponentManifest } from "../src/index.js";

function manifest(profile: string, controls: readonly string[]) {
  return {
    component: "@example/component",
    contractVersion: 1,
    profiles: [{ id: profile, controls }],
    outputBoundaries: ["log"],
    validationStages: ["parse"],
  };
}

describe("通信プロファイルの適用宣言", () => {
  test("必須制御が揃った dplane-ipc を受理する", () => {
    expect(
      validateComponentManifest(
        manifest("dplane-ipc", [
          "unix-domain-socket",
          "runtime-directory",
          "dedicated-uid-gid",
          "file-permissions",
          "peer-credentials",
          "no-network-listen",
          "no-tls-required",
        ]),
      ),
    ).toStrictEqual({ ok: true });
  });

  test("peer credential の欠落と未知のプロファイルを拒否する", () => {
    expect(
      validateComponentManifest(
        manifest("dplane-ipc", [
          "unix-domain-socket",
          "runtime-directory",
          "dedicated-uid-gid",
          "file-permissions",
          "no-network-listen",
          "no-tls-required",
        ]),
      ),
    ).toStrictEqual({
      ok: false,
      error: "missing-required-control",
      profile: "dplane-ipc",
      control: "peer-credentials",
    });
    expect(validateComponentManifest(manifest("mtls-everywhere", ["mtls"]))).toStrictEqual({
      ok: false,
      error: "unknown-transport-profile",
      profile: "mtls-everywhere",
    });
  });
});
