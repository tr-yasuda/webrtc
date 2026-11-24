import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { parseTree } from "jsonc-parser";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const policyPath = path.join(
  repoRoot,
  "docs/auth/authorization-spec/authorization-policy.json",
);
export const schemaPath = path.join(
  repoRoot,
  "docs/auth/authorization-spec/authorization-policy.schema.json",
);
export const generatedTypeScriptPath = path.join(
  repoRoot,
  "packages/authorization/src/generated/policy.ts",
);
export const generatedLeanPath = path.join(
  repoRoot,
  "packages/authorization/proofs/AuthorizationVerification/GeneratedPolicy.lean",
);

const verificationMethods = new Set([
  "lean_proof",
  "conformance",
  "typescript_test",
  "property_test",
  "mutation",
  "review",
  "out_of_scope",
  "ci_script",
]);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkTree(node, visit) {
  if (node === undefined) return;
  visit(node);
  for (const child of node.children ?? []) walkTree(child, visit);
}

export function findDuplicateKeys(text) {
  const tree = parseTree(text);
  if (tree === undefined) return ["JSON を構文解析できません。"];

  const errors = [];
  const visit = (node) => {
    if (node.type !== "object") return;
    const keys = new Set();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const key = keyNode?.value;
      if (typeof key !== "string") continue;
      if (keys.has(key)) {
        errors.push(`重複キーがあります: ${key} (offset ${keyNode.offset})`);
      }
      keys.add(key);
    }
  };
  walkTree(tree, visit);
  return errors;
}

export function loadPolicy() {
  const text = readText(policyPath);
  const duplicateErrors = findDuplicateKeys(text);
  if (duplicateErrors.length > 0) {
    throw new Error(duplicateErrors.join("\n"));
  }
  return JSON.parse(text);
}

