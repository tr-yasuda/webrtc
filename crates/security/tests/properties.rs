use proptest::prelude::*;
use serde_json::json;
use webrtc_security::output::{RedactionOptions, redact_unknown};
use webrtc_security::secret::secret;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_000))]

    #[test]
    fn secret_values_do_not_change_public_output(first in ".*", second in ".*") {
        let left = redact_unknown(
            &json!({
                "projectId": "project-1",
                "count": 1,
                "token": format!("SYNTHETIC_SECRET_{first}"),
                "nested": { "password": format!("SYNTHETIC_SECRET_{first}") }
            }),
            &RedactionOptions::default(),
        );
        let right = redact_unknown(
            &json!({
                "projectId": "project-1",
                "count": 1,
                "token": format!("SYNTHETIC_SECRET_{second}"),
                "nested": { "password": format!("SYNTHETIC_SECRET_{second}") }
            }),
            &RedactionOptions::default(),
        );
        prop_assert_eq!(left, right);
    }

    #[test]
    fn secret_debug_is_non_interfering(first in ".*", second in ".*") {
        let left = format!("{:?}", secret(format!("SYNTHETIC_SECRET_{first}")));
        let right = format!("{:?}", secret(format!("SYNTHETIC_SECRET_{second}")));
        prop_assert_eq!(left, right);
    }

    #[test]
    fn synthetic_secret_marker_is_not_emitted(value in ".*") {
        let marker = "SYNTHETIC_SECRET_MARKER";
        let output = redact_unknown(
            &json!({
                "projectId": "project-1",
                "token": format!("{marker}_{value}"),
                "body": format!("{marker}_{value}")
            }),
            &RedactionOptions::default(),
        );
        prop_assert!(!output.to_string().contains(marker));
    }
}
