import AuthorizationVerification.Model

namespace AuthorizationVerification

structure ParticipantSessionInput where
  id : String
  projectId : String
  roomId : String
  participantId : String
  state : SessionState
deriving DecidableEq, Repr

structure ParticipantRecordInput where
  id : String
  roomId : String
  externalUserId : Option String
  state : ParticipantState
deriving DecidableEq, Repr

structure ParticipantRoomInput where
  state : Option RoomState
  id : Option String
  projectId : String
  name : String
deriving DecidableEq, Repr

structure ParticipantInput where
  operation : Option ParticipantOperation
  credentialProjectId : String
  credentialRoomName : String
  subject : Option String
  grants : Grants
  projectId : String
  projectState : ProjectState
  room : ParticipantRoomInput
  session : Option ParticipantSessionInput
  participant : Option ParticipantRecordInput
deriving DecidableEq, Repr

def subjectAbsent (subject : Option String) : Bool :=
  match subject with
  | none => true
  | some value => value == ""

def participantTargetMatch (input : ParticipantInput) : Bool :=
  input.credentialProjectId == input.projectId &&
    input.credentialRoomName == input.room.name &&
    input.room.projectId == input.projectId

def participantSubjectStatus (subject : Option String) (participant : ParticipantRecordInput) :
    ParticipantSubjectStatus :=
  match participant.externalUserId with
  | none => .empty
  | some value =>
      if value == "" then .empty
      else match subject with
        | some credentialSubject =>
            if value == credentialSubject then .same else .mismatch
        | none => .mismatch

def participantRoomMatch (input : ParticipantInput) (participant : ParticipantRecordInput) : Bool :=
  match input.room.id with
  | none => false
  | some roomId => participant.roomId == roomId

def participantSessionCase (input : ParticipantInput) : Option SessionCase :=
  input.session.map fun session =>
    { state := session.state
      projectMatch := session.projectId == input.projectId
      roomMatch :=
        match input.room.id with
        | none => false
        | some roomId => session.roomId == roomId
      participantMatch :=
        match input.participant with
        | none => false
        | some participant => session.participantId == participant.id
    }

def participantRecordCase (input : ParticipantInput) : Option ParticipantCaseRecord :=
  input.participant.map fun participant =>
    { state := participant.state
      roomMatch := participantRoomMatch input participant
      subjectStatus := participantSubjectStatus input.subject participant
    }

def participantSubjectCases (input : ParticipantInput) : Option ParticipantSubjectStatus :=
  input.participant.map fun participant => participantSubjectStatus input.subject participant

def participantMediaCaseOf (input : ParticipantInput) (operation : MediaOperation) :
    ParticipantCase :=
  match input.room.state with
  | some .active =>
      .mediaRoomActive
        operation
        input.grants
        input.projectState
        (participantTargetMatch input)
        (subjectAbsent input.subject)
        (participantSessionCase input)
        (participantRecordCase input)
  | _ =>
      .mediaRoomInactive
        operation
        input.grants
        input.projectState
        (participantTargetMatch input)
        (subjectAbsent input.subject)
        (participantSubjectCases input)

def participantCaseOf (input : ParticipantInput) : ParticipantCase :=
  match input.operation with
  | none => .invalidOperation
  | some .roomCreate =>
      .roomCreate
        input.grants
        input.projectState
        (participantTargetMatch input)
        (subjectAbsent input.subject)
        input.room.state.isSome
        input.session.isSome
        (participantSubjectCases input)
  | some .roomJoin =>
      match input.room.state with
      | none =>
          .roomJoinAbsent
            input.grants
            input.projectState
            (participantTargetMatch input)
            (subjectAbsent input.subject)
            input.session.isSome
            (participantSubjectCases input)
      | some state =>
          .roomJoinPresent
            input.grants
            input.projectState
            (participantTargetMatch input)
            (subjectAbsent input.subject)
            state
            (participantSessionCase input)
            (participantRecordCase input)
  | some .mediaPublish => participantMediaCaseOf input .publish
  | some .mediaSubscribe => participantMediaCaseOf input .subscribe
  | some .dataSend => participantMediaCaseOf input .dataSend

def decideParticipantConcrete (input : ParticipantInput) : Decision :=
  decideParticipantCase (participantCaseOf input)

