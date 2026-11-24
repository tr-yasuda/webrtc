import { describe, expect, test } from "vitest";
import { authorizeParticipantAction } from "../../src/participant.js";
import { otherProjectId } from "../fixtures.js";
import { baseJoinInput } from "./support.js";

describe("既存 Room への参加状態の検証", () => {
  test.each(["deleting", "deleted"] as const)(
    "Room が %s の場合は room-not-active で拒否する",
    (state) => {
      const decision = authorizeParticipantAction({
        ...baseJoinInput,
        room: { ...baseJoinInput.room, state },
      });

      expect(decision).toMatchObject({ allowed: false, reason: "room-not-active" });
    },
  );

  test("Session の Project だけが一致しない場合は session-target-mismatch で拒否する", () => {
    const decision = authorizeParticipantAction({
      ...baseJoinInput,
      session: {
        ...baseJoinInput.session!,
        projectId: otherProjectId,
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "session-target-mismatch",
    });
  });
});
