use ulid::Ulid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct InvalidDomainId;

macro_rules! domain_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: &str) -> Result<Self, InvalidDomainId> {
                let canonical = value.to_ascii_uppercase();
                let ulid = Ulid::from_string(&canonical).map_err(|_| InvalidDomainId)?;
                if ulid.to_string() != canonical {
                    return Err(InvalidDomainId);
                }

                Ok(Self(canonical))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

domain_id!(ProjectId);
domain_id!(AccountId);
domain_id!(ProjectUserId);
domain_id!(ApplicationId);
domain_id!(ApplicationSigningKeyId);
domain_id!(ManagementApiCredentialId);
domain_id!(RoomId);
domain_id!(ParticipantId);
domain_id!(ParticipantDeviceId);

pub type MemberId = ParticipantId;
