import Lean.Data.Json

open Lean

namespace Authorization

inductive ProjectState
  | active
  | suspended
  deriving DecidableEq, Repr, BEq

inductive ParticipantOperation
  | roomCreate
  | roomJoin
  | mediaPublish
  | mediaSubscribe
  | dataSend
  deriving DecidableEq, Repr, BEq

inductive RoomState
  | absent
  | active
  | deleting
  | deleted
  deriving DecidableEq, Repr, BEq

inductive SessionState
  | active
  | revoked
  | ended
  deriving DecidableEq, Repr, BEq

inductive ParticipantState
  | active
  | revoked
  | left
  deriving DecidableEq, Repr, BEq

inductive SubjectClass
  | empty
  | match
  | mismatch
  deriving DecidableEq, Repr, BEq

structure ParticipantGrants where
  roomCreate : Bool
  roomJoin : Bool
  mediaPublish : Bool
  mediaSubscribe : Bool
  dataSend : Bool
  deriving DecidableEq, Repr, BEq

structure ParticipantInput where
  operation : ParticipantOperation
  projectState : ProjectState
  targetMatch : Bool
  subjectClass : SubjectClass
  roomState : RoomState
  sessionPresent : Bool
  sessionState : SessionState
  sessionTargetMatch : Bool
  participantPresent : Bool
  participantState : ParticipantState
  participantTargetMatch : Bool
  participantSubjectClass : SubjectClass
  grants : ParticipantGrants
  deriving DecidableEq, Repr, BEq

inductive Role
  | none
  | owner
  | admin
  | operator
  | auditor
  deriving DecidableEq, Repr, BEq

inductive ManagementOperation
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
  deriving DecidableEq, Repr, BEq

structure ProjectUserInput where
  operation : ManagementOperation
  projectState : ProjectState
  actorProjectMatch : Bool
  targetProjectMatch : Bool
  role : Role
  targetIdPresent : Bool
  currentRole : Option Role
  nextRole : Option Role
  deriving DecidableEq, Repr, BEq

inductive CredentialScope
  | roomManage
  | sessionManage
  | usageRead
  | auditRead
  deriving DecidableEq, Repr, BEq

structure CredentialScopes where
  roomManage : Bool
  sessionManage : Bool
  usageRead : Bool
  auditRead : Bool
  deriving DecidableEq, Repr, BEq

inductive ExpiryClass
  | valid
  | expired
  | invalid
  deriving DecidableEq, Repr, BEq

structure ManagementCredentialInput where
  operation : ManagementOperation
  projectState : ProjectState
  credentialProjectMatch : Bool
  targetProjectMatch : Bool
  scopes : CredentialScopes
  revoked : Bool
  expiry : ExpiryClass
  targetIdPresent : Bool
  deriving DecidableEq, Repr, BEq

structure Decision where
  allowed : Bool
  reason : String
  targetKeys : List String
  deriving DecidableEq, Repr, BEq

def projectStates : List ProjectState := [.active, .suspended]

def participantOperations : List ParticipantOperation :=
  [.roomCreate, .roomJoin, .mediaPublish, .mediaSubscribe, .dataSend]

def roomStates : List RoomState := [.absent, .active, .deleting, .deleted]
def sessionStates : List SessionState := [.active, .revoked, .ended]
def participantStates : List ParticipantState := [.active, .revoked, .left]
def subjectClasses : List SubjectClass := [.empty, .match, .mismatch]

def roles : List Role := [.none, .owner, .admin, .operator, .auditor]

def managementOperations : List ManagementOperation :=
  [.projectRead, .projectUpdate, .projectDelete, .projectUserRead,
   .projectUserAdd, .projectUserRemove, .projectUserChangeRole,
   .applicationManage, .applicationSigningKeyManage,
   .managementApiCredentialManage, .roomRead, .roomUpdate, .roomDelete,
   .sessionRead, .sessionDisconnect, .participantRead,
   .participantDisconnect, .usageRead, .auditRead]

def credentialScopes : List CredentialScope :=
  [.roomManage, .sessionManage, .usageRead, .auditRead]

def expiryClasses : List ExpiryClass := [.valid, .expired, .invalid]

def projectStateName : ProjectState -> String
  | .active => "active"
  | .suspended => "suspended"

