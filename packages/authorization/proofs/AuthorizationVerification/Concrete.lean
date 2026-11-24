import AuthorizationVerification.Model

set_option linter.unusedSimpArgs false

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
  grantInput : GrantInput
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

theorem participantRecordCase_subjectStatus (input : ParticipantInput) :
    (participantRecordCase input).map (·.subjectStatus) = participantSubjectCases input := by
  cases h : input.participant <;> simp [participantRecordCase, participantSubjectCases, h]

theorem participantSessionCase_isSome (input : ParticipantInput) :
    (participantSessionCase input).isSome = input.session.isSome := by
  cases h : input.session <;> simp [participantSessionCase, h]

def grantInputGrants : GrantInput → Grants
  | .valid grants => grants
  | .invalid _ =>
      { roomCreate := false
        roomJoin := false
        mediaPublish := false
        mediaSubscribe := false
        dataSend := false
      }

def participantMediaCaseOf (input : ParticipantInput) (operation : MediaOperation) :
    ParticipantCase :=
  match input.room.state with
  | some .active =>
      .mediaRoomActive
        operation
        (grantInputGrants input.grantInput)
        input.projectState
        (participantTargetMatch input)
        (subjectAbsent input.subject)
        (participantSessionCase input)
        (participantRecordCase input)
  | _ =>
      .mediaRoomInactive
        operation
        (grantInputGrants input.grantInput)
        input.projectState
        (participantTargetMatch input)
        (subjectAbsent input.subject)
        (participantSubjectCases input)

def participantCaseOf (input : ParticipantInput) : ParticipantCase :=
  match input.operation with
  | none => .invalidOperation
  | some operation =>
      match input.grantInput with
      | .invalid kind =>
        .invalidGrant
          operation
          input.projectState
          (participantTargetMatch input)
          (subjectAbsent input.subject)
          (participantSubjectCases input)
          kind
      | .valid grants => match operation with
        | .roomCreate =>
            .roomCreate
              grants
              input.projectState
              (participantTargetMatch input)
              (subjectAbsent input.subject)
              input.room.state.isSome
              input.session.isSome
              (participantSubjectCases input)
        | .roomJoin =>
            match input.room.state with
            | none =>
                .roomJoinAbsent
                  grants
                  input.projectState
                  (participantTargetMatch input)
                  (subjectAbsent input.subject)
                  input.session.isSome
                  (participantSubjectCases input)
            | some state =>
                .roomJoinPresent
                  grants
                  input.projectState
                  (participantTargetMatch input)
                  (subjectAbsent input.subject)
                  state
                  (participantSessionCase input)
                  (participantRecordCase input)
        | .mediaPublish => participantMediaCaseOf input .publish
        | .mediaSubscribe => participantMediaCaseOf input .subscribe
        | .dataSend => participantMediaCaseOf input .dataSend

def decideParticipantMediaConcrete (input : ParticipantInput) : Decision :=
  if input.room.state != some .active then deny "room-not-active"
  else match participantSessionCase input with
    | none => deny "session-required"
    | some session =>
        if session.state != .active then deny "session-not-active"
        else match participantRecordCase input with
          | none => deny "participant-required"
          | some participant =>
              if participant.state != .active then deny "participant-not-active"
              else if !sessionMatches session (some participant) then
                deny "session-target-mismatch"
              else if !participant.roomMatch then
                deny "participant-target-mismatch"
              else allow

