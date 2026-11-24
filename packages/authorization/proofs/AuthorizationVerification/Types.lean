namespace AuthorizationVerification

inductive Role where
  | owner
  | admin
  | operator
  | auditor
deriving DecidableEq, Repr

def Role.toString : Role → String
  | .owner => "owner"
  | .admin => "admin"
  | .operator => "operator"
  | .auditor => "auditor"

def Role.fromString? : String → Option Role
  | "owner" => some .owner
  | "admin" => some .admin
  | "operator" => some .operator
  | "auditor" => some .auditor
  | _ => none

def allRoles : List Role := [.owner, .admin, .operator, .auditor]

inductive Operation where
  | projectRead
  | projectUpdate
  | projectDelete
  | projectUserRead
  | projectUserAdd
  | projectUserRemove
  | projectUserChangeRole
  | applicationManage
  | applicationSigningKeyManage
  | managementApiCredentialManage
  | roomRead
  | roomUpdate
  | roomDelete
  | sessionRead
  | sessionDisconnect
  | participantRead
  | participantDisconnect
  | usageRead
  | auditRead
deriving DecidableEq, Repr

def Operation.toString : Operation → String
  | .projectRead => "project.read"
  | .projectUpdate => "project.update"
  | .projectDelete => "project.delete"
  | .projectUserRead => "projectUser.read"
  | .projectUserAdd => "projectUser.add"
  | .projectUserRemove => "projectUser.remove"
  | .projectUserChangeRole => "projectUser.changeRole"
  | .applicationManage => "application.manage"
  | .applicationSigningKeyManage => "applicationSigningKey.manage"
  | .managementApiCredentialManage => "managementApiCredential.manage"
  | .roomRead => "room.read"
  | .roomUpdate => "room.update"
  | .roomDelete => "room.delete"
  | .sessionRead => "session.read"
  | .sessionDisconnect => "session.disconnect"
  | .participantRead => "participant.read"
  | .participantDisconnect => "participant.disconnect"
  | .usageRead => "usage.read"
  | .auditRead => "audit.read"

def Operation.fromString? : String → Option Operation
  | "project.read" => some .projectRead
  | "project.update" => some .projectUpdate
  | "project.delete" => some .projectDelete
  | "projectUser.read" => some .projectUserRead
  | "projectUser.add" => some .projectUserAdd
  | "projectUser.remove" => some .projectUserRemove
  | "projectUser.changeRole" => some .projectUserChangeRole
  | "application.manage" => some .applicationManage
  | "applicationSigningKey.manage" => some .applicationSigningKeyManage
  | "managementApiCredential.manage" => some .managementApiCredentialManage
  | "room.read" => some .roomRead
  | "room.update" => some .roomUpdate
  | "room.delete" => some .roomDelete
  | "session.read" => some .sessionRead
  | "session.disconnect" => some .sessionDisconnect
  | "participant.read" => some .participantRead
  | "participant.disconnect" => some .participantDisconnect
  | "usage.read" => some .usageRead
  | "audit.read" => some .auditRead
  | _ => none

def allOperations : List Operation :=
  [ .projectRead
  , .projectUpdate
  , .projectDelete
  , .projectUserRead
  , .projectUserAdd
  , .projectUserRemove
  , .projectUserChangeRole
  , .applicationManage
  , .applicationSigningKeyManage
  , .managementApiCredentialManage
  , .roomRead
  , .roomUpdate
  , .roomDelete
  , .sessionRead
  , .sessionDisconnect
  , .participantRead
  , .participantDisconnect
  , .usageRead
  , .auditRead
  ]

inductive ParticipantOperation where
  | roomCreate
  | roomJoin
  | mediaPublish
  | mediaSubscribe
  | dataSend
deriving DecidableEq, Repr

def ParticipantOperation.toString : ParticipantOperation → String
  | .roomCreate => "room.create"
  | .roomJoin => "room.join"
  | .mediaPublish => "media.publish"
  | .mediaSubscribe => "media.subscribe"
  | .dataSend => "data.send"

inductive MediaOperation where
  | publish
  | subscribe
  | dataSend
deriving DecidableEq, Repr

def MediaOperation.toString : MediaOperation → String
  | .publish => "media.publish"
  | .subscribe => "media.subscribe"
  | .dataSend => "data.send"

def MediaOperation.toParticipantOperation : MediaOperation → ParticipantOperation
  | .publish => .mediaPublish
  | .subscribe => .mediaSubscribe
  | .dataSend => .dataSend

def allMediaOperations : List MediaOperation := [.publish, .subscribe, .dataSend]

inductive Scope where
  | roomManage
  | sessionManage
  | usageRead
  | auditRead
