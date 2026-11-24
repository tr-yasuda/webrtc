import AuthorizationVerification.Cases

namespace AuthorizationVerification

theorem mem_boolValues (value : Bool) : value ∈ boolValues := by
  cases value <;> simp [boolValues]

theorem mem_flatMap_of {α β : Type} {xs : List α} {f : α → List β} {x : α} {y : β}
    (hx : x ∈ xs) (hy : y ∈ f x) : y ∈ xs.flatMap f :=
  List.mem_flatMap.mpr ⟨x, hx, hy⟩

theorem mem_allRoles (role : Role) : role ∈ allRoles := by
  cases role <;> simp [allRoles]

theorem mem_allOperations (operation : Operation) : operation ∈ allOperations := by
  cases operation <;> simp [allOperations]

theorem mem_allMediaOperations (operation : MediaOperation) :
    operation ∈ allMediaOperations := by
  cases operation <;> simp [allMediaOperations]

theorem mem_allScopeSets (set : ScopeSet) : set ∈ allScopeSets := by
  cases set with
  | mk roomManage sessionManage usageRead auditRead =>
      cases roomManage <;> cases sessionManage <;> cases usageRead <;> cases auditRead <;>
        simp [allScopeSets]

theorem mem_allGrants (grants : Grants) : grants ∈ allGrants := by
  cases grants with
  | mk roomCreate roomJoin mediaPublish mediaSubscribe dataSend =>
      cases roomCreate <;> cases roomJoin <;> cases mediaPublish <;>
        cases mediaSubscribe <;> cases dataSend <;> simp [allGrants]

theorem mem_allProjectStates (state : ProjectState) : state ∈ allProjectStates := by
  cases state <;> simp [allProjectStates]

theorem mem_allRoomStates (state : RoomState) : state ∈ allRoomStates := by
  cases state <;> simp [allRoomStates]

theorem mem_allSessionStates (state : SessionState) : state ∈ allSessionStates := by
  cases state <;> simp [allSessionStates]

theorem mem_allParticipantStates (state : ParticipantState) :
    state ∈ allParticipantStates := by
  cases state <;> simp [allParticipantStates]

theorem mem_allSessionCases (session : SessionCase) : session ∈ allSessionCases := by
  cases session with
  | mk state projectMatch roomMatch participantMatch =>
      cases state <;> cases projectMatch <;> cases roomMatch <;> cases participantMatch <;>
        simp [allSessionCases, boolValues, mem_allSessionStates]

theorem mem_allParticipantCaseRecords (participant : ParticipantCaseRecord) :
    participant ∈ allParticipantCaseRecords := by
  cases participant with
  | mk state roomMatch subjectStatus =>
      cases state <;> cases roomMatch <;> cases subjectStatus <;>
        simp [allParticipantCaseRecords, boolValues, mem_allParticipantStates,
          allParticipantSubjectStatuses]

theorem mem_allParticipantSubjectOptions (participant : Option ParticipantSubjectStatus) :
    participant ∈ allParticipantSubjectOptions := by
  cases participant with
  | none => simp [allParticipantSubjectOptions]
  | some status =>
      cases status <;> simp [allParticipantSubjectOptions, allParticipantSubjectStatuses]

theorem mem_allParticipantSessionOptions (session : Option SessionCase) :
    session ∈ allParticipantSessionOptions := by
  cases session with
  | none => simp [allParticipantSessionOptions]
  | some value => simp [allParticipantSessionOptions, mem_allSessionCases value]

theorem mem_allParticipantRecordOptions (participant : Option ParticipantCaseRecord) :
    participant ∈ allParticipantRecordOptions := by
  cases participant with
  | none => simp [allParticipantRecordOptions]
  | some value => simp [allParticipantRecordOptions, mem_allParticipantCaseRecords value]

theorem mem_allRoleValues (role : RoleValue) : role ∈ allRoleValues := by
  cases role <;> simp [allRoleValues, mem_allRoles]

theorem mem_allOperationValues (operation : OperationValue) :
    operation ∈ allOperationValues := by
  cases operation with
  | invalid => simp [allOperationValues]
  | valid value => simp [allOperationValues, mem_allOperations value]

theorem mem_allExpiryStates (state : ExpiryState) : state ∈ allExpiryStates := by
  cases state <;> simp [allExpiryStates]

theorem mem_allScopeCases (scope : ScopeCase) : scope ∈ allScopeCases := by
  cases scope with
  | invalid => simp [allScopeCases]
  | valid value => simp [allScopeCases, mem_allScopeSets value]

