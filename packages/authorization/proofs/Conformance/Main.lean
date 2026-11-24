import Conformance.Enumerate

open Lean
open Authorization

def main : IO Unit := do
  for input in allParticipantCases do
    IO.println (Json.compress (participantLine input))
  for input in allProjectUserCases do
    IO.println (Json.compress (projectUserLine input))
  for input in allManagementCredentialCases do
    IO.println (Json.compress (managementCredentialLine input))
