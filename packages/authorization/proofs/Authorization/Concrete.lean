import Authorization.Participant
import Authorization.ProjectUser
import Authorization.ManagementCredential
import Authorization.SpecAttributes

namespace Authorization

structure Rule (Input : Type) where
  id : String
  reason : String
  fails : Input -> Bool

def firstViolation {Input : Type} (rules : List (Rule Input)) (input : Input) : Option String :=
  match rules with
  | [] => none
  | rule :: rest =>
      if rule.fails input then some rule.reason else firstViolation rest input

structure ConcreteParticipantSession where
  id : String
  projectId : String
  roomId : String
  participantId : String
  state : SessionState
deriving DecidableEq, Repr, BEq

structure ConcreteParticipantRecord where
  id : String
  roomId : String
  externalUserId : String
  state : ParticipantState
deriving DecidableEq, Repr, BEq

structure ConcreteParticipantInput where
  operation : ParticipantOperation
  projectState : ProjectState
  projectId : String
  credentialProjectId : String
  credentialRoomName : String
  credentialSubject : String
  roomState : RoomState
  roomId : String
  roomProjectId : String
  roomName : String
  grants : ParticipantGrants
  session : Option ConcreteParticipantSession
  participant : Option ConcreteParticipantRecord
deriving DecidableEq, Repr, BEq

def concreteParticipantTargetMatch (input : ConcreteParticipantInput) : Bool :=
  input.credentialProjectId == input.projectId &&
    input.credentialRoomName == input.roomName &&
    input.roomProjectId == input.projectId

def concreteSessionState (input : ConcreteParticipantInput) : SessionState :=
  input.session.map (fun session => session.state) |>.getD .active

def concreteSessionTargetMatch (input : ConcreteParticipantInput) : Bool :=
  match input.session, input.participant with
  | none, _ => true
  | some _, none => false
  | some session, some participant =>
      session.projectId == input.projectId &&
        session.roomId == input.roomId &&
        session.participantId == participant.id

def concreteParticipantState (input : ConcreteParticipantInput) : ParticipantState :=
  input.participant.map (fun participant => participant.state) |>.getD .active

def concreteParticipantTargetMatchRecord (input : ConcreteParticipantInput) : Bool :=
  match input.participant with
  | none => true
  | some participant => participant.roomId == input.roomId

def concreteParticipantSubjectClass (input : ConcreteParticipantInput) : SubjectClass :=
  match input.participant with
  | none => .match
  | some participant =>
      if participant.externalUserId == "" then .empty
      else if participant.externalUserId == input.credentialSubject then .match
      else .mismatch

def concreteSubjectClass (input : ConcreteParticipantInput) : SubjectClass :=
  if input.credentialSubject == "" then .empty else .match

def abstractParticipantInput (input : ConcreteParticipantInput) : ParticipantInput :=
  { operation := input.operation,
    projectState := input.projectState,
    targetMatch := concreteParticipantTargetMatch input,
    subjectClass := concreteSubjectClass input,
    roomState := input.roomState,
    sessionPresent := input.session.isSome,
    sessionState := concreteSessionState input,
    sessionTargetMatch := concreteSessionTargetMatch input,
    participantPresent := input.participant.isSome,
    participantState := concreteParticipantState input,
    participantTargetMatch := concreteParticipantTargetMatchRecord input,
    participantSubjectClass := concreteParticipantSubjectClass input,
    grants := input.grants }

structure ParticipantRefinement where
  abstractRule : ParticipantRule
  concreteFails : ConcreteParticipantInput -> Bool
  agrees : ∀ input, concreteFails input = abstractRule.fails (abstractParticipantInput input)

def participantRefinementAt (index : Nat) (proof : index < participantRules.length)
    (concreteFails : ConcreteParticipantInput -> Bool)
    (agrees : ∀ input,
      concreteFails input = (participantRules.get ⟨index, proof⟩).fails
        (abstractParticipantInput input)) : ParticipantRefinement :=
  { abstractRule := participantRules.get ⟨index, proof⟩, concreteFails, agrees }

