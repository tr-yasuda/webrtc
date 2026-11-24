// Generated from specs/security/contract.json. Do not edit by hand.
#[rustfmt::skip]
pub const SECURITY_CONTRACT_JSON: &str = include_str!("../../../specs/security/contract.json");
#[rustfmt::skip]
pub const SECURITY_CONTRACT_VERSION: u64 = 1;
#[rustfmt::skip]
pub const TRANSPORT_PROFILE_IDS: &[&str] = &["public-control", "internal-service", "dplane-ipc", "turn", "webrtc-media", "webrtc-data", "stun-binding"];
#[rustfmt::skip]
pub const OUTPUT_BOUNDARY_IDS: &[&str] = &["log", "audit", "public-error", "url", "diagnostic", "test-output"];
#[rustfmt::skip]
pub const AUDIT_EVENT_KINDS: &[&str] = &["authorization-decision", "operation-result", "request-rejected", "resource"];
#[rustfmt::skip]
pub const VALIDATION_STAGE_IDS: &[&str] = &["pre-parse", "parse", "post-parse", "decompress-reassemble", "execution"];
