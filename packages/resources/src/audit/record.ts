import type { AuditRecord } from "@webrtc/security";
import type { ResourceAuditEvent } from "./contract.js";

export type ResourceAuditRecord = Extract<AuditRecord, { readonly kind: "resource" }>;

export function toResourceAuditRecord(event: ResourceAuditEvent): ResourceAuditRecord {
  return {
    id: event.id,
    kind: "resource",
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
    ...(event.resourceId === undefined ? {} : { resourceId: event.resourceId }),
    outcome: event.outcome,
    scopes: event.scopes.map((scope) => `${scope.kind}:${scope.keyVersion}:${scope.ref}`),
  };
}