def participantRefinements : List ParticipantRefinement := [
  participantRefinementAt 0 (by decide)
    (fun input => input.projectState != .active) (by intro input; rfl),
  participantRefinementAt 1 (by decide)
    (fun input => !concreteParticipantTargetMatch input) (by intro input; rfl),
  participantRefinementAt 2 (by decide)
    (fun input => participantSubjectRequired && concreteSubjectClass input == .empty)
    (by intro input; rfl),
  participantRefinementAt 3 (by decide)
    (fun input =>
      participantSubjectRequired && input.participant.isSome &&
        concreteParticipantSubjectClass input == .empty) (by intro input; rfl),
  participantRefinementAt 4 (by decide)
    (fun input =>
      participantSubjectMustMatch && input.participant.isSome &&
        concreteParticipantSubjectClass input == .mismatch) (by intro input; rfl),
  participantRefinementAt 5 (by decide)
    (fun input => !grantEnabled input.grants (participantGrantFor input.operation))
    (by intro input; rfl),
  participantRefinementAt 6 (by decide)
    (fun input => input.operation == .roomCreate && input.roomState != .absent)
    (by intro input; rfl),
  participantRefinementAt 7 (by decide)
    (fun input =>
      input.operation == .roomCreate &&
        !allGrantsEnabled input.grants (participantRequiredGrants input.operation))
    (by intro input; rfl),
  participantRefinementAt 8 (by decide)
    (fun input => input.operation == .roomCreate && input.session.isSome)
    (by intro input; rfl),
  participantRefinementAt 9 (by decide)
    (fun input => input.operation == .roomCreate && input.participant.isSome)
    (by intro input; rfl),
  participantRefinementAt 10 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        !allGrantsEnabled input.grants
          (participantRequiredGrantsWhenRoomAbsent input.operation))
    (by intro input; rfl),
  participantRefinementAt 11 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        input.session.isSome)
    (by intro input; rfl),
  participantRefinementAt 12 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        input.participant.isSome)
    (by intro input; rfl),
  participantRefinementAt 13 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState != .absent &&
        input.roomState != .active)
    (by intro input; rfl),
  participantRefinementAt 14 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.session.isSome && !input.participant.isSome)
    (by intro input; rfl),
  participantRefinementAt 15 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.session.isSome && concreteSessionState input != .active)
    (by intro input; rfl),
  participantRefinementAt 16 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.session.isSome && !concreteSessionTargetMatch input)
    (by intro input; rfl),
  participantRefinementAt 17 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.participant.isSome && concreteParticipantState input != .active)
    (by intro input; rfl),
  participantRefinementAt 18 (by decide)
    (fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.participant.isSome && !concreteParticipantTargetMatchRecord input)
    (by intro input; rfl),
  participantRefinementAt 19 (by decide)
    (fun input =>
      isMediaData input.operation && participantRequiresExistingRoom input.operation &&
        input.roomState != .active)
    (by intro input; rfl),
  participantRefinementAt 20 (by decide)
    (fun input => isMediaData input.operation && !input.session.isSome)
    (by intro input; rfl),
  participantRefinementAt 21 (by decide)
    (fun input =>
      isMediaData input.operation && input.session.isSome &&
        concreteSessionState input != .active)
    (by intro input; rfl),
  participantRefinementAt 22 (by decide)
    (fun input =>
      isMediaData input.operation && input.session.isSome &&
        !input.participant.isSome)
    (by intro input; rfl),
  participantRefinementAt 23 (by decide)
    (fun input =>
      isMediaData input.operation && input.session.isSome &&
        input.participant.isSome && concreteParticipantState input != .active)
    (by intro input; rfl),
  participantRefinementAt 24 (by decide)
    (fun input =>
      isMediaData input.operation && input.session.isSome &&
        input.participant.isSome && !concreteSessionTargetMatch input)
    (by intro input; rfl),
  participantRefinementAt 25 (by decide)
    (fun input =>
      isMediaData input.operation && input.session.isSome &&
        input.participant.isSome && !concreteParticipantTargetMatchRecord input)
    (by intro input; rfl)
]

