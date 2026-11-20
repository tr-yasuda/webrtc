import { isValid } from "ulid";

type BrandedDomainId<T extends string> = string & {
  readonly __domainId: T;
};

export type ProjectId = BrandedDomainId<"ProjectId">;
export type AccountId = BrandedDomainId<"AccountId">;
export type ProjectUserId = BrandedDomainId<"ProjectUserId">;
export type ApplicationId = BrandedDomainId<"ApplicationId">;
export type ApplicationSigningKeyId = BrandedDomainId<"ApplicationSigningKeyId">;
export type ManagementApiCredentialId = BrandedDomainId<"ManagementApiCredentialId">;
export type RoomId = BrandedDomainId<"RoomId">;
export type ParticipantId = BrandedDomainId<"ParticipantId">;
export type MemberId = ParticipantId;
export type ParticipantDeviceId = BrandedDomainId<"ParticipantDeviceId">;

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

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed" | "closed";
export type ResourceState =
  | "reserved"
  | "in-use"
  | "release-pending"
  | "isolated"
  | "released"
  | "result-unknown";

export type DomainIdParseResult<T> =
  | {
      readonly ok: true;
      readonly id: T;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-domain-id";
    };

function parseDomainId<T extends string>(value: string): DomainIdParseResult<T> {
  if (!isValid(value)) return { ok: false, error: "invalid-domain-id" };

  const canonicalUlid = value.toUpperCase();
  return { ok: true, id: canonicalUlid as T };
}

export function parseProjectId(value: string): DomainIdParseResult<ProjectId> {
  return parseDomainId(value);
}
export function parseAccountId(value: string): DomainIdParseResult<AccountId> {
  return parseDomainId(value);
}
export function parseProjectUserId(value: string): DomainIdParseResult<ProjectUserId> {
  return parseDomainId(value);
}
export function parseApplicationId(value: string): DomainIdParseResult<ApplicationId> {
  return parseDomainId(value);
}
export function parseApplicationSigningKeyId(
  value: string,
): DomainIdParseResult<ApplicationSigningKeyId> {
  return parseDomainId(value);
}
export function parseManagementApiCredentialId(
  value: string,
): DomainIdParseResult<ManagementApiCredentialId> {
  return parseDomainId(value);
}
export function parseRoomId(value: string): DomainIdParseResult<RoomId> {
  return parseDomainId(value);
}
export function parseParticipantId(value: string): DomainIdParseResult<ParticipantId> {
  return parseDomainId(value);
}
export function parseMemberId(value: string): DomainIdParseResult<MemberId> {
  return parseParticipantId(value);
}
export function parseParticipantDeviceId(value: string): DomainIdParseResult<ParticipantDeviceId> {
  return parseDomainId(value);
}