def decideParticipantConcrete (input : ParticipantInput) : Decision :=
  match input.operation with
  | none => deny "unsupported-operation"
  | some operation =>
      if input.projectState != .active then deny "project-not-active"
      else if !participantTargetMatch input then deny "credential-target-mismatch"
      else if participantSubjectRequired && subjectAbsent input.subject then
        deny "subject-required"
      else match participantSubjectDecision (participantSubjectCases input) with
        | some decision => decision
        | none =>
            match input.grantInput with
            | .invalid _ => deny "grant-input-invalid"
            | .valid grants =>
                if grants.forOperation (some operation) != true then deny "grant-not-granted"
                else match operation with
                  | .roomCreate =>
                      if input.room.state.isSome then deny "room-already-exists"
                      else if grants.roomJoin != true then deny "room-join-required"
                      else if input.session.isSome then deny "session-target-mismatch"
                      else if input.participant.isSome then deny "participant-target-mismatch"
                      else allow
                  | .roomJoin =>
                      match input.room.state with
                      | none =>
                          if grants.roomCreate != true then deny "room-create-required"
                          else if input.session.isSome then deny "session-target-mismatch"
                          else if input.participant.isSome then deny "participant-target-mismatch"
                          else allow
                      | some roomState =>
                          if roomState != .active then deny "room-not-active"
                          else if (participantSessionCase input).isSome &&
                              participantRecordCase input = none then
                            deny "participant-required"
                          else match participantSessionCase input with
                            | some session =>
                                if session.state != .active then deny "session-not-active"
                                else match participantRecordCase input with
                                  | some participant =>
                                      if !sessionMatches session (some participant) then
                                        deny "session-target-mismatch"
                                      else if participant.state != .active then
                                        deny "participant-not-active"
                                      else if !participant.roomMatch then
                                        deny "participant-target-mismatch"
                                      else allow
                                  | none => allow
                            | none =>
                                match participantRecordCase input with
                                | some participant =>
                                    if participant.state != .active then
                                      deny "participant-not-active"
                                    else if !participant.roomMatch then
                                      deny "participant-target-mismatch"
                                    else allow
                                | none => allow
                  | .mediaPublish => decideParticipantMediaConcrete input
                  | .mediaSubscribe => decideParticipantMediaConcrete input
                  | .dataSend => decideParticipantMediaConcrete input

