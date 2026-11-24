import { describe, expect, test } from "vitest";
import { authorizeParticipantFromRaw, type ParticipantOperation } from "../../src/participant.js";
import { baseMediaInput } from "./support.js";

describe("参加 JWT 認可入力の検証", () => {
  test.each(["unknown.operation", "constructor"] as unknown as ParticipantOperation[])(
    "定義外の participant operation %s は unsupported-operation で拒否する",
    (operation) => {
      expect(
        authorizeParticipantFromRaw({
          ...baseMediaInput,
          operation,
        }),
      ).toStrictEqual({ ok: false, failure: "unsupported-operation" });
    },
  );
});
