import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  SECURITY_CONTRACT,
  SECURITY_CONTRACT_VERSION,
  loadSecurityContract,
  validateContractInvariants,
} from "../src/index.js";

const contractPath = fileURLToPath(
  new URL("../../../specs/security/contract.json", import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL("../../../specs/security/contract.schema.json", import.meta.url),
);
const componentsPath = fileURLToPath(
  new URL("../../../specs/security/components.json", import.meta.url),
);
const componentsSchemaPath = fileURLToPath(
  new URL("../../../specs/security/components.schema.json", import.meta.url),
);

describe("機械可読セキュリティ契約", () => {
  test("JSON Schema と契約の不変条件を満たす", () => {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as unknown;
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    expect(validate(contract)).toBe(true);
    expect(validateContractInvariants(SECURITY_CONTRACT)).toStrictEqual({ ok: true });

    const components = JSON.parse(readFileSync(componentsPath, "utf8")) as unknown;
    const componentsSchema = JSON.parse(readFileSync(componentsSchemaPath, "utf8")) as object;
    expect(ajv.compile(componentsSchema)(components)).toBe(true);
  });

  test("未知の契約バージョンと契約欠落を安全に拒否する", () => {
    expect(loadSecurityContract({ version: 99 })).toStrictEqual({
      ok: false,
      error: "unsupported-contract-version",
      version: 99,
    });
    expect(loadSecurityContract(null)).toStrictEqual({
      ok: false,
      error: "contract-missing",
    });
    expect(SECURITY_CONTRACT_VERSION).toBe(1);
  });

  test("不完全な契約と基準を緩めた契約を既定値へフォールバックせず拒否する", () => {
    expect(loadSecurityContract({ version: 1 })).toStrictEqual({
      ok: false,
      error: "invalid-contract",
    });

    const weakened = structuredClone(SECURITY_CONTRACT) as unknown as {
      tls: { tls12: { prohibited: string[] } };
      baseline: { tls: { tls12Prohibited: string[] } };
    };
    weakened.tls.tls12.prohibited = weakened.tls.tls12.prohibited.filter(
      (value) => value !== "CBC",
    );
    expect(loadSecurityContract(weakened)).toStrictEqual({
      ok: false,
      error: "invalid-contract",
    });

    weakened.tls.tls12.prohibited.push("CBC");
    weakened.baseline.tls.tls12Prohibited = weakened.baseline.tls.tls12Prohibited.filter(
      (value) => value !== "CBC",
    );
    expect(loadSecurityContract(weakened)).toStrictEqual({
      ok: false,
      error: "invalid-contract",
    });

    const unregistered = structuredClone(SECURITY_CONTRACT) as unknown as {
      transportProfiles: {
        id: string;
        path: string;
        requiredControls: string[];
        forbiddenFallbacks: string[];
      }[];
    };
    unregistered.transportProfiles.push({
      id: "unregistered-profile",
      path: "unregistered-path",
      requiredControls: ["none"],
      forbiddenFallbacks: [],
    });
    expect(loadSecurityContract(unregistered)).toStrictEqual({
      ok: false,
      error: "invalid-contract",
    });
  });
});