def participantOperationName : ParticipantOperation -> String
  | .roomCreate => "room.create"
  | .roomJoin => "room.join"
  | .mediaPublish => "media.publish"
  | .mediaSubscribe => "media.subscribe"
  | .dataSend => "data.send"

def roomStateName : RoomState -> String
  | .absent => "absent"
  | .active => "active"
  | .deleting => "deleting"
  | .deleted => "deleted"

def sessionStateName : SessionState -> String
  | .active => "active"
  | .revoked => "revoked"
  | .ended => "ended"

def participantStateName : ParticipantState -> String
  | .active => "active"
  | .revoked => "revoked"
  | .left => "left"

def subjectClassName : SubjectClass -> String
  | .empty => "empty"
  | .match => "match"
  | .mismatch => "mismatch"

def roleName : Role -> String
  | .none => "none"
  | .owner => "owner"
  | .admin => "admin"
  | .operator => "operator"
  | .auditor => "auditor"

def managementOperationName : ManagementOperation -> String
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

def expiryClassName : ExpiryClass -> String
  | .valid => "valid"
  | .expired => "expired"
  | .invalid => "invalid"

def participantInputJson (input : ParticipantInput) : Json :=
  Json.mkObj [
    ("operation", Json.str (participantOperationName input.operation)),
    ("projectState", Json.str (projectStateName input.projectState)),
    ("targetMatch", Json.bool input.targetMatch),
    ("subjectClass", Json.str (subjectClassName input.subjectClass)),
    ("roomState", Json.str (roomStateName input.roomState)),
    ("sessionPresent", Json.bool input.sessionPresent),
    ("sessionState", Json.str (sessionStateName input.sessionState)),
    ("sessionTargetMatch", Json.bool input.sessionTargetMatch),
    ("participantPresent", Json.bool input.participantPresent),
    ("participantState", Json.str (participantStateName input.participantState)),
    ("participantTargetMatch", Json.bool input.participantTargetMatch),
    ("participantSubjectClass", Json.str (subjectClassName input.participantSubjectClass)),
    ("grants", Json.mkObj [
      ("room.create", Json.bool input.grants.roomCreate),
      ("room.join", Json.bool input.grants.roomJoin),
      ("media.publish", Json.bool input.grants.mediaPublish),
      ("media.subscribe", Json.bool input.grants.mediaSubscribe),
      ("data.send", Json.bool input.grants.dataSend)
    ])
  ]

def projectUserInputJson (input : ProjectUserInput) : Json :=
  Json.mkObj [
    ("operation", Json.str (managementOperationName input.operation)),
    ("projectState", Json.str (projectStateName input.projectState)),
    ("actorProjectMatch", Json.bool input.actorProjectMatch),
    ("targetProjectMatch", Json.bool input.targetProjectMatch),
    ("role", Json.str (roleName input.role)),
    ("targetIdPresent", Json.bool input.targetIdPresent),
    ("currentRole", input.currentRole.map (fun role => Json.str (roleName role)) |>.getD Json.null),
    ("nextRole", input.nextRole.map (fun role => Json.str (roleName role)) |>.getD Json.null)
  ]

def managementCredentialInputJson (input : ManagementCredentialInput) : Json :=
  Json.mkObj [
    ("operation", Json.str (managementOperationName input.operation)),
    ("projectState", Json.str (projectStateName input.projectState)),
    ("credentialProjectMatch", Json.bool input.credentialProjectMatch),
    ("targetProjectMatch", Json.bool input.targetProjectMatch),
    ("scopes", Json.mkObj [
      ("room.manage", Json.bool input.scopes.roomManage),
      ("session.manage", Json.bool input.scopes.sessionManage),
      ("usage.read", Json.bool input.scopes.usageRead),
      ("audit.read", Json.bool input.scopes.auditRead)
    ]),
    ("revoked", Json.bool input.revoked),
    ("expiry", Json.str (expiryClassName input.expiry)),
    ("targetIdPresent", Json.bool input.targetIdPresent)
  ]

def decisionJson (decision : Decision) : Json :=
  Json.mkObj [
    ("allowed", Json.bool decision.allowed),
    ("reason", Json.str decision.reason),
    ("targetKeys", Json.arr (decision.targetKeys.map Json.str).toArray)
  ]

end Authorization