theorem mem_participantRoomCreateCases
    (grants : Grants) (projectState : ProjectState) (targetMatch subjectAbsent roomPresent
      sessionPresent : Bool) (participant : Option ParticipantSubjectStatus) :
    ParticipantCase.roomCreate grants projectState targetMatch subjectAbsent roomPresent
        sessionPresent participant ∈ participantRoomCreateCases := by
  apply mem_flatMap_of (x := grants) (hx := mem_allGrants grants)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  apply mem_flatMap_of (x := roomPresent) (hx := mem_boolValues roomPresent)
  apply mem_flatMap_of (x := sessionPresent) (hx := mem_boolValues sessionPresent)
  exact List.mem_map.mpr ⟨participant, mem_allParticipantSubjectOptions participant, rfl⟩

theorem mem_participantRoomJoinAbsentCases
    (grants : Grants) (projectState : ProjectState) (targetMatch subjectAbsent sessionPresent : Bool)
    (participant : Option ParticipantSubjectStatus) :
    ParticipantCase.roomJoinAbsent grants projectState targetMatch subjectAbsent sessionPresent
        participant ∈ participantRoomJoinAbsentCases := by
  apply mem_flatMap_of (x := grants) (hx := mem_allGrants grants)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  apply mem_flatMap_of (x := sessionPresent) (hx := mem_boolValues sessionPresent)
  exact List.mem_map.mpr ⟨participant, mem_allParticipantSubjectOptions participant, rfl⟩

theorem mem_participantRoomJoinPresentCases
    (grants : Grants) (projectState : ProjectState) (targetMatch subjectAbsent : Bool)
    (roomState : RoomState) (session : Option SessionCase)
    (participant : Option ParticipantCaseRecord) :
    ParticipantCase.roomJoinPresent grants projectState targetMatch subjectAbsent roomState session
        participant ∈ participantRoomJoinPresentCases := by
  apply mem_flatMap_of (x := grants) (hx := mem_allGrants grants)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  apply mem_flatMap_of (x := roomState) (hx := mem_allRoomStates roomState)
  apply mem_flatMap_of (x := session) (hx := mem_allParticipantSessionOptions session)
  exact List.mem_map.mpr ⟨participant, mem_allParticipantRecordOptions participant, rfl⟩

theorem mem_participantMediaRoomInactiveCases
    (operation : MediaOperation) (grants : Grants) (projectState : ProjectState)
    (targetMatch subjectAbsent : Bool) (participant : Option ParticipantSubjectStatus) :
    ParticipantCase.mediaRoomInactive operation grants projectState targetMatch subjectAbsent
        participant ∈ participantMediaRoomInactiveCases := by
  apply mem_flatMap_of (x := operation) (hx := mem_allMediaOperations operation)
  apply mem_flatMap_of (x := grants) (hx := mem_allGrants grants)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  exact List.mem_map.mpr ⟨participant, mem_allParticipantSubjectOptions participant, rfl⟩

theorem mem_participantMediaRoomActiveCases
    (operation : MediaOperation) (grants : Grants) (projectState : ProjectState)
    (targetMatch subjectAbsent : Bool) (session : Option SessionCase)
    (participant : Option ParticipantCaseRecord) :
    ParticipantCase.mediaRoomActive operation grants projectState targetMatch subjectAbsent session
        participant ∈ participantMediaRoomActiveCases := by
  apply mem_flatMap_of (x := operation) (hx := mem_allMediaOperations operation)
  apply mem_flatMap_of (x := grants) (hx := mem_allGrants grants)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  apply mem_flatMap_of (x := session) (hx := mem_allParticipantSessionOptions session)
  exact List.mem_map.mpr ⟨participant, mem_allParticipantRecordOptions participant, rfl⟩

theorem mem_participantInvalidOperationCases :
    ParticipantCase.invalidOperation ∈ participantInvalidOperationCases := by
  simp [participantInvalidOperationCases]

