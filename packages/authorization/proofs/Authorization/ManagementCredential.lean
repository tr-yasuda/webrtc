import Authorization.Types

namespace Authorization

def scopeEnabled (scopes : CredentialScopes) : CredentialScope -> Bool
  | .roomManage => scopes.roomManage
  | .sessionManage => scopes.sessionManage
  | .usageRead => scopes.usageRead
  | .auditRead => scopes.auditRead

def hasRequiredScope (input : ManagementCredentialInput) : Bool :=
  (requiredScopes input.operation).any (scopeEnabled input.scopes)

structure ManagementCredentialRule where
  id : String
  reason : String
  fails : ManagementCredentialInput -> Bool

def managementCredentialRules : List ManagementCredentialRule := [
  { id := "MC-CRED-001", reason := "credential-revoked",
    fails := fun input => input.revoked },
  { id := "MC-CRED-002", reason := "credential-expiry-invalid",
    fails := fun input => input.expiry == .invalid },
  { id := "MC-CRED-003", reason := "credential-expired",
    fails := fun input => input.expiry == .expired },
  { id := "MC-TGT-001", reason := "credential-target-mismatch",
    fails := fun input => !input.credentialProjectMatch || !input.targetProjectMatch },
  { id := "MC-PROJ-001", reason := "project-not-active",
    fails := fun input => input.projectState != .active },
  { id := "MC-ID-001", reason := "target-id-required",
    fails := fun input => managementRequiresTargetId input.operation && !input.targetIdPresent },
  { id := "MC-SCOPE-001", reason := "credential-operation-not-allowed",
    fails := fun input => (requiredScopes input.operation).isEmpty },
  { id := "MC-SCOPE-002", reason := "credential-scope-missing",
    fails := fun input => !hasRequiredScope input }
]

def firstManagementCredentialViolation
    (input : ManagementCredentialInput) : Option String :=
  let rec go : List ManagementCredentialRule -> Option String
    | [] => none
    | rule :: rest => if rule.fails input then some rule.reason else go rest
  go managementCredentialRules

def managementCredentialTargetKeys
    (input : ManagementCredentialInput) : List String :=
  match input.operation with
  | .roomUpdate =>
      ["projectId"] ++ (if input.targetIdPresent then ["roomId"] else [])
  | .roomDelete =>
      ["projectId"] ++ (if input.targetIdPresent then ["roomId"] else [])
  | .sessionDisconnect =>
      ["projectId"] ++ (if input.targetIdPresent then ["sessionId"] else [])
  | .participantDisconnect =>
      ["projectId"] ++ (if input.targetIdPresent then ["participantId"] else [])
  | _ =>
      ["projectId"] ++ (if input.targetIdPresent then ["resourceId"] else [])

def decideManagementCredential
    (input : ManagementCredentialInput) : Decision :=
  match firstManagementCredentialViolation input with
  | some reason =>
      { allowed := false, reason, targetKeys := managementCredentialTargetKeys input }
  | none =>
      { allowed := true, reason := "allowed", targetKeys := managementCredentialTargetKeys input }

def managementCredentialPrerequisites
    (input : ManagementCredentialInput) : Bool :=
  !input.revoked &&
    input.expiry == .valid &&
    input.credentialProjectMatch &&
    input.targetProjectMatch &&
    input.projectState == .active &&
    (!managementRequiresTargetId input.operation || input.targetIdPresent) &&
    !(requiredScopes input.operation).isEmpty &&
    hasRequiredScope input

def allScopeSets : List CredentialScopes :=
  [true, false].flatMap fun roomManage =>
  [true, false].flatMap fun sessionManage =>
  [true, false].flatMap fun usageRead =>
  [true, false].map fun auditRead =>
    { roomManage, sessionManage, usageRead, auditRead }

def allManagementCredentialCases : List ManagementCredentialInput :=
  managementOperations.flatMap fun operation =>
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun credentialProjectMatch =>
  [true, false].flatMap fun targetProjectMatch =>
  allScopeSets.flatMap fun scopes =>
  [true, false].flatMap fun revoked =>
  expiryClasses.flatMap fun expiry =>
  [true, false].map fun targetIdPresent =>
    {
      operation,
      projectState,
      credentialProjectMatch,
      targetProjectMatch,
      scopes,
      revoked,
      expiry,
      targetIdPresent
    }

end Authorization
