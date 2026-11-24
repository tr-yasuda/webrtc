import AuthorizationVerification.Types

namespace AuthorizationVerification

structure SessionCase where
  state : SessionState
  projectMatch : Bool
  roomMatch : Bool
  participantMatch : Bool
deriving DecidableEq, Repr

structure ParticipantCaseRecord where
  state : ParticipantState
  roomMatch : Bool
  subjectStatus : ParticipantSubjectStatus
deriving DecidableEq, Repr

inductive ParticipantCase where
  | roomCreate
      (grants : Grants)
      (projectState : ProjectState)
      (targetMatch : Bool)
      (subjectAbsent : Bool)
      (roomPresent : Bool)
      (sessionPresent : Bool)
      (participant : Option ParticipantSubjectStatus)
  | roomJoinAbsent
      (grants : Grants)
      (projectState : ProjectState)
      (targetMatch : Bool)
      (subjectAbsent : Bool)
      (sessionPresent : Bool)
      (participant : Option ParticipantSubjectStatus)
  | roomJoinPresent
      (grants : Grants)
      (projectState : ProjectState)
      (targetMatch : Bool)
      (subjectAbsent : Bool)
      (roomState : RoomState)
      (session : Option SessionCase)
      (participant : Option ParticipantCaseRecord)
  | mediaRoomInactive
      (operation : MediaOperation)
      (grants : Grants)
      (projectState : ProjectState)
      (targetMatch : Bool)
      (subjectAbsent : Bool)
      (participant : Option ParticipantSubjectStatus)
  | mediaRoomActive
      (operation : MediaOperation)
      (grants : Grants)
      (projectState : ProjectState)
      (targetMatch : Bool)
      (subjectAbsent : Bool)
      (session : Option SessionCase)
      (participant : Option ParticipantCaseRecord)
  | invalidOperation
deriving DecidableEq, Repr

def participantSubjectDecision : Option ParticipantSubjectStatus → Option Decision
  | some .empty => some (deny "subject-required")
  | some .mismatch => some (deny "subject-mismatch")
  | _ => none

def sessionMatches (session : SessionCase) (participant : Option ParticipantCaseRecord) : Bool :=
  session.projectMatch && session.roomMatch &&
    match participant with
    | some _ => session.participantMatch
    | none => true

