use std::fmt;
use ulid::Ulid;

pub const MAX_OPAQUE_ID_LENGTH: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidOpaqueId {
    pub type_name: &'static str,
}

impl fmt::Display for InvalidOpaqueId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} must be 1-{MAX_OPAQUE_ID_LENGTH} non-whitespace characters",
            self.type_name
        )
    }
}

impl std::error::Error for InvalidOpaqueId {}

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self, InvalidOpaqueId> {
                let value = value.into();
                if value.is_empty()
                    || value.chars().count() > MAX_OPAQUE_ID_LENGTH
                    || value.trim().is_empty()
                {
                    return Err(InvalidOpaqueId {
                        type_name: stringify!($name),
                    });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

opaque_id!(ReservationId);
opaque_id!(ResourceId);
opaque_id!(OperationId);
opaque_id!(WorkerId);
opaque_id!(BootId);
opaque_id!(ReconciliationJobId);

impl ReservationId {
    pub fn new() -> Self {
        Self(Ulid::generate().to_string())
    }
}

impl Default for ReservationId {
    fn default() -> Self {
        Self::new()
    }
}

impl ResourceId {
    pub fn new() -> Self {
        Self(Ulid::generate().to_string())
    }
}

impl Default for ResourceId {
    fn default() -> Self {
        Self::new()
    }
}

impl OperationId {
    pub fn new() -> Self {
        Self(Ulid::generate().to_string())
    }
}

impl ReconciliationJobId {
    pub fn new() -> Self {
        Self(Ulid::generate().to_string())
    }
}

impl Default for ReconciliationJobId {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for OperationId {
    fn default() -> Self {
        Self::new()
    }
}
