import type { ParticipantId, ProjectId, RoomId } from "@webrtc/domain";
import type { AuthorizationDecision } from "./decision.js";
import { isManagementOperation, type ManagementOperation } from "./management-operation.js";
import type { ProjectState } from "./project-state.js";

const managementCredentialScopeValues = [
  "room.manage",
  "session.manage",
  "usage.read",
  "audit.read",
] as const;

export type ManagementCredentialScope = (typeof managementCredentialScopeValues)[number];

const managementCredentialScopeSet: ReadonlySet<ManagementCredentialScope> = new Set(
  managementCredentialScopeValues,
);

export type ManagementCredentialAuthorizationTarget =
  | {
      readonly projectId: ProjectId;
      readonly resourceId?: string;
    }
  | {
      readonly projectId: ProjectId;
      readonly roomId: RoomId;
    }
  | {
      readonly projectId: ProjectId;
      readonly sessionId: string;
    }
  | {
      readonly projectId: ProjectId;
      readonly participantId: ParticipantId;
    };

export type ManagementCredentialAuthorizationReason =
  | "allowed"
  | "credential-revoked"
  | "credential-expiry-invalid"
  | "credential-expired"
  | "credential-target-mismatch"
  | "project-not-active"
  | "credential-input-invalid"
  | "target-id-required"
  | "credential-operation-not-allowed"
  | "credential-scope-missing"
  | "unsupported-operation";

export type ManagementCredentialAuthorizationDecision = AuthorizationDecision<
  ManagementOperation,
  ManagementCredentialAuthorizationTarget,
  ManagementCredentialAuthorizationReason
>;

export type ManagementCredentialAuthorizationInput = {
  readonly credential: {
    readonly projectId: ProjectId;
    readonly scopes: readonly ManagementCredentialScope[];
    readonly revoked: boolean;
    readonly expiresAt: number;
  };
  readonly project: {
    readonly id: ProjectId;
    readonly state: ProjectState;
  };
  readonly operation: ManagementOperation;
  readonly target: ManagementCredentialAuthorizationTarget;
  readonly now: number;
};

const operationScopes: Partial<Record<ManagementOperation, readonly ManagementCredentialScope[]>> =
  {
    "room.read": ["room.manage"],
    "room.update": ["room.manage"],
    "room.delete": ["room.manage"],
    "session.read": ["session.manage"],
    "session.disconnect": ["session.manage"],
    "participant.read": ["session.manage"],
    "participant.disconnect": ["session.manage"],
    "usage.read": ["usage.read"],
    "audit.read": ["audit.read"],
  };

export function authorizeManagementCredentialAction(
  input: ManagementCredentialAuthorizationInput,
): ManagementCredentialAuthorizationDecision {
  if (input.credential.revoked !== false) {
    return deny(input, "credential-revoked");
  }
  if (!Number.isFinite(input.credential.expiresAt) || !Number.isFinite(input.now)) {
    return deny(input, "credential-expiry-invalid");
  }
  if (input.now >= input.credential.expiresAt) {
    return deny(input, "credential-expired");
  }
  if (
    input.credential.projectId !== input.project.id ||
    input.target.projectId !== input.project.id
  ) {
    return deny(input, "credential-target-mismatch");
  }
  if (input.project.state !== "active") {
    return deny(input, "project-not-active");
  }
  if (
    !Array.isArray(input.credential.scopes) ||
    !input.credential.scopes.every(isManagementCredentialScope)
  ) {
    return deny(input, "credential-input-invalid");
  }
  if (!isManagementOperation(input.operation)) {
    return deny(input, "unsupported-operation");
  }
  if (!hasRequiredTargetId(input)) {
    return deny(input, "target-id-required");
  }

  const requiredScopes = operationScopes[input.operation];
  if (requiredScopes === undefined) {
    return deny(input, "credential-operation-not-allowed");
  }
  if (!requiredScopes.some((scope) => input.credential.scopes.includes(scope))) {
    return deny(input, "credential-scope-missing");
  }

  return allow(input);
}

function hasRequiredTargetId(input: ManagementCredentialAuthorizationInput): boolean {
  switch (input.operation) {
    case "room.update":
    case "room.delete":
      return "roomId" in input.target;
    case "session.disconnect":
      return "sessionId" in input.target;
    case "participant.disconnect":
      return "participantId" in input.target;
    default:
      return true;
  }
}

function isManagementCredentialScope(value: unknown): value is ManagementCredentialScope {
  return (
    typeof value === "string" &&
    managementCredentialScopeSet.has(value as ManagementCredentialScope)
  );
}

function allow(
  input: ManagementCredentialAuthorizationInput,
): ManagementCredentialAuthorizationDecision {
  return {
    allowed: true,
    operation: input.operation,
    target: input.target,
    reason: "allowed",
  };
}

function deny(
  input: ManagementCredentialAuthorizationInput,
  reason: Exclude<ManagementCredentialAuthorizationReason, "allowed">,
): ManagementCredentialAuthorizationDecision {
  return {
    allowed: false,
    operation: input.operation,
    target: input.target,
    reason,
  };
}
