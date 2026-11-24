use std::collections::{BTreeMap, HashSet};

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::contract::{Redaction, canonical_contract};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum SafeLogScalar {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum SafeLogValue {
    Scalar(SafeLogScalar),
    Array(Vec<SafeLogScalar>),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SafeLogEvent {
    pub event: String,
    pub component: String,
    pub correlation_id: Option<String>,
    pub attributes: BTreeMap<String, SafeLogValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicError {
    pub code: String,
    pub message_key: String,
    pub retryable: bool,
    pub target_ids: Option<Vec<String>>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputError {
    InvalidPublicError,
    InvalidSafeLogEvent,
    ContractUnavailable,
}

impl std::fmt::Display for OutputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPublicError => write!(formatter, "invalid-public-error"),
            Self::InvalidSafeLogEvent => write!(formatter, "invalid-safe-log-event"),
            Self::ContractUnavailable => write!(formatter, "contract-unavailable"),
        }
    }
}

impl std::error::Error for OutputError {}

#[derive(Debug, Clone, Default)]
pub struct RedactionOptions {
    pub sensitive_keys: Option<Vec<String>>,
    pub marker: Option<String>,
    pub max_depth: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSafeLogEvent {
    event: String,
    component: String,
    correlation_id: Option<String>,
    attributes: BTreeMap<String, Value>,
}

impl<'de> Deserialize<'de> for SafeLogEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawSafeLogEvent::deserialize(deserializer)?;
        let mut attributes = BTreeMap::new();
        for (key, value) in raw.attributes {
            let parsed = serde_json::from_value::<SafeLogValue>(value)
                .map_err(|_| D::Error::custom("invalid-safe-log-event"))?;
            attributes.insert(key, parsed);
        }
        let event = Self {
            event: raw.event,
            component: raw.component,
            correlation_id: raw.correlation_id,
            attributes,
        };
        validate_safe_log_event(&event).map_err(D::Error::custom)?;
        Ok(event)
    }
}

impl SafeLogEvent {
    pub fn create(
        event: String,
        component: String,
        correlation_id: Option<String>,
        attributes: BTreeMap<String, SafeLogValue>,
    ) -> Result<Self, OutputError> {
        let event = Self {
            event,
            component,
            correlation_id,
            attributes,
        };
        validate_safe_log_event(&event)?;
        Ok(event)
    }
}

pub fn create_safe_log_event(
    event: String,
    component: String,
    correlation_id: Option<String>,
    attributes: BTreeMap<String, SafeLogValue>,
) -> Result<SafeLogEvent, OutputError> {
    SafeLogEvent::create(event, component, correlation_id, attributes)
}

fn redaction() -> Result<&'static Redaction, OutputError> {
    canonical_contract()
        .map(|contract| &contract.redaction)
        .ok_or(OutputError::ContractUnavailable)
}

fn sensitive_keys(redaction: &Redaction, options: Option<&[String]>) -> HashSet<String> {
    redaction
        .sensitive_keys
        .iter()
        .chain(options.into_iter().flatten())
        .map(|key| key.to_lowercase())
        .collect()
}

fn scalar_is_within_limits(value: &SafeLogScalar, max_string_length: usize) -> bool {
    match value {
        SafeLogScalar::String(text) => text.len() <= max_string_length,
        SafeLogScalar::Number(number) => number.is_finite(),
        SafeLogScalar::Null | SafeLogScalar::Bool(_) => true,
    }
}

fn value_is_within_limits(
    value: &SafeLogValue,
    max_items: usize,
    max_string_length: usize,
) -> bool {
    match value {
        SafeLogValue::Scalar(scalar) => scalar_is_within_limits(scalar, max_string_length),
        SafeLogValue::Array(items) => {
            items.len() <= max_items
                && items
                    .iter()
                    .all(|item| scalar_is_within_limits(item, max_string_length))
        }
    }
}

fn validate_safe_log_event(event: &SafeLogEvent) -> Result<(), OutputError> {
    let redaction = redaction()?;
    let max_items = redaction.max_items as usize;
    let max_string_length = redaction.max_string_length as usize;
    if event.event.trim().is_empty()
        || event.event.len() > max_string_length
        || event.component.trim().is_empty()
        || event.component.len() > max_string_length
        || event
            .correlation_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.len() > max_string_length)
        || event.attributes.len() > max_items
    {
        return Err(OutputError::InvalidSafeLogEvent);
    }
    let sensitive = sensitive_keys(redaction, None);
    for (key, value) in &event.attributes {
        if key.trim().is_empty()
            || key.len() > max_string_length
            || sensitive.contains(&key.to_lowercase())
            || !value_is_within_limits(value, max_items, max_string_length)
        {
            return Err(OutputError::InvalidSafeLogEvent);
        }
    }
    Ok(())
}

