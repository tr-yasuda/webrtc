import type { AccountId, ParticipantId, ProjectId, ProjectUserId, RoomId } from "@webrtc/domain";
import { fc } from "@fast-check/vitest";
import {
  accountId as fixtureAccountId,
  otherParticipantId as fixtureOtherParticipantId,
  otherProjectId as fixtureOtherProjectId,
  otherRoomId as fixtureOtherRoomId,
  otherSessionId as fixtureOtherSessionId,
  otherSubject as fixtureOtherSubject,
  participantId as fixtureParticipantId,
  projectId as fixtureProjectId,
  projectUserId as fixtureProjectUserId,
  roomId as fixtureRoomId,
  sessionId as fixtureSessionId,
  subject as fixtureSubject,
} from "./fixtures.js";

export const DEFAULT_PBT_RUNS = 10_000;
export const DEFAULT_PBT_TIMEOUT_MS = 10_000;

const fixedUnknownValues = [
  "unknown.operation",
  "unknown.role",
  "unknown.scope",
  "constructor",
  "__proto__",
  "superuser",
  "Owner",
] as const;

export type IdPool = {
  readonly projectId: ProjectId;
  readonly otherProjectId: ProjectId;
  readonly roomId: RoomId;
  readonly otherRoomId: RoomId;
  readonly participantId: ParticipantId;
  readonly otherParticipantId: ParticipantId;
  readonly accountId: AccountId;
  readonly projectUserId: ProjectUserId;
  readonly sessionId: string;
  readonly otherSessionId: string;
  readonly subject: string;
  readonly otherSubject: string;
};

// test.prop は性質ごとに Parameters<T> の examples 型が変わるため、共通部分だけを返す。
export type PbtParameters = {
  readonly numRuns: number;
  readonly seed?: number;
  readonly path?: string;
};

export const fixedIdPool: IdPool = {
  projectId: fixtureProjectId,
  otherProjectId: fixtureOtherProjectId,
  roomId: fixtureRoomId,
  otherRoomId: fixtureOtherRoomId,
  participantId: fixtureParticipantId,
  otherParticipantId: fixtureOtherParticipantId,
  accountId: fixtureAccountId,
  projectUserId: fixtureProjectUserId,
  sessionId: fixtureSessionId,
  otherSessionId: fixtureOtherSessionId,
  subject: fixtureSubject,
  otherSubject: fixtureOtherSubject,
};

export function pbtParameters(): PbtParameters {
  const numRuns = readPositiveInteger("PBT_RUNS") ?? DEFAULT_PBT_RUNS;
  const seed = readSeed();
  const path = readNonEmptyString("PBT_PATH");
  if (path !== undefined && seed === undefined) {
    throw new Error("PBT_PATH を指定する場合は PBT_SEED も指定してください");
  }
  return {
    numRuns,
    ...(seed === undefined ? {} : { seed }),
    ...(path === undefined ? {} : { path }),
  };
}

export function pbtTestTimeout(): number {
  return readPositiveInteger("PBT_TIMEOUT_MS") ?? DEFAULT_PBT_TIMEOUT_MS;
}

export function idPoolArbitrary(): fc.Arbitrary<IdPool> {
  return fc
    .tuple(
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
      fc.ulid(),
    )
    .filter((ids) => new Set(ids).size === ids.length)
    .map(
      ([
        projectId,
        otherProjectId,
        roomId,
        otherRoomId,
        participantId,
        otherParticipantId,
        accountId,
        projectUserId,
        sessionId,
        otherSessionId,
        subject,
        otherSubject,
      ]) => ({
        projectId: projectId as ProjectId,
        otherProjectId: otherProjectId as ProjectId,
        roomId: roomId as RoomId,
        otherRoomId: otherRoomId as RoomId,
        participantId: participantId as ParticipantId,
        otherParticipantId: otherParticipantId as ParticipantId,
        accountId: accountId as AccountId,
        projectUserId: projectUserId as ProjectUserId,
        sessionId,
        otherSessionId,
        subject,
        otherSubject,
      }),
    );
}

export function unknownStringArbitrary(knownValues: readonly string[]): fc.Arbitrary<string> {
  const known = new Set(knownValues);
  return fc.oneof(
    fc.constantFrom(...fixedUnknownValues),
    fc.string({ minLength: 1 }).filter((value) => !known.has(value)),
  );
}

function readPositiveInteger(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} は正の整数で指定してください: ${value}`);
  }
  return parsed;
}

function readSeed(): number | undefined {
  const value = process.env.PBT_SEED;
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`PBT_SEED は整数で指定してください: ${value}`);
  }
  return parsed;
}

function readNonEmptyString(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}
