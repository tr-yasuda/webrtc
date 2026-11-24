import { describe, expect, test } from "vitest";
import { runConformance, runContractMutationTests } from "../src/index.js";

const manifest = {
  component: "@example/control",
  contractVersion: 1,
  profiles: [
    {
      id: "public-control",
      controls: [
        "tls",
        "tls-1.2-min",
        "tls-1.3-preferred",
        "aead-only",
        "ecdhe-only",
        "server-certificate-verification",
        "no-plaintext-fallback",
        "no-0-rtt",
        "no-external-psk",
      ],
    },
  ],
  outputBoundaries: ["log", "audit", "public-error"],
  validationStages: ["parse", "execution"],
};

const auditRecord = {
  id: "audit-1",
  kind: "authorization-decision",
  occurredAt: 1,
  actor: { kind: "project-user", id: "user-1" },
  operation: "room.delete",
  target: { kind: "room", id: "room-1" },
  decision: "deny",
  reason: "insufficient-role",
  correlationId: "corr-1",
};

describe("準拠検証キット", () => {
  test("正しい適用宣言と監査を受理する", () => {
    const result = runConformance({ manifest, auditRecords: [auditRecord] });
    expect(result.ok).toBe(true);
  });

  test("負のフィクスチャを拒否する", () => {
    const result = runConformance({
      manifest: {
        ...manifest,
        profiles: [
          {
            id: "public-control",
            controls: manifest.profiles[0]?.controls.filter((control) => control !== "tls"),
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected conformance failure");
    }
    expect(result.errors).toContain("missing-required-control:public-control:tls");
  });

  test("セキュリティ上重要な契約変異をすべて検出する", () => {
    const mutations = runContractMutationTests();
    expect(mutations.every((mutation) => mutation.detected)).toBe(true);
  });

  test("準拠検証のエラーに入力値や秘密情報を含めない", () => {
    const result = runConformance({
      manifest: {
        ...manifest,
        profiles: [{ id: "SYNTHETIC_SECRET_PROFILE", controls: [] }],
      },
      auditRecords: [{ kind: "SYNTHETIC_SECRET_KIND" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected conformance failure");
    }
    expect(result.errors.join("\n")).not.toContain("SYNTHETIC_SECRET");
  });
});
