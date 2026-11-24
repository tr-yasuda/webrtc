import AuthorizationVerification.Cases

set_option linter.unusedSimpArgs false

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

theorem mem_allParticipantOperations (operation : ParticipantOperation) :
    operation ∈ allParticipantOperations := by
  cases operation <;> simp [allParticipantOperations]

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

theorem mem_allTargetIdStates (state : TargetIdState) : state ∈ allTargetIdStates := by
  cases state <;> simp [allTargetIdStates]

theorem mem_allInvalidGrantKinds (kind : InvalidGrantKind) :
    kind ∈ allInvalidGrantKinds := by
  cases kind <;> simp [allInvalidGrantKinds]

theorem mem_allCredentialTimeCases (time : CredentialTimeCase) :
    time ∈ allCredentialTimeCases := by
  cases time <;> simp [allCredentialTimeCases]

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

theorem mem_participantInvalidGrantCases
    (operation : ParticipantOperation) (projectState : ProjectState)
    (targetMatch subjectAbsent : Bool) (participant : Option ParticipantSubjectStatus)
    (kind : InvalidGrantKind) :
    ParticipantCase.invalidGrant operation projectState targetMatch subjectAbsent participant kind ∈
        participantInvalidGrantCases := by
  apply mem_flatMap_of (x := operation) (hx := mem_allParticipantOperations operation)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := targetMatch) (hx := mem_boolValues targetMatch)
  apply mem_flatMap_of (x := subjectAbsent) (hx := mem_boolValues subjectAbsent)
  apply mem_flatMap_of (x := participant) (hx := mem_allParticipantSubjectOptions participant)
  exact List.mem_map.mpr ⟨kind, mem_allInvalidGrantKinds kind, rfl⟩

theorem mem_projectUserCases
    (actorRole : RoleValue) (operation : Operation) (projectState : ProjectState)
    (actorProjectMatch targetProjectMatch : Bool) (targetIdState : TargetIdState)
    (currentRole nextRole : RoleValue) :
    ({ actorRole := actorRole
       operation := operation
       projectState := projectState
       actorProjectMatch := actorProjectMatch
       targetProjectMatch := targetProjectMatch
       targetIdState := targetIdState
       currentRole := currentRole
       nextRole := nextRole
     } : ProjectUserCase) ∈ projectUserCases := by
  apply mem_flatMap_of (x := actorRole) (hx := mem_allRoleValues actorRole)
  apply mem_flatMap_of (x := operation) (hx := mem_allOperations operation)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := actorProjectMatch) (hx := mem_boolValues actorProjectMatch)
  apply mem_flatMap_of (x := targetProjectMatch) (hx := mem_boolValues targetProjectMatch)
  apply mem_flatMap_of (x := targetIdState) (hx := mem_allTargetIdStates targetIdState)
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
    (revoked : Bool) (time : CredentialTimeCase)
    (credentialProjectMatch targetProjectMatch : Bool)
    (projectState : ProjectState) (scopes : ScopeCase) (operation : OperationValue)
    (targetIdState : TargetIdState) :
    ({ revoked := revoked
       time := time
       credentialProjectMatch := credentialProjectMatch
       targetProjectMatch := targetProjectMatch
       projectState := projectState
       scopes := scopes
       operation := operation
       targetIdState := targetIdState
     } : CredentialCase) ∈ credentialCases := by
  apply mem_flatMap_of (x := revoked) (hx := mem_boolValues revoked)
  apply mem_flatMap_of (x := time) (hx := mem_allCredentialTimeCases time)
  apply mem_flatMap_of (x := credentialProjectMatch) (hx := mem_boolValues credentialProjectMatch)
  apply mem_flatMap_of (x := targetProjectMatch) (hx := mem_boolValues targetProjectMatch)
  apply mem_flatMap_of (x := projectState) (hx := mem_allProjectStates projectState)
  apply mem_flatMap_of (x := scopes) (hx := mem_allScopeCases scopes)
  apply mem_flatMap_of (x := operation) (hx := mem_allOperationValues operation)
  exact List.mem_map.mpr ⟨targetIdState, mem_allTargetIdStates targetIdState, rfl⟩

