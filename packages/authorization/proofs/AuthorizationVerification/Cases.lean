import AuthorizationVerification.Concrete

namespace AuthorizationVerification

structure Axis where
  name : String
  values : List String
deriving Repr

def boolValues : List Bool := [false, true]
def boolStrings : List String := ["false", "true"]

def boolString (value : Bool) : String :=
  if value then "true" else "false"

def bitChar (value : Bool) : Char :=
  if value then '1' else '0'

def grantsString (grants : Grants) : String :=
  String.ofList
    [ bitChar grants.roomCreate
    , bitChar grants.roomJoin
    , bitChar grants.mediaPublish
    , bitChar grants.mediaSubscribe
    , bitChar grants.dataSend
    ]

def scopeSetString (set : ScopeSet) : String :=
  String.ofList
    [ bitChar set.roomManage
    , bitChar set.sessionManage
    , bitChar set.usageRead
    , bitChar set.auditRead
    ]

def sessionString (session : SessionCase) : String :=
  "present:" ++ session.state.toString ++ ":" ++
    boolString session.projectMatch ++ ":" ++
    boolString session.roomMatch ++ ":" ++
    boolString session.participantMatch

def sessionOptionString : Option SessionCase → String
  | none => "none"
  | some session => sessionString session

def participantRecordString (participant : ParticipantCaseRecord) : String :=
  "present:" ++ participant.state.toString ++ ":" ++
    boolString participant.roomMatch ++ ":" ++
    participant.subjectStatus.toString

def participantRecordOptionString : Option ParticipantCaseRecord → String
  | none => "none"
  | some participant => participantRecordString participant

def participantSubjectOptionString : Option ParticipantSubjectStatus → String
  | none => "none"
  | some status => status.toString

def roleValueString (role : RoleValue) : String := role.toString

def operationValueString (operation : OperationValue) : String := operation.toString

def scopeCaseString : ScopeCase → String
  | .invalid => "invalid"
  | .valid set => scopeSetString set

def allSessionCases : List SessionCase :=
  allSessionStates.flatMap fun state =>
  boolValues.flatMap fun projectMatch =>
  boolValues.flatMap fun roomMatch =>
  boolValues.map fun participantMatch =>
  { state := state
    projectMatch := projectMatch
    roomMatch := roomMatch
    participantMatch := participantMatch
  }

def allParticipantCaseRecords : List ParticipantCaseRecord :=
  allParticipantStates.flatMap fun state =>
  boolValues.flatMap fun roomMatch =>
  allParticipantSubjectStatuses.map fun subjectStatus =>
  { state := state
    roomMatch := roomMatch
    subjectStatus := subjectStatus
  }

def allParticipantSubjectOptions : List (Option ParticipantSubjectStatus) :=
  none :: allParticipantSubjectStatuses.map some

def allParticipantSessionOptions : List (Option SessionCase) :=
  none :: allSessionCases.map some

def allParticipantRecordOptions : List (Option ParticipantCaseRecord) :=
  none :: allParticipantCaseRecords.map some

structure ParticipantGroup where
  name : String
  axes : List Axis
  cases : List ParticipantCase
deriving Repr

def participantRoomCreateCases : List ParticipantCase :=
  allGrants.flatMap fun grants =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun targetMatch =>
  boolValues.flatMap fun subjectAbsent =>
  boolValues.flatMap fun roomPresent =>
  boolValues.flatMap fun sessionPresent =>
  allParticipantSubjectOptions.map fun participant =>
  .roomCreate grants projectState targetMatch subjectAbsent roomPresent sessionPresent participant

def participantRoomJoinAbsentCases : List ParticipantCase :=
  allGrants.flatMap fun grants =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun targetMatch =>
  boolValues.flatMap fun subjectAbsent =>
  boolValues.flatMap fun sessionPresent =>
  allParticipantSubjectOptions.map fun participant =>
  .roomJoinAbsent grants projectState targetMatch subjectAbsent sessionPresent participant

