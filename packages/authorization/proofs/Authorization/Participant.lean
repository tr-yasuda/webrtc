import Authorization.Types

namespace Authorization

def granted (input : ParticipantInput) : Bool :=
  grantEnabled input.grants (participantGrantFor input.operation)

def isMediaData : ParticipantOperation -> Bool
  | .mediaPublish => true
  | .mediaSubscribe => true
  | .dataSend => true
  | _ => false

structure ParticipantRule where
  id : String
  reason : String
  fails : ParticipantInput -> Bool

def participantRules : List ParticipantRule := [
  { id := "P-PROJ-001", reason := "project-not-active",
    fails := fun input => input.projectState != .active },
  { id := "P-TGT-001", reason := "credential-target-mismatch",
    fails := fun input => !input.targetMatch },
  { id := "P-SUB-001", reason := "subject-required",
    fails := fun input => participantSubjectRequired && input.subjectClass == .empty },
  { id := "P-SUB-002", reason := "subject-required",
    fails := fun input =>
      participantSubjectRequired && input.participantPresent &&
        input.participantSubjectClass == .empty },
  { id := "P-SUB-003", reason := "subject-mismatch",
    fails := fun input =>
      participantSubjectMustMatch && input.participantPresent &&
        input.participantSubjectClass == .mismatch },
  { id := "P-GRANT-001", reason := "grant-not-granted",
    fails := fun input => !granted input },
  { id := "P-RC-001", reason := "room-already-exists",
    fails := fun input =>
      input.operation == .roomCreate && input.roomState != .absent },
  { id := "P-RC-002", reason := "room-join-required",
    fails := fun input =>
      input.operation == .roomCreate &&
        !allGrantsEnabled input.grants (participantRequiredGrants input.operation) },
  { id := "P-RC-003", reason := "session-target-mismatch",
    fails := fun input =>
      input.operation == .roomCreate && input.sessionPresent },
  { id := "P-RC-004", reason := "participant-target-mismatch",
    fails := fun input =>
      input.operation == .roomCreate && input.participantPresent },
  { id := "P-RJ-001", reason := "room-create-required",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        !allGrantsEnabled input.grants
          (participantRequiredGrantsWhenRoomAbsent input.operation) },
  { id := "P-RJ-002", reason := "session-target-mismatch",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        input.sessionPresent },
  { id := "P-RJ-003", reason := "participant-target-mismatch",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .absent &&
        input.participantPresent },
  { id := "P-RJ-004", reason := "room-not-active",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState != .absent &&
        input.roomState != .active },
  { id := "P-RJ-005", reason := "participant-required",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.sessionPresent && !input.participantPresent },
  { id := "P-RJ-006", reason := "session-not-active",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.sessionPresent && input.sessionState != .active },
  { id := "P-RJ-007", reason := "session-target-mismatch",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.sessionPresent && !input.sessionTargetMatch },
  { id := "P-RJ-008", reason := "participant-not-active",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.participantPresent && input.participantState != .active },
  { id := "P-RJ-009", reason := "participant-target-mismatch",
    fails := fun input =>
      input.operation == .roomJoin && input.roomState == .active &&
        input.participantPresent && !input.participantTargetMatch },
  { id := "P-MD-001", reason := "room-not-active",
    fails := fun input =>
      isMediaData input.operation &&
        participantRequiresExistingRoom input.operation &&
        input.roomState != .active },
  { id := "P-MD-002", reason := "session-required",
    fails := fun input => isMediaData input.operation && !input.sessionPresent },
  { id := "P-MD-003", reason := "session-not-active",
    fails := fun input =>
      isMediaData input.operation && input.sessionPresent &&
        input.sessionState != .active },
  { id := "P-MD-004", reason := "participant-required",
    fails := fun input =>
      isMediaData input.operation && input.sessionPresent &&
        !input.participantPresent },
  { id := "P-MD-005", reason := "participant-not-active",
    fails := fun input =>
      isMediaData input.operation && input.sessionPresent &&
        input.participantPresent && input.participantState != .active },
  { id := "P-MD-006", reason := "session-target-mismatch",
    fails := fun input =>
      isMediaData input.operation && input.sessionPresent &&
        input.participantPresent && !input.sessionTargetMatch },
  { id := "P-MD-007", reason := "participant-target-mismatch",
    fails := fun input =>
      isMediaData input.operation && input.sessionPresent &&
        input.participantPresent && !input.participantTargetMatch }
]

