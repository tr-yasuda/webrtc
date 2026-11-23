import type {
  AccountId,
  ApplicationId,
  ApplicationSigningKeyId,
  ManagementApiCredentialId,
  ParticipantDeviceId,
  ParticipantId,
  ProjectId,
  ProjectUserId,
  RoomId,
} from "./id.js";

export type Project = {
  readonly id: ProjectId;
  readonly name: string;
};
export type Account = {
  readonly id: AccountId;
  readonly name: string;
};
export type ProjectUser = {
  readonly id: ProjectUserId;
  readonly projectId: ProjectId;
  readonly accountId: AccountId;
  readonly name: string;
};
export type Application = {
  readonly id: ApplicationId;
  readonly projectId: ProjectId;
  readonly name: string;
};
export type ApplicationSigningKey = {
  readonly id: ApplicationSigningKeyId;
  readonly applicationId: ApplicationId;
  readonly name: string;
};
export type ManagementApiCredential = {
  readonly id: ManagementApiCredentialId;
  readonly projectId: ProjectId;
  readonly name: string;
};
export type Room = {
  readonly id: RoomId;
  readonly projectId: ProjectId;
  readonly name: string;
};
export type Participant = {
  readonly id: ParticipantId;
  readonly roomId: RoomId;
  readonly name: string;
};
export type Member = Participant;
export type ParticipantDevice = {
  readonly id: ParticipantDeviceId;
  readonly participantId: ParticipantId;
  readonly name: string;
};
