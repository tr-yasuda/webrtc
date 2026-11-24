import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  authorizeParticipantAction,
  authorizeParticipantFromRaw,
  buildParticipantTarget,
  validateParticipantAuthorizationInput,
  type ParticipantAuthorizationInput,
  type ParticipantOperation,
} from "../../src/participant.js";
import {
  otherParticipantId,
  otherProjectId,
  otherRoomId,
  otherSubject,
  participantId,
  projectId,
  roomId,
  sessionId,
  subject,
} from "../fixtures.js";

type ParticipantCase = {
  readonly operation: ParticipantOperation;
  readonly projectState: "active" | "suspended";
  readonly targetMatch: boolean;
  readonly subjectClass: "empty" | "match" | "mismatch";
  readonly roomState: "absent" | "active" | "deleting" | "deleted";
  readonly sessionPresent: boolean;
  readonly sessionState: "active" | "revoked" | "ended";
  readonly sessionTargetMatch: boolean;
  readonly participantPresent: boolean;
  readonly participantState: "active" | "revoked" | "left";
  readonly participantTargetMatch: boolean;
  readonly participantExternalUser: "empty" | "match" | "mismatch";
  readonly grants: Record<ParticipantOperation, boolean>;
};

const participantCase = fc.record<ParticipantCase>({
  operation: fc.constantFrom(
    "room.create",
    "room.join",
    "media.publish",
    "media.subscribe",
    "data.send",
  ),
  projectState: fc.constantFrom("active", "suspended"),
  targetMatch: fc.boolean(),
  subjectClass: fc.constantFrom("empty", "match", "mismatch"),
  roomState: fc.constantFrom("absent", "active", "deleting", "deleted"),
  sessionPresent: fc.boolean(),
  sessionState: fc.constantFrom("active", "revoked", "ended"),
  sessionTargetMatch: fc.boolean(),
  participantPresent: fc.boolean(),
  participantState: fc.constantFrom("active", "revoked", "left"),
  participantTargetMatch: fc.boolean(),
  participantExternalUser: fc.constantFrom("empty", "match", "mismatch"),
  grants: fc.record({
    "room.create": fc.boolean(),
    "room.join": fc.boolean(),
    "media.publish": fc.boolean(),
    "media.subscribe": fc.boolean(),
    "data.send": fc.boolean(),
  }),
});

function buildParticipantInput(testCase: ParticipantCase): ParticipantAuthorizationInput {
  const project = testCase.targetMatch ? projectId : otherProjectId;
  const roomName = testCase.targetMatch ? "room-a" : "room-b";
  const credentialSubject =
    testCase.subjectClass === "empty"
      ? ""
      : testCase.subjectClass === "match"
        ? subject
        : otherSubject;
  const participantExternalUser =
    testCase.participantExternalUser === "empty"
      ? ""
      : testCase.participantExternalUser === "match"
        ? credentialSubject
        : credentialSubject === subject
          ? otherSubject
          : subject;

  return {
    operation: testCase.operation,
    credential: {
      projectId: project,
      roomName,
      subject: credentialSubject,
      grants: testCase.grants,
    },
    project: { id: projectId, state: testCase.projectState },
    room:
      testCase.roomState === "absent"
        ? { state: "absent", projectId: project, name: roomName }
        : {
            state: testCase.roomState,
            id: roomId,
            projectId: project,
            name: roomName,
          },
    ...(testCase.sessionPresent
      ? {
          session: {
            id: sessionId,
            projectId: testCase.sessionTargetMatch ? projectId : otherProjectId,
            roomId: testCase.sessionTargetMatch ? roomId : otherRoomId,
            participantId: testCase.sessionTargetMatch ? participantId : otherParticipantId,
            state: testCase.sessionState,
          },
        }
      : {}),
    ...(testCase.participantPresent
      ? {
          participant: {
            id: participantId,
            roomId: testCase.participantTargetMatch ? roomId : otherRoomId,
            externalUserId: participantExternalUser,
            state: testCase.participantState,
          },
        }
      : {}),
  };
}

describe("参加 JWT 認可の性質", () => {
  test("同じ入力から同じ判定を返し、targetとreasonの契約を守る", () => {
    fc.assert(
      fc.property(participantCase, (testCase) => {
        const input = buildParticipantInput(testCase);
        const decision = authorizeParticipantAction(input);

        expect(authorizeParticipantAction(input)).toStrictEqual(decision);
        expect(decision.operation).toBe(input.operation);
        expect(decision.target).toStrictEqual(buildParticipantTarget(input));
        expect(decision.allowed).toBe(decision.reason === "allowed");
      }),
      { numRuns: 200 },
    );
  });

  test("許可時は対象・subject・grantの必要条件を満たす", () => {
    fc.assert(
      fc.property(participantCase, (testCase) => {
        const input = buildParticipantInput(testCase);
        const decision = authorizeParticipantAction(input);
        if (!decision.allowed) {
          return;
        }

        expect(input.project.state).toBe("active");
        expect(input.credential.projectId).toBe(input.project.id);
        expect(input.credential.roomName).toBe(input.room.name);
        expect(input.room.projectId).toBe(input.project.id);
        expect(input.credential.subject.length).toBeGreaterThan(0);
        if (input.participant !== undefined) {
          expect(input.participant.externalUserId).toBe(input.credential.subject);
        }
        expect(input.credential.grants[input.operation]).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  test("未知のgrantキーと非boolean grantを生入力の検証で拒否する", () => {
    fc.assert(
      fc.property(participantCase, (testCase) => {
        const input = buildParticipantInput(testCase);
        expect(
          authorizeParticipantFromRaw({
            ...input,
            credential: {
              ...input.credential,
              grants: { ...input.credential.grants, recording: true },
            },
          }),
        ).toStrictEqual({ ok: false, failure: "unsupported-grant" });
        expect(
          authorizeParticipantFromRaw({
            ...input,
            credential: {
              ...input.credential,
              grants: { ...input.credential.grants, "media.publish": "yes" },
            },
          }),
        ).toStrictEqual({ ok: false, failure: "grant-invalid" });
      }),
      { numRuns: 100 },
    );
  });

  test("任意の値を受け取っても検証はthrowしない", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = validateParticipantAuthorizationInput(value);
        expect(typeof result.ok).toBe("boolean");
      }),
      { numRuns: 300 },
    );
  });
});
