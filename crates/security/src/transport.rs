use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contract::SecurityContract;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportProfileDeclaration {
    pub id: String,
    pub controls: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSecurityManifest {
    pub component: String,
    pub contract_version: u64,
    pub profiles: Vec<TransportProfileDeclaration>,
    pub output_boundaries: Vec<String>,
    pub validation_stages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "error", rename_all = "kebab-case")]
pub enum ManifestValidationError {
    InvalidManifest,
    UnsupportedManifestContractVersion { expected: u64, actual: Value },
    UnknownTransportProfile { profile: String },
    MissingRequiredControl { profile: String, control: String },
    ForbiddenFallback { profile: String, fallback: String },
    UnknownOutputBoundary { boundary: String },
    UnknownValidationStage { stage: String },
}

pub type ManifestValidationResult = Result<(), ManifestValidationError>;

pub fn validate_component_manifest(
    value: &Value,
    contract: &SecurityContract,
) -> ManifestValidationResult {
    let manifest: ComponentSecurityManifest = serde_json::from_value(value.clone())
        .map_err(|_| ManifestValidationError::InvalidManifest)?;
    if manifest.contract_version != contract.version {
        return Err(
            ManifestValidationError::UnsupportedManifestContractVersion {
                expected: contract.version,
                actual: Value::from(manifest.contract_version),
            },
        );
    }
    for declaration in &manifest.profiles {
        let profile = contract
            .transport_profiles
            .iter()
            .find(|entry| entry.id == declaration.id)
            .ok_or_else(|| ManifestValidationError::UnknownTransportProfile {
                profile: declaration.id.clone(),
            })?;
        for control in &profile.required_controls {
            if !declaration.controls.iter().any(|value| value == control) {
                return Err(ManifestValidationError::MissingRequiredControl {
                    profile: declaration.id.clone(),
                    control: control.clone(),
                });
            }
        }
        for fallback in &profile.forbidden_fallbacks {
            if declaration.controls.iter().any(|value| value == fallback) {
                return Err(ManifestValidationError::ForbiddenFallback {
                    profile: declaration.id.clone(),
                    fallback: fallback.clone(),
                });
            }
        }
    }
    for boundary in &manifest.output_boundaries {
        if !contract
            .output_boundaries
            .iter()
            .any(|entry| &entry.id == boundary)
        {
            return Err(ManifestValidationError::UnknownOutputBoundary {
                boundary: boundary.clone(),
            });
        }
    }
    for stage in &manifest.validation_stages {
        if !contract
            .validation_stages
            .iter()
            .any(|entry| &entry.id == stage)
        {
            return Err(ManifestValidationError::UnknownValidationStage {
                stage: stage.clone(),
            });
        }
    }
    Ok(())
}