function uniqueErrors(values, label) {
  const seen = new Set();
  const errors = [];
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label} が重複しています: ${value}`);
    seen.add(value);
  }
  return errors;
}

function ensureReference(errors, set, value, label) {
  if (!set.has(value)) errors.push(`${label} の参照先がありません: ${value}`);
}

export function validatePolicy(policy, root = repoRoot) {
  const errors = [];
  const schema = JSON.parse(readText(schemaPath));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(schema);
  if (!validate(policy)) {
    for (const error of validate.errors ?? []) {
      errors.push(`JSON Schema: ${error.instancePath || "/"} ${error.message ?? "unknown error"}`);
    }
  }

  const roleIds = policy.roles ?? [];
  const operationIds = (policy.operations ?? []).map((operation) => operation.id);
  const scopeIds = (policy.scopes ?? []).map((scope) => scope.id);
  const grantIds = (policy.grants ?? []).map((grant) => grant.id);
  const participantOperationIds = (policy.participantOperations ?? []).map(
    (operation) => operation.id,
  );
  const specRules = policy.specRules ?? [];
  errors.push(...uniqueErrors(roleIds, "role"));
  errors.push(...uniqueErrors(operationIds, "operation"));
  errors.push(...uniqueErrors(scopeIds, "scope"));
  errors.push(...uniqueErrors(grantIds, "grant"));
  errors.push(...uniqueErrors(participantOperationIds, "participantOperation"));
  errors.push(
    ...uniqueErrors(
      specRules.map((rule) => rule.id),
      "specRule",
    ),
  );

  const roleSet = new Set(roleIds);
  const operationSet = new Set(operationIds);
  const grantSet = new Set(grantIds);
  const participantOperationSet = new Set(participantOperationIds);
  const specSet = new Set(specRules.map((rule) => rule.id));

  if (policy.timeContract !== undefined) {
    ensureReference(errors, specSet, policy.timeContract.id, "timeContract.id");
  }

  if (grantSet.size !== participantOperationSet.size) {
    errors.push("grant と participantOperation の集合が一致しません。");
  }
  for (const grant of grantSet) {
    if (!participantOperationSet.has(grant)) {
      errors.push(`participantOperation がありません: ${grant}`);
    }
  }
  for (const operation of participantOperationSet) {
    if (!grantSet.has(operation)) {
      errors.push(`grant がありません: ${operation}`);
    }
  }

  const rolePermissionKeys = Object.keys(policy.rolePermissions ?? {});
  for (const role of roleSet) {
    if (!rolePermissionKeys.includes(role)) {
      errors.push(`rolePermissions がありません: ${role}`);
    }
  }
  for (const [role, operations] of Object.entries(policy.rolePermissions ?? {})) {
    ensureReference(errors, roleSet, role, "rolePermissions key");
    errors.push(...uniqueErrors(operations, `rolePermissions.${role}`));
    for (const operation of operations) {
      ensureReference(errors, operationSet, operation, `rolePermissions.${role}`);
    }
  }

  const operationsById = new Map(
    (policy.operations ?? []).map((operation) => [operation.id, operation]),
  );
  for (const scope of policy.scopes ?? []) {
    for (const operation of scope.operations) {
      ensureReference(errors, operationSet, operation, `scope ${scope.id}`);
    }
  }

  for (const participantOperation of policy.participantOperations ?? []) {
    ensureReference(errors, grantSet, participantOperation.grant, "participantOperation.grant");
    for (const grant of participantOperation.requiresGrant ?? []) {
      ensureReference(errors, grantSet, grant, "participantOperation.requiresGrant");
    }
    for (const grant of participantOperation.requiresGrantWhenRoomAbsent ?? []) {
      ensureReference(errors, grantSet, grant, "participantOperation.requiresGrantWhenRoomAbsent");
    }
  }

  for (const [operation, field] of Object.entries(policy.targetRequirements?.projectUser ?? {})) {
    ensureReference(errors, operationSet, operation, "targetRequirements.projectUser");
    const definition = operationsById.get(operation);
    if (definition !== undefined && definition.projectUserTarget !== field) {
      errors.push(`projectUserTarget と targetRequirements が一致しません: ${operation}`);
    }
  }
  for (const [operation, field] of Object.entries(policy.targetRequirements?.credential ?? {})) {
    ensureReference(errors, operationSet, operation, "targetRequirements.credential");
    const definition = operationsById.get(operation);
    if (definition !== undefined && definition.credentialTarget !== field) {
      errors.push(`credentialTarget と targetRequirements が一致しません: ${operation}`);
    }
  }
  for (const operation of policy.operations ?? []) {
    if (
      operation.projectUserTarget !== "none" &&
      policy.targetRequirements?.projectUser?.[operation.id] !== operation.projectUserTarget
    ) {
      errors.push(`projectUserTarget が targetRequirements にありません: ${operation.id}`);
    }
    if (
      operation.credentialTarget !== "none" &&
      policy.targetRequirements?.credential?.[operation.id] !== operation.credentialTarget
    ) {
      errors.push(`credentialTarget が targetRequirements にありません: ${operation.id}`);
    }
  }

  for (const operation of Object.keys(policy.constraints?.adminOwnerManagement ?? {})) {
    ensureReference(errors, operationSet, operation, "adminOwnerManagement");
  }
  const projectUserOperations = new Set(
    (policy.operations ?? [])
      .filter((operation) => operation.category === "projectUser")
      .map((operation) => operation.id),
  );
  const credentialProjectUserOperations = new Set(
    policy.constraints?.credentialProjectUserOperations ?? [],
  );
  for (const operation of projectUserOperations) {
    if (!credentialProjectUserOperations.has(operation)) {
      errors.push(`credentialProjectUserOperations にありません: ${operation}`);
    }
  }
  for (const operation of credentialProjectUserOperations) {
    if (!projectUserOperations.has(operation)) {
      errors.push(
        `credentialProjectUserOperations が projectUser 以外を参照しています: ${operation}`,
      );
    }
  }

  const caseGroupNames = new Set();
  for (const [kind, groups] of Object.entries(policy.caseGroups ?? {})) {
    for (const group of groups) {
      const fullName = `${kind}.${group}`;
      if (caseGroupNames.has(fullName)) {
        errors.push(`caseGroup が重複しています: ${fullName}`);
      }
      caseGroupNames.add(fullName);
    }
  }

  const referencedCases = new Set();
  for (const rule of specRules) {
    if (!Array.isArray(rule.verification) || rule.verification.length === 0) {
      errors.push(`verification がありません: ${rule.id}`);
    }
    for (const method of rule.verification ?? []) {
      if (!verificationMethods.has(method)) {
        errors.push(`未知の verification method です: ${rule.id} / ${method}`);
      }
    }
    if (rule.verification?.includes("conformance") && (rule.cases ?? []).length === 0) {
      errors.push(`conformance の cases がありません: ${rule.id}`);
    }
    for (const caseName of rule.cases ?? []) {
      ensureReference(errors, caseGroupNames, caseName, `specRule ${rule.id} case`);
      referencedCases.add(caseName);
    }
    if (rule.verification?.includes("out_of_scope")) {
      if (typeof rule.reason !== "string" || rule.reason.length === 0) {
        errors.push(`out_of_scope の理由がありません: ${rule.id}`);
      }
      if (typeof rule.tracking !== "string" || rule.tracking.length === 0) {
        errors.push(`out_of_scope の追跡先がありません: ${rule.id}`);
      }
    }
    if (rule.verification?.includes("ci_script")) {
      if ((rule.scripts ?? []).length === 0) {
        errors.push(`ci_script の scripts がありません: ${rule.id}`);
      }
      for (const script of rule.scripts ?? []) {
        if (!fs.existsSync(path.join(root, script))) {
          errors.push(`ci_script が存在しません: ${rule.id} / ${script}`);
        }
      }
    }
  }
  for (const caseName of caseGroupNames) {
    if (!referencedCases.has(caseName)) {
      errors.push(`どの specRule からも参照されていない caseGroup です: ${caseName}`);
    }
  }

  return errors;
}

export function toCamel(id) {
  return id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

function leanString(value) {
  return JSON.stringify(value);
}

function sourceHash(policy) {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

function leanConstructorList(values) {
  return `[${values.map((value) => `.${toCamel(value)}`).join(", ")}]`;
}

function leanMediaConstructorList(values) {
  return `[${values.map((value) => `.${mediaConstructor(value)}`).join(", ")}]`;
}

function scopeMap(policy) {
  const result = new Map();
  for (const scope of policy.scopes) {
    for (const operation of scope.operations) {
      const current = result.get(operation) ?? [];
      current.push(scope.id);
      result.set(operation, current);
    }
  }
  return result;
}

export function generateTypeScript(policy) {
  const roles = policy.roles;
  const operations = policy.operations;
  const scopes = policy.scopes;
  const grants = policy.grants;
  const participantOperations = policy.participantOperations;
  const mediaOperations = participantOperations
    .filter((operation) => !["room.create", "room.join"].includes(operation.id))
    .map((operation) => operation.id);
  const targets = policy.targetRequirements;
  const adminOwner = policy.constraints.adminOwnerManagement;
  const operationScopes = scopeMap(policy);

  const lines = [
    `/* @generated from docs/auth/authorization-spec/authorization-policy.json schemaVersion=${policy.schemaVersion} sourceSha256=${sourceHash(policy)}; do not edit. */`,
    "",
    `export const projectUserRoleValues = ${JSON.stringify(roles)} as const;`,
    "export type ProjectUserRole = (typeof projectUserRoleValues)[number];",
    `export const projectUserRoleSet: ReadonlySet<ProjectUserRole> = new Set(projectUserRoleValues);`,
    "",
    `export const managementOperationValues = ${JSON.stringify(
      operations.map((operation) => operation.id),
    )} as const;`,
    "export type ManagementOperation = (typeof managementOperationValues)[number];",
    `export const managementOperationSet: ReadonlySet<ManagementOperation> = new Set(managementOperationValues);`,
    "",
    `export const managementCredentialScopeValues = ${JSON.stringify(
      scopes.map((scope) => scope.id),
    )} as const;`,
    "export type ManagementCredentialScope = (typeof managementCredentialScopeValues)[number];",
    `export const managementCredentialScopeSet: ReadonlySet<ManagementCredentialScope> = new Set(managementCredentialScopeValues);`,
    "",
    `export const participantOperationValues = ${JSON.stringify(
      participantOperations.map((operation) => operation.id),
    )} as const;`,
    "export type ParticipantOperation = (typeof participantOperationValues)[number];",
    `export const participantOperationSet: ReadonlySet<ParticipantOperation> = new Set(participantOperationValues);`,
    "",
    `export const participantGrantNames = ${JSON.stringify(
      grants.map((grant) => grant.id),
    )} as const;`,
    "export type ParticipantGrants = Readonly<Record<ParticipantOperation, boolean>>;",
    "",
    `export const mediaOperationValues = ${JSON.stringify(mediaOperations)} as const;`,
    "export type MediaOperation = (typeof mediaOperationValues)[number];",
    "",
    "export const operationScopes: Partial<Record<ManagementOperation, readonly ManagementCredentialScope[]>> = {",
    ...[...operationScopes.entries()].map(
      ([operation, requiredScopes]) =>
        `  ${JSON.stringify(operation)}: ${JSON.stringify(requiredScopes)},`,
    ),
    "};",
    "",
    "export const roleOperations: Record<ProjectUserRole, ReadonlySet<ManagementOperation>> = {",
    ...roles.map(
      (role) =>
        `  ${JSON.stringify(role)}: new Set<ManagementOperation>(${JSON.stringify(
          policy.rolePermissions[role],
        )}),`,
    ),
    "};",
    "",
    "export const projectUserTargetFields: Partial<Record<ManagementOperation, string>> = {",
    ...Object.entries(targets.projectUser).map(
      ([operation, field]) => `  ${JSON.stringify(operation)}: ${JSON.stringify(field)},`,
    ),
    "};",
    "",
    "export const credentialTargetFields: Partial<Record<ManagementOperation, string>> = {",
    ...Object.entries(targets.credential).map(
      ([operation, field]) => `  ${JSON.stringify(operation)}: ${JSON.stringify(field)},`,
    ),
    "};",
    "",
    'export const adminOwnerManagementFields: Partial<Record<ManagementOperation, readonly ("currentRole" | "nextRole")[]>> = {',
    ...Object.entries(adminOwner).map(
      ([operation, fields]) => `  ${JSON.stringify(operation)}: ${JSON.stringify(fields)},`,
    ),
    "};",
    "",
    `export const credentialProjectUserOperations = ${JSON.stringify(
      policy.constraints.credentialProjectUserOperations,
    )} as const;`,
    "",
    "export const participantSubjectConstraints = {",
    `  required: ${JSON.stringify(policy.constraints.participantSubject.required)},`,
    `  matchParticipantExternalUserId: ${JSON.stringify(policy.constraints.participantSubject.matchParticipantExternalUserId)},`,
    "} as const;",
    "",
    "export const timeContract = {",
    `  unit: ${JSON.stringify(policy.timeContract.unit)},`,
    `  type: ${JSON.stringify(policy.timeContract.type)},`,
    "  minSafeInteger: -9007199254740991,",
    "  maxSafeInteger: 9007199254740991,",
    "} as const;",
    "",
  ];
  return lines.join("\n");
}

export function generateLean(policy) {
  const roles = policy.roles;
  const operations = policy.operations.map((operation) => operation.id);
  const scopes = policy.scopes.map((scope) => scope.id);
  const grants = policy.grants.map((grant) => grant.id);
  const participantOperations = policy.participantOperations.map((operation) => operation.id);
  const mediaOperations = participantOperations.filter(
    (operation) => !["room.create", "room.join"].includes(operation),
  );
  const operationScopes = scopeMap(policy);
  const projectUserTargets = policy.targetRequirements.projectUser;
  const credentialTargets = policy.targetRequirements.credential;

  const roleConstructors = roles.map((role) => `  | ${toCamel(role)}`).join("\n");
  const operationConstructors = operations
    .map((operation) => `  | ${toCamel(operation)}`)
    .join("\n");
  const scopeConstructors = scopes.map((scope) => `  | ${toCamel(scope)}`).join("\n");
  const participantOperationConstructors = participantOperations
    .map((operation) => `  | ${toCamel(operation)}`)
    .join("\n");
  const mediaConstructors = mediaOperations
    .map((operation) => `  | ${mediaConstructor(operation)}`)
    .join("\n");
  const grantFields = grants.map((grant) => `  ${toCamel(grant)} : Bool`).join("\n");

  const roleToString = roles
    .map((role) => `  | .${toCamel(role)} => ${leanString(role)}`)
    .join("\n");
  const roleFromString = roles
    .map((role) => `  | ${leanString(role)} => some .${toCamel(role)}`)
    .join("\n");
  const operationToString = operations
    .map((operation) => `  | .${toCamel(operation)} => ${leanString(operation)}`)
    .join("\n");
  const operationFromString = operations
    .map((operation) => `  | ${leanString(operation)} => some .${toCamel(operation)}`)
    .join("\n");
  const scopeToString = scopes
    .map((scope) => `  | .${toCamel(scope)} => ${leanString(scope)}`)
    .join("\n");
  const scopeFromString = scopes
    .map((scope) => `  | ${leanString(scope)} => some .${toCamel(scope)}`)
    .join("\n");
  const participantOperationToString = participantOperations
    .map((operation) => `  | .${toCamel(operation)} => ${leanString(operation)}`)
    .join("\n");
  const mediaToString = mediaOperations
    .map((operation) => `  | .${mediaConstructor(operation)} => ${leanString(operation)}`)
    .join("\n");
  const mediaToParticipant = mediaOperations
    .map((operation) => `  | .${mediaConstructor(operation)} => .${toCamel(operation)}`)
    .join("\n");
  const caseGroupSpecIds = [];
  for (const [kind, groups] of Object.entries(policy.caseGroups)) {
    for (const group of groups) {
      const fullName = `${kind}.${group}`;
      const ids = policy.specRules
        .filter((rule) => (rule.cases ?? []).includes(fullName))
        .map((rule) => rule.id);
      caseGroupSpecIds.push(
        `  | ${leanString(kind)}, ${leanString(group)} => [${ids
          .map((id) => leanString(id))
          .join(", ")}]`,
      );
    }
  }

  const roleAllows = roles
    .flatMap((role) =>
      policy.rolePermissions[role].map(
        (operation) => `  | .${toCamel(role)}, .${toCamel(operation)} => true`,
      ),
    )
    .join("\n");
  const projectUserTargetsLean = Object.keys(projectUserTargets)
    .map((operation) => `  | .${toCamel(operation)} => true`)
    .join("\n");
  const credentialTargetsLean = Object.keys(credentialTargets)
    .map((operation) => `  | .${toCamel(operation)} => true`)
    .join("\n");
  const requiredScopesLean = [...operationScopes.entries()]
    .map(
      ([operation, values]) =>
        `  | .${toCamel(operation)} => some [${values.map((scope) => `.${toCamel(scope)}`).join(", ")}]`,
    )
    .join("\n");
  const adminOwnerLean = Object.entries(policy.constraints.adminOwnerManagement)
    .map(
      ([operation, fields]) =>
        `  | .${toCamel(operation)} => [${fields
          .map((field) => `OwnerField.${field}`)
          .join(", ")}]`,
    )
    .join("\n");

  return `-- @generated from docs/auth/authorization-spec/authorization-policy.json schemaVersion=${policy.schemaVersion} sourceSha256=${sourceHash(policy)}; do not edit.

