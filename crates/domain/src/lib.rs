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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: AccountId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectUser {
    pub id: ProjectUserId,
    pub project_id: ProjectId,
    pub account_id: AccountId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Application {
    pub id: ApplicationId,
    pub project_id: ProjectId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationSigningKey {
    pub id: ApplicationSigningKeyId,
    pub application_id: ApplicationId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagementApiCredential {
    pub id: ManagementApiCredentialId,
    pub project_id: ProjectId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Room {
    pub id: RoomId,
    pub project_id: ProjectId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participant {
    pub id: ParticipantId,
    pub room_id: RoomId,
    pub name: String,
}

pub type Member = Participant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipantDevice {
    pub id: ParticipantDeviceId,
    pub participant_id: ParticipantId,
    pub name: String,
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
