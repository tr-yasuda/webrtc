import { describe, expect, test } from "vitest";
import { asOperationId, asResourceId, toResourceAuditRecord } from "../src/index.js";

describe("資源監査の共通エンベロープ", () => {
  test("資源監査を共通監査レコードへ変換し、生のスコープキーを出さない", () => {
    const record = toResourceAuditRecord({
      id: "audit-1",
      recordedAt: 2,
      occurredAt: 1,
      type: "reserve",
      outcome: "applied",
      operationId: asOperationId("operation-1"),
      resourceId: asResourceId("resource-1"),
      scopes: [
        {
          kind: "server",
          ref: "hmac-ref",
          keyVersion: 1,
        },
      ],
    });
    expect(record).toStrictEqual({
      id: "audit-1",
      kind: "resource",
      occurredAt: 1,
      recordedAt: 2,
      operationId: "operation-1",
      resourceId: "resource-1",
      outcome: "applied",
      scopes: ["server:1:hmac-ref"],
    });
  });

  test("操作 ID がない資源監査では operationId を補完しない", () => {
    const record = toResourceAuditRecord({
      id: "audit-2",
      recordedAt: 2,
      occurredAt: 2,
      type: "expire",
      outcome: "completed",
      scopes: [],
    });
    expect(record).not.toHaveProperty("operationId");
  });
});
