import type {
  AuditActor,
  AuditTarget,
  AuthorizationDecisionAuditRecord,
  AuthorizationDecisionLike,
} from "@webrtc/security";
import { toAuthorizationDecisionAuditRecord } from "@webrtc/security";

export function authorizationDecisionAuditRecord<
  TOperation extends string,
  TReason extends string,
>(input: {
  readonly id: string;
  readonly occurredAt: number;
  readonly correlationId: string;
  readonly actor: AuditActor;
  readonly target: AuditTarget;
  readonly decision: {
    readonly allowed: boolean;
    readonly operation: TOperation;
    readonly reason: TReason;
  };
}): AuthorizationDecisionAuditRecord {
  const decision: AuthorizationDecisionLike = {
    allowed: input.decision.allowed,
    operation: input.decision.operation,
    target: input.target,
    reason: input.decision.reason,
  };
  return toAuthorizationDecisionAuditRecord({
    id: input.id,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
    decision,
  });
}