namespace AuthorizationVerification

inductive Role where
${roleConstructors}
deriving DecidableEq, Repr

def Role.toString : Role -> String
${roleToString}

def Role.fromString? : String -> Option Role
${roleFromString}
  | _ => none

def allRoles : List Role := ${leanConstructorList(roles)}

inductive Operation where
${operationConstructors}
deriving DecidableEq, Repr

def Operation.toString : Operation -> String
${operationToString}

def Operation.fromString? : String -> Option Operation
${operationFromString}
  | _ => none

def allOperations : List Operation := ${leanConstructorList(operations)}

inductive ParticipantOperation where
${participantOperationConstructors}
deriving DecidableEq, Repr

def ParticipantOperation.toString : ParticipantOperation -> String
${participantOperationToString}

def allParticipantOperations : List ParticipantOperation := ${leanConstructorList(participantOperations)}

inductive MediaOperation where
${mediaConstructors}
deriving DecidableEq, Repr

def MediaOperation.toString : MediaOperation -> String
${mediaToString}

def MediaOperation.toParticipantOperation : MediaOperation -> ParticipantOperation
${mediaToParticipant}

def allMediaOperations : List MediaOperation := ${leanMediaConstructorList(mediaOperations)}

inductive Scope where
${scopeConstructors}
deriving DecidableEq, Repr

