import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { ParticipantAuthorizationInput, ParticipantOperation } from "../src/participant.js";
import { authorizeParticipantAction } from "../src/participant.js";
import type { ManagementOperation, ProjectUserRole } from "../src/management-operation.js";
import type {
  ManagementCredentialScope,
  ManagementCredentialAuthorizationInput,
  ManagementCredentialAuthorizationTarget,
} from "../src/management-credential.js";
import { authorizeManagementCredentialAction } from "../src/management-credential.js";
import type {
  ProjectUserAuthorizationInput,
  ProjectUserAuthorizationTarget,
} from "../src/project-user.js";
import { authorizeProjectUserAction } from "../src/project-user.js";
import {
  accountId,
  otherAccountId,
  otherParticipantId,
  otherProjectId,
  otherRoomId,
  otherSubject,
  participantId,
  projectId,
  projectUserId,
  roomId,
  sessionId,
  subject,
} from "./fixtures.js";

type Axis = {
  readonly name: string;
  readonly values: readonly string[];
};

type LeanGroup = {
  readonly name: string;
  readonly axes: readonly Axis[];
  readonly count: number;
  readonly allowed: string;
  readonly reasonCodes: string;
  readonly reasons: readonly string[];
};

type LeanManifest = {
  readonly participant: readonly LeanGroup[];
  readonly projectUser: readonly LeanGroup[];
  readonly credential: readonly LeanGroup[];
};

type CaseRow = Readonly<Record<string, string>>;

