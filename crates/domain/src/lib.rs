#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct InvalidDomainId;

const ID_BODY_LENGTH: usize = 26;

fn is_valid_id_body(body: &str) -> bool {
    body.len() == ID_BODY_LENGTH
        && body
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

macro_rules! domain_id {
    ($name:ident, $prefix:expr) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: &str) -> Result<Self, InvalidDomainId> {
                let prefix: &str = $prefix;

                if !value.starts_with(prefix)
                    || value.len() != prefix.len() + ID_BODY_LENGTH
                    || !is_valid_id_body(&value[prefix.len()..])
                {
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

domain_id!(ProjectId, "prj_");
domain_id!(AccountId, "acct_");
domain_id!(ProjectUserId, "pusr_");
domain_id!(ApplicationId, "app_");
domain_id!(ApplicationSigningKeyId, "sig_");
domain_id!(ManagementApiCredentialId, "cred_");
domain_id!(RoomId, "room_");
domain_id!(ParticipantId, "part_");
domain_id!(ParticipantDeviceId, "pdev_");

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