def concreteParticipantRules : List (Rule ConcreteParticipantInput) :=
  participantRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.concreteFails }

def abstractParticipantRules : List (Rule ParticipantInput) :=
  participantRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.abstractRule.fails }

private theorem participant_rules_map_refine
    (refinements : List ParticipantRefinement) (input : ConcreteParticipantInput) :
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.concreteFails })
      input =
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.abstractRule.fails })
      (abstractParticipantInput input) := by
  induction refinements with
  | nil => rfl
  | cons refinement rest ih =>
      simp [firstViolation, refinement.agrees input, ih]

private theorem participant_rules_refine (input : ConcreteParticipantInput) :
    firstViolation concreteParticipantRules input =
      firstViolation abstractParticipantRules (abstractParticipantInput input) :=
  participant_rules_map_refine participantRefinements input

private theorem participant_rules_match :
    abstractParticipantRules = participantRules.map
      (fun rule => { id := rule.id, reason := rule.reason, fails := rule.fails }) := by
  rfl

private theorem firstParticipantViolationFrom_eq_generic
    (rules : List ParticipantRule) (input : ParticipantInput) :
    firstParticipantViolationFrom rules input =
      firstViolation
        (rules.map fun rule =>
          { id := rule.id, reason := rule.reason, fails := rule.fails })
        input := by
  induction rules with
  | nil => rfl
  | cons rule rest ih =>
      simp [firstParticipantViolationFrom, firstViolation, ih]

def concreteParticipantTargetKeys (input : ConcreteParticipantInput) : List String :=
  ["projectId", "roomName"] ++
    (if input.roomState == .absent then [] else ["roomId"]) ++
    (if input.session.isSome then ["sessionId"] else []) ++
    (if input.participant.isSome then ["participantId"] else [])

def decideParticipantConcrete (input : ConcreteParticipantInput) : Decision :=
  match firstViolation concreteParticipantRules input with
  | some reason =>
      { allowed := false, reason, targetKeys := concreteParticipantTargetKeys input }
  | none =>
      { allowed := true, reason := "allowed", targetKeys := concreteParticipantTargetKeys input }

@[auth_spec "AUTH-VER-02"]
theorem participant_concrete_abstract_equivalence
    (input : ConcreteParticipantInput) :
    decideParticipantConcrete input = decideParticipant (abstractParticipantInput input) := by
  have hfirst := participant_rules_refine input
  have hrules := participant_rules_match
  simp [decideParticipantConcrete, decideParticipant, firstParticipantViolation,
    firstParticipantViolationFrom_eq_generic, hfirst, hrules,
    concreteParticipantTargetKeys, participantTargetKeys, abstractParticipantInput]
  rfl

structure ConcreteProjectUserTarget where
  projectId : String
  accountId : Option String
  projectUserId : Option String
  roomId : Option String
  sessionId : Option String
  participantId : Option String
  resourceId : Option String
  currentRole : Option Role
  nextRole : Option Role
deriving DecidableEq, Repr, BEq

structure ConcreteProjectUserInput where
  operation : ManagementOperation
  projectState : ProjectState
  actorProjectId : String
  projectId : String
  role : Option Role
  target : ConcreteProjectUserTarget
deriving DecidableEq, Repr, BEq

def concreteProjectUserTargetIdPresent
    (input : ConcreteProjectUserInput) : Bool :=
  match input.operation with
  | .projectUserAdd => input.target.accountId.isSome
  | .projectUserRemove => input.target.projectUserId.isSome
  | .projectUserChangeRole => input.target.projectUserId.isSome
  | .roomUpdate => input.target.roomId.isSome
  | .roomDelete => input.target.roomId.isSome
  | .sessionDisconnect => input.target.sessionId.isSome
  | .participantDisconnect => input.target.participantId.isSome
  | _ => input.target.resourceId.isSome

