import Authorization.Types

namespace Authorization

def requiresNextRole : ManagementOperation -> Bool
  | .projectUserAdd => true
  | .projectUserChangeRole => true
  | _ => false

def requiresCurrentRole : ManagementOperation -> Bool
  | .projectUserRemove => true
  | .projectUserChangeRole => true
  | _ => false

def adminManagesOwner (input : ProjectUserInput) : Bool :=
  input.role == .admin &&
    (adminOwnerManagementFields input.operation).any fun field =>
      match field with
      | .currentRole => input.currentRole == some .owner
      | .nextRole => input.nextRole == some .owner

structure ProjectUserRule where
  id : String
  reason : String
  fails : ProjectUserInput -> Bool

def projectUserRules : List ProjectUserRule := [
  { id := "PU-PROJ-001", reason := "project-not-active",
    fails := fun input => input.projectState != .active },
  { id := "PU-ACTOR-001", reason := "actor-project-mismatch",
    fails := fun input => !input.actorProjectMatch },
  { id := "PU-TGT-001", reason := "target-project-mismatch",
    fails := fun input => !input.targetProjectMatch },
  { id := "PU-ROLE-001", reason := "project-user-role-missing",
    fails := fun input => input.role == .none },
  { id := "PU-ID-001", reason := "target-id-required",
    fails := fun input => requiresTargetId input.operation && !input.targetIdPresent },
  { id := "PU-ROLE-004", reason := "insufficient-role",
    fails := fun input => !roleAllows input.role input.operation },
  { id := "PU-ROLE-005", reason := "project-user-next-role-required",
    fails := fun input => requiresNextRole input.operation && input.nextRole.isNone },
  { id := "PU-ROLE-006", reason := "project-user-current-role-required",
    fails := fun input => requiresCurrentRole input.operation && input.currentRole.isNone },
  { id := "PU-OWNER-001", reason := "owner-management-forbidden",
    fails := fun input => adminManagesOwner input }
]

def firstProjectUserViolation (input : ProjectUserInput) : Option String :=
  let rec go : List ProjectUserRule -> Option String
    | [] => none
    | rule :: rest => if rule.fails input then some rule.reason else go rest
  go projectUserRules

def projectUserTargetKeys (input : ProjectUserInput) : List String :=
  match input.operation with
  | .projectUserAdd =>
      ["projectId"] ++
        (if input.targetIdPresent then ["accountId"] else []) ++
        (if input.nextRole.isSome then ["nextRole"] else [])
  | .projectUserRemove =>
      ["projectId"] ++
        (if input.targetIdPresent then ["projectUserId"] else []) ++
        (if input.currentRole.isSome then ["currentRole"] else []) ++
        (if input.nextRole.isSome then ["nextRole"] else [])
  | .projectUserChangeRole =>
      ["projectId"] ++
        (if input.targetIdPresent then ["projectUserId"] else []) ++
        (if input.currentRole.isSome then ["currentRole"] else []) ++
        (if input.nextRole.isSome then ["nextRole"] else [])
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

def decideProjectUser (input : ProjectUserInput) : Decision :=
  match firstProjectUserViolation input with
  | some reason => { allowed := false, reason, targetKeys := projectUserTargetKeys input }
  | none => { allowed := true, reason := "allowed", targetKeys := projectUserTargetKeys input }

def projectUserPrerequisites (input : ProjectUserInput) : Bool :=
  input.projectState == .active &&
    input.actorProjectMatch &&
    input.targetProjectMatch &&
    input.role != .none &&
    (!requiresTargetId input.operation || input.targetIdPresent) &&
    roleAllows input.role input.operation &&
    (!requiresNextRole input.operation || input.nextRole.isSome) &&
    (!requiresCurrentRole input.operation || input.currentRole.isSome) &&
    !adminManagesOwner input

def roleOptions : List (Option Role) :=
  [none, some .owner, some .admin, some .operator, some .auditor]

def allProjectUserCases : List ProjectUserInput :=
  managementOperations.flatMap fun operation =>
  roles.flatMap fun role =>
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun actorProjectMatch =>
  [true, false].flatMap fun targetProjectMatch =>
  [true, false].flatMap fun targetIdPresent =>
  roleOptions.flatMap fun currentRole =>
  roleOptions.map fun nextRole =>
    {
      operation,
      projectState,
      actorProjectMatch,
      targetProjectMatch,
      role,
      targetIdPresent,
      currentRole,
      nextRole
    }

end Authorization
