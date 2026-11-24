import Authorization.Participant
import Authorization.ProjectUser
import Authorization.ManagementCredential

namespace Authorization

def participantSoundCheck : Bool :=
  allParticipantCases.all fun input =>
    !(decideParticipant input).allowed || participantPrerequisites input

def participantCompleteCheck : Bool :=
  allParticipantCases.all fun input =>
    !participantPrerequisites input || (decideParticipant input).allowed

def participantAuditTargetCheck : Bool :=
  allParticipantCases.all fun input =>
    (decideParticipant input).targetKeys = participantTargetKeys input

def participantFirstFailureCheck : Bool :=
  allParticipantCases.all fun input =>
    (decideParticipant input).reason =
      (firstParticipantViolation input).getD "allowed"

def participantVariants (input : ParticipantInput) : List ParticipantInput :=
  match input.operation with
  | .roomCreate | .roomJoin =>
      if input.roomState == .absent || input.roomState != .active then
        [
          { input with sessionState := .revoked },
          { input with sessionTargetMatch := !input.sessionTargetMatch },
          { input with participantState := .revoked },
          { input with participantTargetMatch := !input.participantTargetMatch }
        ]
      else
        []
  | _ => []

def participantNonInterferenceCheck : Bool :=
  allParticipantCases.all fun input =>
    (participantVariants input).all fun variant =>
      decideParticipant variant = decideParticipant input

def projectUserSoundCheck : Bool :=
  allProjectUserCases.all fun input =>
    !(decideProjectUser input).allowed || projectUserPrerequisites input

def projectUserCompleteCheck : Bool :=
  allProjectUserCases.all fun input =>
    !projectUserPrerequisites input || (decideProjectUser input).allowed

def projectUserAuditTargetCheck : Bool :=
  allProjectUserCases.all fun input =>
    (decideProjectUser input).targetKeys = projectUserTargetKeys input

def projectUserFirstFailureCheck : Bool :=
  allProjectUserCases.all fun input =>
    (decideProjectUser input).reason =
      (firstProjectUserViolation input).getD "allowed"

def projectUserVariants (input : ProjectUserInput) : List ProjectUserInput :=
  if input.operation == .projectUserAdd ||
      input.operation == .projectUserRemove ||
      input.operation == .projectUserChangeRole then
    []
  else
    [
      { input with currentRole := none, nextRole := none },
      { input with currentRole := some .owner, nextRole := some .auditor },
      { input with currentRole := some .auditor, nextRole := some .owner }
    ]

def projectUserNonInterferenceCheck : Bool :=
  allProjectUserCases.all fun input =>
    (projectUserVariants input).all fun variant =>
      decideProjectUser variant = decideProjectUser input

def projectUserOwnerBoundaryCheck : Bool :=
  allProjectUserCases.all fun input =>
    !(input.role == .admin && adminManagesOwner input) ||
      !(decideProjectUser input).allowed

def roleInclusionCheck : Bool :=
  managementOperations.all fun operation =>
    (!roleAllows .admin operation || roleAllows .owner operation) &&
    (!roleAllows .operator operation || roleAllows .owner operation) &&
    (!roleAllows .auditor operation || roleAllows .owner operation) &&
    (!roleAllows .operator operation || roleAllows .admin operation) &&
    (!roleAllows .auditor operation || roleAllows .admin operation)

def roleNonInclusionCheck : Bool :=
  managementOperations.any (fun operation =>
    roleAllows .operator operation && !roleAllows .auditor operation) &&
  managementOperations.any (fun operation =>
    roleAllows .auditor operation && !roleAllows .operator operation)

def managementCredentialSoundCheck : Bool :=
  allManagementCredentialCases.all fun input =>
    !(decideManagementCredential input).allowed ||
      managementCredentialPrerequisites input

def managementCredentialCompleteCheck : Bool :=
  allManagementCredentialCases.all fun input =>
    !managementCredentialPrerequisites input ||
      (decideManagementCredential input).allowed

def managementCredentialAuditTargetCheck : Bool :=
  allManagementCredentialCases.all fun input =>
    (decideManagementCredential input).targetKeys =
      managementCredentialTargetKeys input

def managementCredentialFirstFailureCheck : Bool :=
  allManagementCredentialCases.all fun input =>
    (decideManagementCredential input).reason =
      (firstManagementCredentialViolation input).getD "allowed"

def managementCredentialVariants
    (input : ManagementCredentialInput) : List ManagementCredentialInput :=
  if (requiredScopes input.operation).isEmpty then
    [
      { input with scopes := { roomManage := true, sessionManage := true, usageRead := true, auditRead := true } },
      { input with scopes := { roomManage := false, sessionManage := false, usageRead := false, auditRead := false } },
      { input with scopes := { roomManage := true, sessionManage := false, usageRead := true, auditRead := false } }
    ]
  else
    []

