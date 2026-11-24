import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { loadPolicy } from "../../../scripts/authorization-policy.mjs";
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
const manifestPath = path.join(rootDir, ".cache/authorization-conformance.json");
const inputPath = process.argv[2];

const expectedCounts = {
  participant: { cases: 218503, decisions: 218496, validationFailures: 7 },
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

function participantExternalUserId(subjectClass, credentialSubject) {
  switch (subjectClass) {
    case "empty":
      return "";
    case "match":
      return credentialSubject;
    case "mismatch":
    default:
      return credentialSubject === subject ? otherSubject : subject;
  }
}

function participantInput(input) {
  const project = input.targetMatch ? projectId : otherProjectId;
  const roomName = input.targetMatch ? "room-a" : "room-b";
  const credentialSubject =
    input.subjectClass === "empty" ? "" : input.subjectClass === "match" ? subject : otherSubject;
  const participantExternalUser = participantExternalUserId(
    input.participantSubjectClass,
    credentialSubject,
  );

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
    target: managementCredentialTarget(input),
    now: 1_000,
  };
}

function managementCredentialTarget(input) {
  const target = {
    projectId: input.targetProjectMatch ? projectId : otherProjectId,
  };
  if (!input.targetIdPresent) {
    return target;
  }
  switch (input.operation) {
    case "room.update":
    case "room.delete":
      return { ...target, roomId };
    case "session.disconnect":
      return { ...target, sessionId };
    case "participant.disconnect":
      return { ...target, participantId };
    default:
      return { ...target, resourceId: "resource-a" };
  }
}

function compareDecision(label, expected, actual) {
  const expectedKeys = expected.targetKeys.toSorted();
  const actualKeys = Object.keys(actual.target).toSorted();
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

function conformanceGroup(entry) {
  if (entry.kind === "participant") {
    if (entry.caseType === "validation") {
      if (
        entry.validation.reason === "unsupported-grant" ||
        entry.validation.reason === "grant-invalid"
      ) {
        return "participant.invalidGrant";
      }
      if (entry.validation.reason === "unsupported-operation") {
        return "participant.invalidOperation";
      }
      return "participant.invalidInput";
    }
    if (entry.input.operation === "room.create") return "participant.roomCreate";
    if (entry.input.operation === "room.join") {
      return entry.input.roomState === "absent"
        ? "participant.roomJoinAbsent"
        : "participant.roomJoinPresent";
    }
    return entry.input.roomState === "active"
      ? "participant.mediaRoomActive"
      : "participant.mediaRoomInactive";
  }
  if (entry.kind === "project-user") {
    return entry.caseType === "authorization"
      ? "projectUser.validOperation"
      : "projectUser.invalidOperation";
  }
  return "credential.credential";
}

const conformanceByKind = {
  participant: {
    buildAuthorizationInput: participantInput,
    validate: validateParticipantAuthorizationInput,
    authorize: authorizeParticipantAction,
  },
  "project-user": {
    buildAuthorizationInput: projectUserInput,
    validate: validateProjectUserAuthorizationInput,
    authorize: authorizeProjectUserAction,
  },
  "management-credential": {
    buildAuthorizationInput: managementCredentialInput,
    validate: validateManagementCredentialAuthorizationInput,
    authorize: authorizeManagementCredentialAction,
  },
};

async function* readLines(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    yield line;
  }
}

async function main() {
  await rm(manifestPath, { force: true });
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
    Object.keys(conformanceByKind).map((kind) => [
      kind,
      { cases: 0, decisions: 0, validationFailures: 0 },
    ]),
  );
  const mismatches = [];
  const unknownKinds = [];
  const unknownCaseTypes = [];
  const groups = new Map();
  for await (const line of readLines(generatedPath)) {
    if (line.length === 0) {
      continue;
    }
    const entry = JSON.parse(line);
    if (!Object.hasOwn(conformanceByKind, entry.kind)) {
      unknownKinds.push(entry.kind);
      continue;
    }
    if (entry.caseType !== "authorization" && entry.caseType !== "validation") {
      unknownCaseTypes.push(entry.caseType);
      continue;
    }
    counts[entry.kind].cases += 1;
    const group = conformanceGroup(entry);
    const groupCount = groups.get(group) ?? {
      cases: 0,
      decisions: 0,
      validationFailures: 0,
    };
    groupCount.cases += 1;
    groups.set(group, groupCount);
    const subjectConformance = conformanceByKind[entry.kind];
    const raw =
      entry.caseType === "authorization"
        ? subjectConformance.buildAuthorizationInput(entry.input)
        : entry.input;
    const validation = subjectConformance.validate(raw);
    const validationMismatch = compareValidation(entry.kind, entry.validation, validation);
    if (validationMismatch !== null && mismatches.length < 10) {
      mismatches.push({ ...validationMismatch, caseType: entry.caseType, input: entry.input });
    }
    if (!validation.ok) {
      counts[entry.kind].validationFailures += 1;
      groupCount.validationFailures += 1;
      continue;
    }
    counts[entry.kind].decisions += 1;
    groupCount.decisions += 1;
    const actual = subjectConformance.authorize(validation.value);
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
  const policy = loadPolicy();
  const specIdsByGroup = new Map();
  for (const rule of policy.specRules) {
    for (const group of rule.cases ?? []) {
      const specIds = specIdsByGroup.get(group) ?? [];
      specIds.push(rule.id);
      specIdsByGroup.set(group, specIds);
    }
  }
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: policy.schemaVersion,
        groups: Object.fromEntries(
          [...groups.entries()]
            .map(([group, count]) => [
              group,
              {
                ...count,
                specIds: [...new Set(specIdsByGroup.get(group) ?? [])].toSorted(),
              },
            ])
            .toSorted(([left], [right]) => left.localeCompare(right)),
        ),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`conformance passed: ${summary}\n`);
}

await main();
