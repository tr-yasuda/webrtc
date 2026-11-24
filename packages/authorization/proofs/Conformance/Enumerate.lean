import Authorization

open Lean

namespace Authorization

def validationSuccess : Json :=
  Json.mkObj [
    ("ok", Json.bool true)
  ]

def validationFailure (reason : String) : Json :=
  Json.mkObj [
    ("ok", Json.bool false),
    ("reason", Json.str reason)
  ]

def participantLine (input : ParticipantInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "participant"),
    ("caseType", Json.str "authorization"),
    ("input", participantInputJson input),
    ("validation", validationSuccess),
    ("decision", decisionJson (decideParticipant input))
  ]

def projectUserLine (input : ProjectUserInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "project-user"),
    ("caseType", Json.str "authorization"),
    ("input", projectUserInputJson input),
    ("validation", validationSuccess),
    ("decision", decisionJson (decideProjectUser input))
  ]

def managementCredentialLine (input : ManagementCredentialInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "management-credential"),
    ("caseType", Json.str "authorization"),
    ("input", managementCredentialInputJson input),
    ("validation",
      if input.expiry == .invalid then validationFailure "input-invalid" else validationSuccess),
    ("decision", decisionJson (decideManagementCredential input))
  ]

def validationCaseLine (kind : String) (input : Json) (reason : String) : Json :=
  Json.mkObj [
    ("kind", Json.str kind),
    ("caseType", Json.str "validation"),
    ("input", input),
    ("validation", validationFailure reason)
  ]

end Authorization