def managementCredentialNonInterferenceCheck : Bool :=
  allManagementCredentialCases.all fun input =>
    (managementCredentialVariants input).all fun variant =>
      decideManagementCredential variant = decideManagementCredential input

def scopePartitionCheck : Bool :=
  managementOperations.all fun operation =>
    (requiredScopes operation).length <= 1

inductive RawGrantShape
  | valid
  | unknown
  | nonBoolean
  | notObject
  deriving DecidableEq, Repr, BEq

def rawGrantAccepted : RawGrantShape -> Bool
  | .valid => true
  | _ => false

theorem participant_decide_total (input : ParticipantInput) :
    ∃ decision, decideParticipant input = decision :=
  ⟨_, rfl⟩

theorem participant_decide_deterministic (input : ParticipantInput) :
    decideParticipant input = decideParticipant input :=
  rfl

theorem participant_first_failure (input : ParticipantInput) :
    decideParticipant input =
      match firstParticipantViolation input with
      | some reason =>
          { allowed := false, reason, targetKeys := participantTargetKeys input }
      | none =>
          { allowed := true, reason := "allowed", targetKeys := participantTargetKeys input } :=
  rfl

theorem participant_allow_sound : participantSoundCheck = true := by native_decide
theorem participant_allow_complete : participantCompleteCheck = true := by native_decide
theorem participant_audit_target_exact : participantAuditTargetCheck = true := by native_decide
theorem participant_first_failure_all : participantFirstFailureCheck = true := by native_decide
theorem participant_non_interference : participantNonInterferenceCheck = true := by native_decide

theorem project_user_decide_total (input : ProjectUserInput) :
    ∃ decision, decideProjectUser input = decision :=
  ⟨_, rfl⟩

theorem project_user_decide_deterministic (input : ProjectUserInput) :
    decideProjectUser input = decideProjectUser input :=
  rfl

theorem project_user_first_failure (input : ProjectUserInput) :
    decideProjectUser input =
      match firstProjectUserViolation input with
      | some reason =>
          { allowed := false, reason, targetKeys := projectUserTargetKeys input }
      | none =>
          { allowed := true, reason := "allowed", targetKeys := projectUserTargetKeys input } :=
  rfl

theorem project_user_allow_sound : projectUserSoundCheck = true := by native_decide
theorem project_user_allow_complete : projectUserCompleteCheck = true := by native_decide
theorem project_user_audit_target_exact : projectUserAuditTargetCheck = true := by native_decide
theorem project_user_first_failure_all : projectUserFirstFailureCheck = true := by native_decide
theorem project_user_non_interference : projectUserNonInterferenceCheck = true := by native_decide
theorem owner_admin_boundary : projectUserOwnerBoundaryCheck = true := by native_decide
theorem role_inclusion_conditional : roleInclusionCheck = true := by native_decide
theorem role_non_inclusion : roleNonInclusionCheck = true := by native_decide

theorem management_credential_decide_total (input : ManagementCredentialInput) :
    ∃ decision, decideManagementCredential input = decision :=
  ⟨_, rfl⟩

theorem management_credential_decide_deterministic
    (input : ManagementCredentialInput) :
    decideManagementCredential input = decideManagementCredential input :=
  rfl

theorem management_credential_first_failure
    (input : ManagementCredentialInput) :
    decideManagementCredential input =
      match firstManagementCredentialViolation input with
      | some reason =>
          { allowed := false, reason, targetKeys := managementCredentialTargetKeys input }
      | none =>
          { allowed := true, reason := "allowed", targetKeys := managementCredentialTargetKeys input } :=
  rfl

theorem management_credential_allow_sound :
    managementCredentialSoundCheck = true := by native_decide
theorem management_credential_allow_complete :
    managementCredentialCompleteCheck = true := by native_decide
theorem management_credential_audit_target_exact :
    managementCredentialAuditTargetCheck = true := by native_decide
theorem management_credential_first_failure_all :
    managementCredentialFirstFailureCheck = true := by native_decide
theorem management_credential_non_interference :
    managementCredentialNonInterferenceCheck = true := by native_decide
theorem scope_partition : scopePartitionCheck = true := by native_decide
theorem validation_rejects_unknown_grant : rawGrantAccepted .unknown = false := by native_decide
theorem validation_rejects_non_boolean_grant : rawGrantAccepted .nonBoolean = false := by native_decide

end Authorization
