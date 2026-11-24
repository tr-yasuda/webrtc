use std::collections::{BTreeMap, HashMap, HashSet};

use crate::contract::{
    ApplyEventResult, ExpireBatchResult, QuotaDeleteResult, QuotaLimit, QuotaScope, QuotaScopeKind,
    QuotaUsage, ReconciliationBatchOptions, ReconciliationBatchResult, ReconciliationError,
    ReconciliationJob, ReconciliationJobStatus, Reservation, ReservationFilter, ReservationPage,
    ReservationPageOptions, ReserveRejectionReason, ReserveResult, ResourceClaim, ResourceEvent,
    ResourceStoreError, ResourceStoreOptions, RetentionCleanupResult, TransitionRejectionReason,
    TransitionResult,
};
use crate::id::{BootId, OperationId, ReconciliationJobId, ReservationId, ResourceId, WorkerId};
use crate::state::ResourceState;
use crate::transition::{
    PlannedTransition, WorkerStopAction, plan_expiry, plan_transition,
    plan_worker_stop_for_reservation,
};

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

        if let ResourceEvent::Allocated {
            reservation_id,
            resource_id,
            worker_id,
            boot_id,
            ..
        } = &event
            && let Some(reservation) = self.reservations.get(reservation_id)
            && matches!(
                plan_transition(reservation, &event, now, &self.options),
                PlannedTransition::Apply { .. }
            )
            && let Err(_error) = self.assert_allocated_target_capacity(
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
                if let (
                    ResourceEvent::Allocated { .. },
                    ApplyEventResult::Transition(TransitionResult::Applied(next)),
                ) = (&event, &result)
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

    pub fn start_reconciliation(
        &mut self,
        event: &ResourceEvent,
        now: u64,
    ) -> Result<ReconciliationJob, ReconciliationError> {
        let ResourceEvent::WorkerStopped {
            worker_id,
            boot_id,
            confirmed_resource_ids,
            ..
        } = event
        else {
            return Err(ReconciliationError::InvalidEvent(
                "worker-stopped event is required",
            ));
        };
        let worker_boot = (worker_id.clone(), boot_id.clone());
        if let Some(job_id) = self.reconciliation_by_worker_boot.get(&worker_boot)
            && let Some(state) = self.reconciliations.get(job_id)
        {
            return Ok(state.job.clone());
        }

        let confirmed: HashSet<ResourceId> = confirmed_resource_ids.iter().cloned().collect();
        let confirmed_bytes: u64 = confirmed.iter().map(confirmed_resource_size).sum();
        if confirmed.len() > self.options.max_confirmed_resource_ids
            || confirmed_bytes > self.options.max_confirmed_resource_bytes
        {
            return Err(ReconciliationError::CapacityExceeded(
                "confirmed resource capacity exceeded",
            ));
        }

        let mut candidates: Vec<Reservation> = self
            .reservations
            .values()
            .filter(|reservation| {
                reservation.state != ResourceState::Released
                    && reservation.worker_id.as_ref() == Some(worker_id)
                    && reservation.boot_id.as_ref() == Some(boot_id)
            })
            .cloned()
            .collect();
        candidates.sort_by(|left, right| left.id.cmp(&right.id));
        if candidates.len() > self.options.max_reconciliation_targets {
            return Err(ReconciliationError::CapacityExceeded(
                "reconciliation target capacity exceeded",
            ));
        }

        let mut target_bytes = 0;
        let mut target_specs = Vec::with_capacity(candidates.len());
        for reservation in candidates {
            let resource_id = reservation.resource_id.clone();
            let is_confirmed = resource_id
                .as_ref()
                .is_some_and(|resource_id| confirmed.contains(resource_id));
            let size_bytes =
                reconciliation_target_size(&reservation.id, reservation.resource_id.as_ref());
            target_bytes += size_bytes;
            target_specs.push((reservation, resource_id, is_confirmed, size_bytes));
        }
        if target_bytes > self.options.max_reconciliation_target_bytes {
            return Err(ReconciliationError::CapacityExceeded(
                "reconciliation target capacity exceeded",
            ));
        }

        let job_id = ReconciliationJobId::new();
        let status = if target_specs.is_empty() {
            ReconciliationJobStatus::Completed
        } else {
            ReconciliationJobStatus::Pending
        };
        let mut targets = BTreeMap::new();
        for (reservation, resource_id, is_confirmed, size_bytes) in target_specs {
            let target_seq = self.next_target_seq;
            self.next_target_seq += 1;
            targets.insert(
                target_seq,
                ReconciliationTargetState {
                    target_seq,
                    reservation_id: reservation.id,
                    resource_id,
                    confirmed: is_confirmed,
                    state: ReconciliationTargetStateKind::Pending,
                    processed_at: None,
                    size_bytes,
                },
            );
        }
        let job = ReconciliationJob {
            id: job_id.clone(),
            worker_id: worker_id.clone(),
            boot_id: boot_id.clone(),
            status,
            last_target_seq: 0,
            target_count: targets.len(),
            target_bytes,
            created_at: now,
            updated_at: now,
            error: None,
        };
        self.reconciliations.insert(
            job_id.clone(),
            ReconciliationState {
                job: job.clone(),
                confirmed,
                targets,
            },
        );
        self.reconciliation_by_worker_boot
            .insert(worker_boot, job_id);
        Ok(job)
    }

    pub fn continue_reconciliation(
        &mut self,
        job_id: &ReconciliationJobId,
        options: ReconciliationBatchOptions,
        now: u64,
    ) -> Result<ReconciliationBatchResult, ReconciliationError> {
        let state = self
            .reconciliations
            .get(job_id)
            .ok_or_else(|| ReconciliationError::JobNotFound(job_id.clone()))?;
        if options.cursor != state.job.last_target_seq {
            return Err(ReconciliationError::CursorMismatch {
                expected: state.job.last_target_seq,
                actual: options.cursor,
            });
        }
        if matches!(
            state.job.status,
            ReconciliationJobStatus::Completed | ReconciliationJobStatus::Failed
        ) {
            return Ok(ReconciliationBatchResult {
                reclaimed: Vec::new(),
                isolated: Vec::new(),
                unchanged: Vec::new(),
                next_cursor: None,
                has_more: false,
                status: state.job.status,
            });
        }

        let limit = options
            .limit
            .unwrap_or(self.options.reconciliation_batch_size)
            .clamp(1, self.options.reconciliation_batch_size);
        let selected: Vec<ReconciliationTargetState> = state
            .targets
            .values()
            .filter(|target| {
                target.state == ReconciliationTargetStateKind::Pending
                    && target.target_seq > options.cursor
            })
            .take(limit)
            .cloned()
            .collect();
        let worker_id = state.job.worker_id.clone();
        let boot_id = state.job.boot_id.clone();

        let mut reclaimed = Vec::new();
        let mut isolated = Vec::new();
        let mut unchanged = Vec::new();
        let mut last_target_seq = options.cursor;
        for target in selected {
            last_target_seq = target.target_seq;
            let outcome = self.apply_reconciliation_target(&target, &worker_id, &boot_id, now);
            let target_state = match &outcome {
                ReconciliationTargetOutcome::Skipped => ReconciliationTargetStateKind::Skipped,
                ReconciliationTargetOutcome::Reclaimed(_)
                | ReconciliationTargetOutcome::Isolated(_)
                | ReconciliationTargetOutcome::Unchanged(_) => {
                    ReconciliationTargetStateKind::Processed
                }
            };
            let state = self
                .reconciliations
                .get_mut(job_id)
                .expect("reconciliation job exists for selected targets");
            if let Some(stored) = state.targets.get_mut(&target.target_seq) {
                stored.state = target_state;
                stored.processed_at = Some(now);
            }
            match outcome {
                ReconciliationTargetOutcome::Reclaimed(reservation_id) => {
                    reclaimed.push(reservation_id);
                }
                ReconciliationTargetOutcome::Isolated(reservation_id) => {
                    isolated.push(reservation_id);
                }
                ReconciliationTargetOutcome::Unchanged(reservation_id) => {
                    unchanged.push(reservation_id);
                }
                ReconciliationTargetOutcome::Skipped => {}
            }
        }

        let state = self
            .reconciliations
            .get_mut(job_id)
            .expect("reconciliation job exists after processing");
        let has_more = state.targets.values().any(|target| {
            target.state == ReconciliationTargetStateKind::Pending
                && target.target_seq > last_target_seq
        });
        let status = if has_more {
            ReconciliationJobStatus::Running
        } else {
            ReconciliationJobStatus::Completed
        };
        state.job.last_target_seq = last_target_seq;
        state.job.status = status;
        state.job.updated_at = now;

        Ok(ReconciliationBatchResult {
            reclaimed,
            isolated,
            unchanged,
            next_cursor: (last_target_seq > options.cursor).then_some(last_target_seq),
            has_more,
            status,
        })
    }

    pub fn get_reconciliation_job(
        &self,
        job_id: &ReconciliationJobId,
    ) -> Option<ReconciliationJob> {
        self.reconciliations
            .get(job_id)
            .map(|state| state.job.clone())
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

    fn assert_allocated_target_capacity(
        &self,
        worker_id: &WorkerId,
        boot_id: &BootId,
        reservation_id: &ReservationId,
        resource_id: &ResourceId,
    ) -> Result<(), ReconciliationError> {
        let Some(job_id) = self
            .reconciliation_by_worker_boot
            .get(&(worker_id.clone(), boot_id.clone()))
        else {
            return Ok(());
        };
        let Some(state) = self.reconciliations.get(job_id) else {
            return Ok(());
        };
        if state.job.status == ReconciliationJobStatus::Failed {
            return Ok(());
        }
        let size_bytes = reconciliation_target_size(reservation_id, Some(resource_id));
        if let Some(existing) = state
            .targets
            .values()
            .find(|target| &target.reservation_id == reservation_id)
        {
            if existing.state != ReconciliationTargetStateKind::Pending {
                return Ok(());
            }
            if state.job.target_bytes - existing.size_bytes + size_bytes
                > self.options.max_reconciliation_target_bytes
            {
                return Err(ReconciliationError::CapacityExceeded(
                    "reconciliation target capacity exceeded",
                ));
            }
            return Ok(());
        }
        if state.job.target_count + 1 > self.options.max_reconciliation_targets
            || state.job.target_bytes + size_bytes > self.options.max_reconciliation_target_bytes
        {
            return Err(ReconciliationError::CapacityExceeded(
                "reconciliation target capacity exceeded",
            ));
        }
        Ok(())
    }

    fn append_reconciliation_target(
        &mut self,
        reservation: &Reservation,
        now: u64,
    ) -> Result<(), ReconciliationError> {
        let (Some(worker_id), Some(boot_id), Some(resource_id)) = (
            reservation.worker_id.as_ref(),
            reservation.boot_id.as_ref(),
            reservation.resource_id.as_ref(),
        ) else {
            return Ok(());
        };
        let Some(job_id) = self
            .reconciliation_by_worker_boot
            .get(&(worker_id.clone(), boot_id.clone()))
            .cloned()
        else {
            return Ok(());
        };
        let size_bytes = reconciliation_target_size(&reservation.id, Some(resource_id));
        let (confirmed, existing_seq) = {
            let Some(state) = self.reconciliations.get(&job_id) else {
                return Ok(());
            };
            if state.job.status == ReconciliationJobStatus::Failed {
                return Ok(());
            }
            (
                state.confirmed.contains(resource_id),
                state
                    .targets
                    .values()
                    .find(|target| target.reservation_id == reservation.id)
                    .map(|target| target.target_seq),
            )
        };

        if let Some(target_seq) = existing_seq {
            let state = self
                .reconciliations
                .get_mut(&job_id)
                .expect("reconciliation job exists");
            let existing = state
                .targets
                .get_mut(&target_seq)
                .expect("reconciliation target exists");
            if existing.state != ReconciliationTargetStateKind::Pending {
                return Ok(());
            }
            let target_bytes = state.job.target_bytes - existing.size_bytes + size_bytes;
            if target_bytes > self.options.max_reconciliation_target_bytes {
                return Err(ReconciliationError::CapacityExceeded(
                    "reconciliation target capacity exceeded",
                ));
            }
            existing.resource_id = Some(resource_id.clone());
            existing.confirmed = confirmed;
            existing.size_bytes = size_bytes;
            if state.job.status == ReconciliationJobStatus::Completed {
                state.job.status = ReconciliationJobStatus::Pending;
            }
            state.job.target_bytes = target_bytes;
            state.job.updated_at = now;
            return Ok(());
        }

        let target_seq = self.next_target_seq;
        self.next_target_seq += 1;
        let state = self
            .reconciliations
            .get_mut(&job_id)
            .expect("reconciliation job exists");
        if state.job.target_count + 1 > self.options.max_reconciliation_targets
            || state.job.target_bytes + size_bytes > self.options.max_reconciliation_target_bytes
        {
            return Err(ReconciliationError::CapacityExceeded(
                "reconciliation target capacity exceeded",
            ));
        }
        if state.job.status == ReconciliationJobStatus::Completed {
            state.job.status = ReconciliationJobStatus::Pending;
        }
        state.job.target_count += 1;
        state.job.target_bytes += size_bytes;
        state.job.updated_at = now;
        state.targets.insert(
            target_seq,
            ReconciliationTargetState {
                target_seq,
                reservation_id: reservation.id.clone(),
                resource_id: Some(resource_id.clone()),
                confirmed,
                state: ReconciliationTargetStateKind::Pending,
                processed_at: None,
                size_bytes,
            },
        );
        Ok(())
    }

    fn apply_reconciliation_target(
        &mut self,
        target: &ReconciliationTargetState,
        worker_id: &WorkerId,
        boot_id: &BootId,
        now: u64,
    ) -> ReconciliationTargetOutcome {
        let Some(reservation) = self.reservations.get(&target.reservation_id).cloned() else {
            return ReconciliationTargetOutcome::Skipped;
        };
        if reservation.worker_id.as_ref() != Some(worker_id)
            || reservation.boot_id.as_ref() != Some(boot_id)
            || reservation.state == ResourceState::Released
            || reservation.state == ResourceState::Isolated
        {
            return ReconciliationTargetOutcome::Skipped;
        }
        match (&target.resource_id, &reservation.resource_id) {
            (Some(target_resource_id), Some(resource_id)) if target_resource_id == resource_id => {}
            (None, None) => {}
            _ => return ReconciliationTargetOutcome::Skipped,
        }

        let mut confirmed = HashSet::new();
        if target.confirmed
            && let Some(resource_id) = &target.resource_id
        {
            confirmed.insert(resource_id.clone());
        }
        let Some(plan) =
            plan_worker_stop_for_reservation(&reservation, &confirmed, worker_id, boot_id, now)
        else {
            return ReconciliationTargetOutcome::Skipped;
        };
        if plan.action == WorkerStopAction::Release {
            self.release_quota(&plan.reservation)
                .expect("quota accounting must be consistent");
        }
        if let Some(next) = plan.next {
            self.reservations.insert(next.id.clone(), next);
        }
        match plan.action {
            WorkerStopAction::Release => {
                ReconciliationTargetOutcome::Reclaimed(plan.reservation.id)
            }
            WorkerStopAction::Isolate => ReconciliationTargetOutcome::Isolated(plan.reservation.id),
            WorkerStopAction::Unchanged => {
                ReconciliationTargetOutcome::Unchanged(plan.reservation.id)
            }
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