def participantRoomJoinPresentCases : List ParticipantCase :=
  allGrants.flatMap fun grants =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun targetMatch =>
  boolValues.flatMap fun subjectAbsent =>
  allRoomStates.flatMap fun roomState =>
  allParticipantSessionOptions.flatMap fun session =>
  allParticipantRecordOptions.map fun participant =>
  .roomJoinPresent grants projectState targetMatch subjectAbsent roomState session participant

def participantMediaRoomInactiveCases : List ParticipantCase :=
  allMediaOperations.flatMap fun operation =>
  allGrants.flatMap fun grants =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun targetMatch =>
  boolValues.flatMap fun subjectAbsent =>
  allParticipantSubjectOptions.map fun participant =>
  .mediaRoomInactive operation grants projectState targetMatch subjectAbsent participant

def participantMediaRoomActiveCases : List ParticipantCase :=
  allMediaOperations.flatMap fun operation =>
  allGrants.flatMap fun grants =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun targetMatch =>
  boolValues.flatMap fun subjectAbsent =>
  allParticipantSessionOptions.flatMap fun session =>
  allParticipantRecordOptions.map fun participant =>
  .mediaRoomActive operation grants projectState targetMatch subjectAbsent session participant

def participantInvalidOperationCases : List ParticipantCase :=
  [.invalidOperation]

def participantGroups : List ParticipantGroup :=
  [ { name := "roomCreate"
      axes :=
        [ { name := "grants", values := allGrants.map grantsString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "targetMatch", values := boolStrings }
        , { name := "subjectAbsent", values := boolStrings }
        , { name := "roomPresent", values := boolStrings }
        , { name := "sessionPresent", values := boolStrings }
        , { name := "participant", values := allParticipantSubjectOptions.map participantSubjectOptionString }
        ]
      cases := participantRoomCreateCases
    }
  , { name := "roomJoinAbsent"
      axes :=
        [ { name := "grants", values := allGrants.map grantsString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "targetMatch", values := boolStrings }
        , { name := "subjectAbsent", values := boolStrings }
        , { name := "sessionPresent", values := boolStrings }
        , { name := "participant", values := allParticipantSubjectOptions.map participantSubjectOptionString }
        ]
      cases := participantRoomJoinAbsentCases
    }
  , { name := "roomJoinPresent"
      axes :=
        [ { name := "grants", values := allGrants.map grantsString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "targetMatch", values := boolStrings }
        , { name := "subjectAbsent", values := boolStrings }
        , { name := "roomState", values := allRoomStates.map RoomState.toString }
        , { name := "session", values := allParticipantSessionOptions.map sessionOptionString }
        , { name := "participant", values := allParticipantRecordOptions.map participantRecordOptionString }
        ]
      cases := participantRoomJoinPresentCases
    }
  , { name := "mediaRoomInactive"
      axes :=
        [ { name := "operation", values := allMediaOperations.map MediaOperation.toString }
        , { name := "grants", values := allGrants.map grantsString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "targetMatch", values := boolStrings }
        , { name := "subjectAbsent", values := boolStrings }
        , { name := "participant", values := allParticipantSubjectOptions.map participantSubjectOptionString }
        ]
      cases := participantMediaRoomInactiveCases
    }
  , { name := "mediaRoomActive"
      axes :=
        [ { name := "operation", values := allMediaOperations.map MediaOperation.toString }
        , { name := "grants", values := allGrants.map grantsString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "targetMatch", values := boolStrings }
        , { name := "subjectAbsent", values := boolStrings }
        , { name := "session", values := allParticipantSessionOptions.map sessionOptionString }
        , { name := "participant", values := allParticipantRecordOptions.map participantRecordOptionString }
        ]
      cases := participantMediaRoomActiveCases
    }
  , { name := "invalidOperation"
      axes := []
      cases := participantInvalidOperationCases
    }
  ]

def allParticipantCases : List ParticipantCase :=
  participantGroups.flatMap (·.cases)

structure ProjectUserGroup where
  name : String
  axes : List Axis
  cases : List ProjectUserCase
deriving Repr

structure ProjectUserInvalidOperationGroup where
  name : String
  axes : List Axis
  cases : List ProjectUserInvalidOperationCase
deriving Repr

