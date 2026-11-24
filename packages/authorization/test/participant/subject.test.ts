import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  type ParticipantAuthorizationInput,
  type ParticipantAuthorizationReason,
} from "../../src/participant.js";
import { otherSubject } from "../fixtures.js";
import { baseMediaInput, baseJoinInput, expectedTarget } from "./support.js";

describe("参加 JWT の認可", () => {
  test.each([
    {
      name: "media.publish の Participant が JWT subject と一致しない",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          externalUserId: otherSubject,
        },
      },
      reason: "subject-mismatch",
    },
    {
      name: "room.join の Participant が JWT subject と一致しない",
      input: {
        ...baseJoinInput,
        participant: {
          ...baseJoinInput.participant!,
          externalUserId: otherSubject,
        },
      },
      reason: "subject-mismatch",
    },
    {
      name: "JWT subject が空である",
      input: {
        ...baseMediaInput,
        credential: {
          ...baseMediaInput.credential,
          subject: "",
        },
      },
      reason: "subject-required",
    },
    {
      name: "Participant の ExternalUser が空である",
      input: {
        ...baseMediaInput,
        participant: {
          ...baseMediaInput.participant!,
          externalUserId: "",
        },
      },
      reason: "subject-required",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: ParticipantAuthorizationInput;
    reason: Exclude<ParticipantAuthorizationReason, "allowed">;
  }>)("$name 場合は拒否する", ({ input, reason }) => {
    const decision = authorizeParticipantAction(input);

    expect(decision).toStrictEqual({
      allowed: false,
      operation: input.operation,
      target: expectedTarget(input),
      reason,
    });
  });
});
