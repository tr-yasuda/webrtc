import { describe, expect, test } from "vitest";
import {
  authorizeManagementCredentialFromRaw,
  validateManagementCredentialAuthorizationInput,
  type ManagementCredentialScope,
} from "../../src/management-credential.js";
import { type ManagementOperation } from "../../src/management-operation.js";
import { baseInput } from "./support.js";

describe("Management API credential 認可入力の検証", () => {
  test("scopes が文字列の場合は input-invalid で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...baseInput,
        credential: {
          ...baseInput.credential,
          scopes: "session.manage",
        },
      }),
    ).toStrictEqual({ ok: false, reason: "input-invalid" });
  });

  test("scopes に未知の値が含まれる場合は unsupported-scope で拒否する", () => {
    expect(
      validateManagementCredentialAuthorizationInput({
        ...baseInput,
        credential: {
          ...baseInput.credential,
          scopes: ["unknown.scope"] as unknown as readonly ManagementCredentialScope[],
        },
      }),
    ).toStrictEqual({ ok: false, reason: "unsupported-scope" });
  });

  test.each(["unknown.operation", "constructor"] as unknown as ManagementOperation[])(
    "定義外の Management operation %s は unsupported-operation で拒否する",
    (operation) => {
      expect(
        authorizeManagementCredentialFromRaw({
          ...baseInput,
          operation,
        }),
      ).toStrictEqual({ ok: false, failure: "unsupported-operation" });
    },
  );
});