@[auth_spec "AUTH-VER-01"]
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
  | invalidGrant operation projectState targetMatch subjectAbsent participant kind =>
      simp [allParticipantCases, participantGroups,
        mem_participantInvalidGrantCases operation projectState targetMatch subjectAbsent participant
          kind]
  | invalidOperation =>
      simp [allParticipantCases, participantGroups, mem_participantInvalidOperationCases]

@[auth_spec "AUTH-VER-01"]
theorem project_user_cases_complete (projectUserCase : ProjectUserCase) :
    projectUserCase ∈ projectUserCases := by
  cases projectUserCase with
  | mk actorRole operation projectState actorProjectMatch targetProjectMatch targetIdState
      currentRole nextRole =>
      exact mem_projectUserCases actorRole operation projectState actorProjectMatch
        targetProjectMatch targetIdState currentRole nextRole

@[auth_spec "AUTH-VER-01"]
theorem project_user_invalid_operation_cases_complete
    (projectUserCase : ProjectUserInvalidOperationCase) :
    projectUserCase ∈ projectUserInvalidOperationCases := by
  cases projectUserCase with
  | mk projectState actorProjectMatch targetProjectMatch =>
      exact mem_projectUserInvalidOperationCases projectState actorProjectMatch targetProjectMatch

@[auth_spec "AUTH-VER-01"]
theorem credential_cases_complete (credentialCase : CredentialCase) :
    credentialCase ∈ credentialCases := by
  cases credentialCase with
  | mk revoked time credentialProjectMatch targetProjectMatch projectState scopes operation
      targetIdState =>
      exact mem_credentialCases revoked time credentialProjectMatch targetProjectMatch
        projectState scopes operation targetIdState

@[auth_spec "AUTH-PU-01"]
theorem owner_allows_all_operations (operation : Operation) :
    roleAllows .owner operation = true := by
  cases operation <;> rfl

@[auth_spec "AUTH-PU-02"]
theorem admin_does_not_allow_project_delete :
    roleAllows .admin .projectDelete = false := rfl

@[auth_spec "AUTH-PU-02"]
theorem operator_does_not_allow_project_update :
    roleAllows .operator .projectUpdate = false := rfl

@[auth_spec "AUTH-PU-02"]
theorem operator_does_not_allow_project_user_add :
    roleAllows .operator .projectUserAdd = false := rfl

@[auth_spec "AUTH-PU-02"]
theorem auditor_does_not_allow_project_update :
    roleAllows .auditor .projectUpdate = false := rfl

@[auth_spec "AUTH-PU-02"]
theorem auditor_does_not_allow_session_disconnect :
    roleAllows .auditor .sessionDisconnect = false := rfl

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_add_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserAdd
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := .missing
        nextRole := .valid .owner
      } = deny "owner-management-forbidden" := by
  rfl

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_remove_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserRemove
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := .valid .owner
        nextRole := .missing
      } = deny "owner-management-forbidden" := by
  rfl

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_change_owner :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserChangeRole
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := .valid .owner
        nextRole := .valid .admin
      } = deny "owner-management-forbidden" := by
  rfl

@[auth_spec "AUTH-MC-02"]
theorem credential_cannot_manage_project_user :
    decideCredentialCase
      { revoked := false
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .projectUserAdd
        targetIdState := .valid
      } = deny "credential-operation-not-allowed" := by
  rfl

@[auth_spec "AUTH-PART-01"]
theorem participant_subject_mismatch_denied :
    decideParticipantCase
      (.roomJoinPresent
        { roomCreate := true, roomJoin := true, mediaPublish := true, mediaSubscribe := true, dataSend := true }
        .active true false .active
        (some { state := .active, projectMatch := true, roomMatch := true, participantMatch := true })
        (some { state := .active, roomMatch := true, subjectStatus := .mismatch })) =
      deny "subject-mismatch" := by
  rfl

