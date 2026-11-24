-- @generated from docs/auth/authorization-spec/authorization-policy.json schemaVersion=1 sourceSha256=0c61aa8044498255277f08c9c633799619671405039d6e93bd4892466967402d; do not edit.

namespace Authorization

inductive Role where
  | none
  | owner
  | admin
  | operator
  | auditor
deriving DecidableEq, Repr, BEq

def roles : List Role := [.none, .owner, .admin, .operator, .auditor]

def roleName : Role -> String
  | .none => "none"
  | .owner => "owner"
  | .admin => "admin"
  | .operator => "operator"
  | .auditor => "auditor"

inductive ParticipantOperation where
  | roomCreate
  | roomJoin
  | mediaPublish
  | mediaSubscribe
  | dataSend
deriving DecidableEq, Repr, BEq

def participantOperations : List ParticipantOperation := [.roomCreate, .roomJoin, .mediaPublish, .mediaSubscribe, .dataSend]

def participantOperationName : ParticipantOperation -> String
  | .roomCreate => "room.create"
  | .roomJoin => "room.join"
  | .mediaPublish => "media.publish"
  | .mediaSubscribe => "media.subscribe"
  | .dataSend => "data.send"

inductive ManagementOperation where
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

def managementOperations : List ManagementOperation := [.projectRead, .projectUpdate, .projectDelete, .projectUserRead, .projectUserAdd, .projectUserRemove, .projectUserChangeRole, .applicationManage, .applicationSigningKeyManage, .managementApiCredentialManage, .roomRead, .roomUpdate, .roomDelete, .sessionRead, .sessionDisconnect, .participantRead, .participantDisconnect, .usageRead, .auditRead]

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

inductive CredentialScope where
  | roomManage
  | sessionManage
  | usageRead
  | auditRead
deriving DecidableEq, Repr, BEq

def credentialScopes : List CredentialScope := [.roomManage, .sessionManage, .usageRead, .auditRead]

structure CredentialScopes where
  roomManage : Bool
  sessionManage : Bool
  usageRead : Bool
  auditRead : Bool
deriving DecidableEq, Repr, BEq

structure ParticipantGrants where
  roomCreate : Bool
  roomJoin : Bool
  mediaPublish : Bool
  mediaSubscribe : Bool
  dataSend : Bool
deriving DecidableEq, Repr, BEq

def allGrants : List ParticipantGrants :=
  [false, true].flatMap fun roomCreate =>
  [false, true].flatMap fun roomJoin =>
  [false, true].flatMap fun mediaPublish =>
  [false, true].flatMap fun mediaSubscribe =>
  [false, true].map fun dataSend =>
  { roomCreate := roomCreate
    roomJoin := roomJoin
    mediaPublish := mediaPublish
    mediaSubscribe := mediaSubscribe
    dataSend := dataSend }

inductive OwnerField where
  | currentRole
  | nextRole
deriving DecidableEq, Repr, BEq

def roleAllows : Role -> ManagementOperation -> Bool
  | .none, _ => false
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

def requiresTargetId : ManagementOperation -> Bool
  | .projectUserAdd => true
  | .projectUserRemove => true
  | .projectUserChangeRole => true
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def managementRequiresTargetId : ManagementOperation -> Bool
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def requiredScopes : ManagementOperation -> List CredentialScope
  | .roomRead => [.roomManage]
  | .roomUpdate => [.roomManage]
  | .roomDelete => [.roomManage]
  | .sessionRead => [.sessionManage]
  | .sessionDisconnect => [.sessionManage]
  | .participantRead => [.sessionManage]
  | .participantDisconnect => [.sessionManage]
  | .usageRead => [.usageRead]
  | .auditRead => [.auditRead]
  | _ => []

def adminOwnerManagementFields : ManagementOperation -> List OwnerField
  | .projectUserAdd => [OwnerField.nextRole]
  | .projectUserRemove => [OwnerField.currentRole]
  | .projectUserChangeRole => [OwnerField.currentRole, OwnerField.nextRole]
  | _ => []

def credentialProjectUserOperations : List ManagementOperation := [.projectUserRead, .projectUserAdd, .projectUserRemove, .projectUserChangeRole]

def participantSubjectRequired : Bool :=
  true

def participantSubjectMustMatch : Bool :=
  true

end Authorization
