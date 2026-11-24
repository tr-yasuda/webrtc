import { describe, expect, test } from "vitest";
import { authorizationDecisionAuditRecord, authorizeParticipantAction } from "../src/index.js";
import { participantId, projectId, roomId, sessionId, subject } from "./fixtures.js";

describe("認可判定の監査変換", () => {
  test("認可判定を共通監査レコードへ変換し、操作結果と混同しない", () => {
    const decision = authorizeParticipantAction({
      operation: "media.publish",
      credential: {
        projectId,
        roomName: "room",
        subject,
        grants: {
          "room.create": false,
          "room.join": false,
          "media.publish": false,
          "media.subscribe": false,
          "data.send": false,
        },
      },
      project: { id: projectId, state: "active" },
      room: { state: "active", id: roomId, projectId, name: "room" },
      session: {
        id: sessionId,
        projectId,
        roomId,
        participantId,
        state: "active",
      },
      participant: {
        id: participantId,
        roomId,
        externalUserId: subject,
        state: "active",
      },
    });
    const record = authorizationDecisionAuditRecord({
      id: "audit-1",
      occurredAt: 1,
      correlationId: "corr-1",
      actor: { kind: "participant", id: participantId },
      target: { kind: "participant", id: participantId },
      decision,
    });
    expect(record).toMatchObject({
      id: "audit-1",
      kind: "authorization-decision",
      decision: "deny",
      reason: "grant-not-granted",
      correlationId: "corr-1",
    });
  });
});
