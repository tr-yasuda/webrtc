import type {
  IgnoreReason,
  Reservation,
  ResourceEvent,
  ResourceStoreOptions,
  TransitionRejectionReason,
  WorkerStoppedEvent,
} from "./contract.js";
import type { BootId, ResourceId, WorkerId } from "./id.js";
import type { ResourceState } from "./state.js";

export interface TransitionPlan {
  readonly kind: "apply";
  readonly next: Reservation;
  readonly releaseQuota: boolean;
}

export interface IgnoredPlan {
  readonly kind: "ignore";
  readonly reason: IgnoreReason;
}

export interface RejectedPlan {
  readonly kind: "reject";
  readonly reason: TransitionRejectionReason;
}

export type PlannedTransition = TransitionPlan | IgnoredPlan | RejectedPlan;

export interface WorkerStopPlan {
  readonly reservation: Reservation;
  readonly action: "release" | "isolate" | "unchanged";
  readonly next?: Reservation;
}

export interface ExpiryPlan {
  readonly next: Reservation;
  readonly releaseQuota: boolean;
}

function transitionReservation(
  reservation: Reservation,
  state: ResourceState,
  now: number,
  updates: Partial<Pick<Reservation, "resourceId" | "workerId" | "bootId" | "expiresAt">> = {},
): Reservation {
  return {
    ...reservation,
    ...updates,
    state,
    version: reservation.version + 1,
    updatedAt: now,
  };
}

function ignore(reason: IgnoreReason): IgnoredPlan {
  return { kind: "ignore", reason };
}

function reject(reason: TransitionRejectionReason): RejectedPlan {
  return { kind: "reject", reason };
}

export function planTransition(
  reservation: Reservation,
  event: Exclude<ResourceEvent, WorkerStoppedEvent>,
  now: number,
  options: ResourceStoreOptions,
): PlannedTransition {
  switch (event.type) {
    case "allocated":
      return planAllocated(reservation, event, now, options);
    case "release-requested":
      return planReleaseRequested(reservation, now);
    case "released":
      return planReleased(reservation, event, now);
    case "release-failed":
      return planReleaseFailed(reservation, event, now);
    case "outcome-unknown":
      return planOutcomeUnknown(reservation, now);
    case "isolate":
      return planIsolate(reservation, now);
  }
}

function planAllocated(
  reservation: Reservation,
  event: Extract<ResourceEvent, { type: "allocated" }>,
  now: number,
  options: ResourceStoreOptions,
): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  if (reservation.bootId !== undefined && reservation.bootId !== event.bootId) {
    return ignore("stale-boot");
  }
  if (
    (reservation.resourceId !== undefined && reservation.resourceId !== event.resourceId) ||
    (reservation.workerId !== undefined && reservation.workerId !== event.workerId)
  ) {
    return reject("correlation-mismatch");
  }
  if (
    reservation.state === "in-use" ||
    reservation.state === "release-pending" ||
    reservation.state === "isolated"
  ) {
    if (
      reservation.resourceId !== undefined &&
      reservation.workerId !== undefined &&
      reservation.bootId !== undefined
    ) {
      return ignore("duplicate");
    }
    return {
      kind: "apply",
      next: transitionReservation(reservation, reservation.state, now, {
        resourceId: event.resourceId,
        workerId: event.workerId,
        bootId: event.bootId,
      }),
      releaseQuota: false,
    };
  }
  if (reservation.state !== "reserved" && reservation.state !== "result-unknown") {
    return reject("invalid-transition");
  }

  const expiresAt = options.inUseTtlMs === undefined ? undefined : now + options.inUseTtlMs;
  return {
    kind: "apply",
    next: transitionReservation(reservation, "in-use", now, {
      resourceId: event.resourceId,
      workerId: event.workerId,
      bootId: event.bootId,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }),
    releaseQuota: false,
  };
}

function planReleaseRequested(reservation: Reservation, now: number): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  if (reservation.state === "release-pending") {
    return ignore("duplicate");
  }
  if (reservation.state !== "in-use" && reservation.state !== "result-unknown") {
    return reject("invalid-transition");
  }

  return {
    kind: "apply",
    next: transitionReservation(reservation, "release-pending", now),
    releaseQuota: false,
  };
}