def decideParticipantCase : ParticipantCase → Decision
  | .invalidOperation => deny "unsupported-operation"
  | .roomCreate grants projectState targetMatch subjectAbsent roomPresent sessionPresent participant =>
      if projectState != .active then deny "project-not-active"
      else if !targetMatch then deny "credential-target-mismatch"
      else if subjectAbsent then deny "subject-required"
      else match participantSubjectDecision participant with
        | some decision => decision
        | none =>
            if !grants.roomCreate then deny "grant-not-granted"
            else if roomPresent then deny "room-already-exists"
            else if !grants.roomJoin then deny "room-join-required"
            else if sessionPresent then deny "session-target-mismatch"
            else if participant.isSome then deny "participant-target-mismatch"
            else allow
  | .roomJoinAbsent grants projectState targetMatch subjectAbsent sessionPresent participant =>
      if projectState != .active then deny "project-not-active"
      else if !targetMatch then deny "credential-target-mismatch"
      else if subjectAbsent then deny "subject-required"
      else match participantSubjectDecision participant with
        | some decision => decision
        | none =>
            if !grants.roomJoin then deny "grant-not-granted"
            else if !grants.roomCreate then deny "room-create-required"
            else if sessionPresent then deny "session-target-mismatch"
            else if participant.isSome then deny "participant-target-mismatch"
            else allow
  | .roomJoinPresent grants projectState targetMatch subjectAbsent roomState session participant =>
      if projectState != .active then deny "project-not-active"
      else if !targetMatch then deny "credential-target-mismatch"
      else if subjectAbsent then deny "subject-required"
      else match participantSubjectDecision (participant.map (·.subjectStatus)) with
        | some decision => decision
        | none =>
            if !grants.roomJoin then deny "grant-not-granted"
            else if roomState != .active then deny "room-not-active"
            else if session.isSome && participant.isNone then deny "participant-required"
            else match session with
              | some s =>
                  if s.state != .active then deny "session-not-active"
                  else if !sessionMatches s participant then deny "session-target-mismatch"
                  else match participant with
                    | some p =>
                        if p.state != .active then deny "participant-not-active"
                        else if !p.roomMatch then deny "participant-target-mismatch"
                        else allow
                    | none => allow
              | none =>
                  match participant with
                  | some p =>
                      if p.state != .active then deny "participant-not-active"
                      else if !p.roomMatch then deny "participant-target-mismatch"
                      else allow
                  | none => allow
  | .mediaRoomInactive operation grants projectState targetMatch subjectAbsent participant =>
      if projectState != .active then deny "project-not-active"
      else if !targetMatch then deny "credential-target-mismatch"
      else if subjectAbsent then deny "subject-required"
      else match participantSubjectDecision participant with
        | some decision => decision
        | none =>
            if !grants.forOperation (some operation.toParticipantOperation) then deny "grant-not-granted"
            else deny "room-not-active"
  | .mediaRoomActive operation grants projectState targetMatch subjectAbsent session participant =>
      if projectState != .active then deny "project-not-active"
      else if !targetMatch then deny "credential-target-mismatch"
      else if subjectAbsent then deny "subject-required"
      else match participantSubjectDecision (participant.map (·.subjectStatus)) with
        | some decision => decision
        | none =>
            if !grants.forOperation (some operation.toParticipantOperation) then deny "grant-not-granted"
            else match session with
              | none => deny "session-required"
              | some s =>
                  if s.state != .active then deny "session-not-active"
                  else match participant with
                    | none => deny "participant-required"
                    | some p =>
                        if p.state != .active then deny "participant-not-active"
                        else if !sessionMatches s participant then deny "session-target-mismatch"
                        else if !p.roomMatch then deny "participant-target-mismatch"
                        else allow

structure ProjectUserCase where
  actorRole : RoleValue
  operation : Operation
  projectState : ProjectState
  actorProjectMatch : Bool
  targetProjectMatch : Bool
  targetIdPresent : Bool
  currentRole : RoleValue
  nextRole : RoleValue
deriving DecidableEq, Repr

structure ProjectUserInvalidOperationCase where
  projectState : ProjectState
  actorProjectMatch : Bool
  targetProjectMatch : Bool
deriving DecidableEq, Repr

def roleAllows : Role → Operation → Bool
  | .owner, _ => true
  | .admin, .projectDelete => false
  | .admin, _ => true
  | .operator, .projectRead => true
  | .operator, .roomRead => true
  | .operator, .roomUpdate => true
  | .operator, .roomDelete => true
  | .operator, .sessionRead => true
  | .operator, .sessionDisconnect => true
  | .operator, .participantRead => true
  | .operator, .participantDisconnect => true
  | .operator, .usageRead => true
  | .operator, _ => false
  | .auditor, .projectRead => true
  | .auditor, .roomRead => true
  | .auditor, .sessionRead => true
  | .auditor, .participantRead => true
  | .auditor, .usageRead => true
  | .auditor, .auditRead => true
  | .auditor, _ => false

def specRoleAllows : Role → Operation → Bool
  | .owner, _ => true
  | .admin, .projectDelete => false
  | .admin, _ => true
  | .operator, .projectRead => true
  | .operator, .roomRead => true
  | .operator, .roomUpdate => true
  | .operator, .roomDelete => true
  | .operator, .sessionRead => true
  | .operator, .sessionDisconnect => true
  | .operator, .participantRead => true
  | .operator, .participantDisconnect => true
  | .operator, .usageRead => true
  | .operator, _ => false
  | .auditor, .projectRead => true
  | .auditor, .roomRead => true
  | .auditor, .sessionRead => true
  | .auditor, .participantRead => true
  | .auditor, .usageRead => true
  | .auditor, .auditRead => true
  | .auditor, _ => false

