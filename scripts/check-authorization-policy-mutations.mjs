import fs from "node:fs";
import path from "node:path";
import { generateLean, generateTypeScript, loadPolicy, repoRoot } from "./authorization-policy.mjs";

const policy = loadPolicy();
const reportPath = path.join(
  repoRoot,
  "packages/authorization/.cache/authorization-policy-mutations.json",
);

function clone(value) {
  return structuredClone(value);
}

function roleAllows(candidate, role, operation) {
  return (candidate.rolePermissions?.[role] ?? []).includes(operation);
}

function securityInvariants(candidate) {
  const violations = [];
  const roleIds = new Set(candidate.roles ?? []);
  const operations = new Map(
    (candidate.operations ?? []).map((operation) => [operation.id, operation]),
  );
  const grants = new Set((candidate.grants ?? []).map((grant) => grant.id));
  const participantOperations = candidate.participantOperations ?? [];
  const projectUserOperations = [...operations.values()]
    .filter((operation) => operation.category === "projectUser")
    .map((operation) => operation.id);
  const credentialProjectUserOperations = new Set(
    candidate.constraints?.credentialProjectUserOperations ?? [],
  );

  if (candidate.constraints?.participantSubject?.required !== true) {
    violations.push("参加 JWT の subject 必須制約が無効です");
  }
  if (candidate.constraints?.participantSubject?.matchParticipantExternalUserId !== true) {
    violations.push("参加 JWT の subject 一致制約が無効です");
  }

  for (const operation of participantOperations) {
    if (operation.grant !== operation.id) {
      violations.push(`participantOperation の grant が操作と一致しません: ${operation.id}`);
    }
    if (!grants.has(operation.grant)) {
      violations.push(`participantOperation の grant 参照がありません: ${operation.id}`);
    }
  }
  const roomCreate = participantOperations.find((operation) => operation.id === "room.create");
  if (roomCreate !== undefined) {
    if (!(roomCreate.requiresGrant ?? []).includes("room.join")) {
      violations.push("room.create に room.join grant の要求がありません");
    }
    if (roomCreate.requiresExistingRoom !== false) {
      violations.push("room.create が既存 Room を要求しています");
    }
  }
  const roomJoin = participantOperations.find((operation) => operation.id === "room.join");
  if (roomJoin !== undefined) {
    if (!(roomJoin.requiresGrantWhenRoomAbsent ?? []).includes("room.create")) {
      violations.push("未作成 Room への room.join に room.create grant の要求がありません");
    }
    if (roomJoin.requiresExistingRoom !== true) {
      violations.push("room.join の既存 Room 条件がありません");
    }
  }
  for (const operation of participantOperations) {
    if (
      ["media.publish", "media.subscribe", "data.send"].includes(operation.id) &&
      operation.requiresExistingRoom !== true
    ) {
      violations.push(`media operation の既存 Room 条件がありません: ${operation.id}`);
    }
  }
  for (const operation of operations.values()) {
    if (operation.projectUserTarget !== "none") {
      if (
        candidate.targetRequirements?.projectUser?.[operation.id] !== operation.projectUserTarget
      ) {
        violations.push(`ProjectUser の対象 ID 要件がありません: ${operation.id}`);
      }
    }
    if (operation.credentialTarget !== "none") {
      if (candidate.targetRequirements?.credential?.[operation.id] !== operation.credentialTarget) {
        violations.push(`credential の対象 ID 要件がありません: ${operation.id}`);
      }
    }
  }

  for (const role of roleIds) {
    if (!Array.isArray(candidate.rolePermissions?.[role])) {
      violations.push(`rolePermissions がありません: ${role}`);
    }
  }
  if (roleAllows(candidate, "admin", "project.delete")) {
    violations.push("Admin に project.delete が許可されています");
  }
  for (const operation of ["projectUser.add", "projectUser.remove", "projectUser.changeRole"]) {
    if (!roleAllows(candidate, "admin", operation)) {
      violations.push(`Admin の ProjectUser 管理権限がありません: ${operation}`);
    }
  }
  const adminOwner = candidate.constraints?.adminOwnerManagement ?? {};
  if (!(adminOwner["projectUser.add"] ?? []).includes("nextRole")) {
    violations.push("Admin の Owner 付与制約がありません");
  }
  if (!(adminOwner["projectUser.remove"] ?? []).includes("currentRole")) {
    violations.push("Admin の Owner 除外制約がありません");
  }
  if (
    !(adminOwner["projectUser.changeRole"] ?? []).includes("currentRole") ||
    !(adminOwner["projectUser.changeRole"] ?? []).includes("nextRole")
  ) {
    violations.push("Admin の Owner ロール変更制約がありません");
  }

  for (const operation of projectUserOperations) {
    if (!credentialProjectUserOperations.has(operation)) {
      violations.push(`credential の ProjectUser 非継承対象がありません: ${operation}`);
    }
  }
  for (const operation of credentialProjectUserOperations) {
    if (!projectUserOperations.includes(operation)) {
      violations.push(`credential の ProjectUser 非継承対象が不正です: ${operation}`);
    }
  }

  const scopeOperationIds = new Set((candidate.scopes ?? []).flatMap((scope) => scope.operations));
  for (const forbidden of [
    "project.read",
    "project.update",
    "project.delete",
    "projectUser.add",
    "projectUser.remove",
    "projectUser.changeRole",
    "application.manage",
    "managementApiCredential.manage",
  ]) {
    if (scopeOperationIds.has(forbidden)) {
      violations.push(`credential scope が許可してはいけない操作を含みます: ${forbidden}`);
    }
  }

  const invalidClasses = new Set(candidate.timeContract?.invalidClasses ?? []);
  for (const invalidClass of ["fractional", "nonFinite", "outOfSafeRange"]) {
    if (!invalidClasses.has(invalidClass)) {
      violations.push(`時刻契約の不正クラスがありません: ${invalidClass}`);
    }
  }
  if (
    candidate.timeContract?.unit !== "unixEpochMilliseconds" ||
    candidate.timeContract?.type !== "safeInteger"
  ) {
    violations.push("時刻契約の単位または型が不正です");
  }

  return violations;
}