pub fn to_public_error(value: &Value) -> Result<PublicError, OutputError> {
    let object = value.as_object().ok_or(OutputError::InvalidPublicError)?;
    let redaction = redaction()?;
    let max_items = redaction.max_items as usize;
    let max_string_length = redaction.max_string_length as usize;
    let code = object
        .get("code")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= max_string_length)
        .ok_or(OutputError::InvalidPublicError)?;
    let message_key = object
        .get("messageKey")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= max_string_length)
        .ok_or(OutputError::InvalidPublicError)?;
    let retryable = object
        .get("retryable")
        .and_then(Value::as_bool)
        .ok_or(OutputError::InvalidPublicError)?;
    let target_ids = match object.get("targetIds") {
        None | Some(Value::Null) => None,
        Some(Value::Array(items)) if items.len() <= max_items => {
            let mut target_ids = Vec::with_capacity(items.len());
            for item in items {
                let target_id = item
                    .as_str()
                    .filter(|value| !value.trim().is_empty() && value.len() <= max_string_length)
                    .ok_or(OutputError::InvalidPublicError)?;
                target_ids.push(target_id.to_string());
            }
            Some(target_ids)
        }
        Some(_) => return Err(OutputError::InvalidPublicError),
    };
    let correlation_id = match object.get("correlationId") {
        None | Some(Value::Null) => None,
        Some(Value::String(value))
            if !value.trim().is_empty() && value.len() <= max_string_length =>
        {
            Some(value.clone())
        }
        Some(_) => return Err(OutputError::InvalidPublicError),
    };
    Ok(PublicError {
        code: code.to_string(),
        message_key: message_key.to_string(),
        retryable,
        target_ids,
        correlation_id,
    })
}

pub fn redact_unknown(value: &Value, options: &RedactionOptions) -> Value {
    let fallback_marker = options
        .marker
        .clone()
        .unwrap_or_else(|| "[REDACTED]".to_string());
    let Some(redaction) = canonical_contract().map(|contract| &contract.redaction) else {
        return Value::String(fallback_marker);
    };
    let sensitive = sensitive_keys(redaction, options.sensitive_keys.as_deref());
    let marker = options
        .marker
        .clone()
        .unwrap_or_else(|| redaction.marker.clone());
    let max_depth = options.max_depth.unwrap_or(redaction.max_depth);
    visit(
        value,
        0,
        max_depth,
        &sensitive,
        &marker,
        redaction.max_items as usize,
        redaction.max_string_length as usize,
    )
}

#[allow(clippy::too_many_arguments)]
fn visit(
    value: &Value,
    depth: u32,
    max_depth: u32,
    sensitive: &HashSet<String>,
    marker: &str,
    max_items: usize,
    max_string_length: usize,
) -> Value {
    if depth >= max_depth {
        return Value::String(marker.to_string());
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::String(text) => {
            if text.len() <= max_string_length {
                value.clone()
            } else {
                Value::String(marker.to_string())
            }
        }
        Value::Array(items) => {
            if items.len() > max_items {
                return Value::String(marker.to_string());
            }
            Value::Array(
                items
                    .iter()
                    .map(|item| {
                        visit(
                            item,
                            depth + 1,
                            max_depth,
                            sensitive,
                            marker,
                            max_items,
                            max_string_length,
                        )
                    })
                    .collect(),
            )
        }
        Value::Object(object) => {
            if object.len() > max_items {
                return Value::String(marker.to_string());
            }
            let mut redacted = Map::new();
            for (key, entry) in object {
                if sensitive.contains(&key.to_lowercase()) {
                    redacted.insert(key.clone(), Value::String(marker.to_string()));
                } else {
                    redacted.insert(
                        key.clone(),
                        visit(
                            entry,
                            depth + 1,
                            max_depth,
                            sensitive,
                            marker,
                            max_items,
                            max_string_length,
                        ),
                    );
                }
            }
            Value::Object(redacted)
        }
    }
}
