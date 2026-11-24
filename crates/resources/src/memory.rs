use std::collections::{BTreeMap, HashMap, HashSet};

use crate::contract::{
    ApplyEventResult, ExpireBatchResult, QuotaDeleteResult, QuotaLimit, QuotaScope, QuotaScopeKind,
    QuotaUsage, ReconciliationJob, ReconciliationJobStatus, Reservation, ReservationFilter,
    ReservationPage, ReservationPageOptions, ReserveRejectionReason, ReserveResult, ResourceClaim,
    ResourceEvent, ResourceStoreError, ResourceStoreOptions, RetentionCleanupResult,
    TransitionRejectionReason, TransitionResult,
};
use crate::id::{BootId, OperationId, ReconciliationJobId, ReservationId, ResourceId, WorkerId};
use crate::state::ResourceState;
use crate::transition::{PlannedTransition, plan_expiry, plan_transition};

mod reconciliation;

#[derive(Debug, Clone)]
struct QuotaState {
    scope: QuotaScope,
    max_count: u64,
    max_bytes: u64,
    used_count: u64,
    used_bytes: u64,
}

#[derive(Debug, Clone)]
enum StoredOperation {
    Reserve {
        result: ReserveResult,
        occurred_at: u64,
        recorded_at: u64,
    },
    Event {
        result: ApplyEventResult,
        occurred_at: u64,
        recorded_at: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconciliationTargetStateKind {
    Pending,
    Processed,
    Skipped,
}

#[derive(Debug, Clone)]
struct ReconciliationTargetState {
    target_seq: u64,
    reservation_id: ReservationId,
    resource_id: Option<ResourceId>,
    confirmed: bool,
    state: ReconciliationTargetStateKind,
    processed_at: Option<u64>,
    size_bytes: u64,
}

#[derive(Debug, Clone)]
struct ReconciliationState {
    job: ReconciliationJob,
    confirmed: HashSet<ResourceId>,
    targets: BTreeMap<u64, ReconciliationTargetState>,
}

enum ReconciliationTargetOutcome {
    Reclaimed(ReservationId),
    Isolated(ReservationId),
    Unchanged(ReservationId),
    Skipped,
}

fn confirmed_resource_size(resource_id: &ResourceId) -> u64 {
    16 + resource_id.as_str().len() as u64
}

fn reconciliation_target_size(
    reservation_id: &ReservationId,
    resource_id: Option<&ResourceId>,
) -> u64 {
    32 + reservation_id.as_str().len() as u64
        + resource_id.map_or(0, |resource_id| resource_id.as_str().len() as u64)
}

impl StoredOperation {
    fn occurred_at(&self) -> u64 {
        match self {
            Self::Reserve { occurred_at, .. } | Self::Event { occurred_at, .. } => *occurred_at,
        }
    }

    fn recorded_at(&self) -> u64 {
        match self {
            Self::Reserve { recorded_at, .. } | Self::Event { recorded_at, .. } => *recorded_at,
        }
    }
}

fn is_expired_candidate(reservation: &Reservation, now: u64) -> bool {
    reservation.state != ResourceState::Released
        && reservation.state != ResourceState::Isolated
        && reservation
            .expires_at
            .is_some_and(|expires_at| expires_at <= now)
}

fn matches_reservation_filter(reservation: &Reservation, filter: &ReservationFilter) -> bool {
    filter
        .worker_id
        .as_ref()
        .is_none_or(|worker_id| reservation.worker_id.as_ref() == Some(worker_id))
        && filter
            .boot_id
            .as_ref()
            .is_none_or(|boot_id| reservation.boot_id.as_ref() == Some(boot_id))
        && filter.state.is_none_or(|state| reservation.state == state)
}

pub struct InMemoryResourceStore {
    reservations: HashMap<ReservationId, Reservation>,
    quotas: HashMap<String, QuotaState>,
    operations: HashMap<OperationId, StoredOperation>,
    options: ResourceStoreOptions,
    operation_capacity_exceeded: bool,
    reconciliations: HashMap<ReconciliationJobId, ReconciliationState>,
    reconciliation_by_worker_boot: HashMap<(WorkerId, BootId), ReconciliationJobId>,
    next_target_seq: u64,
}

impl InMemoryResourceStore {
    pub fn new(options: ResourceStoreOptions) -> Result<Self, ResourceStoreError> {
        if options.reservation_ttl_ms == 0 {
            return Err(ResourceStoreError::InvalidOptions(
                "reservation_ttl_ms must be positive",
            ));
        }
        if options.in_use_ttl_ms == Some(0) {
            return Err(ResourceStoreError::InvalidOptions(
                "in_use_ttl_ms must be positive",
            ));
        }
        if options.operation_retention_ms == 0
            || options.released_reservation_retention_ms == 0
            || options.cleanup_batch_size == 0
            || options.max_operation_records == 0
            || options.max_released_reservations == 0
            || options.max_scopes_per_claim == 0
            || options.reconciliation_batch_size == 0
            || options.reconciliation_job_retention_ms == 0
            || options.max_confirmed_resource_ids == 0
            || options.max_confirmed_resource_bytes == 0
            || options.max_reconciliation_targets == 0
            || options.max_reconciliation_target_bytes == 0
        {
            return Err(ResourceStoreError::InvalidOptions(
                "retention, cleanup and capacity values must be positive",
            ));
        }

        Ok(Self {
            reservations: HashMap::new(),
            quotas: HashMap::new(),
            operations: HashMap::new(),
            options,
            operation_capacity_exceeded: false,
            reconciliations: HashMap::new(),
            reconciliation_by_worker_boot: HashMap::new(),
            next_target_seq: 1,
        })
    }

    pub fn set_quota_limit(&mut self, limit: QuotaLimit) -> Result<(), ResourceStoreError> {
        let key = limit.scope.storage_key();
        if let Some(quota) = self.quotas.get_mut(&key) {
            quota.max_count = limit.max_count;
            quota.max_bytes = limit.max_bytes;
            return Ok(());
        }

        self.quotas.insert(
            key,
            QuotaState {
                scope: limit.scope,
                max_count: limit.max_count,
                max_bytes: limit.max_bytes,
                used_count: 0,
                used_bytes: 0,
            },
        );
        Ok(())
    }

    pub fn get_quota_usage(&self, scope: &QuotaScope) -> Option<QuotaUsage> {
        self.quotas
            .get(&scope.storage_key())
            .map(|quota| QuotaUsage {
                scope: quota.scope.clone(),
                max_count: quota.max_count,
                max_bytes: quota.max_bytes,
                used_count: quota.used_count,
                used_bytes: quota.used_bytes,
            })
    }

    pub fn delete_quota_scope(&mut self, scope: &QuotaScope) -> QuotaDeleteResult {
        let key = scope.storage_key();
        let Some(quota) = self.quotas.get(&key) else {
            return QuotaDeleteResult::NotFound;
        };
        let usage = QuotaUsage {
            scope: quota.scope.clone(),
            max_count: quota.max_count,
            max_bytes: quota.max_bytes,
            used_count: quota.used_count,
            used_bytes: quota.used_bytes,
        };
        if usage.used_count > 0 || usage.used_bytes > 0 {
            return QuotaDeleteResult::InUse(usage);
        }
        self.quotas.remove(&key);
        QuotaDeleteResult::Deleted
    }

    pub fn reserve(
        &mut self,
        claim: &ResourceClaim,
        operation_id: OperationId,
        now: u64,
    ) -> ReserveResult {
        if let Some(stored) = self.operations.get(&operation_id) {
            return match stored {
                StoredOperation::Reserve { result, .. } => result.clone(),
                StoredOperation::Event { .. } => {
                    ReserveResult::Rejected(ReserveRejectionReason::InvalidClaim)
                }
            };
        }
        if self.operation_capacity_exceeded {
            return ReserveResult::Rejected(ReserveRejectionReason::CapacityExhausted);
        }

        let Ok(scopes) = validate_claim(claim, self.options.max_scopes_per_claim) else {
            return self.record_reserve_result(
                operation_id,
                ReserveResult::Rejected(ReserveRejectionReason::InvalidClaim),
                now,
            );
        };

        let mut quota_keys = Vec::with_capacity(scopes.len());
        for scope in &scopes {
            let key = scope.storage_key();
            let Some(quota) = self.quotas.get(&key) else {
                return self.record_reserve_result(
                    operation_id,
                    ReserveResult::Rejected(ReserveRejectionReason::LimitNotConfigured),
                    now,
                );
            };
            if quota.used_count >= quota.max_count
                || quota.used_bytes > quota.max_bytes
                || claim.size_bytes > quota.max_bytes.saturating_sub(quota.used_bytes)
            {
                return self.record_reserve_result(
                    operation_id,
                    ReserveResult::Rejected(ReserveRejectionReason::QuotaExceeded),
                    now,
                );
            }
            quota_keys.push(key);
        }

        let ttl_ms = claim.ttl_ms.unwrap_or(self.options.reservation_ttl_ms);
        let reservation = Reservation {
            id: ReservationId::new(),
            state: ResourceState::Reserved,
            scopes,
            size_bytes: claim.size_bytes,
            resource_id: None,
            worker_id: None,
            boot_id: None,
            version: 1,
            created_at: now,
            updated_at: now,
            expires_at: Some(now + ttl_ms),
        };

        for key in &quota_keys {
            let quota = self
                .quotas
                .get_mut(key)
                .expect("quota was checked before reservation");
            quota.used_count += 1;
            quota.used_bytes += claim.size_bytes;
        }
        self.reservations
            .insert(reservation.id.clone(), reservation.clone());

        self.record_reserve_result(operation_id, ReserveResult::Reserved(reservation), now)
    }

    pub fn apply_event(&mut self, event: ResourceEvent, now: u64) -> ApplyEventResult {
        let operation_id = event.operation_id().clone();
        let event_at = event.at();
        if let Some(stored) = self.operations.get(&operation_id) {
            return match stored {
                StoredOperation::Event { result, .. } => result.clone(),
                StoredOperation::Reserve { .. } => ApplyEventResult::Transition(
                    TransitionResult::Rejected(TransitionRejectionReason::CorrelationMismatch),
                ),
            };
        }
        if self.operation_capacity_exceeded {
            return ApplyEventResult::Transition(TransitionResult::Rejected(
                TransitionRejectionReason::CapacityExhausted,
            ));
        }

        let correlation = match &event {
            ResourceEvent::Allocated {
                reservation_id,
                resource_id,
                worker_id,
                boot_id,
                ..
            }
            | ResourceEvent::ReleaseFailed {
                reservation_id,
                resource_id,
                worker_id,
                boot_id,
                ..
            } => Some((reservation_id, resource_id, worker_id, boot_id)),
            _ => None,
        };
        if let Some((reservation_id, resource_id, worker_id, boot_id)) = correlation
            && let Some(reservation) = self.reservations.get(reservation_id)
            && matches!(
                plan_transition(reservation, &event, now, &self.options),
                PlannedTransition::Apply { .. }
            )
            && let Err(_error) = self.assert_reconciliation_target_capacity(
                worker_id,
                boot_id,
                reservation_id,
                resource_id,
            )
        {
            return self.record_event_result(
                operation_id,
                ApplyEventResult::Transition(TransitionResult::Rejected(
                    TransitionRejectionReason::CapacityExhausted,
                )),
                event_at,
                now,
            );
        }

        let result = match &event {
            ResourceEvent::WorkerStopped { .. } => match self.start_reconciliation(&event, now) {
                Ok(job) => ApplyEventResult::ReconciliationStarted(job),
                Err(_error) => ApplyEventResult::Transition(TransitionResult::Rejected(
                    TransitionRejectionReason::CapacityExhausted,
                )),
            },
            _ => {
                let result = self.apply_transition(&event, now);
                if matches!(
                    &event,
                    ResourceEvent::Allocated { .. } | ResourceEvent::ReleaseFailed { .. }
                ) && let ApplyEventResult::Transition(TransitionResult::Applied(next)) = &result
                {
                    self.append_reconciliation_target(next, now)
                        .expect("reconciliation target capacity was checked before allocation");
                }
                result
            }
        };
        self.record_event_result(operation_id, result, event_at, now)
    }

    pub fn expire(&mut self, now: u64, limit: Option<usize>) -> ExpireBatchResult {
        let limit = limit
            .unwrap_or(self.options.reconciliation_batch_size)
            .clamp(1, self.options.reconciliation_batch_size);
        let mut candidates: Vec<(u64, ReservationId)> = self
            .reservations
            .iter()
            .filter(|(_, reservation)| is_expired_candidate(reservation, now))
            .map(|(reservation_id, reservation)| {
                (
                    reservation.expires_at.unwrap_or_default(),
                    reservation_id.clone(),
                )
            })
            .collect();
        candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        candidates.truncate(limit);

        let mut released = Vec::new();
        let mut isolated = Vec::new();
        for (_, reservation_id) in candidates {
            let Some(reservation) = self.reservations.get(&reservation_id).cloned() else {
                continue;
            };
            let Some(plan) = plan_expiry(&reservation, now) else {
                continue;
            };
            if plan.release_quota {
                self.release_quota(&reservation)
                    .expect("quota accounting must be consistent");
            }
            self.reservations
                .insert(plan.next.id.clone(), plan.next.clone());
            if plan.next.state == ResourceState::Released {
                released.push(reservation.id);
            } else {
                isolated.push(reservation.id);
            }
        }

        ExpireBatchResult {
            released,
            isolated,
            has_more: self
                .reservations
                .values()
                .any(|reservation| is_expired_candidate(reservation, now)),
        }
    }

    pub fn get_reservation(&self, id: &ReservationId) -> Option<Reservation> {
        self.reservations.get(id).cloned()
    }

    pub fn operation_recorded_at(&self, operation_id: &OperationId) -> Option<u64> {
        self.operations
            .get(operation_id)
            .map(StoredOperation::recorded_at)
    }

    pub fn operation_occurred_at(&self, operation_id: &OperationId) -> Option<u64> {
        self.operations
            .get(operation_id)
            .map(StoredOperation::occurred_at)
    }

    pub fn cleanup(&mut self, now: u64) -> RetentionCleanupResult {
        let mut expired_operations: Vec<(u64, OperationId)> = now
            .checked_sub(self.options.operation_retention_ms)
            .map_or_else(Vec::new, |cutoff| {
                self.operations
                    .iter()
                    .filter(|(_, operation)| operation.recorded_at() <= cutoff)
                    .map(|(operation_id, operation)| {
                        (operation.recorded_at(), operation_id.clone())
                    })
                    .collect()
            });
        expired_operations
            .sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        expired_operations.truncate(self.options.cleanup_batch_size);
        let deleted_operations = expired_operations.len();
        for (_, operation_id) in expired_operations {
            self.operations.remove(&operation_id);
        }

        let mut expired_reservations: Vec<(u64, ReservationId)> = now
            .checked_sub(self.options.released_reservation_retention_ms)
            .map_or_else(Vec::new, |cutoff| {
                self.reservations
                    .iter()
                    .filter(|(_, reservation)| {
                        reservation.state == ResourceState::Released
                            && reservation.updated_at <= cutoff
                    })
                    .map(|(reservation_id, reservation)| {
                        (reservation.updated_at, reservation_id.clone())
                    })
                    .collect()
            });
        expired_reservations
            .sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        expired_reservations.truncate(self.options.cleanup_batch_size);
        let deleted_released_reservations = expired_reservations.len();
        for (_, reservation_id) in expired_reservations {
            self.reservations.remove(&reservation_id);
        }

        let operation_count = self.operations.len();
        self.operation_capacity_exceeded = operation_count >= self.options.max_operation_records;

        let mut released_reservations: Vec<(u64, ReservationId)> = self
            .reservations
            .iter()
            .filter(|(_, reservation)| reservation.state == ResourceState::Released)
            .map(|(reservation_id, reservation)| (reservation.updated_at, reservation_id.clone()))
            .collect();
        released_reservations
            .sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        let released_reservation_count = released_reservations.len();
        let eviction_count =
            released_reservation_count.saturating_sub(self.options.max_released_reservations);
        let evicted: Vec<(u64, ReservationId)> = released_reservations
            .into_iter()
            .take(eviction_count)
            .collect();
        for (_, reservation_id) in &evicted {
            self.reservations.remove(reservation_id);
        }

        let mut expired_jobs: Vec<(u64, ReconciliationJobId)> = now
            .checked_sub(self.options.reconciliation_job_retention_ms)
            .map_or_else(Vec::new, |cutoff| {
                self.reconciliations
                    .iter()
                    .filter(|(_, state)| {
                        matches!(
                            state.job.status,
                            ReconciliationJobStatus::Completed | ReconciliationJobStatus::Failed
                        ) && state.job.updated_at <= cutoff
                    })
                    .map(|(job_id, state)| (state.job.updated_at, job_id.clone()))
                    .collect()
            });
        expired_jobs.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        expired_jobs.truncate(self.options.cleanup_batch_size);
        let deleted_reconciliation_jobs = expired_jobs.len();
        for (_, job_id) in expired_jobs {
            if let Some(state) = self.reconciliations.remove(&job_id) {
                let worker_boot = (state.job.worker_id, state.job.boot_id);
                if self.reconciliation_by_worker_boot.get(&worker_boot) == Some(&job_id) {
                    self.reconciliation_by_worker_boot.remove(&worker_boot);
                }
            }
        }

        RetentionCleanupResult {
            deleted_operations,
            deleted_released_reservations,
            evicted_released_reservations: evicted.len(),
            operation_count,
            released_reservation_count: released_reservation_count - evicted.len(),
            operation_capacity_exceeded: self.operation_capacity_exceeded,
            deleted_reconciliation_jobs,
        }
    }

    /// 内部照合・テスト用。公開契約には含めない。
    pub fn list_reservations_page(
        &self,
        filter: &ReservationFilter,
        options: &ReservationPageOptions,
    ) -> ReservationPage {
        let limit = options
            .limit
            .unwrap_or(self.options.reconciliation_batch_size)
            .clamp(1, self.options.reconciliation_batch_size);
        let mut reservations: Vec<Reservation> = self
            .reservations
            .values()
            .filter(|reservation| {
                options
                    .cursor
                    .as_ref()
                    .is_none_or(|cursor| &reservation.id > cursor)
                    && matches_reservation_filter(reservation, filter)
            })
            .cloned()
            .collect();
        reservations.sort_by(|left, right| left.id.cmp(&right.id));
        let has_more = reservations.len() > limit;
        reservations.truncate(limit);
        let next_cursor = if has_more {
            reservations
                .last()
                .map(|reservation| reservation.id.clone())
        } else {
            None
        };
        ReservationPage {
            reservations,
            next_cursor,
        }
    }

    fn apply_transition(&mut self, event: &ResourceEvent, now: u64) -> ApplyEventResult {
        let reservation_id = match event {
            ResourceEvent::Allocated { reservation_id, .. }
            | ResourceEvent::ReleaseRequested { reservation_id, .. }
            | ResourceEvent::Released { reservation_id, .. }
            | ResourceEvent::ReleaseFailed { reservation_id, .. }
            | ResourceEvent::OutcomeUnknown { reservation_id, .. }
            | ResourceEvent::Isolate { reservation_id, .. } => reservation_id,
            ResourceEvent::WorkerStopped { .. } => {
                return ApplyEventResult::Transition(TransitionResult::Rejected(
                    TransitionRejectionReason::InvalidTransition,
                ));
            }
        };
        let Some(reservation) = self.reservations.get(reservation_id).cloned() else {
            return ApplyEventResult::Transition(TransitionResult::Rejected(
                TransitionRejectionReason::NotFound,
            ));
        };

        match plan_transition(&reservation, event, now, &self.options) {
            PlannedTransition::Ignore(reason) => {
                ApplyEventResult::Transition(TransitionResult::Ignored(reason))
            }
            PlannedTransition::Reject(reason) => {
                ApplyEventResult::Transition(TransitionResult::Rejected(reason))
            }
            PlannedTransition::Apply {
                next,
                release_quota,
            } => {
                if release_quota {
                    self.release_quota(&reservation)
                        .expect("quota accounting must be consistent");
                }
                self.reservations.insert(next.id.clone(), next.clone());
                ApplyEventResult::Transition(TransitionResult::Applied(next))
            }
        }
    }

    fn record_reserve_result(
        &mut self,
        operation_id: OperationId,
        result: ReserveResult,
        at: u64,
    ) -> ReserveResult {
        self.operations.insert(
            operation_id,
            StoredOperation::Reserve {
                result: result.clone(),
                occurred_at: at,
                recorded_at: at,
            },
        );
        result
    }

    fn record_event_result(
        &mut self,
        operation_id: OperationId,
        result: ApplyEventResult,
        occurred_at: u64,
        recorded_at: u64,
    ) -> ApplyEventResult {
        self.operations.insert(
            operation_id,
            StoredOperation::Event {
                result: result.clone(),
                occurred_at,
                recorded_at,
            },
        );
        result
    }

    fn release_quota(&mut self, reservation: &Reservation) -> Result<(), ResourceStoreError> {
        for scope in &reservation.scopes {
            let key = scope.storage_key();
            let quota = self
                .quotas
                .get_mut(&key)
                .ok_or_else(|| ResourceStoreError::QuotaMissing(key.clone()))?;
            if quota.used_count == 0 || quota.used_bytes < reservation.size_bytes {
                return Err(ResourceStoreError::QuotaAccountingInconsistent(key));
            }
            quota.used_count -= 1;
            quota.used_bytes -= reservation.size_bytes;
        }
        Ok(())
    }
}

fn validate_claim(
    claim: &ResourceClaim,
    max_scopes: usize,
) -> Result<Vec<QuotaScope>, ResourceStoreError> {
    if claim.scopes.is_empty() || claim.scopes.len() > max_scopes {
        return Err(ResourceStoreError::InvalidClaim);
    }
    if claim.ttl_ms == Some(0) {
        return Err(ResourceStoreError::InvalidClaim);
    }

    let mut scopes = claim.scopes.clone();
    let mut seen = HashSet::with_capacity(scopes.len());
    for scope in &scopes {
        if scope.key.is_empty() || !seen.insert(scope.storage_key()) {
            return Err(ResourceStoreError::InvalidClaim);
        }
    }
    if !scopes
        .iter()
        .any(|scope| scope.kind == QuotaScopeKind::Server)
    {
        return Err(ResourceStoreError::InvalidClaim);
    }
    scopes.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.key.cmp(&right.key))
    });
    Ok(scopes)
}
