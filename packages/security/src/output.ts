import { SECURITY_CONTRACT } from "./contract.js";
import { isSecret } from "./secret.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type SafeLogValue = JsonPrimitive | readonly JsonPrimitive[];
export type SafeUrl = string & { readonly __safeUrl: unique symbol };

export interface SafeLogEvent {
  readonly event: string;
  readonly component: string;
  readonly correlationId?: string;
  readonly attributes: Readonly<Record<string, SafeLogValue>>;
}

export interface PublicError {
  readonly code: string;
  readonly messageKey: string;
  readonly retryable: boolean;
  readonly targetIds?: readonly string[];
  readonly correlationId?: string;
}

export interface PublicErrorInput extends PublicError {
  readonly cause?: unknown;
  readonly rawMessage?: unknown;
}

export interface SafeTestReport {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly durationMs?: number;
  readonly failureCodes?: readonly string[];
  readonly correlationId?: string;
}

export interface RedactionOptions {
  readonly sensitiveKeys?: readonly string[];
  readonly marker?: string;
  readonly maxDepth?: number;
}

export class UnsafeOutputError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UnsafeOutputError";
  }
}

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

function sensitiveKeys(): ReadonlySet<string> {
  return new Set(SECURITY_CONTRACT.redaction.sensitiveKeys.map((key) => key.toLowerCase()));
}

function isSensitiveKey(key: string, keys: ReadonlySet<string>): boolean {
  return keys.has(key.toLowerCase());
}

function isSafeLogValueWithinLimits(
  value: unknown,
  maxItems: number,
  maxStringLength: number,
): value is SafeLogValue {
  if (typeof value === "string") {
    return value.length <= maxStringLength;
  }
  if (!isSafeLogValue(value)) {
    return false;
  }
  return (
    !Array.isArray(value) ||
    (value.length <= maxItems &&
      value.every((entry) => typeof entry !== "string" || entry.length <= maxStringLength))
  );
}

export function isSafeLogValue(value: unknown): value is SafeLogValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  );
}

export function createSafeLogEvent(input: {
  readonly event: string;
  readonly component: string;
  readonly correlationId?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}): SafeLogEvent {
  const maxStringLength = SECURITY_CONTRACT.redaction.maxStringLength;
  if (
    typeof input.event !== "string" ||
    input.event.trim().length === 0 ||
    input.event.length > maxStringLength ||
    typeof input.component !== "string" ||
    input.component.trim().length === 0 ||
    input.component.length > maxStringLength ||
    (input.correlationId !== undefined &&
      (typeof input.correlationId !== "string" ||
        input.correlationId.trim().length === 0 ||
        input.correlationId.length > maxStringLength))
  ) {
    throw new UnsafeOutputError("invalid-safe-log-event");
  }
  const attributes = input.attributes ?? {};
  if (!isPlainObject(attributes)) {
    throw new UnsafeOutputError("unsafe-log-attributes");
  }
  const maxItems = SECURITY_CONTRACT.redaction.maxItems;
  const keys = sensitiveKeys();
  const entries = Object.entries(attributes);
  if (entries.length > maxItems) {
    throw new UnsafeOutputError("unsafe-log-attributes");
  }
  const safeAttributes: Record<string, SafeLogValue> = {};
  for (const [key, value] of entries) {
    if (
      key.trim().length === 0 ||
      key.length > maxStringLength ||
      isSensitiveKey(key, keys) ||
      !isSafeLogValueWithinLimits(value, maxItems, maxStringLength)
    ) {
      throw new UnsafeOutputError("unsafe-log-attribute");
    }
    safeAttributes[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze({
    event: input.event,
    component: input.component,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    attributes: Object.freeze(safeAttributes),
  });
}

export function toPublicError(input: PublicErrorInput): PublicError {
  const maxItems = SECURITY_CONTRACT.redaction.maxItems;
  const maxStringLength = SECURITY_CONTRACT.redaction.maxStringLength;
  if (
    typeof input.code !== "string" ||
    input.code.trim().length === 0 ||
    input.code.length > maxStringLength ||
    typeof input.messageKey !== "string" ||
    input.messageKey.trim().length === 0 ||
    input.messageKey.length > maxStringLength ||
    typeof input.retryable !== "boolean" ||
    (input.correlationId !== undefined &&
      (typeof input.correlationId !== "string" ||
        input.correlationId.trim().length === 0 ||
        input.correlationId.length > maxStringLength)) ||
    (input.targetIds !== undefined &&
      (!Array.isArray(input.targetIds) ||
        input.targetIds.length > maxItems ||
        input.targetIds.some(
          (targetId) =>
            typeof targetId !== "string" ||
            targetId.trim().length === 0 ||
            targetId.length > maxStringLength,
        )))
  ) {
    throw new UnsafeOutputError("invalid-public-error");
  }
  return {
    code: input.code,
    messageKey: input.messageKey,
    retryable: input.retryable,
    ...(input.targetIds === undefined ? {} : { targetIds: [...input.targetIds] }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  };
}

export function redactUnknown(value: unknown, options: RedactionOptions = {}): JsonValue {
  const sensitive = new Set(
    [...SECURITY_CONTRACT.redaction.sensitiveKeys, ...(options.sensitiveKeys ?? [])].map((key) =>
      key.toLowerCase(),
    ),
  );
  const marker = options.marker ?? SECURITY_CONTRACT.redaction.marker;
  const maxDepth = options.maxDepth ?? SECURITY_CONTRACT.redaction.maxDepth;
  const maxItems = SECURITY_CONTRACT.redaction.maxItems;
  const maxStringLength = SECURITY_CONTRACT.redaction.maxStringLength;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number): JsonValue => {
    if (isSecret(current)) {
      return marker;
    }
    if (current === null || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "string") {
      return current.length <= maxStringLength ? current : marker;
    }
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : marker;
    }
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (
      typeof current === "undefined" ||
      typeof current === "function" ||
      typeof current === "symbol"
    ) {
      return marker;
    }
    if (depth >= maxDepth) {
      return marker;
    }
    if (typeof current === "object") {
      if (seen.has(current)) {
        return marker;
      }
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.length > maxItems) {
          return marker;
        }
        return Object.freeze(current.map((entry) => visit(entry, depth + 1)));
      }
      if (isPlainObject(current)) {
        if (Object.keys(current).length > maxItems) {
          return marker;
        }
        const entries: Record<string, JsonValue> = {};
        for (const [key, entry] of Object.entries(current)) {
          entries[key] = sensitive.has(key.toLowerCase()) ? marker : visit(entry, depth + 1);
        }
        return entries;
      }
    }
    return marker;
  };

  return visit(value, 0);
}

