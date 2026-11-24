import type { DomainIdParseResult } from "@webrtc/domain";
import type { ValidationFailureReason } from "./identifiers.js";

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ValidationFailureReason };

export function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function invalid<T = never>(reason: ValidationFailureReason): ValidationResult<T> {
  return { ok: false, reason };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

export function parseDomainIdValue<T>(
  raw: unknown,
  parse: (value: string) => DomainIdParseResult<T>,
): ValidationResult<T> {
  if (!isString(raw)) {
    return invalid("input-invalid");
  }
  const result = parse(raw);
  return result.ok ? valid(result.id) : invalid("input-invalid");
}

export function parseOptionalDomainIdValue<T>(
  raw: unknown,
  parse: (value: string) => DomainIdParseResult<T>,
): ValidationResult<T | undefined> {
  return raw === undefined ? valid(undefined) : parseDomainIdValue(raw, parse);
}