const baseViolations = securityInvariants(policy);
if (baseViolations.length > 0) {
  console.error(
    `基準ポリシーがセキュリティ不変条件に違反しています:\n${baseViolations.join("\n")}`,
  );
  process.exit(1);
}

const mutations = [
  {
    id: "participant-subject-match-disabled",
    specId: "AUTH-PART-01",
    apply(candidate) {
      candidate.constraints.participantSubject.matchParticipantExternalUserId = false;
    },
  },
  {
    id: "participant-grant-mismatch",
    specId: "AUTH-PART-05",
    apply(candidate) {
      candidate.participantOperations[1].grant = "room.create";
    },
  },
  {
    id: "room-create-required-grant-removed",
    specId: "AUTH-PART-02",
    apply(candidate) {
      candidate.participantOperations[0].requiresGrant = [];
    },
  },
  {
    id: "admin-owner-add-constraint-removed",
    specId: "AUTH-PU-03",
    apply(candidate) {
      delete candidate.constraints.adminOwnerManagement["projectUser.add"];
    },
  },
  {
    id: "project-user-target-requirement-removed",
    specId: "AUTH-PU-05",
    apply(candidate) {
      delete candidate.targetRequirements.projectUser["session.disconnect"];
    },
  },
  {
    id: "credential-scope-expanded",
    specId: "AUTH-MC-01",
    apply(candidate) {
      candidate.scopes[0].operations.push("project.read");
    },
  },
  {
    id: "credential-project-user-scope-expanded",
    specId: "AUTH-MC-02",
    apply(candidate) {
      candidate.scopes[0].operations.push("projectUser.remove");
    },
  },
  {
    id: "credential-project-user-operation-removed",
    specId: "AUTH-MC-02",
    apply(candidate) {
      candidate.constraints.credentialProjectUserOperations =
        candidate.constraints.credentialProjectUserOperations.filter(
          (operation) => operation !== "projectUser.add",
        );
    },
  },
  {
    id: "credential-target-requirement-removed",
    specId: "AUTH-MC-05",
    apply(candidate) {
      delete candidate.targetRequirements.credential["session.disconnect"];
    },
  },
  {
    id: "time-invalid-class-removed",
    specId: "AUTH-MC-06",
    apply(candidate) {
      candidate.timeContract.invalidClasses = candidate.timeContract.invalidClasses.filter(
        (invalidClass) => invalidClass !== "fractional",
      );
    },
  },
];

const results = [];
for (const mutation of mutations) {
  const candidate = clone(policy);
  mutation.apply(candidate);
  generateTypeScript(candidate);
  generateLean(candidate);
  const violations = securityInvariants(candidate);
  results.push({
    mutation: mutation.id,
    specId: mutation.specId,
    detected: violations.length > 0,
    violations,
  });
}

const missed = results.filter((result) => !result.detected);
if (missed.length > 0) {
  console.error(
    `セキュリティ不変条件が検出できなかった仕様 mutation があります:\n${missed
      .map((result) => `${result.specId} / ${result.mutation}`)
      .join("\n")}`,
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ results }, null, 2)}\n`);
console.log(`仕様 mutation を検出しました: ${results.length} 件`);
