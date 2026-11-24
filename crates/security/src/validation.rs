use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FieldSegment {
    Key(String),
    Index(i64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationFailure {
    pub code: String,
    pub path: Vec<String>,
    pub limit: Option<String>,
}

const UNKNOWN_KEY: &str = "[unknown-key]";
const TRUNCATED: &str = "[truncated]";
const MAX_PATH_SEGMENTS: usize = 32;

pub fn sanitize_field_path(path: &[FieldSegment], allowed_fields: &[String]) -> Vec<String> {
    let allowed = allowed_fields
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut sanitized = Vec::new();
    for (index, segment) in path.iter().enumerate() {
        if index >= MAX_PATH_SEGMENTS {
            sanitized.push(TRUNCATED.to_string());
            break;
        }
        match segment {
            FieldSegment::Index(value) if *value >= 0 => sanitized.push(value.to_string()),
            FieldSegment::Index(_) => sanitized.push(UNKNOWN_KEY.to_string()),
            FieldSegment::Key(value) if allowed.contains(value.as_str()) => {
                sanitized.push(value.clone());
            }
            FieldSegment::Key(_) => sanitized.push(UNKNOWN_KEY.to_string()),
        }
    }
    sanitized
}
