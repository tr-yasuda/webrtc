use crate::id::{
    AccountId, ApplicationId, ApplicationSigningKeyId, ManagementApiCredentialId,
    ParticipantDeviceId, ParticipantId, ProjectId, ProjectUserId, RoomId,
};

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
