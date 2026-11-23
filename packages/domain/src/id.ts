import { ulidToUUID } from "ulid";

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
  // 非 ASCII を大文字化すると ULID でない入力を受理するため、ASCII の小文字だけを変換する。
  const canonicalUlid = value.replace(/[a-z]/g, (character) => character.toUpperCase());
  try {
    ulidToUUID(canonicalUlid);
  } catch {
    return { ok: false, error: "invalid-domain-id" };
  }

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
