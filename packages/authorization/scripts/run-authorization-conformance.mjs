import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  authorizeManagementCredentialAction,
  authorizeParticipantAction,
  authorizeProjectUserAction,
} from "../dist/index.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const proofsDir = path.join(rootDir, "proofs");
const inputPath = process.argv[2];

const projectId = "project-a";
const otherProjectId = "project-b";
const roomId = "room-a";
const otherRoomId = "room-b";
const participantId = "participant-a";
const otherParticipantId = "participant-b";
const accountId = "account-a";
const projectUserId = "project-user-a";
const sessionId = "session-a";
const subject = "subject-a";
const otherSubject = "subject-b";

function participantInput(input) {
  const project = input.targetMatch ? projectId : otherProjectId;
  const roomName = input.targetMatch ? "room-a" : "room-b";
  const credentialSubject =
    input.subjectClass === "empty" ? "" : input.subjectClass === "match" ? subject : otherSubject;
  const participantExternalUser =
    input.participantSubjectClass === "empty"
      ? ""
      : input.participantSubjectClass === "match"
        ? credentialSubject
        : credentialSubject === subject
          ? otherSubject
          : subject;

  return {
    operation: input.operation,
    credential: {
      projectId: project,
      roomName,
      subject: credentialSubject,
      grants: input.grants,
    },
    project: { id: projectId, state: input.projectState },
    room:
      input.roomState === "absent"
        ? { state: "absent", projectId: project, name: roomName }
        : {
            state: input.roomState,
            id: roomId,
            projectId: project,
            name: roomName,
          },
    ...(input.sessionPresent
      ? {
          session: {
            id: sessionId,
            projectId: input.sessionTargetMatch ? projectId : otherProjectId,
            roomId: input.sessionTargetMatch ? roomId : otherRoomId,
            participantId: input.sessionTargetMatch ? participantId : otherParticipantId,
            state: input.sessionState,
          },
        }
      : {}),
    ...(input.participantPresent
      ? {
          participant: {
            id: participantId,
            roomId: input.participantTargetMatch ? roomId : otherRoomId,
            externalUserId: participantExternalUser,
            state: input.participantState,
          },
        }
      : {}),
  };
}

function projectUserTarget(input) {
  const targetProject = input.targetProjectMatch ? projectId : otherProjectId;
  switch (input.operation) {
    case "projectUser.add":
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { accountId } : {}),
        ...(input.nextRole === null ? {} : { nextRole: input.nextRole }),
      };
    case "projectUser.remove":
    case "projectUser.changeRole":
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { projectUserId } : {}),
        ...(input.currentRole === null ? {} : { currentRole: input.currentRole }),
        ...(input.nextRole === null ? {} : { nextRole: input.nextRole }),
      };
    case "room.update":
    case "room.delete":
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { roomId } : {}),
      };
    case "session.disconnect":
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { sessionId } : {}),
      };
    case "participant.disconnect":
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { participantId } : {}),
      };
    default:
      return {
        projectId: targetProject,
        ...(input.targetIdPresent ? { resourceId: "resource-a" } : {}),
      };
  }
}

function projectUserInput(input) {
  return {
    actor: {
      projectId: input.actorProjectMatch ? projectId : otherProjectId,
      role: input.role === "none" ? null : input.role,
    },
    project: { id: projectId, state: input.projectState },
    operation: input.operation,
    target: projectUserTarget(input),
  };
}

function managementCredentialInput(input) {
  const expiresAt =
    input.expiry === "invalid" ? Number.NaN : input.expiry === "expired" ? 1_000 : 2_000;
  return {
    credential: {
      projectId: input.credentialProjectMatch ? projectId : otherProjectId,
      scopes: Object.entries(input.scopes)
        .filter(([, enabled]) => enabled)
        .map(([scope]) => scope),
      revoked: input.revoked,
      expiresAt,
    },
    project: { id: projectId, state: input.projectState },
    operation: input.operation,
    target: {
      projectId: input.targetProjectMatch ? projectId : otherProjectId,
      ...(input.targetIdPresent
        ? input.operation === "room.update" || input.operation === "room.delete"
          ? { roomId }
          : input.operation === "session.disconnect"
            ? { sessionId }
            : input.operation === "participant.disconnect"
              ? { participantId }
              : { resourceId: "resource-a" }
        : {}),
    },
    now: 1_000,
  };
}

function targetKeys(target) {
  return Object.keys(target).toSorted();
}

function compareDecision(label, expected, actual) {
  const expectedKeys = expected.targetKeys.toSorted();
  const actualKeys = targetKeys(actual.target);
  if (
    expected.allowed !== actual.allowed ||
    expected.reason !== actual.reason ||
    expectedKeys.join("\u0000") !== actualKeys.join("\u0000")
  ) {
    return {
      label,
      expected,
      actual: {
        allowed: actual.allowed,
        reason: actual.reason,
        targetKeys: actualKeys,
      },
    };
  }
  return null;
}

async function* readLines(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    yield line;
  }
}

async function main() {
  let generatedPath = inputPath;
  let temporaryDir;
  if (generatedPath === undefined) {
    temporaryDir = await mkdtemp(path.join(tmpdir(), "authorization-conformance-"));
    generatedPath = path.join(temporaryDir, "cases.jsonl");
    execFileSync(
      "bash",
      [
        "-c",
        'elan run --install "$(cat lean-toolchain)" lake exe authorization-conformance > "$1"',
        "bash",
        generatedPath,
      ],
      { cwd: proofsDir, stdio: "inherit" },
    );
  }

  const counts = { participant: 0, "project-user": 0, "management-credential": 0 };
  const mismatches = [];
  for await (const line of readLines(generatedPath)) {
    if (line.length === 0) {
      continue;
    }
    const entry = JSON.parse(line);
    counts[entry.kind] += 1;
    const actual =
      entry.kind === "participant"
        ? authorizeParticipantAction(participantInput(entry.input))
        : entry.kind === "project-user"
          ? authorizeProjectUserAction(projectUserInput(entry.input))
          : authorizeManagementCredentialAction(managementCredentialInput(entry.input));
    const mismatch = compareDecision(entry.kind, entry.decision, actual);
    if (mismatch !== null && mismatches.length < 10) {
      mismatches.push({ ...mismatch, input: entry.input });
    }
  }

  if (temporaryDir !== undefined) {
    await rm(temporaryDir, { recursive: true, force: true });
  }

  if (mismatches.length > 0) {
    process.stderr.write(`conformance mismatches: ${mismatches.length}\n`);
    process.stderr.write(`${JSON.stringify(mismatches, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `conformance passed: participant=${counts.participant}, project-user=${counts["project-user"]}, management-credential=${counts["management-credential"]}\n`,
  );
}

await main();
