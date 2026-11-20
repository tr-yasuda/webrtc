#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct InvalidDomainId;

const ID_BODY_LENGTH: usize = 26;

fn is_valid_ulid(value: &str) -> bool {
    value.len() == ID_BODY_LENGTH
        && value.bytes().all(|byte| {
            byte.is_ascii_digit()
                || (byte.is_ascii_uppercase() && !matches!(byte, b'I' | b'L' | b'O' | b'U'))
        })
}

macro_rules! domain_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: &str) -> Result<Self, InvalidDomainId> {
                if !is_valid_ulid(value) {
                    return Err(InvalidDomainId);
                }

                Ok(Self(value.to_owned()))
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    pub id: ProjectId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: AccountId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectUser {
    pub id: ProjectUserId,
    pub project_id: ProjectId,
    pub account_id: AccountId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Application {
    pub id: ApplicationId,
    pub project_id: ProjectId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationSigningKey {
    pub id: ApplicationSigningKeyId,
    pub application_id: ApplicationId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagementApiCredential {
    pub id: ManagementApiCredentialId,
    pub project_id: ProjectId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Room {
    pub id: RoomId,
    pub project_id: ProjectId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participant {
    pub id: ParticipantId,
    pub room_id: RoomId,
}

pub type Member = Participant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipantDevice {
    pub id: ParticipantDeviceId,
    pub participant_id: ParticipantId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ConnectionState {
    Connecting,
    Connected,
    Reconnecting,
    Failed,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceState {
    Reserved,
    InUse,
    ReleasePending,
    Isolated,
    Released,
    ResultUnknown,
}