export function toSafeUrl(
  base: string,
  path: readonly string[],
  query: Readonly<Record<string, string | undefined>>,
  allowedQueryKeys: readonly string[],
): SafeUrl {
  const maxItems = SECURITY_CONTRACT.redaction.maxItems;
  const maxStringLength = SECURITY_CONTRACT.redaction.maxStringLength;
  const keys = sensitiveKeys();
  const allowed = new Set(allowedQueryKeys);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new UnsafeOutputError("unsafe-url-base");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.length === 0 ||
    url.pathname !== "/" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new UnsafeOutputError("unsafe-url-base");
  }
  if (path.length > maxItems || Object.keys(query).length > maxItems) {
    throw new UnsafeOutputError("unsafe-url-size");
  }
  if (path.some((segment) => segment === "." || segment === "..")) {
    throw new UnsafeOutputError("unsafe-url-path");
  }
  if (
    path.some(
      (segment) =>
        typeof segment !== "string" || segment.length === 0 || segment.length > maxStringLength,
    )
  ) {
    throw new UnsafeOutputError("unsafe-url-path");
  }
  for (const key of Object.keys(query)) {
    if (!allowed.has(key) || isSensitiveKey(key, keys)) {
      throw new UnsafeOutputError("query-key-not-allowed");
    }
  }
  const safeUrl = new URL(url.origin);
  safeUrl.pathname = `/${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string" || value.length > maxStringLength) {
      throw new UnsafeOutputError("unsafe-url-query-value");
    }
    safeUrl.searchParams.set(key, value);
  }
  return safeUrl.toString() as SafeUrl;
}

export function stringifyJsonValue(value: JsonValue): string {
  return JSON.stringify(value);
}

export function createSafeTestReport(input: {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly durationMs?: number;
  readonly failureCodes?: readonly string[];
  readonly correlationId?: string;
}): SafeTestReport {
  const maxItems = SECURITY_CONTRACT.redaction.maxItems;
  const maxStringLength = SECURITY_CONTRACT.redaction.maxStringLength;
  if (
    input.name.trim().length === 0 ||
    input.name.length > maxStringLength ||
    (input.correlationId !== undefined &&
      (input.correlationId.length === 0 || input.correlationId.length > maxStringLength)) ||
    (input.durationMs !== undefined &&
      (!Number.isFinite(input.durationMs) || input.durationMs < 0)) ||
    (input.failureCodes !== undefined &&
      (input.failureCodes.length > maxItems ||
        input.failureCodes.some((code) => code.length === 0 || code.length > maxStringLength)))
  ) {
    throw new UnsafeOutputError("invalid-safe-test-report");
  }
  return Object.freeze({
    name: input.name,
    status: input.status,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.failureCodes === undefined
      ? {}
      : { failureCodes: Object.freeze([...input.failureCodes]) }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}
