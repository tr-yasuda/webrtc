import { describe, expect, test } from "vitest";
import {
  toAuthorizationDecisionAuditRecord,
  toOperationResultAuditRecord,
  validateAuditRecord,
} from "../src/index.js";

const actor = { kind: "project-user" as const, id: "user-1" };
const target = { kind: "room", id: "room-1" };

describe("監査イベントの意味論", () => {
  test("認可判定と操作結果を別イベントにする", () => {
    const decision = toAuthorizationDecisionAuditRecord({
      id: "audit-1",
      occurredAt: 1,
      correlationId: "corr-1",
      actor,
      decision: {
        allowed: true,
        operation: "room.delete",
        target,
        reason: "allowed",
      },
    });
    const result = toOperationResultAuditRecord({
      id: "audit-2",
      occurredAt: 2,
      correlationId: "corr-1",
      actor,
      operation: "room.delete",
      target,
      result: "succeeded",
      reason: "completed",
      authorizationDecisionId: decision.id,
    });
    expect(validateAuditRecord(decision)).toStrictEqual({ ok: true });
    expect(validateAuditRecord(result)).toStrictEqual({ ok: true });
    expect(result.authorizationDecisionId).toBe(decision.id);
  });

  test("操作結果に認可判定の値を混入させない", () => {
    expect(
      validateAuditRecord({
        id: "audit-2",
        kind: "operation-result",
        occurredAt: 2,
        actor,
        operation: "room.delete",
        target,
        result: "allow",
        reason: "allowed",
        authorizationDecisionId: "audit-1",
        correlationId: "corr-1",
      }),
    ).toStrictEqual({
      ok: false,
      error: "invalid-audit-result",
      kind: "operation-result",
    });
  });

  test("監査エラーは入力値を反射しない", () => {
    const result = validateAuditRecord({
      kind: "SYNTHETIC_SECRET_KIND",
    });
    expect(result).toStrictEqual({ ok: false, error: "unknown-audit-kind" });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
  });

  test("別種別のフィールドと未定義の型を拒否する", () => {
    expect(
      validateAuditRecord({
        id: "audit-5",
        kind: "operation-result",
        occurredAt: 5,
        actor,
        operation: "room.delete",
        target,
        result: "succeeded",
        reason: "completed",
        authorizationDecisionId: "audit-1",
        correlationId: "corr-1",
        decision: "allow",
      }),
    ).toStrictEqual({
      ok: false,
      error: "unexpected-audit-field",
      kind: "operation-result",
    });
    expect(
      validateAuditRecord({
        id: "audit-6",
        kind: "authorization-decision",
        occurredAt: 6,
        actor: "SYNTHETIC_SECRET_ACTOR",
        operation: "room.delete",
        target,
        decision: "allow",
        reason: "allowed",
        correlationId: "corr-1",
      }),
    ).toStrictEqual({
      ok: false,
      error: "invalid-audit-field",
      kind: "authorization-decision",
      field: "actor",
    });
  });
});
