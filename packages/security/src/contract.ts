import { Ajv2020 } from "ajv/dist/2020.js";
import {
  SECURITY_CONTRACT,
  SECURITY_CONTRACT_VERSION,
  type SecurityContract,
} from "./generated/contract.js";
import { SECURITY_CONTRACT_SCHEMA } from "./generated/contract-schema.js";

export { SECURITY_CONTRACT, SECURITY_CONTRACT_VERSION };
export type { SecurityContract };

export type ContractLoadResult =
  | { readonly ok: true; readonly contract: SecurityContract }
  | { readonly ok: false; readonly error: "contract-missing" }
  | {
      readonly ok: false;
      readonly error: "unsupported-contract-version";
      readonly version: unknown;
    }
  | { readonly ok: false; readonly error: "invalid-contract" };

export type ContractInvariantError =
  | { readonly error: "missing-profile"; readonly profile: string }
  | {
      readonly error: "missing-required-control";
      readonly profile: string;
      readonly control: string;
    }
  | { readonly error: "missing-secret-class"; readonly secretClass: string }
  | { readonly error: "missing-output-boundary"; readonly boundary: string }
  | { readonly error: "missing-audit-event"; readonly kind: string }
  | { readonly error: "invalid-tls-baseline"; readonly detail: string }
  | { readonly error: "invalid-dtls-baseline"; readonly detail: string }
  | { readonly error: "baseline-mismatch"; readonly detail: string };

export type ContractInvariantResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ContractInvariantError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const validateSecurityContractSchema = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(SECURITY_CONTRACT_SCHEMA);

export function loadSecurityContract(value: unknown): ContractLoadResult {
  if (value === null || value === undefined) {
    return { ok: false, error: "contract-missing" };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "invalid-contract" };
  }
  if (value.version !== SECURITY_CONTRACT_VERSION) {
    return { ok: false, error: "unsupported-contract-version", version: value.version };
  }
  if (!validateSecurityContractSchema(value)) {
    return { ok: false, error: "invalid-contract" };
  }
  const contract = value as unknown as SecurityContract;
  if (!jsonEqual(contract, SECURITY_CONTRACT)) {
    return { ok: false, error: "invalid-contract" };
  }
  return { ok: true, contract };
}

export function findTransportProfile(
  contract: SecurityContract,
  profileId: string,
): SecurityContract["transportProfiles"][number] | undefined {
  return contract.transportProfiles.find((profile) => profile.id === profileId);
}

export function validateContractInvariants(contract: SecurityContract): ContractInvariantResult {
  const canonicalBaseline = SECURITY_CONTRACT.baseline;
  if (!jsonEqual(contract.baseline, canonicalBaseline)) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "baseline" } };
  }
  const baselineProfiles = canonicalBaseline.transportProfiles as Readonly<
    Record<string, readonly string[]>
  >;
  const baselineForbiddenFallbacks = canonicalBaseline.forbiddenFallbacks as Readonly<
    Record<string, readonly string[]>
  >;
  for (const [profileId, required] of Object.entries(baselineProfiles)) {
    const profile = findTransportProfile(contract, profileId);
    if (profile === undefined) {
      return { ok: false, reason: { error: "missing-profile", profile: profileId } };
    }
    if (!sameStringSet(profile.requiredControls, required)) {
      return {
        ok: false,
        reason: { error: "baseline-mismatch", detail: `profile-controls:${profileId}` },
      };
    }
    if (!sameStringSet(profile.forbiddenFallbacks, baselineForbiddenFallbacks[profileId] ?? [])) {
      return {
        ok: false,
        reason: { error: "baseline-mismatch", detail: `profile-fallbacks:${profileId}` },
      };
    }
  }
  const baselineProfileIds = new Set(Object.keys(baselineProfiles));
  for (const profile of contract.transportProfiles) {
    if (!baselineProfileIds.has(profile.id)) {
      return {
        ok: false,
        reason: { error: "baseline-mismatch", detail: "unbaselined-profile" },
      };
    }
  }

  if (
    !sameStringSet(
      contract.secretClasses.map((entry) => entry.id),
      canonicalBaseline.secretClasses,
    )
  ) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "secret-classes" } };
  }

  if (
    !sameStringSet(
      contract.outputBoundaries.map((entry) => entry.id),
      canonicalBaseline.outputBoundaries,
    )
  ) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "output-boundaries" } };
  }

  if (
    !sameStringSet(
      contract.audit.eventKinds.map((entry) => entry.id),
      canonicalBaseline.auditEventKinds,
    )
  ) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "audit-event-kinds" } };
  }
  if (
    !jsonEqual(contract.audit.actorKinds, SECURITY_CONTRACT.audit.actorKinds) ||
    !jsonEqual(contract.audit.eventKinds, SECURITY_CONTRACT.audit.eventKinds)
  ) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "audit-contract" } };
  }

  if (
    !sameStringSet(
      contract.validationStages.map((entry) => entry.id),
      canonicalBaseline.validationStages,
    )
  ) {
    return { ok: false, reason: { error: "baseline-mismatch", detail: "validation-stages" } };
  }

  if (
    !sameStringSet(contract.tls.prohibitedVersions, canonicalBaseline.tls.prohibitedVersions) ||
    !sameStringSet(contract.tls.tls12.keyExchange, canonicalBaseline.tls.tls12KeyExchange) ||
    !sameStringSet(contract.tls.tls12.cipherKinds, canonicalBaseline.tls.tls12CipherKinds) ||
    !sameStringSet(contract.tls.tls12.prohibited, canonicalBaseline.tls.tls12Prohibited) ||
    !sameStringSet(contract.tls.tls13.keyExchange, canonicalBaseline.tls.tls13KeyExchange) ||
    !sameStringArray(contract.tls.tls13.groups, canonicalBaseline.tls.tls13Groups)
  ) {
    return {
      ok: false,
      reason: { error: "invalid-tls-baseline", detail: "TLS baseline mismatch" },
    };
  }
  if (
    contract.tls.tls13.zeroRtt !== canonicalBaseline.tls.zeroRtt ||
    contract.tls.tls13.psk.mode !== canonicalBaseline.tls.pskMode ||
    contract.tls.tls13.psk.pskKeAllowed !== canonicalBaseline.tls.pskKeAllowed
  ) {
    return {
      ok: false,
      reason: { error: "invalid-tls-baseline", detail: "TLS 1.3 baseline mismatch" },
    };
  }
  if (
    !sameStringArray(contract.dtls.supportedVersions, canonicalBaseline.dtls.supportedVersions) ||
    contract.dtls.preferredVersion !== canonicalBaseline.dtls.preferredVersion ||
    !sameStringSet(contract.dtls.prohibitedVersions, canonicalBaseline.dtls.prohibitedVersions) ||
    contract.dtls.plaintextFallback !== canonicalBaseline.dtls.plaintextFallback ||
    contract.dtls.webrtcDtls12Renegotiation !== canonicalBaseline.dtls.webrtcDtls12Renegotiation ||
    contract.dtls.requireCertificateFingerprintVerification !==
      canonicalBaseline.dtls.requireCertificateFingerprintVerification
  ) {
    return {
      ok: false,
      reason: {
        error: "invalid-dtls-baseline",
        detail: "DTLS baseline mismatch",
      },
    };
  }

  return { ok: true };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function sameStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}