def firstParticipantViolationFrom
    (rules : List ParticipantRule) (input : ParticipantInput) : Option String :=
  match rules with
  | [] => none
  | rule :: rest =>
      if rule.fails input then some rule.reason else firstParticipantViolationFrom rest input

def firstParticipantViolation (input : ParticipantInput) : Option String :=
  firstParticipantViolationFrom participantRules input

def participantTargetKeys (input : ParticipantInput) : List String :=
  ["projectId", "roomName"] ++
    (if input.roomState == .absent then [] else ["roomId"]) ++
    (if input.sessionPresent then ["sessionId"] else []) ++
    (if input.participantPresent then ["participantId"] else [])

def decideParticipant (input : ParticipantInput) : Decision :=
  match firstParticipantViolation input with
  | some reason => { allowed := false, reason := reason, targetKeys := participantTargetKeys input }
  | none => { allowed := true, reason := "allowed", targetKeys := participantTargetKeys input }

def participantPrerequisites (input : ParticipantInput) : Bool :=
  input.projectState == .active &&
    input.targetMatch &&
    input.subjectClass != .empty &&
    (if input.participantPresent then
      input.participantSubjectClass != .empty &&
        input.participantSubjectClass != .mismatch
    else true) &&
    granted input &&
    (match input.operation with
     | .roomCreate =>
       input.roomState == .absent &&
         allGrantsEnabled input.grants (participantRequiredGrants input.operation) &&
         !input.sessionPresent && !input.participantPresent
     | .roomJoin =>
       (if input.roomState == .absent then
         allGrantsEnabled input.grants
           (participantRequiredGrantsWhenRoomAbsent input.operation) &&
           !input.sessionPresent && !input.participantPresent
       else if input.roomState == .active then
         (if input.sessionPresent then
           input.sessionState == .active && input.sessionTargetMatch &&
             input.participantPresent
         else true) &&
         (if input.participantPresent then
           input.participantState == .active && input.participantTargetMatch
         else true)
       else false)
     | .mediaPublish => participantRequiresExistingRoom input.operation &&
         input.roomState == .active && input.sessionPresent &&
         input.sessionState == .active && input.participantPresent &&
         input.participantState == .active && input.sessionTargetMatch &&
         input.participantTargetMatch
     | .mediaSubscribe => participantRequiresExistingRoom input.operation &&
         input.roomState == .active && input.sessionPresent &&
         input.sessionState == .active && input.participantPresent &&
         input.participantState == .active && input.sessionTargetMatch &&
         input.participantTargetMatch
     | .dataSend => participantRequiresExistingRoom input.operation &&
         input.roomState == .active && input.sessionPresent &&
         input.sessionState == .active && input.participantPresent &&
         input.participantState == .active && input.sessionTargetMatch &&
         input.participantTargetMatch)

def sessionChoices : List (Bool × SessionState × Bool) :=
  [(false, .active, true)] ++
    sessionStates.flatMap fun state =>
      [true, false].map fun targetMatch => (true, state, targetMatch)

def participantChoices : List (Bool × ParticipantState × Bool × SubjectClass) :=
  [(false, .active, true, .match)] ++
    participantStates.flatMap fun state =>
    [true, false].flatMap fun targetMatch =>
    subjectClasses.map fun subjectClass =>
      (true, state, targetMatch, subjectClass)

