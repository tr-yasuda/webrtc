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
  validateManagementCredentialAuthorizationInput,
  validateParticipantAuthorizationInput,
  validateProjectUserAuthorizationInput,
} from "../dist/index.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const proofsDir = path.join(rootDir, "proofs");
const inputPath = process.argv[2];

const expectedCounts = {
  participant: { cases: 215046, decisions: 215040, validationFailures: 6 },
  "project-user": { cases: 38010, decisions: 38000, validationFailures: 10 },
  "management-credential": { cases: 29192, decisions: 19456, validationFailures: 9736 },
};

const projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const otherProjectId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const roomId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const otherRoomId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const participantId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const otherParticipantId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const accountId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const projectUserId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
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

function compareValidation(kind, expected, actual) {
  if (expected.ok !== actual.ok || (!expected.ok && expected.reason !== actual.reason)) {
    return {
      kind,
      expectedValidation: expected,
      actualValidation: actual.ok ? { ok: true } : { ok: false, reason: actual.reason },
    };
  }
  return null;
}

function buildAuthorizationInput(kind, input) {
  switch (kind) {
    case "participant":
      return participantInput(input);
    case "project-user":
      return projectUserInput(input);
    case "management-credential":
      return managementCredentialInput(input);
    default:
      throw new Error(`unknown conformance kind: ${kind}`);
  }
}

function validateInput(kind, input) {
  switch (kind) {
    case "participant":
      return validateParticipantAuthorizationInput(input);
    case "project-user":
      return validateProjectUserAuthorizationInput(input);
    case "management-credential":
      return validateManagementCredentialAuthorizationInput(input);
    default:
      throw new Error(`unknown conformance kind: ${kind}`);
  }
}

function authorizeInput(kind, input) {
  switch (kind) {
    case "participant":
      return authorizeParticipantAction(input);
    case "project-user":
      return authorizeProjectUserAction(input);
    case "management-credential":
      return authorizeManagementCredentialAction(input);
    default:
      throw new Error(`unknown conformance kind: ${kind}`);
  }
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

  const counts = Object.fromEntries(
    Object.keys(expectedCounts).map((kind) => [
      kind,
      { cases: 0, decisions: 0, validationFailures: 0 },
    ]),
  );
  const mismatches = [];
  const unknownKinds = [];
  const unknownCaseTypes = [];
  for await (const line of readLines(generatedPath)) {
    if (line.length === 0) {
      continue;
    }
    const entry = JSON.parse(line);
    if (!(entry.kind in counts)) {
      unknownKinds.push(entry.kind);
      continue;
    }
    if (entry.caseType !== "authorization" && entry.caseType !== "validation") {
      unknownCaseTypes.push(entry.caseType);
      continue;
    }
    counts[entry.kind].cases += 1;
    const raw =
      entry.caseType === "authorization"
        ? buildAuthorizationInput(entry.kind, entry.input)
        : entry.input;
    const validation = validateInput(entry.kind, raw);
    const validationMismatch = compareValidation(entry.kind, entry.validation, validation);
    if (validationMismatch !== null && mismatches.length < 10) {
      mismatches.push({ ...validationMismatch, caseType: entry.caseType, input: entry.input });
    }
    if (!validation.ok) {
      counts[entry.kind].validationFailures += 1;
      continue;
    }
    counts[entry.kind].decisions += 1;
    const actual = authorizeInput(entry.kind, validation.value);
    const decisionMismatch = compareDecision(entry.kind, entry.decision, actual);
    if (decisionMismatch !== null && mismatches.length < 10) {
      mismatches.push({ ...decisionMismatch, caseType: entry.caseType, input: entry.input });
    }
  }

  if (temporaryDir !== undefined) {
    await rm(temporaryDir, { recursive: true, force: true });
  }

  const countMismatches = Object.entries(expectedCounts).flatMap(([kind, expected]) =>
    Object.entries(expected).flatMap(([metric, expectedValue]) =>
      counts[kind][metric] === expectedValue
        ? []
        : [{ kind, metric, expected: expectedValue, actual: counts[kind][metric] }],
    ),
  );
  if (countMismatches.length > 0 || unknownKinds.length > 0 || unknownCaseTypes.length > 0) {
    if (countMismatches.length > 0) {
      process.stderr.write(`conformance case count mismatch: ${JSON.stringify(countMismatches)}\n`);
    }
    if (unknownKinds.length > 0) {
      process.stderr.write(`conformance unknown kinds: ${JSON.stringify(unknownKinds)}\n`);
    }
    if (unknownCaseTypes.length > 0) {
      process.stderr.write(`conformance unknown case types: ${JSON.stringify(unknownCaseTypes)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (mismatches.length > 0) {
    process.stderr.write(`conformance mismatches: ${mismatches.length}\n`);
    process.stderr.write(`${JSON.stringify(mismatches, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const summary = Object.entries(counts)
    .map(
      ([kind, count]) =>
        `${kind}=${count.cases}(decisions=${count.decisions}, validationFailures=${count.validationFailures})`,
    )
    .join(", ");
  process.stdout.write(`conformance passed: ${summary}\n`);
}

await main();
