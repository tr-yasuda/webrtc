export type ProjectUserRole = "owner" | "admin" | "operator" | "auditor";

export type ManagementOperation =
  | "project.read"
  | "project.update"
  | "project.delete"
  | "projectUser.read"
  | "projectUser.add"
  | "projectUser.remove"
  | "projectUser.changeRole"
  | "application.manage"
  | "applicationSigningKey.manage"
  | "managementApiCredential.manage"
  | "room.read"
  | "room.update"
  | "room.delete"
  | "session.read"
  | "session.disconnect"
  | "participant.read"
  | "participant.disconnect"
  | "usage.read"
  | "audit.read";