@[auth_spec "AUTH-VER-02"]
theorem participant_abstraction (input : ParticipantInput) :
    decideParticipantConcrete input = decideParticipantCase (participantCaseOf input) := by
  cases hOperation : input.operation with
  | none =>
      simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf, hOperation]
  | some operation =>
      cases hGrant : input.grantInput with
      | invalid kind =>
          simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf, hOperation,
            hGrant] <;> rfl
      | valid grants =>
          cases operation with
          | roomCreate =>
              simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf, hOperation,
                hGrant, Grants.forOperation, participantSubjectCases, participantSubjectDecision] <;>
                (repeat' split <;> rfl)
          | roomJoin =>
              cases hRoom : input.room.state <;>
                simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf, hOperation,
                  hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                  participantSessionCase, participantRoomMatch,
                  participantSubjectStatus, participantSubjectDecision, sessionMatches,
                  participantRecordCase_subjectStatus, participantSessionCase_isSome] <;>
                (repeat' split <;> rfl)
          | mediaPublish =>
              cases hRoom : input.room.state with
              | none =>
                  simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                    hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                    participantSessionCase, participantRoomMatch, participantSubjectStatus,
                    participantSubjectDecision, sessionMatches, participantRecordCase_subjectStatus,
                    participantMediaCaseOf, decideParticipantMediaConcrete, grantInputGrants,
                    participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;> rfl
              | some roomState =>
                  cases roomState <;>
                    simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                      hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                      participantSessionCase, participantRoomMatch, participantSubjectStatus,
                      participantSubjectDecision, sessionMatches,
                      participantRecordCase_subjectStatus, participantMediaCaseOf,
                      decideParticipantMediaConcrete, grantInputGrants,
                      participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;>
                    (repeat' split <;> rfl)
          | mediaSubscribe =>
              cases hRoom : input.room.state with
              | none =>
                  simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                    hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                    participantSessionCase, participantRoomMatch, participantSubjectStatus,
                    participantSubjectDecision, sessionMatches, participantRecordCase_subjectStatus,
                    participantMediaCaseOf, decideParticipantMediaConcrete, grantInputGrants,
                    participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;> rfl
              | some roomState =>
                  cases roomState <;>
                    simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                      hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                      participantSessionCase, participantRoomMatch, participantSubjectStatus,
                      participantSubjectDecision, sessionMatches,
                      participantRecordCase_subjectStatus, participantMediaCaseOf,
                      decideParticipantMediaConcrete, grantInputGrants,
                      participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;>
                    (repeat' split <;> rfl)
          | dataSend =>
              cases hRoom : input.room.state with
              | none =>
                  simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                    hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                    participantSessionCase, participantRoomMatch, participantSubjectStatus,
                    participantSubjectDecision, sessionMatches, participantRecordCase_subjectStatus,
                    participantMediaCaseOf, decideParticipantMediaConcrete, grantInputGrants,
                    participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;> rfl
              | some roomState =>
                  cases roomState <;>
                    simp [decideParticipantConcrete, decideParticipantCase, participantCaseOf,
                      hOperation, hGrant, hRoom, Grants.forOperation, participantSubjectCases,
                      participantSessionCase, participantRoomMatch, participantSubjectStatus,
                      participantSubjectDecision, sessionMatches,
                      participantRecordCase_subjectStatus, participantMediaCaseOf,
                      decideParticipantMediaConcrete, grantInputGrants,
                      participantSessionCase_isSome, MediaOperation.toParticipantOperation] <;>
                    (repeat' split <;> rfl)

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

def optionHasNonEmptyString : Option String → Bool
  | none => false
  | some value => value != ""

def projectUserTargetId (operation : Operation) (target : ProjectUserTargetInput) : Option String :=
  match operation with
  | .projectUserAdd => target.accountId
  | .projectUserRemove | .projectUserChangeRole =>
      target.projectUserId
  | .roomUpdate | .roomDelete => target.roomId
  | .sessionDisconnect => target.sessionId
  | .participantDisconnect => target.participantId
  | _ => some ""

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
          targetIdState := targetIdStateOf (projectUserTargetId operation input.target)
          currentRole := roleValueOf input.target.currentRole
          nextRole := roleValueOf input.target.nextRole
        }

def decideProjectUserConcrete (input : ProjectUserInput) : Decision :=
  if input.projectState != .active then deny "project-not-active"
  else if input.actorProjectId != input.projectId then deny "actor-project-mismatch"
  else if input.target.projectId != input.projectId then deny "target-project-mismatch"
  else match input.operation with
    | none => deny "unsupported-operation"
    | some operation =>
        match roleValueOf input.actorRole with
        | .missing => deny "project-user-role-missing"
        | .invalid => deny "project-user-role-invalid"
        | .valid role =>
            if roleValueOf input.target.currentRole == .invalid ||
                roleValueOf input.target.nextRole == .invalid then
              deny "project-user-role-invalid"
            else if requiresTargetId operation &&
                targetIdStateOf (projectUserTargetId operation input.target) != .valid then
              deny "target-id-required"
            else if !roleAllows role operation then deny "insufficient-role"
            else if (operation == .projectUserAdd || operation == .projectUserChangeRole) &&
                roleValueOf input.target.nextRole == .missing then
              deny "project-user-next-role-required"
            else if (operation == .projectUserRemove || operation == .projectUserChangeRole) &&
                roleValueOf input.target.currentRole == .missing then
              deny "project-user-current-role-required"
            else if role == .admin &&
                adminOwnerManagementForbidden operation
                  (roleValueOf input.target.currentRole) (roleValueOf input.target.nextRole) then
              deny "owner-management-forbidden"
            else allow

@[auth_spec "AUTH-VER-02"]
theorem project_user_abstraction (input : ProjectUserInput) :
    decideProjectUserConcrete input = match projectUserCaseOf input with
      | .inl c => decideProjectUserCase c
      | .inr c => decideProjectUserInvalidOperationCase c := by
  cases hOperation : input.operation with
  | none =>
      simp [decideProjectUserConcrete, projectUserCaseOf, decideProjectUserCase,
        decideProjectUserInvalidOperationCase, hOperation]
  | some operation =>
      cases operation <;>
        simp [decideProjectUserConcrete, projectUserCaseOf, decideProjectUserCase, hOperation,
          decideProjectUserInvalidOperationCase, roleValueOf, projectUserTargetId,
          targetIdStateOf] <;> rfl

structure CredentialTargetInput where
  projectId : String
  targetId : Option String
deriving DecidableEq, Repr

structure CredentialInput where
  credentialProjectId : String
  scopes : List String
  revoked : Bool
  expiresAt : Option Timestamp
  now : Option Timestamp
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

def credentialExpiryState (expiresAt now : Option Timestamp) : ExpiryState :=
  match expiresAt, now with
  | some (.safe expiry), some (.safe current) =>
      if expiry < minSafeInteger || expiry > maxSafeInteger ||
          current < minSafeInteger || current > maxSafeInteger then
        .invalid
      else if current < expiry then .valid else .expired
  | _, _ => .invalid

def credentialTimeCaseOf (expiresAt now : Option Timestamp) : CredentialTimeCase :=
  match expiresAt, now with
  | none, _ => .missingExpiresAt
  | _, none => .missingNow
  | some .fractional, _ => .fractionalExpiresAt
  | _, some .fractional => .fractionalNow
  | some .nonFinite, _ => .nonFiniteExpiresAt
  | _, some .nonFinite => .nonFiniteNow
  | some .outOfSafeRange, _ => .outOfSafeRangeExpiresAt
  | _, some .outOfSafeRange => .outOfSafeRangeNow
  | some (.safe expiry), some (.safe current) =>
      match credentialExpiryState (some (.safe expiry)) (some (.safe current)) with
      | .valid => .valid
      | .expired => .expired
      | .invalid =>
          if expiry < minSafeInteger || expiry > maxSafeInteger then
            .outOfSafeRangeExpiresAt
          else .outOfSafeRangeNow

@[auth_spec "AUTH-MC-06"]
theorem credentialTimeCase_abstraction (expiresAt now : Option Timestamp) :
    credentialExpiryState expiresAt now =
      credentialTimeStateOfCase (credentialTimeCaseOf expiresAt now) := by
  cases expiresAt with
  | none =>
      cases now <;>
        simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase]
  | some expiresAt =>
      cases now with
      | none =>
          cases expiresAt <;>
            simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase]
      | some now =>
          cases expiresAt <;> cases now <;>
            simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase]
          case some.some.safe.safe expiry current =>
            by_cases hExpiry : expiry < minSafeInteger ∨ maxSafeInteger < expiry
            · simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase,
                hExpiry]
            by_cases hNow : current < minSafeInteger ∨ maxSafeInteger < current
            · simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase,
                hExpiry, hNow]
            by_cases hlt : current < expiry <;>
              simp [credentialExpiryState, credentialTimeCaseOf, credentialTimeStateOfCase,
                hExpiry, hNow, hlt]

