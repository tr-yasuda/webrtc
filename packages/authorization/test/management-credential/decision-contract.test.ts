import { describe, expect, test } from "vitest";
import {
  authorizeManagementCredentialAction,
  authorizeManagementCredentialFromRaw,
  type ManagementOperation,
} from "../../src/management-credential.js";
import { projectId } from "../fixtures.js";
import { baseInput, targetFor } from "./support.js";

function targetKeys(target: object) {
  return Object.keys(target).toSorted();
}

function inputFor(operation: ManagementOperation) {
  return {
    ...baseInput,
    operation,
    target: targetFor(operation),
  };
}

describe("Management API credential 認可の監査target契約", () => {
  test("Room 操作のtargetは roomId を含める", () => {
    expect(
      targetKeys(authorizeManagementCredentialAction(inputFor("room.update")).target),
    ).toStrictEqual(["projectId", "roomId"]);
    expect(
      targetKeys(authorizeManagementCredentialAction(inputFor("room.delete")).target),
    ).toStrictEqual(["projectId", "roomId"]);
  });

  test("Session と Participant の強制切断targetは対象IDを含める", () => {
    expect(
      targetKeys(authorizeManagementCredentialAction(inputFor("session.disconnect")).target),
    ).toStrictEqual(["projectId", "sessionId"]);
    expect(
      targetKeys(authorizeManagementCredentialAction(inputFor("participant.disconnect")).target),
    ).toStrictEqual(["participantId", "projectId"]);
  });

  test("一覧取得のtargetは resourceId の有無を反映する", () => {
    expect(
      targetKeys(
        authorizeManagementCredentialAction({
          ...baseInput,
          operation: "room.read",
          target: { projectId, resourceId: "room-a" },
        }).target,
      ),
    ).toStrictEqual(["projectId", "resourceId"]);
    expect(
      targetKeys(
        authorizeManagementCredentialAction({
          ...baseInput,
          operation: "room.read",
          target: { projectId },
        }).target,
      ),
    ).toStrictEqual(["projectId"]);
  });

  test("生入力の認可は有効な入力で成功する", () => {
    const outcome = authorizeManagementCredentialFromRaw(baseInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.allowed).toBe(true);
    }
  });
});