theorem mem_projectUserCases
    (actorRole : RoleValue) (operation : Operation) (projectState : ProjectState)
    (actorProjectMatch targetProjectMatch targetIdPresent : Bool)
    (currentRole nextRole : RoleValue) :
    ({ actorRole := actorRole
       operation := operation
       projectState := projectState
       actorProjectMatch := actorProjectMatch
       targetProjectMatch := targetProjectMatch
       targetIdPresent := targetIdPresent
       currentRole := currentRole
       nextRole := nextRole
     } : ProjectUserCase) ∈ projectUserCases := by
  apply mem_flatMap_of (x := actorRole) (hx := mem_allRoleValues actorRole)
  apply mem_flatMap_of (x := operation) (hx := mem_allOperations operation)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := actorProjectMatch) (hx := mem_boolValues actorProjectMatch)
  apply mem_flatMap_of (x := targetProjectMatch) (hx := mem_boolValues targetProjectMatch)
  apply mem_flatMap_of (x := targetIdPresent) (hx := mem_boolValues targetIdPresent)
  apply mem_flatMap_of (x := currentRole) (hx := mem_allRoleValues currentRole)
  exact List.mem_map.mpr ⟨nextRole, mem_allRoleValues nextRole, rfl⟩

theorem mem_projectUserInvalidOperationCases
    (projectState : ProjectState) (actorProjectMatch targetProjectMatch : Bool) :
    ({ projectState := projectState
       actorProjectMatch := actorProjectMatch
       targetProjectMatch := targetProjectMatch
     } : ProjectUserInvalidOperationCase) ∈ projectUserInvalidOperationCases := by
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := actorProjectMatch) (hx := mem_boolValues actorProjectMatch)
  exact List.mem_map.mpr ⟨targetProjectMatch, mem_boolValues targetProjectMatch, rfl⟩

theorem mem_credentialCases
    (revoked : Bool) (expiry : ExpiryState) (credentialProjectMatch targetProjectMatch : Bool)
    (projectState : ProjectState) (scopes : ScopeCase) (operation : OperationValue)
    (targetIdPresent : Bool) :
    ({ revoked := revoked
       expiry := expiry
       credentialProjectMatch := credentialProjectMatch
       targetProjectMatch := targetProjectMatch
       projectState := projectState
       scopes := scopes
       operation := operation
       targetIdPresent := targetIdPresent
     } : CredentialCase) ∈ credentialCases := by
  apply mem_flatMap_of (x := revoked) (hx := mem_boolValues revoked)
  apply mem_flatMap_of (x := expiry) (hx := mem_allExpiryStates expiry)
  apply mem_flatMap_of (x := credentialProjectMatch) (hx := mem_boolValues credentialProjectMatch)
  apply mem_flatMap_of (x := targetProjectMatch) (hx := mem_boolValues targetProjectMatch)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := scopes) (hx := mem_allScopeCases scopes)
  apply mem_flatMap_of (x := operation) (hx := mem_allOperationValues operation)
  exact List.mem_map.mpr ⟨targetIdPresent, mem_boolValues targetIdPresent, rfl⟩

theorem participant_cases_complete (participantCase : ParticipantCase) :
    participantCase ∈ allParticipantCases := by
  cases participantCase with
  | roomCreate grants projectState targetMatch subjectAbsent roomPresent sessionPresent participant =>
      simp [allParticipantCases, participantGroups,
        mem_participantRoomCreateCases grants projectState targetMatch subjectAbsent roomPresent
          sessionPresent participant]
  | roomJoinAbsent grants projectState targetMatch subjectAbsent sessionPresent participant =>
      simp [allParticipantCases, participantGroups,
        mem_participantRoomJoinAbsentCases grants projectState targetMatch subjectAbsent
          sessionPresent participant]
  | roomJoinPresent grants projectState targetMatch subjectAbsent roomState session participant =>
      simp [allParticipantCases, participantGroups,
        mem_participantRoomJoinPresentCases grants projectState targetMatch subjectAbsent roomState
          session participant]
  | mediaRoomInactive operation grants projectState targetMatch subjectAbsent participant =>
      simp [allParticipantCases, participantGroups,
        mem_participantMediaRoomInactiveCases operation grants projectState targetMatch subjectAbsent
          participant]
  | mediaRoomActive operation grants projectState targetMatch subjectAbsent session participant =>
      simp [allParticipantCases, participantGroups,
        mem_participantMediaRoomActiveCases operation grants projectState targetMatch subjectAbsent
          session participant]
  | invalidOperation =>
      simp [allParticipantCases, participantGroups, mem_participantInvalidOperationCases]

theorem project_user_cases_complete (projectUserCase : ProjectUserCase) :
    projectUserCase ∈ projectUserCases := by
  cases projectUserCase with
  | mk actorRole operation projectState actorProjectMatch targetProjectMatch targetIdPresent
      currentRole nextRole =>
      exact mem_projectUserCases actorRole operation projectState actorProjectMatch
        targetProjectMatch targetIdPresent currentRole nextRole