def roomCreateCases : List ParticipantInput :=
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  roomStates.flatMap fun roomState =>
  [true, false].flatMap fun sessionPresent =>
  [true, false].flatMap fun participantPresent =>
  allGrants.map fun grants =>
    {
      operation := .roomCreate,
      projectState,
      targetMatch,
      subjectClass,
      roomState,
      sessionPresent,
      sessionState := .active,
      sessionTargetMatch := true,
      participantPresent,
      participantState := .active,
      participantTargetMatch := true,
      participantSubjectClass := .match,
      grants
    }

def roomJoinAbsentCases : List ParticipantInput :=
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  [true, false].flatMap fun sessionPresent =>
  [true, false].flatMap fun participantPresent =>
  allGrants.map fun grants =>
    {
      operation := .roomJoin,
      projectState,
      targetMatch,
      subjectClass,
      roomState := .absent,
      sessionPresent,
      sessionState := .active,
      sessionTargetMatch := true,
      participantPresent,
      participantState := .active,
      participantTargetMatch := true,
      participantSubjectClass := .match,
      grants
    }

def roomJoinNonActiveCases : List ParticipantInput :=
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  [RoomState.deleting, RoomState.deleted].flatMap fun roomState =>
  [true, false].flatMap fun sessionPresent =>
  [true, false].flatMap fun participantPresent =>
  allGrants.map fun grants =>
    {
      operation := .roomJoin,
      projectState,
      targetMatch,
      subjectClass,
      roomState,
      sessionPresent,
      sessionState := .active,
      sessionTargetMatch := true,
      participantPresent,
      participantState := .active,
      participantTargetMatch := true,
      participantSubjectClass := .match,
      grants
    }

def roomJoinActiveCases : List ParticipantInput :=
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  sessionChoices.flatMap fun (sessionPresent, sessionState, sessionTargetMatch) =>
  participantChoices.flatMap fun (participantPresent, participantState, participantTargetMatch, participantSubjectClass) =>
  allGrants.map fun grants =>
    {
      operation := .roomJoin,
      projectState,
      targetMatch,
      subjectClass,
      roomState := .active,
      sessionPresent,
      sessionState,
      sessionTargetMatch,
      participantPresent,
      participantState,
      participantTargetMatch,
      participantSubjectClass,
      grants
    }

def mediaDataCases : List ParticipantInput :=
  [ParticipantOperation.mediaPublish, .mediaSubscribe, .dataSend].flatMap fun operation =>
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  sessionChoices.flatMap fun (sessionPresent, sessionState, sessionTargetMatch) =>
  participantChoices.flatMap fun (participantPresent, participantState, participantTargetMatch, participantSubjectClass) =>
  allGrants.map fun grants =>
    {
      operation,
      projectState,
      targetMatch,
      subjectClass,
      roomState := .active,
      sessionPresent,
      sessionState,
      sessionTargetMatch,
      participantPresent,
      participantState,
      participantTargetMatch,
      participantSubjectClass,
      grants
    }

def mediaDataInactiveCases : List ParticipantInput :=
  [ParticipantOperation.mediaPublish, .mediaSubscribe, .dataSend].flatMap fun operation =>
  projectStates.flatMap fun projectState =>
  [true, false].flatMap fun targetMatch =>
  subjectClasses.flatMap fun subjectClass =>
  [RoomState.absent, .deleting, .deleted].flatMap fun roomState =>
  allGrants.map fun grants =>
    {
      operation,
      projectState,
      targetMatch,
      subjectClass,
      roomState,
      sessionPresent := true,
      sessionState := .active,
      sessionTargetMatch := true,
      participantPresent := true,
      participantState := .active,
      participantTargetMatch := true,
      participantSubjectClass := .match,
      grants
    }

def allParticipantCases : List ParticipantInput :=
  roomCreateCases ++ roomJoinAbsentCases ++ roomJoinNonActiveCases ++
    roomJoinActiveCases ++ mediaDataCases ++ mediaDataInactiveCases

end Authorization