const manifestPath = fileURLToPath(
  new URL("../.cache/lean-authorization-cases.json", import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LeanManifest;

function rowsFor(group: LeanGroup): readonly CaseRow[] {
  let rows: CaseRow[] = [{}];

  for (const axis of group.axes) {
    const nextRows: CaseRow[] = [];
    for (const row of rows) {
      for (const value of axis.values) {
        nextRows.push({ ...row, [axis.name]: value });
      }
    }
    rows = nextRows;
  }

  return rows;
}

function boolValue(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`unexpected boolean case: ${value ?? "missing"}`);
}

function grantsFromBits(bits: string): ParticipantAuthorizationInput["credential"]["grants"] {
  return {
    "room.create": bits[0] === "1",
    "room.join": bits[1] === "1",
    "media.publish": bits[2] === "1",
    "media.subscribe": bits[3] === "1",
    "data.send": bits[4] === "1",
  };
}

function projectStateValue(value: string | undefined): "active" | "suspended" {
  if (value === "active" || value === "suspended") return value;
  throw new Error(`unexpected project state: ${value ?? "missing"}`);
}

function mediaOperationValue(value: string | undefined): ParticipantOperation {
  if (value === "media.publish" || value === "media.subscribe" || value === "data.send") {
    return value;
  }
  throw new Error(`unexpected media operation: ${value ?? "missing"}`);
}

function participantSubjectValue(value: string | undefined): string {
  if (value === "empty") return "";
  if (value === "same") return subject;
  if (value === "mismatch") return otherSubject;
  throw new Error(`unexpected participant subject: ${value ?? "missing"}`);
}

function sessionFromCase(
  value: string | undefined,
): NonNullable<ParticipantAuthorizationInput["session"]> | undefined {
  if (value === "none") return undefined;
  const [kind, state, projectMatch, roomMatch, participantMatch] = value.split(":");
  if (kind !== "present" || state === undefined) {
    throw new Error(`unexpected session case: ${value}`);
  }
  return {
    id: sessionId,
    projectId: boolValue(projectMatch) ? projectId : otherProjectId,
    roomId: boolValue(roomMatch) ? roomId : otherRoomId,
    participantId: boolValue(participantMatch) ? participantId : otherParticipantId,
    state: state as NonNullable<ParticipantAuthorizationInput["session"]>["state"],
  };
}

function participantRecordFromCase(
  value: string | undefined,
): NonNullable<ParticipantAuthorizationInput["participant"]> | undefined {
  if (value === "none") return undefined;
  const [kind, state, roomMatch, subjectStatus] = value.split(":");
  if (kind !== "present" || state === undefined || subjectStatus === undefined) {
    throw new Error(`unexpected participant case: ${value}`);
  }
  return {
    id: participantId,
    roomId: boolValue(roomMatch) ? roomId : otherRoomId,
    externalUserId: participantSubjectValue(subjectStatus),
    state: state as NonNullable<ParticipantAuthorizationInput["participant"]>["state"],
  };
}

function participantSubjectOnly(
  value: string | undefined,
): NonNullable<ParticipantAuthorizationInput["participant"]> | undefined {
  if (value === "none") return undefined;
  return {
    id: participantId,
    roomId,
    externalUserId: participantSubjectValue(value),
    state: "active",
  };
}

function participantRoomFromCase(
  group: LeanGroup,
  row: CaseRow,
): ParticipantAuthorizationInput["room"] {
  switch (group.name) {
    case "roomCreate":
      return boolValue(row.roomPresent)
        ? { state: "active", id: roomId, projectId, name: "room-a" }
        : { state: "absent", projectId, name: "room-a" };
    case "roomJoinAbsent":
      return { state: "absent", projectId, name: "room-a" };
    case "roomJoinPresent":
      return {
        state: row.roomState as NonNullable<ParticipantAuthorizationInput["room"]>["state"],
        id: roomId,
        projectId,
        name: "room-a",
      };
    case "mediaRoomInactive":
      return { state: "deleting", id: roomId, projectId, name: "room-a" };
    default:
      return { state: "active", id: roomId, projectId, name: "room-a" };
  }
}

function participantSessionFromCase(
  group: LeanGroup,
  row: CaseRow,
): ParticipantAuthorizationInput["session"] {
  if (group.name === "mediaRoomInactive") return undefined;
  if (group.name === "roomJoinPresent" || group.name === "mediaRoomActive") {
    return sessionFromCase(row.session);
  }
  return boolValue(row.sessionPresent)
    ? {
        id: sessionId,
        projectId,
        roomId,
        participantId,
        state: "active",
      }
    : undefined;
}

function participantInputFor(group: LeanGroup, row: CaseRow): ParticipantAuthorizationInput {
  if (group.name === "invalidOperation") {
    return {
      operation: "unknown.operation" as ParticipantOperation,
      credential: {
        projectId,
        roomName: "room-a",
        subject,
        grants: grantsFromBits("00000"),
      },
      project: { id: projectId, state: "active" },
      room: { state: "absent", projectId, name: "room-a" },
    };
  }

  const targetMatches = boolValue(row.targetMatch);
  const subjectAbsent = boolValue(row.subjectAbsent);
  const baseCredential = {
    projectId: targetMatches ? projectId : otherProjectId,
    roomName: "room-a",
    subject: subjectAbsent ? "" : subject,
  };

  const operation =
    group.name === "roomCreate"
      ? "room.create"
      : group.name === "roomJoinAbsent" || group.name === "roomJoinPresent"
        ? "room.join"
        : mediaOperationValue(row.operation);

  const participant =
    group.name === "roomJoinPresent" || group.name === "mediaRoomActive"
      ? participantRecordFromCase(row.participant)
      : participantSubjectOnly(row.participant);
  const session = participantSessionFromCase(group, row);

  return {
    operation,
    credential: {
      ...baseCredential,
      grants: grantsFromBits(row.grants ?? "00000"),
    },
    project: { id: projectId, state: projectStateValue(row.projectState) },
    room: participantRoomFromCase(group, row),
    ...(session === undefined ? {} : { session }),
    ...(participant === undefined ? {} : { participant }),
  };
}

function roleValue(value: string | undefined): ProjectUserRole | null | "invalid" {
  if (value === "missing") return null;
  if (value === "invalid") return "invalid";
  if (value === "owner" || value === "admin" || value === "operator" || value === "auditor") {
    return value;
  }
  throw new Error(`unexpected role: ${value ?? "missing"}`);
}

function targetRoleValue(value: string | undefined): ProjectUserRole | undefined {
  if (value === "missing" || value === undefined) return undefined;
  if (value === "invalid") return "invalid" as ProjectUserRole;
  if (value === "owner" || value === "admin" || value === "operator" || value === "auditor") {
    return value;
  }
  throw new Error(`unexpected target role: ${value ?? "missing"}`);
}

function targetIdForOperation(
  operation: ManagementOperation,
): keyof ProjectUserAuthorizationTarget {
  switch (operation) {
    case "projectUser.add":
      return "accountId";
    case "projectUser.remove":
    case "projectUser.changeRole":
      return "projectUserId";
    case "room.update":
    case "room.delete":
      return "roomId";
    case "session.disconnect":
      return "sessionId";
    case "participant.disconnect":
      return "participantId";
    default:
      return "resourceId";
  }
}

function projectUserTarget(
  row: CaseRow,
  operation: ManagementOperation,
): ProjectUserAuthorizationTarget {
  const targetIdPresent = row.targetIdPresent === undefined ? true : boolValue(row.targetIdPresent);
  const targetId = targetIdForOperation(operation);
  const common = {
    projectId: boolValue(row.targetProjectMatch) ? projectId : otherProjectId,
    currentRole: targetRoleValue(row.currentRole),
    nextRole: targetRoleValue(row.nextRole),
  };

  if (!targetIdPresent) {
    return common as ProjectUserAuthorizationTarget;
  }

  switch (targetId) {
    case "accountId":
      return { ...common, accountId } as ProjectUserAuthorizationTarget;
    case "projectUserId":
      return { ...common, projectUserId } as ProjectUserAuthorizationTarget;
    case "roomId":
      return { ...common, roomId } as ProjectUserAuthorizationTarget;
    case "sessionId":
      return { ...common, sessionId } as ProjectUserAuthorizationTarget;
    case "participantId":
      return { ...common, participantId } as ProjectUserAuthorizationTarget;
    default:
      return { ...common, resourceId: "resource-a" } as ProjectUserAuthorizationTarget;
  }
}

function projectUserInputFor(group: LeanGroup, row: CaseRow): ProjectUserAuthorizationInput {
  const operation =
    group.name === "invalidOperation"
      ? ("unknown.operation" as ManagementOperation)
      : (row.operation as ManagementOperation);
  const role = group.name === "invalidOperation" ? "owner" : roleValue(row.actorRole);

  return {
    actor: {
      projectId: boolValue(row.actorProjectMatch) ? projectId : otherProjectId,
      role: role === "invalid" ? ("invalid" as ProjectUserRole) : role,
    },
    project: { id: projectId, state: projectStateValue(row.projectState) },
    operation,
    target: projectUserTarget(row, operation),
  };
}

function scopeSetFromBits(bits: string): readonly ManagementCredentialScope[] {
  const values: ManagementCredentialScope[] = [];
  if (bits[0] === "1") values.push("room.manage");
  if (bits[1] === "1") values.push("session.manage");
  if (bits[2] === "1") values.push("usage.read");
  if (bits[3] === "1") values.push("audit.read");
  return values;
}

function credentialTarget(
  row: CaseRow,
  operation: ManagementOperation,
): ManagementCredentialAuthorizationTarget {
  const targetIdPresent = boolValue(row.targetIdPresent);
  const targetProjectId = boolValue(row.targetProjectMatch) ? projectId : otherProjectId;
  const targetId = targetIdForOperation(operation);

  if (!targetIdPresent) {
    return { projectId: targetProjectId, resourceId: "resource-a" };
  }

  switch (targetId) {
    case "roomId":
      return { projectId: targetProjectId, roomId };
    case "sessionId":
      return { projectId: targetProjectId, sessionId };
    case "participantId":
      return { projectId: targetProjectId, participantId };
    default:
      return { projectId: targetProjectId, resourceId: "resource-a" };
  }
}

function expiresAtFromCase(expiry: string | undefined): number {
  if (expiry === "valid") return 2_000;
  if (expiry === "expired") return 1_000;
  return Number.NaN;
}

function credentialInputFor(row: CaseRow): ManagementCredentialAuthorizationInput {
  const operation =
    row.operation === "invalid"
      ? ("unknown.operation" as ManagementOperation)
      : (row.operation as ManagementOperation);
  const scopes =
    row.scopes === "invalid"
      ? (["unknown.scope"] as unknown as readonly ManagementCredentialScope[])
      : scopeSetFromBits(row.scopes ?? "0000");

  return {
    credential: {
      projectId: boolValue(row.credentialProjectMatch) ? projectId : otherProjectId,
      scopes,
      revoked: boolValue(row.revoked),
      expiresAt: expiresAtFromCase(row.expiry),
    },
    project: { id: projectId, state: projectStateValue(row.projectState) },
    operation,
    target: credentialTarget(row, operation),
    now: 1_000,
  };
}

function expectedDecision(group: LeanGroup, index: number): { allowed: boolean; reason: string } {
  const code = group.reasonCodes[index];
  const reason = group.reasons[Number.parseInt(code ?? "", 36)];
  if (reason === undefined) {
    throw new Error(`missing reason code at ${group.name}[${index}]`);
  }
  return { allowed: group.allowed[index] === "1", reason };
}

function participantRepresentativeInput(
  subjectValue: string,
  participantSubject: string,
): ParticipantAuthorizationInput {
  return {
    operation: "media.publish",
    credential: {
      projectId,
      subject: subjectValue,
      roomName: "room-a",
      grants: {
        "room.create": false,
        "room.join": false,
        "media.publish": true,
        "media.subscribe": false,
        "data.send": false,
      },
    },
    project: { id: projectId, state: "active" },
    room: { state: "active", id: roomId, projectId, name: "room-a" },
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
      externalUserId: participantSubject,
      state: "active",
    },
  };
}

