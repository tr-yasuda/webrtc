export interface ValidationFailure {
  readonly code: string;
  readonly path: readonly string[];
  readonly limit?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ValidationFailure };

const UNKNOWN_KEY = "[unknown-key]";
const TRUNCATED = "[truncated]";
const MAX_PATH_SEGMENTS = 32;

export function sanitizeFieldPath(
  path: readonly (string | number)[],
  allowedFields: readonly string[],
): string[] {
  const allowed = new Set(allowedFields);
  const sanitized: string[] = [];
  for (const [index, segment] of path.entries()) {
    if (index >= MAX_PATH_SEGMENTS) {
      sanitized.push(TRUNCATED);
      break;
    }
    if (typeof segment === "number") {
      if (!Number.isSafeInteger(segment) || segment < 0) {
        sanitized.push(UNKNOWN_KEY);
      } else {
        sanitized.push(String(segment));
      }
      continue;
    }
    sanitized.push(allowed.has(segment) ? segment : UNKNOWN_KEY);
  }
  return sanitized;
}

export function validationFailure(
  code: string,
  path: readonly (string | number)[],
  allowedFields: readonly string[],
  limit?: string,
): ValidationResult<never> {
  return {
    ok: false,
    failure: {
      code,
      path: sanitizeFieldPath(path, allowedFields),
      ...(limit === undefined ? {} : { limit }),
    },
  };
}
