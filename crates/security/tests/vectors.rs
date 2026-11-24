use serde_json::{Value, json};
use webrtc_security::audit::validate_audit_record;
use webrtc_security::conformance::run_conformance;
use webrtc_security::contract::{ContractError, load_contract_value};
use webrtc_security::output::{RedactionOptions, SafeLogEvent, redact_unknown, to_public_error};
use webrtc_security::transport::validate_component_manifest;
use webrtc_security::validation::{FieldSegment, sanitize_field_path};

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../../specs/security/vectors.json"))
        .expect("vectors must be valid JSON")
}

fn contract() -> webrtc_security::contract::SecurityContract {
    webrtc_security::security_contract().expect("contract must parse")
}

fn contract_error_value(error: ContractError) -> Value {
    match error {
        ContractError::Missing => json!({ "error": "contract-missing" }),
        ContractError::UnsupportedVersion(version) => {
            json!({ "error": "unsupported-contract-version", "version": version })
        }
        ContractError::Invalid => json!({ "error": "invalid-contract" }),
    }
}

#[test]
fn redaction_vectors() {
    for case in vectors()["redaction"].as_array().expect("redaction array") {
        let output = redact_unknown(&case["input"], &RedactionOptions::default());
        assert_eq!(output, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn public_error_vectors() {
    for case in vectors()["publicErrors"]
        .as_array()
        .expect("public error array")
    {
        let output = to_public_error(&case["input"]).expect("public error must parse");
        assert_eq!(
            serde_json::to_value(output).expect("public error must serialize"),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}

#[test]
fn field_path_vectors() {
    for case in vectors()["fieldPaths"]
        .as_array()
        .expect("field path array")
    {
        let path: Vec<FieldSegment> =
            serde_json::from_value(case["path"].clone()).expect("path must parse");
        let allowed: Vec<String> = serde_json::from_value(case["allowedFields"].clone())
            .expect("allowed fields must parse");
        let expected: Vec<String> =
            serde_json::from_value(case["expected"].clone()).expect("expected path must parse");
        assert_eq!(
            sanitize_field_path(&path, &allowed),
            expected,
            "{}",
            case["id"]
        );
    }
}

#[test]
fn transport_vectors() {
    let contract = contract();
    for case in vectors()["transport"].as_array().expect("transport array") {
        let result = validate_component_manifest(&case["manifest"], &contract);
        match (&case["expected"], result) {
            (Value::String(expected), Ok(())) if expected == "valid" => {}
            (expected, Err(error)) => {
                assert_eq!(
                    serde_json::to_value(error).expect("manifest error must serialize"),
                    *expected,
                    "{}",
                    case["id"]
                );
            }
            (expected, Ok(())) => panic!("expected {expected}, got valid for {}", case["id"]),
        }
    }
}

#[test]
fn audit_vectors() {
    let contract = contract();
    for case in vectors()["audit"].as_array().expect("audit array") {
        let result = validate_audit_record(&case["record"], &contract);
        match (&case["expected"], result) {
            (Value::String(expected), Ok(())) if expected == "valid" => {}
            (expected, Err(error)) => {
                assert_eq!(
                    serde_json::to_value(error).expect("audit error must serialize"),
                    *expected,
                    "{}",
                    case["id"]
                );
            }
            (expected, Ok(())) => panic!("expected {expected}, got valid for {}", case["id"]),
        }
    }
}

#[test]
fn contract_vectors() {
    for case in vectors()["contract"].as_array().expect("contract array") {
        let result = load_contract_value(Some(&case["input"]));
        match result {
            Ok(_) => panic!("expected contract error for {}", case["id"]),
            Err(error) => assert_eq!(
                contract_error_value(error),
                case["expected"],
                "{}",
                case["id"]
            ),
        }
    }
}

#[test]
fn incomplete_or_weakened_contract_is_rejected() {
    assert!(matches!(
        load_contract_value(Some(&json!({ "version": 1 }))),
        Err(ContractError::Invalid)
    ));

    let mut weakened = serde_json::to_value(contract()).expect("contract must serialize");
    weakened["tls"]["tls12"]["prohibited"] = json!(["RSA_KEY_EXCHANGE", "NULL"]);
    assert!(matches!(
        load_contract_value(Some(&weakened)),
        Err(ContractError::Invalid)
    ));

    weakened["tls"]["tls12"]["prohibited"] = json!(["CBC", "NULL"]);
    weakened["baseline"]["tls"]["tls12Prohibited"] = json!(["CBC", "NULL"]);
    assert!(matches!(
        load_contract_value(Some(&weakened)),
        Err(ContractError::Invalid)
    ));
}

#[test]
fn safe_log_event_rejects_sensitive_attributes_and_limits() {
    for key in ["token", "email", "sdp"] {
        let mut attributes = serde_json::Map::new();
        attributes.insert(key.to_string(), Value::String("SYNTHETIC_SECRET".into()));
        let value = json!({
            "event": "room.joined",
            "component": "signaling",
            "attributes": attributes
        });
        assert!(
            serde_json::from_value::<SafeLogEvent>(value).is_err(),
            "{key}"
        );
    }
    let too_long = json!({
        "event": "room.joined",
        "component": "signaling",
        "attributes": { "value": "x".repeat(1025) }
    });
    assert!(serde_json::from_value::<SafeLogEvent>(too_long).is_err());
    let valid = json!({
        "event": "room.joined",
        "component": "signaling",
        "attributes": { "roomId": "r1", "flags": ["a", "b"] }
    });
    assert!(serde_json::from_value::<SafeLogEvent>(valid).is_ok());
}

#[test]
fn conformance_errors_do_not_reflect_input_values() {
    let result = run_conformance(
        None,
        Some(&json!({
            "component": "@example/control",
            "contractVersion": 1,
            "profiles": [{ "id": "SYNTHETIC_SECRET_PROFILE", "controls": [] }],
            "outputBoundaries": [],
            "validationStages": []
        })),
        &[json!({ "kind": "SYNTHETIC_SECRET_KIND" })],
    );
    assert!(!result.ok);
    assert!(
        !result
            .errors
            .iter()
            .any(|error| error.contains("SYNTHETIC_SECRET")),
        "{:?}",
        result.errors
    );
}
