import {
  SECURITY_CONTRACT,
  loadSecurityContract,
  validateContractInvariants,
  type ContractInvariantError,
  type SecurityContract,
} from "./contract.js";
import { validateAuditRecord, type AuditValidationResult } from "./audit.js";
import { validateComponentManifest, type ManifestValidationResult } from "./transport.js";

export interface ContractMutationResult {
  readonly id: string;
  readonly detected: boolean;
  readonly error?: string;
}

export type ConformanceResult =
  | {
      readonly ok: true;
      readonly mutations: readonly ContractMutationResult[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
      readonly mutations: readonly ContractMutationResult[];
    };

interface MutableContract {
  transportProfiles: Array<{
    id: string;
    requiredControls: string[];
    forbiddenFallbacks: string[];
  }>;
  audit: {
    eventKinds: Array<{
      id: string;
      requiredFields: string[];
      fieldTypes: Record<string, string>;
      decisionValues?: string[];
      resultValues?: string[];
      stageValues?: string[];
      outcomeValues?: string[];
    }>;
  };
  tls: {
    tls13: {
      zeroRtt: boolean;
      psk: {
        mode: string;
        pskKeAllowed: boolean;
      };
    };
  };
}

function cloneContract(contract: SecurityContract): MutableContract {
  return structuredClone(contract) as unknown as MutableContract;
}

function invokeMutation(
  contract: SecurityContract,
  id: string,
  apply: (contract: MutableContract) => void,
): ContractMutationResult {
  const mutated = cloneContract(contract);
  apply(mutated);
  const result = validateContractInvariants(mutated as unknown as SecurityContract);
  return {
    id,
    detected: !result.ok,
    ...(result.ok ? {} : { error: result.reason.error }),
  };
}

export function runContractMutationTests(
  contract: SecurityContract = SECURITY_CONTRACT,
): ContractMutationResult[] {
  return [
    invokeMutation(contract, "remove-public-control-tls", (mutated) => {
      const profile = mutated.transportProfiles.find((entry) => entry.id === "public-control");
      if (profile !== undefined) {
        profile.requiredControls = profile.requiredControls.filter((control) => control !== "tls");
      }
    }),
    invokeMutation(contract, "remove-public-control-no-external-psk", (mutated) => {
      const profile = mutated.transportProfiles.find((entry) => entry.id === "public-control");
      if (profile !== undefined) {
        profile.requiredControls = profile.requiredControls.filter(
          (control) => control !== "no-external-psk",
        );
      }
    }),
    invokeMutation(contract, "remove-dplane-peer-credentials", (mutated) => {
      const profile = mutated.transportProfiles.find((entry) => entry.id === "dplane-ipc");
      if (profile !== undefined) {
        profile.requiredControls = profile.requiredControls.filter(
          (control) => control !== "peer-credentials",
        );
      }
    }),
    invokeMutation(contract, "remove-webrtc-media-sframe", (mutated) => {
      const profile = mutated.transportProfiles.find((entry) => entry.id === "webrtc-media");
      if (profile !== undefined) {
        profile.requiredControls = profile.requiredControls.filter(
          (control) => control !== "sframe-e2ee",
        );
      }
    }),
    invokeMutation(contract, "remove-webrtc-data-fingerprint", (mutated) => {
      const profile = mutated.transportProfiles.find((entry) => entry.id === "webrtc-data");
      if (profile !== undefined) {
        profile.requiredControls = profile.requiredControls.filter(
          (control) => control !== "dtls-fingerprint-verification",
        );
      }
    }),
    invokeMutation(contract, "remove-authorization-decision-audit", (mutated) => {
      mutated.audit.eventKinds = mutated.audit.eventKinds.filter(
        (entry) => entry.id !== "authorization-decision",
      );
    }),
    invokeMutation(contract, "remove-authorization-decision-field-type", (mutated) => {
      const kind = mutated.audit.eventKinds.find((entry) => entry.id === "authorization-decision");
      if (kind !== undefined) {
        delete kind.fieldTypes.actor;
      }
    }),
    invokeMutation(contract, "enable-tls13-zero-rtt", (mutated) => {
      mutated.tls.tls13.zeroRtt = true;
    }),
    invokeMutation(contract, "enable-tls13-pure-psk", (mutated) => {
      mutated.tls.tls13.psk.mode = "psk_ke";
      mutated.tls.tls13.psk.pskKeAllowed = true;
    }),
  ];
}

export interface ConformanceInput {
  readonly contract?: unknown;
  readonly manifest?: unknown;
  readonly auditRecords?: readonly unknown[];
}

export function runConformance(input: ConformanceInput = {}): ConformanceResult {
  const errors: string[] = [];
  const loaded =
    input.contract === undefined
      ? loadSecurityContract(SECURITY_CONTRACT)
      : loadSecurityContract(input.contract);
  if (!loaded.ok) {
    return { ok: false, errors: [loaded.error], mutations: runContractMutationTests() };
  }
  const invariants = validateContractInvariants(loaded.contract);
  if (!invariants.ok) {
    errors.push(formatInvariant(invariants.reason));
  }
  if (input.manifest !== undefined) {
    const manifest = validateComponentManifest(input.manifest, loaded.contract);
    if (!manifest.ok) {
      errors.push(formatManifestError(manifest));
    }
  }
  for (const [index, record] of (input.auditRecords ?? []).entries()) {
    const audit = validateAuditRecord(record, loaded.contract);
    if (!audit.ok) {
      errors.push(`audit[${index}]:${formatAuditError(audit)}`);
    }
  }
  const mutations = runContractMutationTests(loaded.contract);
  for (const mutation of mutations) {
    if (!mutation.detected) {
      errors.push(`mutation-not-detected:${mutation.id}`);
    }
  }
  return errors.length === 0 ? { ok: true, mutations } : { ok: false, errors, mutations };
}

function formatInvariant(error: ContractInvariantError): string {
  switch (error.error) {
    case "missing-profile":
      return `missing-profile:${error.profile}`;
    case "missing-required-control":
      return `missing-required-control:${error.profile}:${error.control}`;
    case "missing-secret-class":
      return `missing-secret-class:${error.secretClass}`;
    case "missing-output-boundary":
      return `missing-output-boundary:${error.boundary}`;
    case "missing-audit-event":
      return `missing-audit-event:${error.kind}`;
    case "invalid-tls-baseline":
      return `invalid-tls-baseline:${error.detail}`;
    case "invalid-dtls-baseline":
      return `invalid-dtls-baseline:${error.detail}`;
    case "baseline-mismatch":
      return `baseline-mismatch:${error.detail}`;
  }
}

function formatManifestError(error: ManifestValidationResult): string {
  if (error.ok) {
    return "valid";
  }
  switch (error.error) {
    case "missing-required-control":
      return `missing-required-control:${error.profile}:${error.control}`;
    case "unknown-transport-profile":
      return "unknown-transport-profile";
    case "forbidden-fallback":
      return `forbidden-fallback:${error.profile}:${error.fallback}`;
    case "unsupported-manifest-contract-version":
      return "unsupported-manifest-contract-version";
    case "unknown-output-boundary":
      return "unknown-output-boundary";
    case "unknown-validation-stage":
      return "unknown-validation-stage";
    case "invalid-manifest":
      return "invalid-manifest";
  }
}

function formatAuditError(error: AuditValidationResult): string {
  if (error.ok) {
    return "valid";
  }
  switch (error.error) {
    case "missing-audit-field":
      return `missing-audit-field:${error.kind}:${error.field}`;
    case "unknown-audit-kind":
      return "unknown-audit-kind";
    case "unexpected-audit-field":
      return `unexpected-audit-field:${error.kind}`;
    case "invalid-audit-field":
      return `invalid-audit-field:${error.kind}:${error.field}`;
    case "invalid-audit-decision":
      return `invalid-audit-decision:${error.kind}`;
    case "invalid-audit-result":
      return `invalid-audit-result:${error.kind}`;
    case "invalid-audit-stage":
      return `invalid-audit-stage:${error.kind}`;
    case "invalid-audit-outcome":
      return `invalid-audit-outcome:${error.kind}`;
    case "invalid-audit-record":
      return "invalid-audit-record";
  }
}