def concreteProjectUserRole (input : ConcreteProjectUserInput) : Role :=
  input.role.getD .none

def concreteProjectUserActorMatch (input : ConcreteProjectUserInput) : Bool :=
  input.actorProjectId == input.projectId

def concreteProjectUserTargetMatch (input : ConcreteProjectUserInput) : Bool :=
  input.target.projectId == input.projectId

def concreteProjectUserAdminManagesOwner (input : ConcreteProjectUserInput) : Bool :=
  input.role == some .admin &&
    (adminOwnerManagementFields input.operation).any fun field =>
      match field with
      | .currentRole => input.target.currentRole == some .owner
      | .nextRole => input.target.nextRole == some .owner

def abstractProjectUserInput (input : ConcreteProjectUserInput) : ProjectUserInput :=
  { operation := input.operation,
    projectState := input.projectState,
    actorProjectMatch := concreteProjectUserActorMatch input,
    targetProjectMatch := concreteProjectUserTargetMatch input,
    role := concreteProjectUserRole input,
    targetIdPresent := concreteProjectUserTargetIdPresent input,
    currentRole := input.target.currentRole,
    nextRole := input.target.nextRole }

structure ProjectUserRefinement where
  abstractRule : ProjectUserRule
  concreteFails : ConcreteProjectUserInput -> Bool
  agrees : ∀ input, concreteFails input = abstractRule.fails (abstractProjectUserInput input)

def projectUserRefinementAt (index : Nat) (proof : index < projectUserRules.length)
    (concreteFails : ConcreteProjectUserInput -> Bool)
    (agrees : ∀ input,
      concreteFails input = (projectUserRules.get ⟨index, proof⟩).fails
        (abstractProjectUserInput input)) : ProjectUserRefinement :=
  { abstractRule := projectUserRules.get ⟨index, proof⟩, concreteFails, agrees }

def projectUserRefinements : List ProjectUserRefinement := [
  projectUserRefinementAt 0 (by decide)
    (fun input => input.projectState != .active) (by intro input; rfl),
  projectUserRefinementAt 1 (by decide)
    (fun input => !concreteProjectUserActorMatch input) (by intro input; rfl),
  projectUserRefinementAt 2 (by decide)
    (fun input => !concreteProjectUserTargetMatch input) (by intro input; rfl),
  projectUserRefinementAt 3 (by decide)
    (fun input => concreteProjectUserRole input == .none) (by intro input; rfl),
  projectUserRefinementAt 4 (by decide)
    (fun input =>
      requiresTargetId input.operation && !concreteProjectUserTargetIdPresent input)
    (by intro input; rfl),
  projectUserRefinementAt 5 (by decide)
    (fun input =>
      !roleAllows (concreteProjectUserRole input) input.operation)
    (by intro input; rfl),
  projectUserRefinementAt 6 (by decide)
    (fun input =>
      requiresNextRole input.operation && input.target.nextRole.isNone)
    (by intro input; rfl),
  projectUserRefinementAt 7 (by decide)
    (fun input =>
      requiresCurrentRole input.operation && input.target.currentRole.isNone)
    (by intro input; rfl),
  projectUserRefinementAt 8 (by decide)
    (fun input =>
      concreteProjectUserRole input == .admin &&
        (adminOwnerManagementFields input.operation).any fun field =>
          match field with
          | .currentRole => input.target.currentRole == some .owner
          | .nextRole => input.target.nextRole == some .owner)
    (by intro input; rfl)
]

def concreteProjectUserRules : List (Rule ConcreteProjectUserInput) :=
  projectUserRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.concreteFails }

def abstractProjectUserRules : List (Rule ProjectUserInput) :=
  projectUserRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.abstractRule.fails }

