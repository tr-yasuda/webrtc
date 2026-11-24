import Conformance.ValidationCases

open Lean
open Authorization

def main : IO Unit := do
  for input in allParticipantCases do
    IO.println (Json.compress (participantLine input))
  for input in allProjectUserCases do
    IO.println (Json.compress (projectUserLine input))
  for input in allManagementCredentialCases do
    IO.println (Json.compress (managementCredentialLine input))
  for line in participantValidationCases do
    IO.println (Json.compress line)
  for line in projectUserValidationCases do
    IO.println (Json.compress line)
  for line in managementCredentialValidationCases do
    IO.println (Json.compress line)
