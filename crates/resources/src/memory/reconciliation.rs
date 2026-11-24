use std::collections::{BTreeMap, HashSet};

use crate::contract::{
    ReconciliationBatchOptions, ReconciliationBatchResult, ReconciliationError, ReconciliationJob,
    ReconciliationJobStatus, Reservation, ResourceEvent,
};
use crate::id::{BootId, ReconciliationJobId, ReservationId, ResourceId, WorkerId};
use crate::state::ResourceState;
use crate::transition::{WorkerStopAction, plan_worker_stop_for_reservation};

use super::{
    InMemoryResourceStore, ReconciliationState, ReconciliationTargetOutcome,
    ReconciliationTargetState, ReconciliationTargetStateKind, confirmed_resource_size,
    reconciliation_target_size,
};

impl InMemoryResourceStore {
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

    pub(super) fn assert_reconciliation_target_capacity(
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

    pub(super) fn append_reconciliation_target(
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
}