private theorem projectUser_rules_map_refine
    (refinements : List ProjectUserRefinement) (input : ConcreteProjectUserInput) :
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.concreteFails })
      input =
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.abstractRule.fails })
      (abstractProjectUserInput input) := by
  induction refinements with
  | nil => rfl
  | cons refinement rest ih =>
      simp [firstViolation, refinement.agrees input, ih]

private theorem projectUser_rules_match :
    abstractProjectUserRules = projectUserRules.map
      (fun rule => { id := rule.id, reason := rule.reason, fails := rule.fails }) := by
  rfl

private theorem firstProjectUserViolationFrom_eq_generic
    (rules : List ProjectUserRule) (input : ProjectUserInput) :
    firstProjectUserViolationFrom rules input =
      firstViolation
        (rules.map fun rule =>
          { id := rule.id, reason := rule.reason, fails := rule.fails })
        input := by
  induction rules with
  | nil => rfl
  | cons rule rest ih =>
      simp [firstProjectUserViolationFrom, firstViolation, ih]

def concreteProjectUserTargetKeys (input : ConcreteProjectUserInput) : List String :=
  match input.operation with
  | .projectUserAdd =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["accountId"] else []) ++
        (if input.target.nextRole.isSome then ["nextRole"] else [])
  | .projectUserRemove =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["projectUserId"] else []) ++
        (if input.target.currentRole.isSome then ["currentRole"] else []) ++
        (if input.target.nextRole.isSome then ["nextRole"] else [])
  | .projectUserChangeRole =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["projectUserId"] else []) ++
        (if input.target.currentRole.isSome then ["currentRole"] else []) ++
        (if input.target.nextRole.isSome then ["nextRole"] else [])
  | .roomUpdate | .roomDelete =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["roomId"] else [])
  | .sessionDisconnect =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["sessionId"] else [])
  | .participantDisconnect =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["participantId"] else [])
  | _ =>
      ["projectId"] ++
        (if concreteProjectUserTargetIdPresent input then ["resourceId"] else [])

def decideProjectUserConcrete (input : ConcreteProjectUserInput) : Decision :=
  match firstViolation concreteProjectUserRules input with
  | some reason =>
      { allowed := false, reason, targetKeys := concreteProjectUserTargetKeys input }
  | none =>
      { allowed := true, reason := "allowed", targetKeys := concreteProjectUserTargetKeys input }

@[auth_spec "AUTH-VER-02"]
theorem project_user_concrete_abstract_equivalence
    (input : ConcreteProjectUserInput) :
    decideProjectUserConcrete input = decideProjectUser (abstractProjectUserInput input) := by
  have hfirst := projectUser_rules_map_refine projectUserRefinements input
  have hrules := projectUser_rules_match
  have hfirstConcrete :
      firstViolation concreteProjectUserRules input =
        firstViolation abstractProjectUserRules (abstractProjectUserInput input) := by
    simpa [concreteProjectUserRules, abstractProjectUserRules] using hfirst
  unfold decideProjectUserConcrete decideProjectUser
  rw [hfirstConcrete, hrules]
  simp [firstProjectUserViolation, firstProjectUserViolationFrom_eq_generic,
    concreteProjectUserTargetKeys, projectUserTargetKeys, abstractProjectUserInput]
  rfl

inductive ConcreteNumber where
  | safeInteger (value : Int)
  | fractional
  | nonFinite
  | outOfSafeRange
deriving DecidableEq, Repr, BEq

structure ConcreteCredentialInput where
  operation : ManagementOperation
  projectState : ProjectState
  credentialProjectId : String
  projectId : String
  targetProjectId : String
  scopes : List CredentialScope
  revoked : Bool
  expiresAt : ConcreteNumber
  now : ConcreteNumber
  targetIdPresent : Bool
deriving DecidableEq, Repr, BEq