function planReleased(
  reservation: Reservation,
  event: Extract<ResourceEvent, { type: "released" }>,
  now: number,
): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  const correlation = checkCorrelation(reservation, event);
  if (correlation !== undefined) {
    return correlation;
  }

  return {
    kind: "apply",
    next: transitionReservation(reservation, "released", now, {
      resourceId: event.resourceId,
      workerId: event.workerId,
      bootId: event.bootId,
    }),
    releaseQuota: true,
  };
}

function planReleaseFailed(
  reservation: Reservation,
  event: Extract<ResourceEvent, { type: "release-failed" }>,
  now: number,
): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  const correlation = checkCorrelation(reservation, event);
  if (correlation !== undefined) {
    return correlation;
  }
  if (
    reservation.state === "in-use" &&
    reservation.resourceId !== undefined &&
    reservation.workerId !== undefined &&
    reservation.bootId !== undefined
  ) {
    return ignore("duplicate");
  }
  if (
    reservation.state !== "in-use" &&
    reservation.state !== "release-pending" &&
    reservation.state !== "result-unknown"
  ) {
    return reject("invalid-transition");
  }

  return {
    kind: "apply",
    next: transitionReservation(reservation, "in-use", now, {
      resourceId: event.resourceId,
      workerId: event.workerId,
      bootId: event.bootId,
    }),
    releaseQuota: false,
  };
}

function planOutcomeUnknown(reservation: Reservation, now: number): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  if (reservation.state === "result-unknown" || reservation.state === "isolated") {
    return ignore("duplicate");
  }

  return {
    kind: "apply",
    next: transitionReservation(reservation, "result-unknown", now),
    releaseQuota: false,
  };
}

function planIsolate(reservation: Reservation, now: number): PlannedTransition {
  if (reservation.state === "released") {
    return ignore("already-released");
  }
  if (reservation.state === "isolated") {
    return ignore("duplicate");
  }

  return {
    kind: "apply",
    next: transitionReservation(reservation, "isolated", now),
    releaseQuota: false,
  };
}

function checkCorrelation(
  reservation: Reservation,
  event: Extract<ResourceEvent, { type: "released" | "release-failed" }>,
): IgnoredPlan | RejectedPlan | undefined {
  if (reservation.bootId !== undefined && reservation.bootId !== event.bootId) {
    return ignore("stale-boot");
  }
  if (
    (reservation.resourceId !== undefined && reservation.resourceId !== event.resourceId) ||
    (reservation.workerId !== undefined && reservation.workerId !== event.workerId)
  ) {
    return reject("correlation-mismatch");
  }

  return undefined;
}

export function planExpiry(reservation: Reservation, now: number): ExpiryPlan | undefined {
  if (
    reservation.state === "released" ||
    reservation.state === "isolated" ||
    reservation.expiresAt === undefined ||
    reservation.expiresAt > now
  ) {
    return undefined;
  }

  if (reservation.state === "reserved") {
    return {
      next: transitionReservation(reservation, "released", now),
      releaseQuota: true,
    };
  }

  return {
    next: transitionReservation(reservation, "isolated", now),
    releaseQuota: false,
  };
}

export function planWorkerStopped(
  reservations: readonly Reservation[],
  event: WorkerStoppedEvent,
  now: number,
): readonly WorkerStopPlan[] {
  const confirmed = new Set(event.confirmedResourceIds);
  return reservations
    .map((reservation) =>
      planWorkerStopForReservation(reservation, confirmed, event.workerId, event.bootId, now),
    )
    .filter((plan): plan is WorkerStopPlan => plan !== undefined);
}

export function planWorkerStopForReservation(
  reservation: Reservation,
  confirmed: ReadonlySet<ResourceId>,
  workerId: WorkerId,
  bootId: BootId,
  now: number,
): WorkerStopPlan | undefined {
  if (
    reservation.state === "released" ||
    reservation.workerId !== workerId ||
    reservation.bootId !== bootId
  ) {
    return undefined;
  }

  if (reservation.state === "reserved") {
    return {
      reservation,
      action: "release",
      next: transitionReservation(reservation, "released", now),
    };
  }

  if (reservation.resourceId !== undefined && confirmed.has(reservation.resourceId)) {
    return {
      reservation,
      action: "release",
      next: transitionReservation(reservation, "released", now),
    };
  }

  if (reservation.state !== "isolated") {
    return {
      reservation,
      action: "isolate",
      next: transitionReservation(reservation, "isolated", now),
    };
  }

  return { reservation, action: "unchanged" };
}