@[auth_spec "AUTH-PART-04"]
theorem participant_project_suspended_denied :
    decideParticipantCase
      (.mediaRoomActive .publish
        { roomCreate := true, roomJoin := true, mediaPublish := true, mediaSubscribe := true, dataSend := true }
        .suspended true false
        (some { state := .active, projectMatch := true, roomMatch := true, participantMatch := true })
        (some { state := .active, roomMatch := true, subjectStatus := .same })) =
      deny "project-not-active" := by
  rfl

@[auth_spec "AUTH-PART-02"]
theorem participant_room_create_without_join_denied :
    decideParticipantCase
      (.roomCreate
        { roomCreate := true, roomJoin := false, mediaPublish := false, mediaSubscribe := false, dataSend := false }
        .active true false false false none) =
      deny "room-join-required" := by
  rfl

@[auth_spec "AUTH-PART-03"]
theorem participant_inactive_session_denied :
    decideParticipantCase
      (.roomJoinPresent
        { roomCreate := true, roomJoin := true, mediaPublish := true, mediaSubscribe := true, dataSend := true }
        .active true false .active
        (some { state := .revoked, projectMatch := true, roomMatch := true, participantMatch := true })
        (some { state := .active, roomMatch := true, subjectStatus := .same })) =
      deny "session-not-active" := by
  rfl

@[auth_spec "AUTH-PU-04"]
theorem project_user_target_id_missing_denied :
    decideProjectUserCase
      { actorRole := .valid .owner
        operation := .sessionDisconnect
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .missing
        currentRole := .missing
        nextRole := .missing
      } = deny "target-id-required" := by
  rfl

@[auth_spec "AUTH-MC-03"]
theorem credential_revoked_denied :
    decideCredentialCase
      { revoked := true
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdState := .valid
      } = deny "credential-revoked" := by
  rfl

@[auth_spec "AUTH-MC-03"]
theorem credential_expired_denied :
    decideCredentialCase
      { revoked := false
        time := .expired
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdState := .valid
      } = deny "credential-expired" := by
  rfl

@[auth_spec "AUTH-MC-03"]
theorem credential_expiry_invalid_denied :
    decideCredentialCase
      { revoked := false
        time := .fractionalExpiresAt
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdState := .valid
      } = deny "credential-expiry-invalid" := by
  rfl

@[auth_spec "AUTH-MC-04"]
theorem credential_scope_missing_denied :
    decideCredentialCase
      { revoked := false
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid { roomManage := false, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdState := .valid
      } = deny "credential-scope-missing" := by
  rfl

@[auth_spec "AUTH-MC-01"]
theorem credential_scope_allows_room_read :
    decideCredentialCase
      { revoked := false
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid
          { roomManage := true, sessionManage := false, usageRead := false, auditRead := false }
        operation := .valid .roomRead
        targetIdState := .valid
      } = allow := by
  rfl

@[auth_spec "AUTH-PU-02"]
theorem operator_denied_operations (operation : Operation)
    (h : operation ∈
      [ .projectUpdate
      , .projectDelete
      , .projectUserAdd
      , .projectUserRemove
      , .projectUserChangeRole
      , .applicationManage
      , .applicationSigningKeyManage
      , .managementApiCredentialManage
      , .auditRead
      ]) : roleAllows .operator operation = false := by
  cases operation <;> simp_all [roleAllows]

@[auth_spec "AUTH-PU-02"]
theorem auditor_denied_operations (operation : Operation)
    (h : operation ∈
      [ .projectUpdate
      , .projectDelete
      , .projectUserAdd
      , .projectUserRemove
      , .projectUserChangeRole
      , .applicationManage
      , .applicationSigningKeyManage
      , .managementApiCredentialManage
      , .roomUpdate
      , .roomDelete
      , .sessionDisconnect
      , .participantDisconnect
      ]) : roleAllows .auditor operation = false := by
  cases operation <;> simp_all [roleAllows]

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_add_owner_for_any_current_role (currentRole : RoleValue)
    (hCurrent : currentRole ≠ .invalid) :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserAdd
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := currentRole
        nextRole := .valid .owner
      } = deny "owner-management-forbidden" := by
  cases currentRole <;>
    simp_all [decideProjectUserCase, adminOwnerManagementForbidden,
      adminOwnerManagementFields, roleValueIsOwner, roleAllows]

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_remove_owner_for_any_next_role (nextRole : RoleValue)
    (hNext : nextRole ≠ .invalid) :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserRemove
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := .valid .owner
        nextRole := nextRole
      } = deny "owner-management-forbidden" := by
  cases nextRole <;>
    simp_all [decideProjectUserCase, adminOwnerManagementForbidden,
      adminOwnerManagementFields, roleValueIsOwner, roleAllows]