def concreteExpiryClass (input : ConcreteCredentialInput) : ExpiryClass :=
  match input.expiresAt, input.now with
  | .safeInteger expiresAt, .safeInteger now =>
      if now < expiresAt then .valid else .expired
  | _, _ => .invalid

def concreteScopes (input : ConcreteCredentialInput) : CredentialScopes :=
  { roomManage := input.scopes.contains .roomManage,
    sessionManage := input.scopes.contains .sessionManage,
    usageRead := input.scopes.contains .usageRead,
    auditRead := input.scopes.contains .auditRead }

def concreteCredentialProjectMatch (input : ConcreteCredentialInput) : Bool :=
  input.credentialProjectId == input.projectId

def concreteCredentialTargetMatch (input : ConcreteCredentialInput) : Bool :=
  input.targetProjectId == input.projectId

def concreteHasRequiredScope (input : ConcreteCredentialInput) : Bool :=
  (requiredScopes input.operation).any (fun scope => input.scopes.contains scope)

private theorem scopeEnabled_concreteScopes
    (input : ConcreteCredentialInput) (scope : CredentialScope) :
    scopeEnabled (concreteScopes input) scope = input.scopes.contains scope := by
  cases scope <;> rfl

def abstractManagementCredentialInput
    (input : ConcreteCredentialInput) : ManagementCredentialInput :=
  { operation := input.operation,
    projectState := input.projectState,
    credentialProjectMatch := concreteCredentialProjectMatch input,
    targetProjectMatch := concreteCredentialTargetMatch input,
    scopes := concreteScopes input,
    revoked := input.revoked,
    expiry := concreteExpiryClass input,
    targetIdPresent := input.targetIdPresent }

private theorem concreteHasRequiredScope_eq (input : ConcreteCredentialInput) :
    concreteHasRequiredScope input =
      hasRequiredScope (abstractManagementCredentialInput input) := by
  simp [concreteHasRequiredScope, hasRequiredScope, abstractManagementCredentialInput,
    concreteScopes, requiredScopes]
  split <;> simp [scopeEnabled]

private theorem managementCredentialRule7_fails
    (input : ManagementCredentialInput) :
    (managementCredentialRules.get ⟨7, by decide⟩).fails input =
      !hasRequiredScope input := rfl

structure ManagementCredentialRefinement where
  abstractRule : ManagementCredentialRule
  concreteFails : ConcreteCredentialInput -> Bool
  agrees : ∀ input,
    concreteFails input = abstractRule.fails (abstractManagementCredentialInput input)

def managementCredentialRefinementAt
    (index : Nat) (proof : index < managementCredentialRules.length)
    (concreteFails : ConcreteCredentialInput -> Bool)
    (agrees : ∀ input,
      concreteFails input = (managementCredentialRules.get ⟨index, proof⟩).fails
        (abstractManagementCredentialInput input)) : ManagementCredentialRefinement :=
  { abstractRule := managementCredentialRules.get ⟨index, proof⟩, concreteFails, agrees }

def managementCredentialRefinements : List ManagementCredentialRefinement := [
  managementCredentialRefinementAt 0 (by decide)
    (fun input => input.revoked) (by intro input; rfl),
  managementCredentialRefinementAt 1 (by decide)
    (fun input => concreteExpiryClass input == .invalid) (by intro input; rfl),
  managementCredentialRefinementAt 2 (by decide)
    (fun input => concreteExpiryClass input == .expired) (by intro input; rfl),
  managementCredentialRefinementAt 3 (by decide)
    (fun input =>
      !concreteCredentialProjectMatch input || !concreteCredentialTargetMatch input)
    (by intro input; rfl),
  managementCredentialRefinementAt 4 (by decide)
    (fun input => input.projectState != .active) (by intro input; rfl),
  managementCredentialRefinementAt 5 (by decide)
    (fun input =>
      managementRequiresTargetId input.operation && !input.targetIdPresent)
    (by intro input; rfl),
  managementCredentialRefinementAt 6 (by decide)
    (fun input => (requiredScopes input.operation).isEmpty) (by intro input; rfl),
  managementCredentialRefinementAt 7 (by decide)
    (fun input => !concreteHasRequiredScope input)
    (by
      intro input
      rw [managementCredentialRule7_fails, concreteHasRequiredScope_eq])
]

