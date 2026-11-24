import AuthorizationVerification.GeneratedPolicy
import AuthorizationVerification.SpecAttributes

namespace AuthorizationVerification

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

inductive TargetIdState where
  | missing
  | empty
  | valid
deriving DecidableEq, Repr

def TargetIdState.toString : TargetIdState → String
  | .missing => "missing"
  | .empty => "empty"
  | .valid => "valid"

def allTargetIdStates : List TargetIdState := [.missing, .empty, .valid]

def targetIdStateOf (value : Option String) : TargetIdState :=
  match value with
  | none => .missing
  | some text => if text == "" then .empty else .valid

inductive InvalidGrantKind where
  | unknownKey
  | nonBoolean
  | missingKey
  | notObject
deriving DecidableEq, Repr

def InvalidGrantKind.toString : InvalidGrantKind → String
  | .unknownKey => "unknownKey"
  | .nonBoolean => "nonBoolean"
  | .missingKey => "missingKey"
  | .notObject => "notObject"

def allInvalidGrantKinds : List InvalidGrantKind :=
  [.unknownKey, .nonBoolean, .missingKey, .notObject]

inductive GrantInput where
  | valid (grants : Grants)
  | invalid (kind : InvalidGrantKind)
deriving DecidableEq, Repr

inductive Timestamp where
  | safe (value : Int)
  | fractional
  | nonFinite
  | outOfSafeRange
deriving DecidableEq, Repr

inductive CredentialTimeCase where
  | valid
  | expired
  | minimumBoundaryExpired
  | maximumBoundaryValid
  | maximumBoundaryExpired
  | fractionalExpiresAt
  | fractionalNow
  | nonFiniteExpiresAt
  | nonFiniteNow
  | outOfSafeRangeExpiresAt
  | outOfSafeRangeNow
  | missingExpiresAt
  | missingNow
deriving DecidableEq, Repr

def CredentialTimeCase.toString : CredentialTimeCase → String
  | .valid => "valid"
  | .expired => "expired"
  | .minimumBoundaryExpired => "minimumBoundaryExpired"
  | .maximumBoundaryValid => "maximumBoundaryValid"
  | .maximumBoundaryExpired => "maximumBoundaryExpired"
  | .fractionalExpiresAt => "fractionalExpiresAt"
  | .fractionalNow => "fractionalNow"
  | .nonFiniteExpiresAt => "nonFiniteExpiresAt"
  | .nonFiniteNow => "nonFiniteNow"
  | .outOfSafeRangeExpiresAt => "outOfSafeRangeExpiresAt"
  | .outOfSafeRangeNow => "outOfSafeRangeNow"
  | .missingExpiresAt => "missingExpiresAt"
  | .missingNow => "missingNow"

def allCredentialTimeCases : List CredentialTimeCase :=
  [ .valid
  , .expired
  , .minimumBoundaryExpired
  , .maximumBoundaryValid
  , .maximumBoundaryExpired
  , .fractionalExpiresAt
  , .fractionalNow
  , .nonFiniteExpiresAt
  , .nonFiniteNow
  , .outOfSafeRangeExpiresAt
  , .outOfSafeRangeNow
  , .missingExpiresAt
  , .missingNow
  ]

def Grants.forOperation (grants : Grants) : Option ParticipantOperation → Bool
  | some .roomCreate => grants.roomCreate
  | some .roomJoin => grants.roomJoin
  | some .mediaPublish => grants.mediaPublish
  | some .mediaSubscribe => grants.mediaSubscribe
  | some .dataSend => grants.dataSend
  | _ => false

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

def credentialTimeStateOfCase : CredentialTimeCase → ExpiryState
  | .valid | .maximumBoundaryValid => .valid
  | .expired | .minimumBoundaryExpired | .maximumBoundaryExpired => .expired
  | .fractionalExpiresAt
  | .fractionalNow
  | .nonFiniteExpiresAt
  | .nonFiniteNow
  | .outOfSafeRangeExpiresAt
  | .outOfSafeRangeNow
  | .missingExpiresAt
  | .missingNow => .invalid

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