def projectUserCases : List ProjectUserCase :=
  allRoleValues.flatMap fun actorRole =>
  allOperations.flatMap fun operation =>
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun actorProjectMatch =>
  boolValues.flatMap fun targetProjectMatch =>
  boolValues.flatMap fun targetIdPresent =>
  allRoleValues.flatMap fun currentRole =>
  allRoleValues.map fun nextRole =>
  { actorRole := actorRole
    operation := operation
    projectState := projectState
    actorProjectMatch := actorProjectMatch
    targetProjectMatch := targetProjectMatch
    targetIdPresent := targetIdPresent
    currentRole := currentRole
    nextRole := nextRole
  }

def projectUserInvalidOperationCases : List ProjectUserInvalidOperationCase :=
  allProjectStates.flatMap fun projectState =>
  boolValues.flatMap fun actorProjectMatch =>
  boolValues.map fun targetProjectMatch =>
  { projectState := projectState
    actorProjectMatch := actorProjectMatch
    targetProjectMatch := targetProjectMatch
  }

def projectUserGroups : List ProjectUserGroup :=
  [ { name := "validOperation"
      axes :=
        [ { name := "actorRole", values := allRoleValues.map roleValueString }
        , { name := "operation", values := allOperations.map Operation.toString }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "actorProjectMatch", values := boolStrings }
        , { name := "targetProjectMatch", values := boolStrings }
        , { name := "targetIdPresent", values := boolStrings }
        , { name := "currentRole", values := allRoleValues.map roleValueString }
        , { name := "nextRole", values := allRoleValues.map roleValueString }
        ]
      cases := projectUserCases
    }
  ]

def projectUserInvalidOperationGroups : List ProjectUserInvalidOperationGroup :=
  [ { name := "invalidOperation"
      axes :=
        [ { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "actorProjectMatch", values := boolStrings }
        , { name := "targetProjectMatch", values := boolStrings }
        ]
      cases := projectUserInvalidOperationCases
    }
  ]

structure CredentialGroup where
  name : String
  axes : List Axis
  cases : List CredentialCase
deriving Repr

def allScopeCases : List ScopeCase :=
  .invalid :: allScopeSets.map .valid

def credentialCases : List CredentialCase :=
  boolValues.flatMap fun revoked =>
  allExpiryStates.flatMap fun expiry =>
  boolValues.flatMap fun credentialProjectMatch =>
  boolValues.flatMap fun targetProjectMatch =>
  allProjectStates.flatMap fun projectState =>
  allScopeCases.flatMap fun scopes =>
  allOperationValues.flatMap fun operation =>
  boolValues.map fun targetIdPresent =>
  { revoked := revoked
    expiry := expiry
    credentialProjectMatch := credentialProjectMatch
    targetProjectMatch := targetProjectMatch
    projectState := projectState
    scopes := scopes
    operation := operation
    targetIdPresent := targetIdPresent
  }

def credentialGroups : List CredentialGroup :=
  [ { name := "credential"
      axes :=
        [ { name := "revoked", values := boolStrings }
        , { name := "expiry", values := allExpiryStates.map ExpiryState.toString }
        , { name := "credentialProjectMatch", values := boolStrings }
        , { name := "targetProjectMatch", values := boolStrings }
        , { name := "projectState", values := allProjectStates.map ProjectState.toString }
        , { name := "scopes", values := allScopeCases.map scopeCaseString }
        , { name := "operation", values := allOperationValues.map operationValueString }
        , { name := "targetIdPresent", values := boolStrings }
        ]
      cases := credentialCases
    }
  ]

#guard participantRoomCreateCases.length = 4096
#guard participantRoomJoinAbsentCases.length = 2048
#guard participantRoomJoinPresentCases.length = 364800
#guard participantMediaRoomInactiveCases.length = 3072
#guard participantMediaRoomActiveCases.length = 364800
#guard participantInvalidOperationCases.length = 1
#guard allParticipantCases.length = 738817
#guard projectUserCases.length = 65664
#guard projectUserInvalidOperationCases.length = 8
#guard credentialCases.length = 32640

end AuthorizationVerification