def concreteManagementCredentialRules : List (Rule ConcreteCredentialInput) :=
  managementCredentialRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.concreteFails }

def abstractManagementCredentialRules : List (Rule ManagementCredentialInput) :=
  managementCredentialRefinements.map fun refinement =>
    { id := refinement.abstractRule.id,
      reason := refinement.abstractRule.reason,
      fails := refinement.abstractRule.fails }

private theorem managementCredential_rules_map_refine
    (refinements : List ManagementCredentialRefinement)
    (input : ConcreteCredentialInput) :
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.concreteFails })
      input =
    firstViolation
      (refinements.map fun refinement =>
        { id := refinement.abstractRule.id,
          reason := refinement.abstractRule.reason,
          fails := refinement.abstractRule.fails })
      (abstractManagementCredentialInput input) := by
  induction refinements with
  | nil => rfl
  | cons refinement rest ih =>
      simp [firstViolation, refinement.agrees input, ih]

private theorem managementCredential_rules_match :
    abstractManagementCredentialRules = managementCredentialRules.map
      (fun rule => { id := rule.id, reason := rule.reason, fails := rule.fails }) := by
  rfl

private theorem firstManagementCredentialViolationFrom_eq_generic
    (rules : List ManagementCredentialRule) (input : ManagementCredentialInput) :
    firstManagementCredentialViolationFrom rules input =
      firstViolation
        (rules.map fun rule =>
          { id := rule.id, reason := rule.reason, fails := rule.fails })
        input := by
  induction rules with
  | nil => rfl
  | cons rule rest ih =>
      simp [firstManagementCredentialViolationFrom, firstViolation, ih]

def concreteManagementCredentialTargetKeys
    (input : ConcreteCredentialInput) : List String :=
  match input.operation with
  | .roomUpdate | .roomDelete =>
      ["projectId"] ++ (if input.targetIdPresent then ["roomId"] else [])
  | .sessionDisconnect =>
      ["projectId"] ++ (if input.targetIdPresent then ["sessionId"] else [])
  | .participantDisconnect =>
      ["projectId"] ++ (if input.targetIdPresent then ["participantId"] else [])
  | _ =>
      ["projectId"] ++ (if input.targetIdPresent then ["resourceId"] else [])

def decideManagementCredentialConcrete (input : ConcreteCredentialInput) : Decision :=
  match firstViolation concreteManagementCredentialRules input with
  | some reason =>
      { allowed := false, reason, targetKeys := concreteManagementCredentialTargetKeys input }
  | none =>
      { allowed := true, reason := "allowed",
        targetKeys := concreteManagementCredentialTargetKeys input }

@[auth_spec "AUTH-VER-02"]
theorem management_credential_concrete_abstract_equivalence
    (input : ConcreteCredentialInput) :
    decideManagementCredentialConcrete input =
      decideManagementCredential (abstractManagementCredentialInput input) := by
  have hfirst := managementCredential_rules_map_refine managementCredentialRefinements input
  have hrules := managementCredential_rules_match
  have hfirstConcrete :
      firstViolation concreteManagementCredentialRules input =
        firstViolation abstractManagementCredentialRules
          (abstractManagementCredentialInput input) := by
    simpa [concreteManagementCredentialRules, abstractManagementCredentialRules] using hfirst
  unfold decideManagementCredentialConcrete decideManagementCredential
  rw [hfirstConcrete, hrules]
  simp [firstManagementCredentialViolation,
    firstManagementCredentialViolationFrom_eq_generic,
    concreteManagementCredentialTargetKeys, managementCredentialTargetKeys,
    abstractManagementCredentialInput]
  rfl

end Authorization
