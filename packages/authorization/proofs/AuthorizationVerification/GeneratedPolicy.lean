-- @generated from docs/auth/authorization-spec/authorization-policy.json schemaVersion=1 sourceSha256=02af62d78cd8d9009949e9c3790c62c9a1aa7ee378afa1329ccbcf85f1463305; do not edit.

namespace AuthorizationVerification

inductive Role where
  | owner
  | admin
  | operator
  | auditor
deriving DecidableEq, Repr

def Role.toString : Role -> String
  | .owner => "owner"
  | .admin => "admin"
  | .operator => "operator"
  | .auditor => "auditor"

def Role.fromString? : String -> Option Role
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

def Operation.toString : Operation -> String
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

def Operation.fromString? : String -> Option Operation
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

def allOperations : List Operation := [.projectRead, .projectUpdate, .projectDelete, .projectUserRead, .projectUserAdd, .projectUserRemove, .projectUserChangeRole, .applicationManage, .applicationSigningKeyManage, .managementApiCredentialManage, .roomRead, .roomUpdate, .roomDelete, .sessionRead, .sessionDisconnect, .participantRead, .participantDisconnect, .usageRead, .auditRead]

inductive ParticipantOperation where
  | roomCreate
  | roomJoin
  | mediaPublish
  | mediaSubscribe
  | dataSend
deriving DecidableEq, Repr

def ParticipantOperation.toString : ParticipantOperation -> String
  | .roomCreate => "room.create"
  | .roomJoin => "room.join"
  | .mediaPublish => "media.publish"
  | .mediaSubscribe => "media.subscribe"
  | .dataSend => "data.send"

def allParticipantOperations : List ParticipantOperation := [.roomCreate, .roomJoin, .mediaPublish, .mediaSubscribe, .dataSend]

inductive MediaOperation where
  | publish
  | subscribe
  | dataSend
deriving DecidableEq, Repr

def MediaOperation.toString : MediaOperation -> String
  | .publish => "media.publish"
  | .subscribe => "media.subscribe"
  | .dataSend => "data.send"

def MediaOperation.toParticipantOperation : MediaOperation -> ParticipantOperation
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

def Scope.toString : Scope -> String
  | .roomManage => "room.manage"
  | .sessionManage => "session.manage"
  | .usageRead => "usage.read"
  | .auditRead => "audit.read"

def Scope.fromString? : String -> Option Scope
  | "room.manage" => some .roomManage
  | "session.manage" => some .sessionManage
  | "usage.read" => some .usageRead
  | "audit.read" => some .auditRead
  | _ => none

def allScopes : List Scope := [.roomManage, .sessionManage, .usageRead, .auditRead]

structure Grants where
  roomCreate : Bool
  roomJoin : Bool
  mediaPublish : Bool
  mediaSubscribe : Bool
  dataSend : Bool
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
  | .owner, .projectRead => true
  | .owner, .projectUpdate => true
  | .owner, .projectDelete => true
  | .owner, .projectUserRead => true
  | .owner, .projectUserAdd => true
  | .owner, .projectUserRemove => true
  | .owner, .projectUserChangeRole => true
  | .owner, .applicationManage => true
  | .owner, .applicationSigningKeyManage => true
  | .owner, .managementApiCredentialManage => true
  | .owner, .roomRead => true
  | .owner, .roomUpdate => true
  | .owner, .roomDelete => true
  | .owner, .sessionRead => true
  | .owner, .sessionDisconnect => true
  | .owner, .participantRead => true
  | .owner, .participantDisconnect => true
  | .owner, .usageRead => true
  | .owner, .auditRead => true
  | .admin, .projectRead => true
  | .admin, .projectUpdate => true
  | .admin, .projectUserRead => true
  | .admin, .projectUserAdd => true
  | .admin, .projectUserRemove => true
  | .admin, .projectUserChangeRole => true
  | .admin, .applicationManage => true
  | .admin, .applicationSigningKeyManage => true
  | .admin, .managementApiCredentialManage => true
  | .admin, .roomRead => true
  | .admin, .roomUpdate => true
  | .admin, .roomDelete => true
  | .admin, .sessionRead => true
  | .admin, .sessionDisconnect => true
  | .admin, .participantRead => true
  | .admin, .participantDisconnect => true
  | .admin, .usageRead => true
  | .admin, .auditRead => true
  | .operator, .projectRead => true
  | .operator, .roomRead => true
  | .operator, .roomUpdate => true
  | .operator, .roomDelete => true
  | .operator, .sessionRead => true
  | .operator, .sessionDisconnect => true
  | .operator, .participantRead => true
  | .operator, .participantDisconnect => true
  | .operator, .usageRead => true
  | .auditor, .projectRead => true
  | .auditor, .roomRead => true
  | .auditor, .sessionRead => true
  | .auditor, .participantRead => true
  | .auditor, .usageRead => true
  | .auditor, .auditRead => true
  | _, _ => false

def requiresTargetId : Operation -> Bool
  | .projectUserAdd => true
  | .projectUserRemove => true
  | .projectUserChangeRole => true
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def credentialRequiresTargetId : Operation -> Bool
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def requiredScopes : Operation -> Option (List Scope)
  | .roomRead => some [.roomManage]
  | .roomUpdate => some [.roomManage]
  | .roomDelete => some [.roomManage]
  | .sessionRead => some [.sessionManage]
  | .sessionDisconnect => some [.sessionManage]
  | .participantRead => some [.sessionManage]
  | .participantDisconnect => some [.sessionManage]
  | .usageRead => some [.usageRead]
  | .auditRead => some [.auditRead]
  | _ => none

def adminOwnerManagementFields : Operation -> List OwnerField
  | .projectUserAdd => [OwnerField.nextRole]
  | .projectUserRemove => [OwnerField.currentRole]
  | .projectUserChangeRole => [OwnerField.currentRole, OwnerField.nextRole]
  | _ => []

def credentialProjectUserOperations : List Operation :=
  [.projectUserRead, .projectUserAdd, .projectUserRemove, .projectUserChangeRole]

def participantSubjectRequired : Bool :=
  true

def participantSubjectMustMatch : Bool :=
  true

def caseGroupSpecIds : String -> String -> List String
  | "participant", "roomCreate" => ["AUTH-PART-02", "AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "roomJoinAbsent" => ["AUTH-PART-02", "AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "roomJoinPresent" => ["AUTH-PART-01", "AUTH-PART-03", "AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "mediaRoomInactive" => ["AUTH-PART-04", "AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "mediaRoomActive" => ["AUTH-PART-01", "AUTH-PART-03", "AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "invalidGrant" => ["AUTH-PART-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "participant", "invalidOperation" => ["AUTH-PART-04", "AUTH-PART-05", "AUTH-VER-01"]
  | "projectUser", "validOperation" => ["AUTH-PU-01", "AUTH-PU-02", "AUTH-PU-03", "AUTH-PU-04", "AUTH-PU-05", "AUTH-VER-01", "AUTH-VER-02"]
  | "projectUser", "invalidOperation" => ["AUTH-PU-04", "AUTH-VER-01", "AUTH-VER-02"]
  | "credential", "credential" => ["AUTH-MC-01", "AUTH-MC-02", "AUTH-MC-03", "AUTH-MC-04", "AUTH-MC-05", "AUTH-MC-06", "AUTH-VER-01", "AUTH-VER-02"]
  | _, _ => []

def minSafeInteger : Int := -9007199254740991
def maxSafeInteger : Int := 9007199254740991

end AuthorizationVerification
