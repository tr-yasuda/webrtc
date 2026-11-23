import type { ProjectId } from "@webrtc/domain";
import type { AuthorizationDecision } from "./decision.js";
import type { ManagementOperation } from "./management-operation.js";
import type { ProjectState } from "./project-state.js";

export type ManagementCredentialScope =
  | "room.manage"
  | "session.manage"
  | "usage.read"
  | "audit.read";

export type ManagementCredentialAuthorizationTarget = {
  readonly projectId: ProjectId;
  readonly resourceId?: string;
};

export type ManagementCredentialAuthorizationReason =
  | "allowed"
  | "credential-revoked"
  | "credential-expiry-invalid"
  | "credential-expired"
  | "credential-target-mismatch"
  | "project-not-active"
  | "credential-operation-not-allowed"
  | "credential-scope-missing";

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
  if (input.credential.revoked) {
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

  const requiredScopes = operationScopes[input.operation];
  if (requiredScopes === undefined) {
    return deny(input, "credential-operation-not-allowed");
  }
  if (!requiredScopes.some((scope) => input.credential.scopes.includes(scope))) {
    return deny(input, "credential-scope-missing");
  }

  return allow(input);
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
