import type { ReservationId, ResourceId } from "./id.js";

export function confirmedResourceSize(resourceId: ResourceId): number {
  return 16 + Buffer.byteLength(resourceId, "utf8");
}

export function reconciliationTargetSize(
  reservationId: ReservationId,
  resourceId?: ResourceId,
): number {
  return (
    32 +
    Buffer.byteLength(reservationId, "utf8") +
    (resourceId === undefined ? 0 : Buffer.byteLength(resourceId, "utf8"))
  );
}
