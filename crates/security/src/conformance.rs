use serde::Serialize;
use serde_json::Value;

use crate::audit::AuditValidationError;
use crate::audit::validate_audit_record;
use crate::contract::{
    ContractError, SecurityContract, load_contract_value, security_contract,
    validate_contract_invariants,
};
use crate::transport::{ManifestValidationError, validate_component_manifest};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractMutationResult {
    pub id: String,
    pub detected: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConformanceResult {
    pub ok: bool,
    pub errors: Vec<String>,
    pub mutations: Vec<ContractMutationResult>,
}

fn remove_control(value: &mut Value, profile_id: &str, control: &str) {
    let Some(profiles) = value
        .get_mut("transportProfiles")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let Some(profile) = profiles
        .iter_mut()
        .find(|profile| profile.get("id").and_then(Value::as_str) == Some(profile_id))
    else {
        return;
    };
    let Some(controls) = profile
        .get_mut("requiredControls")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    controls.retain(|entry| entry.as_str() != Some(control));
}

fn remove_audit_kind(value: &mut Value, kind: &str) {
    let Some(kinds) = value
        .get_mut("audit")
        .and_then(|audit| audit.get_mut("eventKinds"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    kinds.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(kind));
}

fn remove_audit_field_type(value: &mut Value, kind: &str, field: &str) {
    let Some(kind) = value
        .get_mut("audit")
        .and_then(|audit| audit.get_mut("eventKinds"))
        .and_then(Value::as_array_mut)
        .and_then(|kinds| {
            kinds
                .iter_mut()
                .find(|entry| entry.get("id").and_then(Value::as_str) == Some(kind))
        })
    else {
        return;
    };
    let Some(field_types) = kind.get_mut("fieldTypes").and_then(Value::as_object_mut) else {
        return;
    };
    field_types.remove(field);
}

fn detect_mutation(
    id: &str,
    mutation: impl FnOnce(&mut Value),
    contract: &SecurityContract,
) -> ContractMutationResult {
    let mut value = serde_json::to_value(contract).expect("contract must serialize");
    mutation(&mut value);
    let result = serde_json::from_value::<SecurityContract>(value)
        .map_err(|_| "invalid-mutated-contract".to_string())
        .and_then(|mutated| {
            validate_contract_invariants(&mutated).map_err(|error| format!("{error:?}"))
        });
    ContractMutationResult {
        id: id.to_string(),
        detected: result.is_err(),
        error: result.err(),
    }
}

pub fn run_contract_mutation_tests(contract: &SecurityContract) -> Vec<ContractMutationResult> {
    vec![
        detect_mutation(
            "remove-public-control-tls",
            |value| remove_control(value, "public-control", "tls"),
            contract,
        ),
        detect_mutation(
            "remove-public-control-no-external-psk",
            |value| remove_control(value, "public-control", "no-external-psk"),
            contract,
        ),
        detect_mutation(
            "remove-dplane-peer-credentials",
            |value| remove_control(value, "dplane-ipc", "peer-credentials"),
            contract,
        ),
        detect_mutation(
            "remove-webrtc-media-sframe",
            |value| remove_control(value, "webrtc-media", "sframe-e2ee"),
            contract,
        ),
        detect_mutation(
            "remove-webrtc-data-fingerprint",
            |value| remove_control(value, "webrtc-data", "dtls-fingerprint-verification"),
            contract,
        ),
        detect_mutation(
            "remove-authorization-decision-audit",
            |value| remove_audit_kind(value, "authorization-decision"),
            contract,
        ),
        detect_mutation(
            "remove-authorization-decision-field-type",
            |value| remove_audit_field_type(value, "authorization-decision", "actor"),
            contract,
        ),
        detect_mutation(
            "enable-tls13-zero-rtt",
            |value| {
                if let Some(tls13) = value
                    .get_mut("tls")
                    .and_then(|tls| tls.get_mut("tls13"))
                    .and_then(Value::as_object_mut)
                {
                    tls13.insert("zeroRtt".to_string(), Value::Bool(true));
                }
            },
            contract,
        ),
        detect_mutation(
            "enable-tls13-pure-psk",
            |value| {
                if let Some(psk) = value
                    .get_mut("tls")
                    .and_then(|tls| tls.get_mut("tls13"))
                    .and_then(|tls13| tls13.get_mut("psk"))
                    .and_then(Value::as_object_mut)
                {
                    psk.insert("mode".to_string(), Value::String("psk_ke".to_string()));
                    psk.insert("pskKeAllowed".to_string(), Value::Bool(true));
                }
            },
            contract,
        ),
    ]
}

pub fn run_conformance(
    contract_value: Option<&Value>,
    manifest: Option<&Value>,
    audit_records: &[Value],
) -> ConformanceResult {
    let contract = if let Some(value) = contract_value {
        load_contract_value(Some(value))
    } else {
        security_contract()
    };
    let contract = match contract {
        Ok(contract) => contract,
        Err(error) => {
            return ConformanceResult {
                ok: false,
                errors: vec![format_contract_error(error)],
                mutations: vec![],
            };
        }
    };
    let mut errors = Vec::new();
    if let Err(error) = validate_contract_invariants(&contract) {
        errors.push(format!("{error:?}"));
    }
    if let Some(manifest) = manifest
        && let Err(error) = validate_component_manifest(manifest, &contract)
    {
        errors.push(format_manifest_error(error));
    }
    for (index, record) in audit_records.iter().enumerate() {
        if let Err(error) = validate_audit_record(record, &contract) {
            errors.push(format!("audit[{index}]:{}", format_audit_error(error)));
        }
    }
    let mutations = run_contract_mutation_tests(&contract);
    for mutation in &mutations {
        if !mutation.detected {
            errors.push(format!("mutation-not-detected:{}", mutation.id));
        }
    }
    ConformanceResult {
        ok: errors.is_empty(),
        errors,
        mutations,
    }
}

fn format_contract_error(error: ContractError) -> String {
    error.to_string()
}

fn format_manifest_error(error: ManifestValidationError) -> String {
    match error {
        ManifestValidationError::InvalidManifest => "invalid-manifest".to_string(),
        ManifestValidationError::UnsupportedManifestContractVersion { .. } => {
            "unsupported-manifest-contract-version".to_string()
        }
        ManifestValidationError::UnknownTransportProfile { .. } => {
            "unknown-transport-profile".to_string()
        }
        ManifestValidationError::MissingRequiredControl { profile, control } => {
            format!("missing-required-control:{profile}:{control}")
        }
        ManifestValidationError::ForbiddenFallback { profile, fallback } => {
            format!("forbidden-fallback:{profile}:{fallback}")
        }
        ManifestValidationError::UnknownOutputBoundary { .. } => {
            "unknown-output-boundary".to_string()
        }
        ManifestValidationError::UnknownValidationStage { .. } => {
            "unknown-validation-stage".to_string()
        }
    }
}

fn format_audit_error(error: AuditValidationError) -> String {
    match error {
        AuditValidationError::InvalidAuditRecord => "invalid-audit-record".to_string(),
        AuditValidationError::UnknownAuditKind => "unknown-audit-kind".to_string(),
        AuditValidationError::MissingAuditField { kind, field } => {
            format!("missing-audit-field:{kind}:{field}")
        }
        AuditValidationError::UnexpectedAuditField { kind } => {
            format!("unexpected-audit-field:{kind}")
        }
        AuditValidationError::InvalidAuditField { kind, field } => {
            format!("invalid-audit-field:{kind}:{field}")
        }
        AuditValidationError::InvalidAuditDecision { kind } => {
            format!("invalid-audit-decision:{kind}")
        }
        AuditValidationError::InvalidAuditResult { kind } => {
            format!("invalid-audit-result:{kind}")
        }
        AuditValidationError::InvalidAuditStage { kind } => {
            format!("invalid-audit-stage:{kind}")
        }
        AuditValidationError::InvalidAuditOutcome { kind } => {
            format!("invalid-audit-outcome:{kind}")
        }
    }
}