deriving DecidableEq, Repr

def Scope.fromString? : String → Option Scope
  | "room.manage" => some .roomManage
  | "session.manage" => some .sessionManage
  | "usage.read" => some .usageRead
  | "audit.read" => some .auditRead
  | _ => none

structure ScopeSet where
  roomManage : Bool
  sessionManage : Bool
  usageRead : Bool
  auditRead : Bool
deriving DecidableEq, Repr

def ScopeSet.contains (set : ScopeSet) : Scope → Bool
  | .roomManage => set.roomManage
  | .sessionManage => set.sessionManage
  | .usageRead => set.usageRead
  | .auditRead => set.auditRead

def ScopeSet.ofList (scopes : List Scope) : ScopeSet :=
  { roomManage := scopes.contains .roomManage
    sessionManage := scopes.contains .sessionManage
    usageRead := scopes.contains .usageRead
    auditRead := scopes.contains .auditRead
  }

def allScopeSets : List ScopeSet :=
  [false, true].flatMap fun roomManage =>
  [false, true].flatMap fun sessionManage =>
  [false, true].flatMap fun usageRead =>
  [false, true].map fun auditRead =>
  { roomManage := roomManage
    sessionManage := sessionManage
    usageRead := usageRead
    auditRead := auditRead
  }

structure Grants where
  roomCreate : Bool
  roomJoin : Bool
  mediaPublish : Bool
  mediaSubscribe : Bool
  dataSend : Bool
deriving DecidableEq, Repr

def Grants.forOperation (grants : Grants) : Option ParticipantOperation → Bool
  | some .roomCreate => grants.roomCreate
  | some .roomJoin => grants.roomJoin
  | some .mediaPublish => grants.mediaPublish
  | some .mediaSubscribe => grants.mediaSubscribe
  | some .dataSend => grants.dataSend
  | _ => false

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

inductive ProjectState where
  | active
  | suspended
deriving DecidableEq, Repr

def ProjectState.toString : ProjectState → String
  | .active => "active"
  | .suspended => "suspended"

def allProjectStates : List ProjectState := [.active, .suspended]

inductive RoomState where
  | active
  | deleting
  | deleted
deriving DecidableEq, Repr

def RoomState.toString : RoomState → String
  | .active => "active"
  | .deleting => "deleting"
  | .deleted => "deleted"

def allRoomStates : List RoomState := [.active, .deleting, .deleted]

inductive SessionState where
  | active
  | revoked
  | ended
deriving DecidableEq, Repr

def SessionState.toString : SessionState → String
  | .active => "active"
  | .revoked => "revoked"
  | .ended => "ended"

def allSessionStates : List SessionState := [.active, .revoked, .ended]

inductive ParticipantState where
  | active
  | revoked
  | left
deriving DecidableEq, Repr

def ParticipantState.toString : ParticipantState → String
  | .active => "active"
  | .revoked => "revoked"
  | .left => "left"

def allParticipantStates : List ParticipantState := [.active, .revoked, .left]

inductive ParticipantSubjectStatus where
  | empty
  | same
  | mismatch
deriving DecidableEq, Repr

def ParticipantSubjectStatus.toString : ParticipantSubjectStatus → String
  | .empty => "empty"
  | .same => "same"
  | .mismatch => "mismatch"

def allParticipantSubjectStatuses : List ParticipantSubjectStatus := [.empty, .same, .mismatch]

inductive ExpiryState where
  | valid
  | expired
  | invalid
deriving DecidableEq, Repr

def ExpiryState.toString : ExpiryState → String
  | .valid => "valid"
  | .expired => "expired"
  | .invalid => "invalid"

def allExpiryStates : List ExpiryState := [.valid, .expired, .invalid]

inductive RoleValue where
  | missing
  | invalid
  | valid (role : Role)
deriving DecidableEq, Repr

def RoleValue.toString : RoleValue → String
  | .missing => "missing"
  | .invalid => "invalid"
  | .valid role => role.toString

def allRoleValues : List RoleValue :=
  [.missing, .invalid] ++ allRoles.map RoleValue.valid

inductive OperationValue where
  | invalid
  | valid (operation : Operation)
deriving DecidableEq, Repr

def OperationValue.toString : OperationValue → String
  | .invalid => "invalid"
  | .valid operation => operation.toString

def allOperationValues : List OperationValue :=
  .invalid :: allOperations.map OperationValue.valid

structure Decision where
  allowed : Bool
  reason : String
deriving DecidableEq, Repr

def allow : Decision := { allowed := true, reason := "allowed" }

def deny (reason : String) : Decision := { allowed := false, reason := reason }

end AuthorizationVerification
