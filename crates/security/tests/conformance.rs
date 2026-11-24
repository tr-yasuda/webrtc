use serde_json::json;
use webrtc_security::conformance::{run_conformance, run_contract_mutation_tests};

fn contract() -> webrtc_security::contract::SecurityContract {
    webrtc_security::security_contract().expect("contract must parse")
}

fn manifest() -> serde_json::Value {
    json!({
        "component": "@example/control",
        "contractVersion": 1,
        "profiles": [{
            "id": "public-control",
            "controls": [
                "tls",
                "tls-1.2-min",
                "tls-1.3-preferred",
                "aead-only",
                "ecdhe-only",
                "server-certificate-verification",
                "no-plaintext-fallback",
                "no-0-rtt",
                "no-external-psk"
            ]
        }],
        "outputBoundaries": ["log", "audit", "public-error"],
        "validationStages": ["parse", "execution"]
    })
}

fn audit_record() -> serde_json::Value {
    json!({
        "id": "audit-1",
        "kind": "authorization-decision",
        "occurredAt": 1,
        "actor": { "kind": "project-user", "id": "user-1" },
        "operation": "room.delete",
        "target": { "kind": "room", "id": "room-1" },
        "decision": "deny",
        "reason": "insufficient-role",
        "correlationId": "corr-1"
    })
}

#[test]
fn accepts_valid_manifest_and_audit() {
    let result = run_conformance(None, Some(&manifest()), &[audit_record()]);
    assert!(result.ok, "{:?}", result.errors);
}

#[test]
fn rejects_missing_required_control() {
    let mut invalid = manifest();
    invalid["profiles"][0]["controls"] = json!([
        "tls-1.2-min",
        "tls-1.3-preferred",
        "aead-only",
        "ecdhe-only",
        "server-certificate-verification",
        "no-plaintext-fallback",
        "no-0-rtt"
    ]);
    let result = run_conformance(None, Some(&invalid), &[]);
    assert!(!result.ok);
    assert!(
        result
            .errors
            .iter()
            .any(|error| error.contains("missing-required-control")),
        "{:?}",
        result.errors
    );
}

#[test]
fn detects_all_security_critical_contract_mutations() {
    let mutations = run_contract_mutation_tests(&contract());
    assert!(
        mutations.iter().all(|mutation| mutation.detected),
        "{mutations:?}"
    );
}
