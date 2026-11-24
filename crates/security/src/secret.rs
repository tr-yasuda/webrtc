/// A value that must not be serialized or printed without an explicit reveal.
///
/// ```compile_fail
/// let value = webrtc_security::secret(String::from("synthetic"));
/// let _ = serde_json::to_string(&value);
/// ```
#[derive(Clone, Eq, PartialEq)]
pub struct Secret<T>(T);

impl<T> Secret<T> {
    pub fn new(value: T) -> Self {
        Self(value)
    }

    pub fn reveal(&self, purpose: &str) -> &T {
        assert!(
            !purpose.trim().is_empty(),
            "secret reveal purpose is required"
        );
        &self.0
    }
}

impl<T> std::fmt::Debug for Secret<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

impl<T> std::fmt::Display for Secret<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

pub fn secret<T>(value: T) -> Secret<T> {
    Secret::new(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_are_redacted() {
        let value = secret("SYNTHETIC_SECRET");
        assert_eq!(format!("{value:?}"), "[REDACTED]");
        assert_eq!(format!("{value}"), "[REDACTED]");
        assert_eq!(value.reveal("test"), &"SYNTHETIC_SECRET");
    }
}
