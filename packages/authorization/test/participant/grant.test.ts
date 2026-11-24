import { describe, expect, test } from "vitest";
import { authorizeParticipantFromRaw } from "../../src/participant.js";
import { projectId, subject } from "../fixtures.js";
import { baseMediaInput, grants } from "./support.js";
import { authSpecName } from "../auth-spec.js";

describe("参加 JWT の grant 検証", () => {
  test.each([
    {
      name: "room.create の grant が真偽値でない",
      input: {
        operation: "room.create",
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: { ...grants, "room.create": "yes" },
        },
        project: { id: projectId, state: "active" },
        room: { state: "absent", projectId, name: "new-room" },
      },
    },
    {
      name: "media.publish の grant が真偽値でない",
      input: {
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          grants: {
            ...baseMediaInput.credential.grants,
            "media.publish": "yes",
          },
        },
      },
    },
    {
      name: "未作成 Room への参加で room.create の grant が真偽値でない",
      input: {
        operation: "room.join",
        credential: {
          projectId,
          subject,
          roomName: "new-room",
          grants: {
            ...grants,
            "room.create": "yes",
            "room.join": true,
          },
        },
        project: { id: projectId, state: "active" },
        room: { state: "absent", projectId, name: "new-room" },
      },
    },
  ])(authSpecName("AUTH-PART-05", "$name場合は grant-invalid で拒否する"), ({ input }) => {
    expect(authorizeParticipantFromRaw(input)).toStrictEqual({
      ok: false,
      failure: "grant-invalid",
    });
  });
});
