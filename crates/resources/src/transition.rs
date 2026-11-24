use std::collections::HashSet;

use crate::contract::{
    IgnoreReason, Reservation, ResourceEvent, ResourceStoreOptions, TransitionRejectionReason,
};
use crate::id::{BootId, ResourceId, WorkerId};
use crate::state::ResourceState;

pub enum PlannedTransition {
    Apply {
        next: Reservation,
        release_quota: bool,
    },
    Ignore(IgnoreReason),
    Reject(TransitionRejectionReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerStopAction {
    Release,
    Isolate,
    Unchanged,
}

pub struct WorkerStopPlan {
    pub reservation: Reservation,
    pub action: WorkerStopAction,
    pub next: Option<Reservation>,
}

pub struct ExpiryPlan {
    pub next: Reservation,
    pub release_quota: bool,
}

fn transition_reservation(
    reservation: &Reservation,
    state: ResourceState,
    now: u64,
) -> Reservation {
    Reservation {
        state,
        version: reservation.version + 1,
        updated_at: now,
        ..reservation.clone()
    }
}

fn ignore(reason: IgnoreReason) -> PlannedTransition {
    PlannedTransition::Ignore(reason)
}

fn reject(reason: TransitionRejectionReason) -> PlannedTransition {
    PlannedTransition::Reject(reason)
}

pub fn plan_transition(
    reservation: &Reservation,
    event: &ResourceEvent,
    now: u64,
    options: &ResourceStoreOptions,
) -> PlannedTransition {
    match event {
        ResourceEvent::Allocated {
            resource_id,
            worker_id,
            boot_id,
            ..
        } => plan_allocated(reservation, resource_id, worker_id, boot_id, now, options),
        ResourceEvent::ReleaseRequested { .. } => plan_release_requested(reservation, now),
        ResourceEvent::Released {
            resource_id,
            worker_id,
            boot_id,
            ..
        } => plan_released(reservation, resource_id, worker_id, boot_id, now),
        ResourceEvent::ReleaseFailed {
            resource_id,
            worker_id,
            boot_id,
            ..
        } => plan_release_failed(reservation, resource_id, worker_id, boot_id, now),
        ResourceEvent::OutcomeUnknown { .. } => plan_outcome_unknown(reservation, now),
        ResourceEvent::Isolate { .. } => plan_isolate(reservation, now),
        ResourceEvent::WorkerStopped { .. } => reject(TransitionRejectionReason::InvalidTransition),
    }
}

fn plan_allocated(
    reservation: &Reservation,
    resource_id: &ResourceId,
    worker_id: &WorkerId,
    boot_id: &BootId,
    now: u64,
    options: &ResourceStoreOptions,
) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if reservation
        .boot_id
        .as_ref()
        .is_some_and(|current| current != boot_id)
    {
        return ignore(IgnoreReason::StaleBoot);
    }
    if reservation
        .resource_id
        .as_ref()
        .is_some_and(|current| current != resource_id)
        || reservation
            .worker_id
            .as_ref()
            .is_some_and(|current| current != worker_id)
    {
        return reject(TransitionRejectionReason::CorrelationMismatch);
    }
    if matches!(
        reservation.state,
        ResourceState::InUse | ResourceState::ReleasePending | ResourceState::Isolated
    ) {
        if reservation.resource_id.is_some()
            && reservation.worker_id.is_some()
            && reservation.boot_id.is_some()
        {
            return ignore(IgnoreReason::Duplicate);
        }
        let mut next = transition_reservation(reservation, reservation.state, now);
        next.resource_id = Some(resource_id.clone());
        next.worker_id = Some(worker_id.clone());
        next.boot_id = Some(boot_id.clone());
        return PlannedTransition::Apply {
            next,
            release_quota: false,
        };
    }
    if !matches!(
        reservation.state,
        ResourceState::Reserved | ResourceState::ResultUnknown
    ) {
        return reject(TransitionRejectionReason::InvalidTransition);
    }

    let mut next = transition_reservation(reservation, ResourceState::InUse, now);
    next.resource_id = Some(resource_id.clone());
    next.worker_id = Some(worker_id.clone());
    next.boot_id = Some(boot_id.clone());
    if let Some(ttl_ms) = options.in_use_ttl_ms {
        next.expires_at = Some(now + ttl_ms);
    }
    PlannedTransition::Apply {
        next,
        release_quota: false,
    }
}

fn plan_release_requested(reservation: &Reservation, now: u64) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if reservation.state == ResourceState::ReleasePending {
        return ignore(IgnoreReason::Duplicate);
    }
    if !matches!(
        reservation.state,
        ResourceState::InUse | ResourceState::ResultUnknown
    ) {
        return reject(TransitionRejectionReason::InvalidTransition);
    }

    PlannedTransition::Apply {
        next: transition_reservation(reservation, ResourceState::ReleasePending, now),
        release_quota: false,
    }
}

