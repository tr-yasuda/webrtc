import type { ManagementCredentialScope, ManagementOperation } from "../contracts/identifiers.js";

export const operationScope: Partial<Record<ManagementOperation, ManagementCredentialScope>> = {
  "room.read": "room.manage",
  "room.update": "room.manage",
  "room.delete": "room.manage",
  "session.read": "session.manage",
  "session.disconnect": "session.manage",
  "participant.read": "session.manage",
  "participant.disconnect": "session.manage",
  "usage.read": "usage.read",
  "audit.read": "audit.read",
};