theorem participant_abstraction (input : ParticipantInput) :
    decideParticipantConcrete input = decideParticipantCase (participantCaseOf input) := by
  rfl

structure ProjectUserTargetInput where
  projectId : String
  accountId : Option String
  projectUserId : Option String
  roomId : Option String
  sessionId : Option String
  participantId : Option String
  currentRole : Option String
  nextRole : Option String
deriving DecidableEq, Repr

structure ProjectUserInput where
  actorProjectId : String
  actorRole : Option String
  projectId : String
  projectState : ProjectState
  operation : Option Operation
  target : ProjectUserTargetInput
deriving DecidableEq, Repr

def roleValueOf (role : Option String) : RoleValue :=
  match role with
  | none => .missing
  | some value =>
      match Role.fromString? value with
      | none => .invalid
      | some parsed => .valid parsed

def projectUserTargetIdPresent (operation : Operation) (target : ProjectUserTargetInput) : Bool :=
  match operation with
  | .projectUserAdd => target.accountId.isSome
  | .projectUserRemove | .projectUserChangeRole => target.projectUserId.isSome
  | .roomUpdate | .roomDelete => target.roomId.isSome
  | .sessionDisconnect => target.sessionId.isSome
  | .participantDisconnect => target.participantId.isSome
  | _ => true

def projectUserCaseOf (input : ProjectUserInput) :
    Sum ProjectUserCase ProjectUserInvalidOperationCase :=
  match input.operation with
  | none =>
      .inr
        { projectState := input.projectState
          actorProjectMatch := input.actorProjectId == input.projectId
          targetProjectMatch := input.target.projectId == input.projectId
        }
  | some operation =>
      .inl
        { actorRole := roleValueOf input.actorRole
          operation := operation
          projectState := input.projectState
          actorProjectMatch := input.actorProjectId == input.projectId
          targetProjectMatch := input.target.projectId == input.projectId
          targetIdPresent := projectUserTargetIdPresent operation input.target
          currentRole := roleValueOf input.target.currentRole
          nextRole := roleValueOf input.target.nextRole
        }

def decideProjectUserConcrete (input : ProjectUserInput) : Decision :=
  match projectUserCaseOf input with
  | .inl c => decideProjectUserCase c
  | .inr c => decideProjectUserInvalidOperationCase c

theorem project_user_abstraction (input : ProjectUserInput) :
    decideProjectUserConcrete input =
      match projectUserCaseOf input with
      | .inl c => decideProjectUserCase c
      | .inr c => decideProjectUserInvalidOperationCase c := by
  rfl

structure CredentialTargetInput where
  projectId : String
  targetIdPresent : Bool
deriving DecidableEq, Repr

structure CredentialInput where
  credentialProjectId : String
  scopes : List String
  revoked : Bool
  expiresAt : Option Int
  now : Option Int
  projectId : String
  projectState : ProjectState
  operation : Option Operation
  target : CredentialTargetInput
deriving DecidableEq, Repr

def scopeSetOfStrings? (values : List String) : Option ScopeSet :=
  let parsed := values.map Scope.fromString?
  if parsed.all (fun value => value.isSome) then
    some (ScopeSet.ofList (parsed.filterMap id))
  else
    none

def credentialExpiryState (expiresAt now : Option Int) : ExpiryState :=
  match expiresAt, now with
  | some expiry, some current =>
      if current < expiry then .valid else .expired
  | _, _ => .invalid

def credentialCaseOf (input : CredentialInput) : CredentialCase :=
  { revoked := input.revoked
    expiry := credentialExpiryState input.expiresAt input.now
    credentialProjectMatch := input.credentialProjectId == input.projectId
    targetProjectMatch := input.target.projectId == input.projectId
    projectState := input.projectState
    scopes :=
      match scopeSetOfStrings? input.scopes with
      | none => .invalid
      | some set => .valid set
    operation :=
      match input.operation with
      | none => .invalid
      | some operation => .valid operation
    targetIdPresent := input.target.targetIdPresent
  }

def decideCredentialConcrete (input : CredentialInput) : Decision :=
  decideCredentialCase (credentialCaseOf input)

theorem credential_abstraction (input : CredentialInput) :
    decideCredentialConcrete input = decideCredentialCase (credentialCaseOf input) := by
  rfl

end AuthorizationVerification
