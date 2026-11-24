import { describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asReservationId,
  asResourceId,
  asWorkerId,
  newOperationId,
  newReservationId,
  newResourceId,
} from "../src/index.js";

const idContracts = [
  { name: "ReservationId", parse: asReservationId, generate: newReservationId },
  { name: "ResourceId", parse: asResourceId, generate: newResourceId },
  { name: "OperationId", parse: asOperationId, generate: newOperationId },
  { name: "WorkerId", parse: asWorkerId, generate: undefined },
  { name: "BootId", parse: asBootId, generate: undefined },
] as const;

describe("資源 ID 契約", () => {
  test.each(idContracts)(
    "$name は非空・128文字以内・空白のみでない値だけを受け入れる",
    ({ parse, generate }) => {
      if (generate !== undefined) {
        const generated = generate();
        expect(parse(generated)).toBe(generated);
      }

      const maximumLength = "a".repeat(128);
      expect(parse(maximumLength)).toBe(maximumLength);
      expect(() => parse("")).toThrow();
      expect(() => parse("   ")).toThrow();
      expect(() => parse("a".repeat(129))).toThrow();
      expect(parse("あ".repeat(128))).toBe("あ".repeat(128));
      expect(() => parse("あ".repeat(129))).toThrow();
    },
  );
});
