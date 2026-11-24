import { describe, expect, test } from "vitest";
import { authorizeParticipantAction } from "../../src/participant.js";
import { otherProjectId, projectId } from "../fixtures.js";
import { baseMediaInput } from "./support.js";

describe("参加 JWT の credential target 検証", () => {
  test("credential の Project だけが一致しない場合は拒否する", () => {
    expect(
      authorizeParticipantAction({
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          projectId: otherProjectId,
        },
      }),
    ).toMatchObject({ allowed: false, reason: "credential-target-mismatch" });
  });

  test("credential の Room 名だけが一致しない場合は拒否する", () => {
    expect(
      authorizeParticipantAction({
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          roomName: "room-b",
        },
      }),
    ).toMatchObject({ allowed: false, reason: "credential-target-mismatch" });
  });

  test("Room の Project だけが一致しない場合は拒否する", () => {
    expect(
      authorizeParticipantAction({
        ...baseMediaInput,
        room: {
          ...baseMediaInput.room,
          projectId: otherProjectId,
        },
      }),
    ).toMatchObject({ allowed: false, reason: "credential-target-mismatch" });
  });

  test("ホスト名とProjectが一致していてもcredentialのProjectだけが違えば拒否する", () => {
    expect(
      authorizeParticipantAction({
        ...baseMediaInput,
        project: { id: projectId, state: "active" },
        room: {
          state: "active",
          id: baseMediaInput.room.id,
          projectId,
          name: "room-a",
        },
        credential: {
          ...baseMediaInput.credential,
          projectId: otherProjectId,
        },
      }),
    ).toMatchObject({ allowed: false, reason: "credential-target-mismatch" });
  });
});
