use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::generated::{SECURITY_CONTRACT_JSON, SECURITY_CONTRACT_VERSION};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityContract {
    pub version: u64,
    pub tls: TlsContract,
    pub dtls: DtlsContract,
    pub baseline: SecurityBaseline,
    pub secret_classes: Vec<SecretClass>,
    pub redaction: Redaction,
    pub output_boundaries: Vec<OutputBoundary>,
    pub transport_profiles: Vec<TransportProfile>,
    pub audit: AuditContract,
    pub validation_stages: Vec<ValidationStage>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TlsContract {
    pub prohibited_versions: Vec<String>,
    pub tls12: Tls12Contract,
    pub tls13: Tls13Contract,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tls12Contract {
    pub min_version: String,
    pub key_exchange: Vec<String>,
    pub cipher_kinds: Vec<String>,
    pub prohibited: Vec<String>,
    pub session_resumption: bool,
    pub require_authentication_on_resumption: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tls13Contract {
    pub min_version: String,
    pub key_exchange: Vec<String>,
    pub groups: Vec<String>,
    pub psk: PskContract,
    pub session_resumption: bool,
    pub require_authentication_on_resumption: bool,
    pub zero_rtt: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PskContract {
    pub allowed: bool,
    pub mode: String,
    pub external_psk_requires_explicit_config: bool,
    pub psk_ke_allowed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DtlsContract {
    pub supported_versions: Vec<String>,
    pub preferred_version: String,
    pub prohibited_versions: Vec<String>,
    pub plaintext_fallback: bool,
    pub webrtc_dtls12_renegotiation: bool,
    pub require_certificate_fingerprint_verification: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityBaseline {
    pub transport_profiles: BTreeMap<String, Vec<String>>,
    pub forbidden_fallbacks: BTreeMap<String, Vec<String>>,
    pub secret_classes: Vec<String>,
    pub output_boundaries: Vec<String>,
    pub audit_event_kinds: Vec<String>,
    pub validation_stages: Vec<String>,
    pub tls: BaselineTls,
    pub dtls: BaselineDtls,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaselineTls {
    pub prohibited_versions: Vec<String>,
    pub tls12_key_exchange: Vec<String>,
    pub tls12_cipher_kinds: Vec<String>,
    pub tls12_prohibited: Vec<String>,
    pub tls13_key_exchange: Vec<String>,
    pub tls13_groups: Vec<String>,
    pub zero_rtt: bool,
    pub psk_mode: String,
    pub psk_ke_allowed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDtls {
    pub supported_versions: Vec<String>,
    pub preferred_version: String,
    pub prohibited_versions: Vec<String>,
    pub plaintext_fallback: bool,
    pub webrtc_dtls12_renegotiation: bool,
    pub require_certificate_fingerprint_verification: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretClass {
    pub id: String,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Redaction {
    pub sensitive_keys: Vec<String>,
    pub marker: String,
    pub max_depth: u32,
    pub max_items: u32,
    pub max_string_length: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputBoundary {
    pub id: String,
    pub allowed_types: Vec<String>,
    pub forbidden_classes: Vec<String>,
    pub redaction_fallback: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransportProfile {
    pub id: String,
    pub path: String,
    pub required_controls: Vec<String>,
    pub forbidden_fallbacks: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditContract {
    pub actor_kinds: Vec<String>,
    pub event_kinds: Vec<AuditEventKind>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventKind {
    pub id: String,
    pub required_fields: Vec<String>,
    pub field_types: BTreeMap<String, String>,
    pub decision_values: Option<Vec<String>>,
    pub result_values: Option<Vec<String>>,
    pub stage_values: Option<Vec<String>>,
    pub outcome_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationStage {
    pub id: String,
    pub required_responsibilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractError {
    Missing,
    UnsupportedVersion(u64),
    Invalid,
}

impl std::fmt::Display for ContractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(formatter, "contract-missing"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported-contract-version:{version}")
            }
            Self::Invalid => write!(formatter, "invalid-contract"),
        }
    }
}

impl std::error::Error for ContractError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractInvariantError {
    MissingProfile(String),
    MissingRequiredControl { profile: String, control: String },
    MissingSecretClass(String),
    MissingOutputBoundary(String),
    MissingAuditEvent(String),
    InvalidTlsBaseline(String),
    InvalidDtlsBaseline(String),
    BaselineMismatch(String),
}

pub(crate) fn canonical_contract() -> Option<&'static SecurityContract> {
    static CACHE: OnceLock<Option<SecurityContract>> = OnceLock::new();
    CACHE
        .get_or_init(|| serde_json::from_str(SECURITY_CONTRACT_JSON).ok())
        .as_ref()
}

pub fn security_contract() -> Result<SecurityContract, ContractError> {
    canonical_contract().cloned().ok_or(ContractError::Invalid)
}

pub fn load_contract_value(value: Option<&Value>) -> Result<SecurityContract, ContractError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Err(ContractError::Missing);
    };
    let version = value
        .as_object()
        .and_then(|object| object.get("version"))
        .and_then(Value::as_u64)
        .ok_or(ContractError::Invalid)?;
    if version != SECURITY_CONTRACT_VERSION {
        return Err(ContractError::UnsupportedVersion(version));
    }
    let contract = serde_json::from_value::<SecurityContract>(value.clone())
        .map_err(|_| ContractError::Invalid)?;
    let canonical = canonical_contract().ok_or(ContractError::Invalid)?;
    if &contract != canonical {
        return Err(ContractError::Invalid);
    }
    Ok(contract)
}

pub fn validate_contract_invariants(
    contract: &SecurityContract,
) -> Result<(), ContractInvariantError> {
    let canonical = canonical_contract().ok_or_else(|| {
        ContractInvariantError::BaselineMismatch("canonical-contract-unavailable".to_string())
    })?;
    if contract.baseline != canonical.baseline {
        return Err(ContractInvariantError::BaselineMismatch(
            "baseline".to_string(),
        ));
    }
    let baseline = &canonical.baseline;
    for (profile_id, controls) in &baseline.transport_profiles {
        let profile = contract
            .transport_profiles
            .iter()
            .find(|entry| entry.id == *profile_id)
            .ok_or_else(|| ContractInvariantError::MissingProfile(profile_id.clone()))?;
        if !same_string_set(&profile.required_controls, controls) {
            return Err(ContractInvariantError::BaselineMismatch(format!(
                "profile-controls:{profile_id}"
            )));
        }
        if !same_string_set(
            &profile.forbidden_fallbacks,
            baseline
                .forbidden_fallbacks
                .get(profile_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        ) {
            return Err(ContractInvariantError::BaselineMismatch(format!(
                "profile-fallbacks:{profile_id}"
            )));
        }
    }

    if !contract
        .transport_profiles
        .iter()
        .all(|entry| baseline.transport_profiles.contains_key(&entry.id))
    {
        return Err(ContractInvariantError::BaselineMismatch(
            "unbaselined-profile".to_string(),
        ));
    }

    if !same_string_set(
        &contract
            .secret_classes
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>(),
        &baseline.secret_classes,
    ) {
        return Err(ContractInvariantError::BaselineMismatch(
            "secret-classes".to_string(),
        ));
    }

    if !same_string_set(
        &contract
            .output_boundaries
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>(),
        &baseline.output_boundaries,
    ) {
        return Err(ContractInvariantError::BaselineMismatch(
            "output-boundaries".to_string(),
        ));
    }

    if !same_string_set(
        &contract
            .audit
            .event_kinds
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>(),
        &baseline.audit_event_kinds,
    ) {
        return Err(ContractInvariantError::BaselineMismatch(
            "audit-event-kinds".to_string(),
        ));
    }
    if contract.audit.actor_kinds != canonical.audit.actor_kinds
        || contract.audit.event_kinds != canonical.audit.event_kinds
    {
        return Err(ContractInvariantError::BaselineMismatch(
            "audit-contract".to_string(),
        ));
    }

    if !same_string_set(
        &contract
            .validation_stages
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>(),
        &baseline.validation_stages,
    ) {
        return Err(ContractInvariantError::BaselineMismatch(
            "validation-stages".to_string(),
        ));
    }

    if !same_string_set(
        &contract.tls.prohibited_versions,
        &baseline.tls.prohibited_versions,
    ) || !same_string_set(
        &contract.tls.tls12.key_exchange,
        &baseline.tls.tls12_key_exchange,
    ) || !same_string_set(
        &contract.tls.tls12.cipher_kinds,
        &baseline.tls.tls12_cipher_kinds,
    ) || !same_string_set(
        &contract.tls.tls12.prohibited,
        &baseline.tls.tls12_prohibited,
    ) || !same_string_set(
        &contract.tls.tls13.key_exchange,
        &baseline.tls.tls13_key_exchange,
    ) || !same_string_array(&contract.tls.tls13.groups, &baseline.tls.tls13_groups)
    {
        return Err(ContractInvariantError::InvalidTlsBaseline(
            "TLS baseline mismatch".to_string(),
        ));
    }

    if contract.tls.tls13.zero_rtt != baseline.tls.zero_rtt
        || contract.tls.tls13.psk.mode != baseline.tls.psk_mode
        || contract.tls.tls13.psk.psk_ke_allowed != baseline.tls.psk_ke_allowed
    {
        return Err(ContractInvariantError::InvalidTlsBaseline(
            "TLS 1.3 baseline mismatch".to_string(),
        ));
    }
    if !same_string_array(
        &contract.dtls.supported_versions,
        &baseline.dtls.supported_versions,
    ) || contract.dtls.preferred_version != baseline.dtls.preferred_version
        || !same_string_set(
            &contract.dtls.prohibited_versions,
            &baseline.dtls.prohibited_versions,
        )
        || contract.dtls.plaintext_fallback != baseline.dtls.plaintext_fallback
        || contract.dtls.webrtc_dtls12_renegotiation != baseline.dtls.webrtc_dtls12_renegotiation
        || contract.dtls.require_certificate_fingerprint_verification
            != baseline.dtls.require_certificate_fingerprint_verification
    {
        return Err(ContractInvariantError::InvalidDtlsBaseline(
            "DTLS baseline mismatch".to_string(),
        ));
    }

    Ok(())
}

fn same_string_set(actual: &[String], expected: &[String]) -> bool {
    actual.len() == expected.len() && actual.iter().all(|value| expected.contains(value))
}

fn same_string_array(actual: &[String], expected: &[String]) -> bool {
    actual == expected
}