@[auth_spec "AUTH-PU-03"]
theorem admin_cannot_change_owner_for_any_roles
    (currentRole nextRole : RoleValue)
    (hOwner : currentRole = .valid .owner ∨ nextRole = .valid .owner)
    (hCurrentInvalid : currentRole ≠ .invalid)
    (hNextInvalid : nextRole ≠ .invalid)
    (hCurrentMissing : currentRole ≠ .missing)
    (hNextMissing : nextRole ≠ .missing) :
    decideProjectUserCase
      { actorRole := .valid .admin
        operation := .projectUserChangeRole
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .valid
        currentRole := currentRole
        nextRole := nextRole
      } = deny "owner-management-forbidden" := by
  rcases hOwner with rfl | rfl
  · cases nextRole <;>
      simp_all [decideProjectUserCase, adminOwnerManagementForbidden,
        adminOwnerManagementFields, roleValueIsOwner, roleAllows]
  · cases currentRole <;>
      simp_all [decideProjectUserCase, adminOwnerManagementForbidden,
        adminOwnerManagementFields, roleValueIsOwner, roleAllows]

@[auth_spec "AUTH-MC-02"]
theorem credential_all_project_user_operations_denied (operation : Operation)
    (h : operation ∈ credentialProjectUserOperations) :
    decideCredentialCase
      { revoked := false
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid
          { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid operation
        targetIdState := .valid
      } = deny "credential-operation-not-allowed" := by
  simp [credentialProjectUserOperations] at h
  rcases h with rfl | rfl | rfl | rfl <;> rfl

@[auth_spec "AUTH-MC-06"]
theorem credential_invalid_time_denied (time : CredentialTimeCase)
    (h : credentialTimeStateOfCase time = .invalid) :
    decideCredentialCase
      { revoked := false
        time := time
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid
          { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid .roomRead
        targetIdState := .valid
      } = deny "credential-expiry-invalid" := by
  cases time <;> simp_all [decideCredentialCase, credentialTimeStateOfCase]

@[auth_spec "AUTH-MC-05"]
theorem credential_target_id_empty_denied (operation : Operation)
    (h : credentialRequiresTargetId operation = true) :
    decideCredentialCase
      { revoked := false
        time := .valid
        credentialProjectMatch := true
        targetProjectMatch := true
        projectState := .active
        scopes := .valid
          { roomManage := true, sessionManage := true, usageRead := true, auditRead := true }
        operation := .valid operation
        targetIdState := .empty
      } = deny "target-id-required" := by
  cases operation <;>
    simp_all [decideCredentialCase, credentialRequiresTargetId, credentialTimeStateOfCase]

@[auth_spec "AUTH-PU-05"]
theorem project_user_target_id_empty_denied (operation : Operation)
    (h : requiresTargetId operation = true) :
    decideProjectUserCase
      { actorRole := .valid .owner
        operation := operation
        projectState := .active
        actorProjectMatch := true
        targetProjectMatch := true
        targetIdState := .empty
        currentRole := .missing
        nextRole := .missing
      } = deny "target-id-required" := by
  cases operation <;> simp_all [decideProjectUserCase, requiresTargetId]

@[auth_spec "AUTH-PART-05"]
theorem participant_invalid_grant_all_kinds (kind : InvalidGrantKind) :
    decideParticipantCase
      (.invalidGrant .roomCreate .active true false none kind) =
      deny "grant-input-invalid" := by
  cases kind <;> rfl

end AuthorizationVerification