theorem project_user_invalid_operation_cases_complete
    (projectUserCase : ProjectUserInvalidOperationCase) :
    projectUserCase ∈ projectUserInvalidOperationCases := by
  cases projectUserCase with
  | mk projectState actorProjectMatch targetProjectMatch =>
      exact mem_projectUserInvalidOperationCases projectState actorProjectMatch targetProjectMatch

theorem credential_cases_complete (credentialCase : CredentialCase) :
    credentialCase ∈ credentialCases := by
  cases credentialCase with
  | mk revoked expiry credentialProjectMatch targetProjectMatch projectState scopes operation
      targetIdPresent =>
      exact mem_credentialCases revoked expiry credentialProjectMatch targetProjectMatch
        projectState scopes operation targetIdPresent

theorem role_allows_matches_spec (role : Role) (operation : Operation) :
    roleAllows role operation = specRoleAllows role operation := by
  cases role <;> cases operation <;> rfl

theorem owner_allows_all_operations (operation : Operation) :
    roleAllows .owner operation = true := by
  cases operation <;> rfl

theorem admin_does_not_allow_project_delete :
    roleAllows .admin .projectDelete = false := rfl

theorem operator_does_not_allow_project_update :
    roleAllows .operator .projectUpdate = false := rfl

theorem operator_does_not_allow_project_user_add :
    roleAllows .operator .projectUserAdd = false := rfl

theorem auditor_does_not_allow_project_update :
    roleAllows .auditor .projectUpdate = false := rfl

theorem auditor_does_not_allow_session_disconnect :
    roleAllows .auditor .sessionDisconnect = false := rfl

theorem admin_cannot_add_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserAdd
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdPresent := true
        currentRole := .missing
        nextRole := .valid .owner
      } = deny "owner-management-forbidden" := by
  rfl

theorem admin_cannot_remove_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserRemove
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdPresent := true
        currentRole := .valid .owner
        nextRole := .missing
      } = deny "owner-management-forbidden" := by
  rfl

theorem admin_cannot_change_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserChangeRole
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdPresent := true
        currentRole := .valid .owner
        nextRole := .valid .admin
      } = deny "owner-management-forbidden" := by
  rfl

theorem credential_cannot_manage_project_user :
    decideCredentialCase
      { revoked := false
        expiry := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .projectUserAdd
        targetIdPresent := true
      } = deny "credential-operation-not-allowed" := by
  rfl

theorem participant_subject_mismatch_denied :
    decideParticipantCase
      (.roomJoinPresent
        { roomCreate := true, roomJoin := true, mediaPublish := true, mediaSubscribe := true, dataSend := true }
        .active true false .active
        (some { state := .active, projectMatch := true, roomMatch := true, participantMatch := true })
        (some { state := .active, roomMatch := true, subjectStatus := .mismatch })) =
      deny "subject-mismatch" := by
  rfl

theorem participant_project_suspended_denied :
    decideParticipantCase
      (.mediaRoomActive .publish
        { roomCreate := true, roomJoin := true, mediaPublish := true, mediaSubscribe := true, dataSend := true }
        .suspended true false
        (some { state := .active, projectMatch := true, roomMatch := true, participantMatch := true })
        (some { state := .active, roomMatch := true, subjectStatus := .same })) =
      deny "project-not-active" := by
  rfl

theorem project_user_target_id_missing_denied :
    decideProjectUserCase
      { actorRole := .valid .owner
        operation := .sessionDisconnect
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdPresent := false
        currentRole := .missing
        nextRole := .missing
      } = deny "target-id-required" := by
  rfl

theorem credential_revoked_denied :
    decideCredentialCase
      { revoked := true
        expiry := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdPresent := true
      } = deny "credential-revoked" := by
  rfl

theorem credential_expired_denied :
    decideCredentialCase
      { revoked := false
        expiry := .expired
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdPresent := true
      } = deny "credential-expired" := by
  rfl

theorem credential_expiry_invalid_denied :
    decideCredentialCase
      { revoked := false
        expiry := .invalid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdPresent := true
      } = deny "credential-expiry-invalid" := by
  rfl

theorem credential_scope_missing_denied :
    decideCredentialCase
      { revoked := false
        expiry := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := false, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdPresent := true
      } = deny "credential-scope-missing" := by
  rfl

end AuthorizationVerification