def requiresTargetId : Operation → Bool
  | .projectUserAdd => true
  | .projectUserRemove => true
  | .projectUserChangeRole => true
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def credentialRequiresTargetId : Operation → Bool
  | .roomUpdate => true
  | .roomDelete => true
  | .sessionDisconnect => true
  | .participantDisconnect => true
  | _ => false

def roleValueIsOwner : RoleValue → Bool
  | .valid .owner => true
  | _ => false

def adminOwnerManagementForbidden (operation : Operation) (currentRole nextRole : RoleValue) : Bool :=
  match operation with
  | .projectUserAdd => roleValueIsOwner nextRole
  | .projectUserRemove => roleValueIsOwner currentRole
  | .projectUserChangeRole => roleValueIsOwner currentRole || roleValueIsOwner nextRole
  | _ => false

def decideProjectUserCase (c : ProjectUserCase) : Decision :=
  if c.projectState != .active then deny "project-not-active"
  else if !c.actorProjectMatch then deny "actor-project-mismatch"
  else if !c.targetProjectMatch then deny "target-project-mismatch"
  else match c.actorRole with
    | .missing => deny "project-user-role-missing"
    | .invalid => deny "project-user-role-invalid"
    | .valid role =>
        if c.currentRole == .invalid || c.nextRole == .invalid then
          deny "project-user-role-invalid"
        else if requiresTargetId c.operation && !c.targetIdPresent then
          deny "target-id-required"
        else if !roleAllows role c.operation then
          deny "insufficient-role"
        else if (c.operation == .projectUserAdd || c.operation == .projectUserChangeRole) &&
            c.nextRole == .missing then
          deny "project-user-next-role-required"
        else if (c.operation == .projectUserRemove || c.operation == .projectUserChangeRole) &&
            c.currentRole == .missing then
          deny "project-user-current-role-required"
        else if role == .admin &&
            adminOwnerManagementForbidden c.operation c.currentRole c.nextRole then
          deny "owner-management-forbidden"
        else allow

def decideProjectUserInvalidOperationCase (c : ProjectUserInvalidOperationCase) : Decision :=
  if c.projectState != .active then deny "project-not-active"
  else if !c.actorProjectMatch then deny "actor-project-mismatch"
  else if !c.targetProjectMatch then deny "target-project-mismatch"
  else deny "unsupported-operation"

inductive ScopeCase where
  | invalid
  | valid (set : ScopeSet)
deriving DecidableEq, Repr

structure CredentialCase where
  revoked : Bool
  expiry : ExpiryState
  credentialProjectMatch : Bool
  targetProjectMatch : Bool
  projectState : ProjectState
  scopes : ScopeCase
  operation : OperationValue
  targetIdPresent : Bool
deriving DecidableEq, Repr

def requiredScopes : Operation → Option (List Scope)
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

def scopeSetAllows (set : ScopeSet) (required : List Scope) : Bool :=
  required.any set.contains

def decideCredentialCase (c : CredentialCase) : Decision :=
  if c.revoked then deny "credential-revoked"
  else if c.expiry == .invalid then deny "credential-expiry-invalid"
  else if c.expiry == .expired then deny "credential-expired"
  else if !c.credentialProjectMatch || !c.targetProjectMatch then
    deny "credential-target-mismatch"
  else if c.projectState != .active then deny "project-not-active"
  else match c.scopes with
    | .invalid => deny "credential-input-invalid"
    | .valid set =>
        match c.operation with
        | .invalid => deny "unsupported-operation"
        | .valid operation =>
            if credentialRequiresTargetId operation && !c.targetIdPresent then
              deny "target-id-required"
            else match requiredScopes operation with
              | none => deny "credential-operation-not-allowed"
              | some required =>
                  if scopeSetAllows set required then allow
                  else deny "credential-scope-missing"

end AuthorizationVerification
