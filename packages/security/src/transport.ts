import { SECURITY_CONTRACT, findTransportProfile, type SecurityContract } from "./contract.js";

export interface TransportProfileDeclaration {
  readonly id: string;
  readonly controls: readonly string[];
}

export interface ComponentSecurityManifest {
  readonly component: string;
  readonly contractVersion: number;
  readonly profiles: readonly TransportProfileDeclaration[];
  readonly outputBoundaries: readonly string[];
  readonly validationStages: readonly string[];
}

export type ManifestValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "invalid-manifest" }
  | {
      readonly ok: false;
      readonly error: "unsupported-manifest-contract-version";
      readonly expected: number;
      readonly actual: unknown;
    }
  | {
      readonly ok: false;
      readonly error: "unknown-transport-profile";
      readonly profile: string;
    }
  | {
      readonly ok: false;
      readonly error: "missing-required-control";
      readonly profile: string;
      readonly control: string;
    }
  | {
      readonly ok: false;
      readonly error: "forbidden-fallback";
      readonly profile: string;
      readonly fallback: string;
    }
  | {
      readonly ok: false;
      readonly error: "unknown-output-boundary";
      readonly boundary: string;
    }
  | {
      readonly ok: false;
      readonly error: "unknown-validation-stage";
      readonly stage: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validateComponentManifest(
  value: unknown,
  contract: SecurityContract = SECURITY_CONTRACT,
): ManifestValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid-manifest" };
  }
  if (value.contractVersion !== contract.version) {
    return {
      ok: false,
      error: "unsupported-manifest-contract-version",
      expected: contract.version,
      actual: value.contractVersion,
    };
  }
  if (
    typeof value.component !== "string" ||
    !Array.isArray(value.profiles) ||
    !isStringArray(value.outputBoundaries) ||
    !isStringArray(value.validationStages)
  ) {
    return { ok: false, error: "invalid-manifest" };
  }

  for (const profileEntry of value.profiles) {
    if (
      !isRecord(profileEntry) ||
      typeof profileEntry.id !== "string" ||
      !isStringArray(profileEntry.controls)
    ) {
      return { ok: false, error: "invalid-manifest" };
    }
    const profile = findTransportProfile(contract, profileEntry.id);
    if (profile === undefined) {
      return { ok: false, error: "unknown-transport-profile", profile: profileEntry.id };
    }
    const requiredControls = profile.requiredControls as readonly string[];
    for (const control of requiredControls) {
      if (!profileEntry.controls.includes(control)) {
        return {
          ok: false,
          error: "missing-required-control",
          profile: profileEntry.id,
          control,
        };
      }
    }
    const forbiddenFallbacks = profile.forbiddenFallbacks as readonly string[];
    for (const fallback of forbiddenFallbacks) {
      if (profileEntry.controls.includes(fallback)) {
        return {
          ok: false,
          error: "forbidden-fallback",
          profile: profileEntry.id,
          fallback,
        };
      }
    }
  }

  for (const boundary of value.outputBoundaries) {
    if (!contract.outputBoundaries.some((entry) => entry.id === boundary)) {
      return { ok: false, error: "unknown-output-boundary", boundary };
    }
  }
  for (const stage of value.validationStages) {
    if (!contract.validationStages.some((entry) => entry.id === stage)) {
      return { ok: false, error: "unknown-validation-stage", stage };
    }
  }
  return { ok: true };
}