def Scope.toString : Scope -> String
${scopeToString}

def Scope.fromString? : String -> Option Scope
${scopeFromString}
  | _ => none

def allScopes : List Scope := ${leanConstructorList(scopes)}

structure Grants where
${grantFields}
deriving DecidableEq, Repr

def allGrants : List Grants :=
  [false, true].flatMap fun roomCreate =>
  [false, true].flatMap fun roomJoin =>
  [false, true].flatMap fun mediaPublish =>
  [false, true].flatMap fun mediaSubscribe =>
  [false, true].map fun dataSend =>
  { roomCreate := roomCreate
    roomJoin := roomJoin
    mediaPublish := mediaPublish
    mediaSubscribe := mediaSubscribe
    dataSend := dataSend
  }

inductive OwnerField where
  | currentRole
  | nextRole
deriving DecidableEq, Repr

def roleAllows : Role -> Operation -> Bool
${roleAllows}
  | _, _ => false

def requiresTargetId : Operation -> Bool
${projectUserTargetsLean}
  | _ => false

def credentialRequiresTargetId : Operation -> Bool
${credentialTargetsLean}
  | _ => false

def requiredScopes : Operation -> Option (List Scope)
${requiredScopesLean}
  | _ => none

def adminOwnerManagementFields : Operation -> List OwnerField
${adminOwnerLean}
  | _ => []

