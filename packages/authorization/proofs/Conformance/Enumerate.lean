import Authorization

open Lean

namespace Authorization

def participantLine (input : ParticipantInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "participant"),
    ("input", participantInputJson input),
    ("decision", decisionJson (decideParticipant input))
  ]

def projectUserLine (input : ProjectUserInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "project-user"),
    ("input", projectUserInputJson input),
    ("decision", decisionJson (decideProjectUser input))
  ]

def managementCredentialLine (input : ManagementCredentialInput) : Json :=
  Json.mkObj [
    ("kind", Json.str "management-credential"),
    ("input", managementCredentialInputJson input),
    ("decision", decisionJson (decideManagementCredential input))
  ]

end Authorization
