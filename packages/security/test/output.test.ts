import { describe, expect, test } from "vitest";
import {
  createSafeLogEvent,
  redactUnknown,
  secret,
  stringifyJsonValue,
  toPublicError,
  toSafeUrl,
} from "../src/index.js";

describe("秘密情報の出力境界", () => {
  test("秘密型は暗黙の文字列化とシリアライズを拒否する", () => {
    const value = secret("SYNTHETIC_SECRET");
    expect(String(value)).toBe("[REDACTED]");
    expect(() => JSON.stringify({ value })).toThrow("secret values cannot be serialized");
    expect(redactUnknown({ token: "SYNTHETIC_SECRET", projectId: "p1" })).toStrictEqual({
      token: "[REDACTED]",
      projectId: "p1",
    });
  });

  test("構造化ログは許可した型だけを受け付ける", () => {
    expect(
      createSafeLogEvent({
        event: "room.joined",
        component: "signaling",
        attributes: { roomId: "r1", count: 1, ok: true },
      }),
    ).toStrictEqual({
      event: "room.joined",
      component: "signaling",
      attributes: { roomId: "r1", count: 1, ok: true },
    });
    expect(() =>
      createSafeLogEvent({
        event: "room.joined",
        component: "signaling",
        attributes: { nested: { token: "x" } },
      }),
    ).toThrow("unsafe-log-attribute");
  });

  test("構造化ログは秘密属性と上限超過を拒否し、返却後も変更できない", () => {
    for (const key of ["token", "email", "sdp"]) {
      expect(() =>
        createSafeLogEvent({
          event: "room.joined",
          component: "signaling",
          attributes: { [key]: "SYNTHETIC_SECRET" },
        }),
      ).toThrow("unsafe-log-attribute");
    }
    expect(() =>
      createSafeLogEvent({
        event: "room.joined",
        component: "signaling",
        attributes: { value: "x".repeat(1025) },
      }),
    ).toThrow("unsafe-log-attribute");
    const event = createSafeLogEvent({
      event: "room.joined",
      component: "signaling",
      attributes: { roomId: "r1", flags: ["a", "b"] },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.attributes)).toBe(true);
    expect(Object.isFrozen(event.attributes.flags)).toBe(true);
  });

  test("公開エラーは入力の原因と元メッセージを落とす", () => {
    expect(
      toPublicError({
        code: "invalid-input",
        messageKey: "errors.invalidInput",
        retryable: false,
        targetIds: ["room-1"],
        correlationId: "corr-1",
        cause: "SYNTHETIC_SECRET",
        rawMessage: "SYNTHETIC_DETAIL",
      }),
    ).toStrictEqual({
      code: "invalid-input",
      messageKey: "errors.invalidInput",
      retryable: false,
      targetIds: ["room-1"],
      correlationId: "corr-1",
    });
  });

  test("安全な JSON 値だけを文字列化する", () => {
    expect(stringifyJsonValue({ projectId: "p1", count: 1 })).toBe('{"projectId":"p1","count":1}');
  });

  test("URL は許可したクエリだけを使い、循環参照を伏字にする", () => {
    expect(toSafeUrl("https://example.com", ["rooms", "r1"], { roomId: "r1" }, ["roomId"])).toBe(
      "https://example.com/rooms/r1?roomId=r1",
    );
    expect(() =>
      toSafeUrl("https://example.com", [], { token: "SYNTHETIC_SECRET" }, ["roomId"]),
    ).toThrow("query-key-not-allowed");
    const cyclic: Record<string, unknown> = { token: "SYNTHETIC_SECRET" };
    cyclic.self = cyclic;
    expect(redactUnknown(cyclic)).toStrictEqual({
      token: "[REDACTED]",
      self: "[REDACTED]",
    });
  });

  test("URL は資格情報・クエリ・断片・危険なスキーム・親参照を拒否する", () => {
    for (const base of [
      "http://example.com",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "https://example.com?token=x",
      "https://example.com#fragment",
      "https://example.com/api",
    ]) {
      expect(() => toSafeUrl(base, [], {}, [])).toThrow("unsafe-url");
    }
    expect(() => toSafeUrl("https://example.com", [".."], {}, [])).toThrow("unsafe-url-path");
  });

  test("個人情報と Buffer を redaction の最後の防衛線で伏字にする", () => {
    expect(
      redactUnknown({
        email: "person@example.com",
        displayName: "Synthetic Person",
        ipAddress: "192.0.2.10",
        projectId: "p1",
      }),
    ).toStrictEqual({
      email: "[REDACTED]",
      displayName: "[REDACTED]",
      ipAddress: "[REDACTED]",
      projectId: "p1",
    });
    expect(redactUnknown(Buffer.from("SYNTHETIC_SECRET"))).toBe("[REDACTED]");
  });
});
