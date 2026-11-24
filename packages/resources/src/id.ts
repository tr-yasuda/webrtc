import { ulid } from "ulid";

type OpaqueId<T extends string> = string & {
  readonly __resourceIdType: T;
};

export type ReservationId = OpaqueId<"ReservationId">;
export type ResourceId = OpaqueId<"ResourceId">;
export type OperationId = OpaqueId<"OperationId">;
export type WorkerId = OpaqueId<"WorkerId">;
export type BootId = OpaqueId<"BootId">;
export type ReconciliationJobId = OpaqueId<"ReconciliationJobId">;

const MAX_OPAQUE_ID_LENGTH = 128;

function parseOpaqueId<T extends string>(value: string, type: T): OpaqueId<T> {
  if (value.length === 0 || value.length > MAX_OPAQUE_ID_LENGTH || value.trim().length === 0) {
    throw new Error(`${type} must be 1-${MAX_OPAQUE_ID_LENGTH} non-whitespace characters`);
  }

  return value as OpaqueId<T>;
}

export function newReservationId(): ReservationId {
  return ulid() as ReservationId;
}

export function newResourceId(): ResourceId {
  return ulid() as ResourceId;
}

export function newOperationId(): OperationId {
  return ulid() as OperationId;
}

export function newReconciliationJobId(): ReconciliationJobId {
  return ulid() as ReconciliationJobId;
}

export function asReservationId(value: string): ReservationId {
  return parseOpaqueId(value, "ReservationId");
}

export function asResourceId(value: string): ResourceId {
  return parseOpaqueId(value, "ResourceId");
}

export function asOperationId(value: string): OperationId {
  return parseOpaqueId(value, "OperationId");
}

export function asWorkerId(value: string): WorkerId {
  return parseOpaqueId(value, "WorkerId");
}

export function asBootId(value: string): BootId {
  return parseOpaqueId(value, "BootId");
}

export function asReconciliationJobId(value: string): ReconciliationJobId {
  return parseOpaqueId(value, "ReconciliationJobId");
}