fn plan_released(
    reservation: &Reservation,
    resource_id: &ResourceId,
    worker_id: &WorkerId,
    boot_id: &BootId,
    now: u64,
) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if let Some(correlation) = check_correlation(reservation, resource_id, worker_id, boot_id) {
        return correlation;
    }

    let mut next = transition_reservation(reservation, ResourceState::Released, now);
    next.resource_id = Some(resource_id.clone());
    next.worker_id = Some(worker_id.clone());
    next.boot_id = Some(boot_id.clone());
    PlannedTransition::Apply {
        next,
        release_quota: true,
    }
}

fn plan_release_failed(
    reservation: &Reservation,
    resource_id: &ResourceId,
    worker_id: &WorkerId,
    boot_id: &BootId,
    now: u64,
) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if let Some(correlation) = check_correlation(reservation, resource_id, worker_id, boot_id) {
        return correlation;
    }
    if reservation.state == ResourceState::InUse
        && reservation.resource_id.is_some()
        && reservation.worker_id.is_some()
        && reservation.boot_id.is_some()
    {
        return ignore(IgnoreReason::Duplicate);
    }
    if !matches!(
        reservation.state,
        ResourceState::InUse | ResourceState::ReleasePending | ResourceState::ResultUnknown
    ) {
        return reject(TransitionRejectionReason::InvalidTransition);
    }

    let mut next = transition_reservation(reservation, ResourceState::InUse, now);
    next.resource_id = Some(resource_id.clone());
    next.worker_id = Some(worker_id.clone());
    next.boot_id = Some(boot_id.clone());
    PlannedTransition::Apply {
        next,
        release_quota: false,
    }
}

fn plan_outcome_unknown(reservation: &Reservation, now: u64) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if matches!(
        reservation.state,
        ResourceState::ResultUnknown | ResourceState::Isolated
    ) {
        return ignore(IgnoreReason::Duplicate);
    }

    PlannedTransition::Apply {
        next: transition_reservation(reservation, ResourceState::ResultUnknown, now),
        release_quota: false,
    }
}

fn plan_isolate(reservation: &Reservation, now: u64) -> PlannedTransition {
    if reservation.state == ResourceState::Released {
        return ignore(IgnoreReason::AlreadyReleased);
    }
    if reservation.state == ResourceState::Isolated {
        return ignore(IgnoreReason::Duplicate);
    }

    PlannedTransition::Apply {
        next: transition_reservation(reservation, ResourceState::Isolated, now),
        release_quota: false,
    }
}

fn check_correlation(
    reservation: &Reservation,
    resource_id: &ResourceId,
    worker_id: &WorkerId,
    boot_id: &BootId,
) -> Option<PlannedTransition> {
    if reservation
        .boot_id
        .as_ref()
        .is_some_and(|current| current != boot_id)
    {
        return Some(ignore(IgnoreReason::StaleBoot));
    }
    if reservation
        .resource_id
        .as_ref()
        .is_some_and(|current| current != resource_id)
        || reservation
            .worker_id
            .as_ref()
            .is_some_and(|current| current != worker_id)
    {
        return Some(reject(TransitionRejectionReason::CorrelationMismatch));
    }
    None
}

pub fn plan_expiry(reservation: &Reservation, now: u64) -> Option<ExpiryPlan> {
    if matches!(
        reservation.state,
        ResourceState::Released | ResourceState::Isolated
    ) {
        return None;
    }
    let expires_at = reservation.expires_at?;
    if expires_at > now {
        return None;
    }

    if reservation.state == ResourceState::Reserved {
        return Some(ExpiryPlan {
            next: transition_reservation(reservation, ResourceState::Released, now),
            release_quota: true,
        });
    }

    Some(ExpiryPlan {
        next: transition_reservation(reservation, ResourceState::Isolated, now),
        release_quota: false,
    })
}

pub fn plan_worker_stop_for_reservation(
    reservation: &Reservation,
    confirmed: &HashSet<ResourceId>,
    worker_id: &WorkerId,
    boot_id: &BootId,
    now: u64,
) -> Option<WorkerStopPlan> {
    if reservation.state == ResourceState::Released
        || reservation.worker_id.as_ref() != Some(worker_id)
        || reservation.boot_id.as_ref() != Some(boot_id)
    {
        return None;
    }

    if reservation.state == ResourceState::Reserved {
        return Some(WorkerStopPlan {
            reservation: reservation.clone(),
            action: WorkerStopAction::Release,
            next: Some(transition_reservation(
                reservation,
                ResourceState::Released,
                now,
            )),
        });
    }

    if reservation
        .resource_id
        .as_ref()
        .is_some_and(|resource_id| confirmed.contains(resource_id))
    {
        return Some(WorkerStopPlan {
            reservation: reservation.clone(),
            action: WorkerStopAction::Release,
            next: Some(transition_reservation(
                reservation,
                ResourceState::Released,
                now,
            )),
        });
    }

    if reservation.state != ResourceState::Isolated {
        return Some(WorkerStopPlan {
            reservation: reservation.clone(),
            action: WorkerStopAction::Isolate,
            next: Some(transition_reservation(
                reservation,
                ResourceState::Isolated,
                now,
            )),
        });
    }

    Some(WorkerStopPlan {
        reservation: reservation.clone(),
        action: WorkerStopAction::Unchanged,
        next: None,
    })
}