function projectUserRepresentativeInput(
  targetAccountId: typeof accountId,
): ProjectUserAuthorizationInput {
  return {
    actor: { projectId, role: "owner" },
    project: { id: projectId, state: "active" },
    operation: "projectUser.add",
    target: { projectId, accountId: targetAccountId, nextRole: "auditor" },
  };
}

function credentialRepresentativeInput(
  expiresAt: number,
  scopes: readonly ManagementCredentialScope[],
): ManagementCredentialAuthorizationInput {
  return {
    credential: {
      projectId,
      scopes,
      revoked: false,
      expiresAt,
    },
    project: { id: projectId, state: "active" },
    operation: "room.read",
    target: { projectId, resourceId: "room-a" },
    now: 1_000,
  };
}

describe("Lean 認可モデルとの全件照合", () => {
  test("参加 JWT の全ケースで許可・拒否と理由が一致する", () => {
    for (const group of manifest.participant) {
      const rows = rowsFor(group);
      expect(rows.length, group.name).toBe(group.count);
      expect(group.allowed.length, group.name).toBe(group.count);
      expect(group.reasonCodes.length, group.name).toBe(group.count);

      rows.forEach((row, index) => {
        const decision = authorizeParticipantAction(participantInputFor(group, row));
        expect(
          { allowed: decision.allowed, reason: decision.reason },
          `${group.name}[${index}]`,
        ).toStrictEqual(expectedDecision(group, index));
      });
    }
  });

  test("ProjectUser の全ケースで許可・拒否と理由が一致する", () => {
    for (const group of manifest.projectUser) {
      const rows = rowsFor(group);
      expect(rows.length, group.name).toBe(group.count);
      expect(group.allowed.length, group.name).toBe(group.count);
      expect(group.reasonCodes.length, group.name).toBe(group.count);

      rows.forEach((row, index) => {
        const decision = authorizeProjectUserAction(projectUserInputFor(group, row));
        expect(
          { allowed: decision.allowed, reason: decision.reason },
          `${group.name}[${index}]`,
        ).toStrictEqual(expectedDecision(group, index));
      });
    }
  });

  test("Management API credential の全ケースで許可・拒否と理由が一致する", () => {
    for (const group of manifest.credential) {
      const rows = rowsFor(group);
      expect(rows.length, group.name).toBe(group.count);
      expect(group.allowed.length, group.name).toBe(group.count);
      expect(group.reasonCodes.length, group.name).toBe(group.count);

      rows.forEach((row, index) => {
        const decision = authorizeManagementCredentialAction(credentialInputFor(row));
        expect(
          { allowed: decision.allowed, reason: decision.reason },
          `${group.name}[${index}]`,
        ).toStrictEqual(expectedDecision(group, index));
      });
    }
  });

  test("同値類内の代表値を変えても参加 JWT の判定が変わらない", () => {
    const first = authorizeParticipantAction(participantRepresentativeInput(subject, otherSubject));
    const second = authorizeParticipantAction(
      participantRepresentativeInput(otherSubject, subject),
    );

    expect({ allowed: second.allowed, reason: second.reason }).toStrictEqual({
      allowed: first.allowed,
      reason: first.reason,
    });
  });

  test("同値類内の代表値を変えても ProjectUser の判定が変わらない", () => {
    const first = authorizeProjectUserAction(projectUserRepresentativeInput(accountId));
    const second = authorizeProjectUserAction(projectUserRepresentativeInput(otherAccountId));

    expect({ allowed: second.allowed, reason: second.reason }).toStrictEqual({
      allowed: first.allowed,
      reason: first.reason,
    });
  });

  test("同値類内の代表値を変えても credential の判定が変わらない", () => {
    const validFirst = authorizeManagementCredentialAction(
      credentialRepresentativeInput(2_000, ["room.manage", "usage.read"]),
    );
    const validSecond = authorizeManagementCredentialAction(
      credentialRepresentativeInput(3_000, ["usage.read", "room.manage"]),
    );
    const expiredFirst = authorizeManagementCredentialAction(
      credentialRepresentativeInput(1_000, ["room.manage"]),
    );
    const expiredSecond = authorizeManagementCredentialAction(
      credentialRepresentativeInput(500, ["room.manage"]),
    );
    const invalidFirst = authorizeManagementCredentialAction(
      credentialRepresentativeInput(Number.NaN, ["room.manage"]),
    );
    const invalidSecond = authorizeManagementCredentialAction(
      credentialRepresentativeInput(Number.POSITIVE_INFINITY, ["room.manage"]),
    );

    expect({ allowed: validSecond.allowed, reason: validSecond.reason }).toStrictEqual({
      allowed: validFirst.allowed,
      reason: validFirst.reason,
    });
    expect({ allowed: expiredSecond.allowed, reason: expiredSecond.reason }).toStrictEqual({
      allowed: expiredFirst.allowed,
      reason: expiredFirst.reason,
    });
    expect({ allowed: invalidSecond.allowed, reason: invalidSecond.reason }).toStrictEqual({
      allowed: invalidFirst.allowed,
      reason: invalidFirst.reason,
    });
  });
});
