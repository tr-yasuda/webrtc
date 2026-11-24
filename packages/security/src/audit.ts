import { SECURITY_CONTRACT, type SecurityContract } from "./contract.js";

export type AuditKind =
  | "authorization-decision"
  | "operation-result"
  | "request-rejected"
  | "resource";

export interface AuditActor {
  readonly kind: "project-user" | "participant" | "service" | "system";
  readonly id: string;
}

export interface AuditTarget {
  readonly kind: string;
  readonly id: string;
}

export interface AuditEnvelope {
  readonly id: string;
  readonly occurredAt: number;
  readonly recordedAt?: number;
  readonly correlationId?: string;
}

export interface AuthorizationDecisionAuditRecord extends AuditEnvelope {
  readonly kind: "authorization-decision";
  readonly actor: AuditActor;
  readonly operation: string;
  readonly target: AuditTarget;
  readonly decision: "allow" | "deny";
  readonly reason: string;
}

export interface OperationResultAuditRecord extends AuditEnvelope {
  readonly kind: "operation-result";
  readonly actor: AuditActor;
  readonly operation: string;
  readonly target: AuditTarget;
  readonly result: "succeeded" | "failed" | "outcome-unknown";
  readonly reason: string;
  readonly authorizationDecisionId: string;
}

export interface RequestRejectedAuditRecord extends AuditEnvelope {
  readonly kind: "request-rejected";
  readonly stage: "authentication" | "validation";
  readonly reason: string;
  readonly actor?: AuditActor;
  readonly target?: AuditTarget;
}

export interface ResourceAuditRecord extends AuditEnvelope {
  readonly kind: "resource";
  readonly recordedAt: number;
  readonly operationId?: string;
  readonly resourceId?: string;
  readonly outcome: string;
  readonly scopes: readonly string[];
}

export type AuditRecord =
  | AuthorizationDecisionAuditRecord
  | OperationResultAuditRecord
  | RequestRejectedAuditRecord
  | ResourceAuditRecord;

export interface AuthorizationDecisionLike {
  readonly allowed: boolean;
  readonly operation: string;
  readonly target: AuditTarget;
  readonly reason: string;
}

export type AuditValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "invalid-audit-record" }
  | { readonly ok: false; readonly error: "unknown-audit-kind" }
  | {
      readonly ok: false;
      readonly error: "missing-audit-field";
      readonly kind: string;
      readonly field: string;
    }
  | {
      readonly ok: false;
      readonly error: "unexpected-audit-field";
      readonly kind: string;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-audit-field";
      readonly kind: string;
      readonly field: string;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-audit-decision";
      readonly kind: string;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-audit-result";
      readonly kind: string;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-audit-stage";
      readonly kind: string;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-audit-outcome";
      readonly kind: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isActor(value: unknown, actorKinds: readonly string[], maxLength: number): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === "kind" || key === "id") &&
    typeof value.kind === "string" &&
    actorKinds.includes(value.kind) &&
    isIdentifier(value.id, maxLength)
  );
}

function isTarget(value: unknown, maxLength: number): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === "kind" || key === "id") &&
    typeof value.kind === "string" &&
    value.kind.trim().length > 0 &&
    value.kind.length <= maxLength &&
    isIdentifier(value.id, maxLength)
  );
}

function enumValues(
  definition: SecurityContract["audit"]["eventKinds"][number],
  field: string,
): readonly string[] | undefined {
  const entry = definition as {
    readonly decisionValues?: readonly string[];
    readonly resultValues?: readonly string[];
    readonly stageValues?: readonly string[];
    readonly outcomeValues?: readonly string[];
  };
  switch (field) {
    case "decision":
      return entry.decisionValues;
    case "result":
      return entry.resultValues;
    case "stage":
      return entry.stageValues;
    case "outcome":
      return entry.outcomeValues;
    default:
      return undefined;
  }
}

function validateField(
  value: unknown,
  fieldType: string,
  definition: SecurityContract["audit"]["eventKinds"][number],
  field: string,
  contract: SecurityContract,
): boolean {
  const maxLength = contract.redaction.maxStringLength;
  switch (fieldType) {
    case "identifier":
      return isIdentifier(value, maxLength);
    case "timestamp":
      return isTimestamp(value);
    case "actor":
      return isActor(value, contract.audit.actorKinds, maxLength);
    case "target":
      return isTarget(value, maxLength);
    case "string":
      return isIdentifier(value, maxLength);
    case "enum":
      return typeof value === "string" && (enumValues(definition, field)?.includes(value) ?? false);
    case "identifier-array":
      return (
        Array.isArray(value) &&
        value.length <= contract.redaction.maxItems &&
        value.every((entry) => isIdentifier(entry, maxLength))
      );
    default:
      return false;
  }
}

export function toAuthorizationDecisionAuditRecord(input: {
  readonly id: string;
  readonly occurredAt: number;
  readonly correlationId: string;
  readonly actor: AuditActor;
  readonly decision: AuthorizationDecisionLike;
}): AuthorizationDecisionAuditRecord {
  return {
    id: input.id,
    kind: "authorization-decision",
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
    operation: input.decision.operation,
    target: input.decision.target,
    decision: input.decision.allowed ? "allow" : "deny",
    reason: input.decision.reason,
  };
}

export function toOperationResultAuditRecord(input: {
  readonly id: string;
  readonly occurredAt: number;
  readonly correlationId: string;
  readonly actor: AuditActor;
  readonly operation: string;
  readonly target: AuditTarget;
  readonly result: "succeeded" | "failed" | "outcome-unknown";
  readonly reason: string;
  readonly authorizationDecisionId: string;
}): OperationResultAuditRecord {
  return {
    id: input.id,
    kind: "operation-result",
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
    operation: input.operation,
    target: input.target,
    result: input.result,
    reason: input.reason,
    authorizationDecisionId: input.authorizationDecisionId,
  };
}

export function validateAuditRecord(
  value: unknown,
  contract: SecurityContract = SECURITY_CONTRACT,
): AuditValidationResult {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    return { ok: false, error: "invalid-audit-record" };
  }
  const kind = value.kind;
  const definition = contract.audit.eventKinds.find((entry) => entry.id === kind);
  if (definition === undefined) {
    return { ok: false, error: "unknown-audit-kind" };
  }
  for (const field of definition.requiredFields) {
    if (!hasOwn(value, field)) {
      return { ok: false, error: "missing-audit-field", kind, field };
    }
  }
  const fieldTypes = definition.fieldTypes as Readonly<Record<string, string>>;
  for (const field of Object.keys(value)) {
    if (!(field in fieldTypes)) {
      return { ok: false, error: "unexpected-audit-field", kind };
    }
  }
  for (const [field, fieldType] of Object.entries(fieldTypes)) {
    if (!hasOwn(value, field)) {
      continue;
    }
    if (!validateField(value[field], fieldType, definition, field, contract)) {
      if (fieldType === "enum") {
        switch (field) {
          case "decision":
            return { ok: false, error: "invalid-audit-decision", kind };
          case "result":
            return { ok: false, error: "invalid-audit-result", kind };
          case "stage":
            return { ok: false, error: "invalid-audit-stage", kind };
          case "outcome":
            return { ok: false, error: "invalid-audit-outcome", kind };
        }
      }
      return { ok: false, error: "invalid-audit-field", kind, field };
    }
  }
  return { ok: true };
}
