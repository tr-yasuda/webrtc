import { ulid } from "ulid";
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

const idParsers = [
  { idType: "ProjectId", parseId: parseProjectId },
  { idType: "AccountId", parseId: parseAccountId },
  { idType: "ProjectUserId", parseId: parseProjectUserId },
  { idType: "ApplicationId", parseId: parseApplicationId },
  { idType: "ApplicationSigningKeyId", parseId: parseApplicationSigningKeyId },
  { idType: "ManagementApiCredentialId", parseId: parseManagementApiCredentialId },
  { idType: "RoomId", parseId: parseRoomId },
  { idType: "ParticipantId", parseId: parseParticipantId },
  { idType: "ParticipantDeviceId", parseId: parseParticipantDeviceId },
] as const;

describe("共通ドメイン ID 契約", () => {
  test.each(idParsers)("各ドメイン ID $idType は規定形式だけを受け入れる", ({ parseId }) => {
    const validUlid = ulid();
    expect(parseId(validUlid)).toStrictEqual({ ok: true, id: validUlid });
    expect(parseId("")).toStrictEqual({ ok: false, error: "invalid-domain-id" });
    expect(parseId(validUlid.slice(0, -1))).toStrictEqual({
      ok: false,
      error: "invalid-domain-id",
    });
    expect(parseId(`${validUlid.slice(0, -1)}U`)).toStrictEqual({
      ok: false,
      error: "invalid-domain-id",
    });
    expect(parseId(`8${"Z".repeat(25)}`)).toStrictEqual({
      ok: false,
      error: "invalid-domain-id",
    });
    expect(parseId("ſ".repeat(26))).toStrictEqual({
      ok: false,
      error: "invalid-domain-id",
    });
    expect(parseId(validUlid.toLowerCase())).toStrictEqual({ ok: true, id: validUlid });
  });
});