def credentialCaseOf (input : CredentialInput) : CredentialCase :=
  { revoked := input.revoked
    time := credentialTimeCaseOf input.expiresAt input.now
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
    targetIdState := targetIdStateOf input.target.targetId
  }

def decideCredentialConcrete (input : CredentialInput) : Decision :=
  if input.revoked then deny "credential-revoked"
  else if credentialExpiryState input.expiresAt input.now == .invalid then
    deny "credential-expiry-invalid"
  else if credentialExpiryState input.expiresAt input.now == .expired then
    deny "credential-expired"
  else if input.credentialProjectId != input.projectId ||
      input.target.projectId != input.projectId then
    deny "credential-target-mismatch"
  else if input.projectState != .active then deny "project-not-active"
  else match scopeSetOfStrings? input.scopes with
    | none => deny "credential-input-invalid"
    | some set =>
        match input.operation with
        | none => deny "unsupported-operation"
        | some operation =>
            if credentialRequiresTargetId operation &&
                targetIdStateOf input.target.targetId != .valid then
              deny "target-id-required"
            else match requiredScopes operation with
              | none => deny "credential-operation-not-allowed"
              | some required =>
                  if scopeSetAllows set required then allow
                  else deny "credential-scope-missing"

@[auth_spec "AUTH-VER-02"]
theorem credential_abstraction (input : CredentialInput) :
    decideCredentialConcrete input = decideCredentialCase (credentialCaseOf input) := by
  have htime := credentialTimeCase_abstraction input.expiresAt input.now
  cases hOperation : input.operation with
  | none =>
      cases hscopes : scopeSetOfStrings? input.scopes <;>
        simp [decideCredentialConcrete, credentialCaseOf, decideCredentialCase, hOperation, htime,
          hscopes, targetIdStateOf]
  | some operation =>
      cases operation <;> cases hscopes : scopeSetOfStrings? input.scopes <;>
        simp [decideCredentialConcrete, credentialCaseOf, decideCredentialCase, hOperation, htime,
          hscopes, targetIdStateOf] <;> rfl

end AuthorizationVerification
