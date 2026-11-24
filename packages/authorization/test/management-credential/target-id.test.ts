import { describe, expect, test } from "vitest";
import {
  authorizeManagementCredentialAction,
  type ManagementCredentialAuthorizationTarget,
  type ManagementCredentialScope,
} from "../../src/management-credential.js";
import { type ManagementOperation } from "../../src/management-operation.js";
import { participantId, projectId, roomId, sessionId } from "../fixtures.js";
import { baseInput } from "./support.js";

describe("Management API credential の認可", () => {
  test.each([
    {
      name: "session.disconnect",
      operation: "session.disconnect",
      scope: "session.manage",
    },
    {
      name: "participant.disconnect",
      operation: "participant.disconnect",
      scope: "session.manage",
    },
    {
      name: "room.update",
      operation: "room.update",
      scope: "room.manage",
    },
    {
      name: "room.delete",
      operation: "room.delete",
      scope: "room.manage",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    scope: ManagementCredentialScope;
  }>)("$name は対象 ID がない場合は拒否する", ({ operation, scope }) => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: [scope],
      },
      operation,
      target: { projectId },
    });

    expect(decision).toStrictEqual({
      allowed: false,
      operation,
      target: { projectId },
      reason: "target-id-required",
    });
  });

  test.each([
    {
      name: "session.disconnect",
      operation: "session.disconnect",
      scope: "session.manage",
      target: { projectId, sessionId },
    },
    {
      name: "participant.disconnect",
      operation: "participant.disconnect",
      scope: "session.manage",
      target: { projectId, participantId },
    },
    {
      name: "room.update",
      operation: "room.update",
      scope: "room.manage",
      target: { projectId, roomId },
    },
    {
      name: "room.delete",
      operation: "room.delete",
      scope: "room.manage",
      target: { projectId, roomId },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    operation: ManagementOperation;
    scope: ManagementCredentialScope;
    target: ManagementCredentialAuthorizationTarget;
  }>)("$name は対象 ID がある場合は許可する", ({ operation, scope, target }) => {
    const decision = authorizeManagementCredentialAction({
      ...baseInput,
      credential: {
        ...baseInput.credential,
        scopes: [scope],
      },
      operation,
      target,
    });

    expect(decision).toStrictEqual({
      allowed: true,
      operation,
      target,
      reason: "allowed",
    });
  });
});