def credentialProjectUserOperations : List Operation :=
  [${policy.constraints.credentialProjectUserOperations
    .map((operation) => `.${toCamel(operation)}`)
    .join(", ")}]

def participantSubjectRequired : Bool :=
  ${policy.constraints.participantSubject.required ? "true" : "false"}

def participantSubjectMustMatch : Bool :=
  ${policy.constraints.participantSubject.matchParticipantExternalUserId ? "true" : "false"}

def caseGroupSpecIds : String -> String -> List String
${caseGroupSpecIds.join("\n")}
  | _, _ => []

def minSafeInteger : Int := -9007199254740991
def maxSafeInteger : Int := 9007199254740991

end AuthorizationVerification
`;
}

function mediaConstructor(operation) {
  if (operation === "media.publish") return "publish";
  if (operation === "media.subscribe") return "subscribe";
  return toCamel(operation);
}

export function semanticDiff(base, next) {
  const lines = [];
  const compareSet = (label, baseValues, nextValues) => {
    const baseSet = new Set(baseValues);
    const nextSet = new Set(nextValues);
    for (const value of nextSet) if (!baseSet.has(value)) lines.push(`追加 ${label}: ${value}`);
    for (const value of baseSet) if (!nextSet.has(value)) lines.push(`削除 ${label}: ${value}`);
  };
  compareSet("role", base.roles, next.roles);
  compareSet(
    "operation",
    base.operations.map((operation) => operation.id),
    next.operations.map((operation) => operation.id),
  );
  compareSet(
    "scope",
    base.scopes.map((scope) => scope.id),
    next.scopes.map((scope) => scope.id),
  );
  compareSet(
    "grant",
    base.grants.map((grant) => grant.id),
    next.grants.map((grant) => grant.id),
  );
  compareSet(
    "spec rule",
    base.specRules.map((rule) => rule.id),
    next.specRules.map((rule) => rule.id),
  );
  for (const role of next.roles) {
    const before = new Set(base.rolePermissions?.[role] ?? []);
    const after = new Set(next.rolePermissions?.[role] ?? []);
    for (const operation of after) {
      if (!before.has(operation)) lines.push(`許可追加 ${role}: ${operation}`);
    }
    for (const operation of before) {
      if (!after.has(operation)) lines.push(`許可削除 ${role}: ${operation}`);
    }
  }
  for (const scope of next.scopes ?? []) {
    const before = new Set(
      (base.scopes ?? []).find((candidate) => candidate.id === scope.id)?.operations ?? [],
    );
    const after = new Set(scope.operations ?? []);
    for (const operation of after) {
      if (!before.has(operation)) lines.push(`scope 許可追加 ${scope.id}: ${operation}`);
    }
    for (const operation of before) {
      if (!after.has(operation)) lines.push(`scope 許可削除 ${scope.id}: ${operation}`);
    }
  }
  const baseOperations = new Map(
    (base.operations ?? []).map((operation) => [operation.id, operation]),
  );
  for (const operation of next.operations ?? []) {
    const before = baseOperations.get(operation.id);
    if (before === undefined) continue;
    for (const field of ["category", "projectUserTarget", "credentialTarget"]) {
      if (before[field] !== operation[field]) {
        lines.push(
          `operation ${field} 変更 ${operation.id}: ${before[field]} -> ${operation[field]}`,
        );
      }
    }
  }
  const baseParticipantOperations = new Map(
    (base.participantOperations ?? []).map((operation) => [operation.id, operation]),
  );
  for (const operation of next.participantOperations ?? []) {
    const before = baseParticipantOperations.get(operation.id);
    if (before === undefined) continue;
    for (const field of [
      "grant",
      "requiresGrant",
      "requiresGrantWhenRoomAbsent",
      "requiresExistingRoom",
    ]) {
      if (JSON.stringify(before[field]) !== JSON.stringify(operation[field])) {
        lines.push(
          `participantOperation ${field} 変更 ${operation.id}: ${JSON.stringify(before[field])} -> ${JSON.stringify(operation[field])}`,
        );
      }
    }
  }
  for (const [operation, field] of Object.entries(next.targetRequirements?.projectUser ?? {})) {
    const before = base.targetRequirements?.projectUser?.[operation];
    if (before !== field) {
      lines.push(`ProjectUser 対象 ID 要件変更 ${operation}: ${before ?? "なし"} -> ${field}`);
    }
  }
  for (const operation of Object.keys(base.targetRequirements?.projectUser ?? {})) {
    if (!(operation in (next.targetRequirements?.projectUser ?? {}))) {
      lines.push(`ProjectUser 対象 ID 要件削除 ${operation}`);
    }
  }
  for (const [operation, field] of Object.entries(next.targetRequirements?.credential ?? {})) {
    const before = base.targetRequirements?.credential?.[operation];
    if (before !== field) {
      lines.push(`credential 対象 ID 要件変更 ${operation}: ${before ?? "なし"} -> ${field}`);
    }
  }
  for (const operation of Object.keys(base.targetRequirements?.credential ?? {})) {
    if (!(operation in (next.targetRequirements?.credential ?? {}))) {
      lines.push(`credential 対象 ID 要件削除 ${operation}`);
    }
  }
  if (
    JSON.stringify(base.constraints?.participantSubject) !==
    JSON.stringify(next.constraints?.participantSubject)
  ) {
    lines.push("参加 JWT subject 制約を変更");
  }
  if (
    JSON.stringify(base.constraints?.adminOwnerManagement) !==
    JSON.stringify(next.constraints?.adminOwnerManagement)
  ) {
    lines.push("Admin の Owner 管理制約を変更");
  }
  if (
    JSON.stringify(base.constraints?.credentialProjectUserOperations) !==
    JSON.stringify(next.constraints?.credentialProjectUserOperations)
  ) {
    lines.push("credential の ProjectUser 非継承対象を変更");
  }
  if (JSON.stringify(base.timeContract) !== JSON.stringify(next.timeContract)) {
    lines.push(`時刻契約を変更: ${base.timeContract?.id ?? "なし"}`);
  }
  for (const [kind, groups] of Object.entries(next.caseGroups ?? {})) {
    const before = new Set(base.caseGroups?.[kind] ?? []);
    const after = new Set(groups);
    for (const group of after) {
      if (!before.has(group)) lines.push(`ケース group 追加 ${kind}.${group}`);
    }
    for (const group of before) {
      if (!after.has(group)) lines.push(`ケース group 削除 ${kind}.${group}`);
    }
  }
  const baseRules = new Map((base.specRules ?? []).map((rule) => [rule.id, rule]));
  for (const rule of next.specRules ?? []) {
    const before = baseRules.get(rule.id);
    if (before === undefined) continue;
    for (const field of ["statement", "verification", "cases", "scripts", "reason", "tracking"]) {
      if (JSON.stringify(before[field]) !== JSON.stringify(rule[field])) {
        lines.push(`仕様ルール ${field} 変更 ${rule.id}`);
      }
    }
  }
  return lines;
}
