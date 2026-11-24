import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  loadSecurityContract,
  redactUnknown,
  sanitizeFieldPath,
  toPublicError,
  validateAuditRecord,
  validateComponentManifest,
} from "../src/index.js";

function transportExpected(result: ReturnType<typeof validateComponentManifest>): unknown {
  if (result.ok) {
    return "valid";
  }
  const { ok: _ok, ...rest } = result;
  return rest;
}

function auditExpected(result: ReturnType<typeof validateAuditRecord>): unknown {
  if (result.ok) {
    return "valid";
  }
  const { ok: _ok, ...rest } = result;
  return rest;
}

function contractExpected(result: ReturnType<typeof loadSecurityContract>): unknown {
  if (result.ok) {
    return "valid";
  }
  const { ok: _ok, ...rest } = result;
  return rest;
}

interface Vectors {
  readonly redaction: readonly {
    readonly id: string;
    readonly input: unknown;
    readonly expected: unknown;
  }[];
  readonly publicErrors: readonly {
    readonly id: string;
    readonly input: Parameters<typeof toPublicError>[0];
    readonly expected: unknown;
  }[];
  readonly fieldPaths: readonly {
    readonly id: string;
    readonly path: readonly (string | number)[];
    readonly allowedFields: readonly string[];
    readonly expected: readonly string[];
  }[];
  readonly transport: readonly {
    readonly id: string;
    readonly manifest: unknown;
    readonly expected: unknown;
  }[];
  readonly audit: readonly {
    readonly id: string;
    readonly record: unknown;
    readonly expected: unknown;
  }[];
  readonly contract: readonly {
    readonly id: string;
    readonly input: unknown;
    readonly expected: unknown;
  }[];
}

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../specs/security/vectors.json", import.meta.url)),
    "utf8",
  ),
) as Vectors;

describe("TypeScript 共有テストベクター", () => {
  test.each(vectors.redaction)("$id", ({ input, expected }) => {
    expect(redactUnknown(input)).toStrictEqual(expected);
  });

  test.each(vectors.publicErrors)("$id", ({ input, expected }) => {
    expect(toPublicError(input)).toStrictEqual(expected);
  });

  test.each(vectors.fieldPaths)("$id", ({ path, allowedFields, expected }) => {
    expect(sanitizeFieldPath(path, allowedFields)).toStrictEqual(expected);
  });

  test.each(vectors.transport)("$id", ({ manifest, expected }) => {
    expect(transportExpected(validateComponentManifest(manifest))).toStrictEqual(expected);
  });

  test.each(vectors.audit)("$id", ({ record, expected }) => {
    expect(auditExpected(validateAuditRecord(record))).toStrictEqual(expected);
  });

  test.each(vectors.contract)("$id", ({ input, expected }) => {
    expect(contractExpected(loadSecurityContract(input))).toStrictEqual(expected);
  });
});
