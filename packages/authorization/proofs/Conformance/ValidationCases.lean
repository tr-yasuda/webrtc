import Conformance.Enumerate

open Lean

namespace Authorization

def projectIdA : String := "01ARZ3NDEKTSV4RRFFQ69G5FAV"
def roomIdA : String := "01ARZ3NDEKTSV4RRFFQ69G5FAX"

def participantValidationInput
    (credentialProjectId projectId roomProjectId : String)
    (grants : List (String × Json)) : Json :=
  Json.mkObj [
    ("operation", Json.str "room.join"),
    ("credential", Json.mkObj [
      ("projectId", Json.str credentialProjectId),
      ("roomName", Json.str "room-a"),
      ("subject", Json.str "subject-a"),
      ("grants", Json.mkObj grants)
    ]),
    ("project", Json.mkObj [
      ("id", Json.str projectId),
      ("state", Json.str "active")
    ]),
    ("room", Json.mkObj [
      ("state", Json.str "absent"),
      ("projectId", Json.str roomProjectId),
      ("name", Json.str "room-a")
    ])
  ]

def participantValidationGrants : List (String × Json) := [
  ("room.create", Json.bool true),
  ("room.join", Json.bool true)
]

def participantValidationCases : List Json := [
  validationCaseLine "participant"
    (participantValidationInput "" projectIdA roomIdA participantValidationGrants)
    "input-invalid",
  validationCaseLine "participant"
    (participantValidationInput projectIdA "" roomIdA participantValidationGrants)
    "input-invalid",
  validationCaseLine "participant"
    (participantValidationInput projectIdA projectIdA "" participantValidationGrants)
    "input-invalid",
  validationCaseLine "participant"
    (participantValidationInput "not-a-ulid" projectIdA roomIdA participantValidationGrants)
    "input-invalid",
  validationCaseLine "participant"
    (participantValidationInput projectIdA projectIdA roomIdA
      (participantValidationGrants ++ [("recording", Json.bool true)]))
    "unsupported-grant",
  validationCaseLine "participant"
    (participantValidationInput projectIdA projectIdA roomIdA [
      ("room.create", Json.bool true),
      ("room.join", Json.str "yes")
    ])
    "grant-invalid"
]

def projectUserValidationInput
    (actorProjectId projectId targetProjectId : String)
    (operation role : String)
    (targetFields : List (String × Json)) : Json :=
  Json.mkObj [
    ("actor", Json.mkObj [
      ("projectId", Json.str actorProjectId),
      ("role", Json.str role)
    ]),
    ("project", Json.mkObj [
      ("id", Json.str projectId),
      ("state", Json.str "active")
    ]),
    ("operation", Json.str operation),
    ("target", Json.mkObj (("projectId", Json.str targetProjectId) :: targetFields))
  ]

def projectUserValidationCases : List Json := [
  validationCaseLine "project-user"
    (projectUserValidationInput "" projectIdA projectIdA "project.read" "owner" [])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA "" projectIdA "project.read" "owner" [])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA "" "project.read" "owner" [])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "projectUser.add" "owner" [
      ("accountId", Json.str ""),
      ("nextRole", Json.str "auditor")
    ])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "projectUser.changeRole" "owner" [
      ("projectUserId", Json.str ""),
      ("currentRole", Json.str "auditor"),
      ("nextRole", Json.str "auditor")
    ])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "room.update" "owner" [
      ("roomId", Json.str "")
    ])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "participant.disconnect" "owner" [
      ("participantId", Json.str "")
    ])
    "input-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "project.read" "owner" [
      ("roomId", Json.str roomIdA)
    ])
    "target-invalid",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "project.read" "superuser" [])
    "unsupported-role",
  validationCaseLine "project-user"
    (projectUserValidationInput projectIdA projectIdA projectIdA "unknown.operation" "owner" [])
    "unsupported-operation"
]

def managementCredentialValidationInput
    (credentialProjectId projectId targetProjectId : String)
    (operation : String) (scopes : List Json)
    (targetFields : List (String × Json)) : Json :=
  Json.mkObj [
    ("credential", Json.mkObj [
      ("projectId", Json.str credentialProjectId),
      ("scopes", Json.arr scopes.toArray),
      ("revoked", Json.bool false),
      ("expiresAt", Json.num 2000)
    ]),
    ("project", Json.mkObj [
      ("id", Json.str projectId),
      ("state", Json.str "active")
    ]),
    ("operation", Json.str operation),
    ("target", Json.mkObj (("projectId", Json.str targetProjectId) :: targetFields)),
    ("now", Json.num 1000)
  ]

def managementCredentialValidationCases : List Json := [
  validationCaseLine "management-credential"
    (managementCredentialValidationInput "" projectIdA projectIdA "room.read"
      [Json.str "room.manage"] [])
    "input-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA "" projectIdA "room.read"
      [Json.str "room.manage"] [])
    "input-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA "" "room.read"
      [Json.str "room.manage"] [])
    "input-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA projectIdA "room.read"
      [Json.str "unknown.scope"] [])
    "unsupported-scope",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA projectIdA "room.update"
      [Json.str "room.manage"] [("roomId", Json.str "")])
    "input-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA projectIdA "participant.disconnect"
      [Json.str "session.manage"] [("participantId", Json.str "")])
    "input-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA projectIdA "room.read"
      [Json.str "room.manage"] [("roomId", Json.str roomIdA)])
    "target-invalid",
  validationCaseLine "management-credential"
    (managementCredentialValidationInput projectIdA projectIdA projectIdA "unknown.operation"
      [Json.str "room.manage"] [])
    "unsupported-operation"
]

end Authorization
