import { describe, expect, test } from "vitest";
import {
  parseAccountId,
  parseApplicationId,
  parseApplicationSigningKeyId,
  parseManagementApiCredentialId,
  parseParticipantDeviceId,
  parseParticipantId,
  parseProjectId,
  parseProjectUserId,
  parseRoomId,
} from "../src/index.js";

const validIds = {
  account: "acct_abcdefghij0123456789qrstuv",
  application: "app_abcdefghij0123456789qrstuv",
  applicationSigningKey: "sig_abcdefghij0123456789qrstuv",
  managementApiCredential: "cred_abcdefghij0123456789qrstuv",
  participant: "part_abcdefghij0123456789qrstuv",
  participantDevice: "pdev_abcdefghij0123456789qrstuv",
  project: "prj_abcdefghij0123456789qrstuv",
  projectUser: "pusr_abcdefghij0123456789qrstuv",
  room: "room_abcdefghij0123456789qrstuv",
} as const;

describe("共通ドメイン ID 契約", () => {
  test("各ドメイン ID は規定形式だけを受け入れる", () => {
    const parsers = [
      [parseProjectId, validIds.project],
      [parseAccountId, validIds.account],
      [parseProjectUserId, validIds.projectUser],
      [parseApplicationId, validIds.application],
      [parseApplicationSigningKeyId, validIds.applicationSigningKey],
      [parseManagementApiCredentialId, validIds.managementApiCredential],
      [parseRoomId, validIds.room],
      [parseParticipantId, validIds.participant],
      [parseParticipantDeviceId, validIds.participantDevice],
    ] as const;

    for (const [parseId, validId] of parsers) {
      expect(parseId(validId)).toStrictEqual({ ok: true, id: validId });
      expect(parseId("")).toStrictEqual({ ok: false, error: "invalid-domain-id" });
      expect(parseId(validId.slice(0, -1))).toStrictEqual({
        ok: false,
        error: "invalid-domain-id",
      });
      expect(parseId(`${validId.slice(0, -1)}A`)).toStrictEqual({
        ok: false,
        error: "invalid-domain-id",
      });
      expect(parseId(`bad_${validIds.project.slice(4)}`)).toStrictEqual({
        ok: false,
        error: "invalid-domain-id",
      });
    }
  });
});
