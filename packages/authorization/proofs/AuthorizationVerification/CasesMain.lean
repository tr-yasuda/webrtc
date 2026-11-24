import AuthorizationVerification
import Lean.Data.Json
import Lean.Data.Json.Printer

open AuthorizationVerification
open Lean

def axisJson (axis : Axis) : Json :=
  Json.mkObj
    [ ("name", Json.str axis.name)
    , ("values", Json.arr (axis.values.toArray.map Json.str))
    ]

def reasonAlphabet := "0123456789abcdefghijklmnopqrstuvwxyz"

def reasonChar (index : Nat) : Char :=
  reasonAlphabet.toList.getD index '?'

def reasonIndex (reason : String) (reasons : List String) : Nat :=
  (reasons.findIdx? fun candidate => candidate == reason).getD reasonAlphabet.length

def allowedString {α : Type} (cases : List α) (decide : α → Decision) : String :=
  String.ofList <| cases.map fun item =>
    if (decide item).allowed then '1' else '0'

def reasonCodeString {α : Type}
    (cases : List α) (decide : α → Decision) (reasons : List String) : String :=
  String.ofList <| cases.map fun item =>
    reasonChar (reasonIndex (decide item).reason reasons)

def groupJson {α : Type}
    (name : String)
    (axes : List Axis)
    (cases : List α)
    (decide : α → Decision)
    (reasons : List String) : Json :=
  Json.mkObj
    [ ("name", Json.str name)
    , ("axes", Json.arr (axes.toArray.map axisJson))
    , ("count", cases.length)
    , ("allowed", Json.str (allowedString cases decide))
    , ("reasonCodes", Json.str (reasonCodeString cases decide reasons))
    , ("reasons", Json.arr (reasons.toArray.map Json.str))
    ]

def participantReasons : List String :=
  [ "allowed"
  , "unsupported-operation"
  , "project-not-active"
  , "credential-target-mismatch"
  , "subject-required"
  , "subject-mismatch"
  , "grant-not-granted"
  , "room-already-exists"
  , "room-join-required"
  , "session-target-mismatch"
  , "participant-target-mismatch"
  , "room-create-required"
  , "room-not-active"
  , "session-required"
  , "participant-required"
  , "session-not-active"
  , "participant-not-active"
  ]

def projectUserReasons : List String :=
  [ "allowed"
  , "project-not-active"
  , "actor-project-mismatch"
  , "target-project-mismatch"
  , "unsupported-operation"
  , "project-user-role-missing"
  , "project-user-role-invalid"
  , "target-id-required"
  , "insufficient-role"
  , "project-user-next-role-required"
  , "project-user-current-role-required"
  , "owner-management-forbidden"
  ]

def credentialReasons : List String :=
  [ "allowed"
  , "credential-revoked"
  , "credential-expiry-invalid"
  , "credential-expired"
  , "credential-target-mismatch"
  , "project-not-active"
  , "credential-input-invalid"
  , "unsupported-operation"
  , "target-id-required"
  , "credential-operation-not-allowed"
  , "credential-scope-missing"
  ]

def manifestJson : Json :=
  Json.mkObj
    [ ( "participant"
      , Json.arr <| (participantGroups.map fun group =>
            groupJson group.name group.axes group.cases decideParticipantCase participantReasons).toArray
      )
    , ( "projectUser"
      , Json.arr <|
          (projectUserGroups.map fun group =>
            groupJson group.name group.axes group.cases decideProjectUserCase projectUserReasons).toArray ++
          (projectUserInvalidOperationGroups.map fun group =>
            groupJson group.name group.axes group.cases decideProjectUserInvalidOperationCase
              projectUserReasons).toArray
      )
    , ( "credential"
      , Json.arr <| (credentialGroups.map fun group =>
            groupJson group.name group.axes group.cases decideCredentialCase credentialReasons).toArray
      )
    ]

def main : IO Unit :=
  IO.println (Json.compress manifestJson)
