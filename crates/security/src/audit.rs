use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contract::SecurityContract;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEnvelope {
    pub id: String,
    pub kind: String,
    pub occurred_at: i64,
    pub recorded_at: Option<i64>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditActor {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditTarget {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationDecisionAuditRecord {
    pub id: String,
    pub kind: String,
    pub occurred_at: i64,
    pub actor: AuditActor,
    pub operation: String,
    pub target: AuditTarget,
    pub decision: String,
    pub reason: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationResultAuditRecord {
    pub id: String,
    pub kind: String,
    pub occurred_at: i64,
    pub actor: AuditActor,
    pub operation: String,
    pub target: AuditTarget,
    pub result: String,
    pub reason: String,
    pub authorization_decision_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestRejectedAuditRecord {
    pub id: String,
    pub kind: String,
    pub occurred_at: i64,
    pub stage: String,
    pub reason: String,
    pub correlation_id: String,
    pub actor: Option<AuditActor>,
    pub target: Option<AuditTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAuditRecord {
    pub id: String,
    pub kind: String,
    pub occurred_at: i64,
    pub recorded_at: i64,
    pub operation_id: Option<String>,
    pub resource_id: Option<String>,
    pub outcome: String,
    pub scopes: Vec<String>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "error", rename_all = "kebab-case")]
pub enum AuditValidationError {
    InvalidAuditRecord,
    UnknownAuditKind,
    MissingAuditField { kind: String, field: String },
    UnexpectedAuditField { kind: String },
    InvalidAuditField { kind: String, field: String },
    InvalidAuditDecision { kind: String },
    InvalidAuditResult { kind: String },
    InvalidAuditStage { kind: String },
    InvalidAuditOutcome { kind: String },
}

fn is_identifier(value: &Value, max_length: usize) -> bool {
    value
        .as_str()
        .is_some_and(|text| !text.trim().is_empty() && text.len() <= max_length)
}

fn is_actor(value: &Value, actor_kinds: &[String], max_length: usize) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 2
        && object.contains_key("kind")
        && object.contains_key("id")
        && object
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|kind| actor_kinds.iter().any(|allowed| allowed == kind))
        && object
            .get("id")
            .is_some_and(|id| is_identifier(id, max_length))
}

fn is_target(value: &Value, max_length: usize) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 2
        && object.contains_key("kind")
        && object.contains_key("id")
        && object
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|kind| !kind.trim().is_empty() && kind.len() <= max_length)
        && object
            .get("id")
            .is_some_and(|id| is_identifier(id, max_length))
}

fn enum_values<'a>(
    definition: &'a crate::contract::AuditEventKind,
    field: &str,
) -> Option<&'a [String]> {
    match field {
        "decision" => definition.decision_values.as_deref(),
        "result" => definition.result_values.as_deref(),
        "stage" => definition.stage_values.as_deref(),
        "outcome" => definition.outcome_values.as_deref(),
        _ => None,
    }
}

fn validate_field(
    value: &Value,
    field_type: &str,
    definition: &crate::contract::AuditEventKind,
    field: &str,
    contract: &SecurityContract,
) -> bool {
    let max_length = contract.redaction.max_string_length as usize;
    match field_type {
        "identifier" | "string" => is_identifier(value, max_length),
        "timestamp" => value.as_u64().is_some(),
        "actor" => is_actor(value, &contract.audit.actor_kinds, max_length),
        "target" => is_target(value, max_length),
        "enum" => value.as_str().is_some_and(|actual| {
            enum_values(definition, field)
                .is_some_and(|values| values.iter().any(|allowed| allowed == actual))
        }),
        "identifier-array" => value.as_array().is_some_and(|items| {
            items.len() <= contract.redaction.max_items as usize
                && items.iter().all(|item| is_identifier(item, max_length))
        }),
        _ => false,
    }
}

pub fn validate_audit_record(
    value: &Value,
    contract: &SecurityContract,
) -> Result<(), AuditValidationError> {
    let object = value
        .as_object()
        .ok_or(AuditValidationError::InvalidAuditRecord)?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(AuditValidationError::InvalidAuditRecord)?
        .to_string();
    let definition = contract
        .audit
        .event_kinds
        .iter()
        .find(|entry| entry.id == kind)
        .ok_or(AuditValidationError::UnknownAuditKind)?;
    for field in &definition.required_fields {
        if !object.contains_key(field) {
            return Err(AuditValidationError::MissingAuditField {
                kind,
                field: field.clone(),
            });
        }
    }
    if object
        .keys()
        .any(|field| !definition.field_types.contains_key(field))
    {
        return Err(AuditValidationError::UnexpectedAuditField { kind });
    }
    for (field, field_type) in &definition.field_types {
        let Some(value) = object.get(field) else {
            continue;
        };
        if validate_field(value, field_type, definition, field, contract) {
            continue;
        }
        if field_type == "enum" {
            return Err(match field.as_str() {
                "decision" => AuditValidationError::InvalidAuditDecision { kind },
                "result" => AuditValidationError::InvalidAuditResult { kind },
                "stage" => AuditValidationError::InvalidAuditStage { kind },
                "outcome" => AuditValidationError::InvalidAuditOutcome { kind },
                _ => AuditValidationError::InvalidAuditField {
                    kind,
                    field: field.clone(),
                },
            });
        }
        return Err(AuditValidationError::InvalidAuditField {
            kind,
            field: field.clone(),
        });
    }
    Ok(())
}
