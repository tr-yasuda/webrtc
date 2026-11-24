use webrtc_resources::{
    ApplyEventResult, BootId, InMemoryResourceStore, OperationId, QuotaLimit, QuotaScope,
    QuotaScopeKind, ReconciliationBatchOptions, ReconciliationError, ReconciliationJobStatus,
    Reservation, ReserveRejectionReason, ReserveResult, ResourceClaim, ResourceEvent, ResourceId,
    ResourceState, ResourceStoreOptions, TransitionRejectionReason, TransitionResult, WorkerId,
};

fn server_scope() -> QuotaScope {
    QuotaScope::new(QuotaScopeKind::Server, "server-a")
}

fn user_scope() -> QuotaScope {
    QuotaScope::new(QuotaScopeKind::User, "user-a")
}

fn claim(size_bytes: u64, ttl_ms: Option<u64>) -> ResourceClaim {
    ResourceClaim {
        scopes: vec![server_scope(), user_scope()],
        size_bytes,
        ttl_ms,
    }
}

fn operation(value: &str) -> OperationId {
    OperationId::parse(value).expect("operation id")
}

fn resource(value: &str) -> ResourceId {
    ResourceId::parse(value).expect("resource id")
}

fn worker() -> WorkerId {
    WorkerId::parse("worker-a").expect("worker id")
}

fn boot() -> BootId {
    BootId::parse("boot-1").expect("boot id")
}

fn store(max_count: u64, max_bytes: u64) -> InMemoryResourceStore {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions::new(1_000))
        .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count,
            max_bytes,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count,
            max_bytes,
        })
        .expect("set user quota");
    store
}

fn reserved(result: ReserveResult) -> Reservation {
    match result {
        ReserveResult::Reserved(reservation) => reservation,
        other => panic!("reservation failed: {other:?}"),
    }
}

fn allocate(
    store: &mut InMemoryResourceStore,
    reservation: &Reservation,
    resource_id: &str,
    operation_id: &str,
    now: u64,
) -> ApplyEventResult {
    store.apply_event(
        ResourceEvent::Allocated {
            reservation_id: reservation.id.clone(),
            resource_id: resource(resource_id),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation(operation_id),
            at: now,
        },
        now,
    )
}

#[test]
fn tombstone_が上限を超えると古いものから削除する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_released_reservations: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 3,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 3,
            max_bytes: 10,
        })
        .expect("set user quota");
    let first = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let second = reserved(store.reserve(&claim(1, None), operation("reserve-2"), 1));
    allocate(&mut store, &first, "resource-1", "allocate-1", 0);
    allocate(&mut store, &second, "resource-2", "allocate-2", 1);
    for (reservation, resource_id, now) in [(&first, "resource-1", 0), (&second, "resource-2", 1)] {
        store.apply_event(
            ResourceEvent::Released {
                reservation_id: reservation.id.clone(),
                resource_id: resource(resource_id),
                worker_id: worker(),
                boot_id: boot(),
                operation_id: operation(&format!("release-{now}")),
                at: now,
            },
            now,
        );
    }

    let evicted = store.cleanup(2);
    assert_eq!(evicted.released_reservation_count, 1);
    assert_eq!(evicted.evicted_released_reservations, 1);
    assert!(store.get_reservation(&first.id).is_none());
    assert!(store.get_reservation(&second.id).is_some());
}

#[test]
fn スコープ数が上限を超える予約を拒否する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_scopes_per_claim: 2,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    let room_scope = QuotaScope::new(QuotaScopeKind::Room, "room-a");
    let claim = ResourceClaim {
        scopes: vec![server_scope(), room_scope, user_scope()],
        size_bytes: 1,
        ttl_ms: None,
    };

    assert_eq!(
        store.reserve(&claim, operation("too-many-scopes"), 0),
        ReserveResult::Rejected(ReserveRejectionReason::InvalidClaim)
    );
}

#[test]
fn 照合ジョブは開始後の遅延確保を_target_seq_で取りこぼさない() {
    let mut store = store(3, 10);
    let delayed = reserved(store.reserve(&claim(1, None), operation("reserve-delayed"), 0));
    let allocated = reserved(store.reserve(&claim(1, None), operation("reserve-allocated"), 0));
    allocate(&mut store, &allocated, "resource-2", "allocate-1", 1);

    let job = match store.apply_event(
        ResourceEvent::WorkerStopped {
            worker_id: worker(),
            boot_id: boot(),
            confirmed_resource_ids: Vec::new(),
            operation_id: operation("worker-stopped-1"),
            at: 2,
        },
        2,
    ) {
        ApplyEventResult::ReconciliationStarted(job) => job,
        other => panic!("worker stop did not start reconciliation: {other:?}"),
    };
    assert_eq!(job.status, ReconciliationJobStatus::Pending);
    assert_eq!(job.target_count, 1);

    let first = store
        .continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor: 0,
                limit: Some(1),
            },
            2,
        )
        .expect("first batch");
    assert_eq!(first.isolated, vec![allocated.id.clone()]);
    assert!(!first.has_more);
    let cursor = first.next_cursor.expect("cursor");

    allocate(&mut store, &delayed, "resource-1", "allocate-late", 3);
    let resumed = store
        .get_reconciliation_job(&job.id)
        .expect("reconciliation job");
    assert_eq!(resumed.status, ReconciliationJobStatus::Pending);
    assert_eq!(resumed.target_count, 2);
    assert_eq!(resumed.last_target_seq, cursor);

    let second = store
        .continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor,
                limit: Some(1),
            },
            4,
        )
        .expect("second batch");
    assert_eq!(second.isolated, vec![delayed.id.clone()]);
    assert!(!second.has_more);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        2
    );
}

#[test]
fn 照合ジョブの古いカーソルと存在しないジョブを拒否する() {
    let mut store = store(2, 10);
    let job = store
        .start_reconciliation(
            &ResourceEvent::WorkerStopped {
                worker_id: worker(),
                boot_id: BootId::parse("boot-empty").expect("boot id"),
                confirmed_resource_ids: Vec::new(),
                operation_id: operation("worker-stopped-empty"),
                at: 0,
            },
            0,
        )
        .expect("reconciliation job");
    assert_eq!(
        store.continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor: 1,
                limit: None,
            },
            0,
        ),
        Err(ReconciliationError::CursorMismatch {
            expected: 0,
            actual: 1,
        })
    );
    let missing = webrtc_resources::ReconciliationJobId::parse("missing").expect("job id");
    assert_eq!(
        store.continue_reconciliation(
            &missing,
            ReconciliationBatchOptions {
                cursor: 0,
                limit: None,
            },
            0,
        ),
        Err(ReconciliationError::JobNotFound(missing))
    );
}

#[test]
fn 完了した照合ジョブだけを保持期間後に削除する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        reconciliation_job_retention_ms: 100,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    let event = ResourceEvent::WorkerStopped {
        worker_id: worker(),
        boot_id: boot(),
        confirmed_resource_ids: Vec::new(),
        operation_id: operation("worker-stopped-1"),
        at: 0,
    };
    let job = store.start_reconciliation(&event, 0).expect("job");
    assert_eq!(store.cleanup(99).deleted_reconciliation_jobs, 0);
    assert!(store.get_reconciliation_job(&job.id).is_some());
    assert_eq!(store.cleanup(100).deleted_reconciliation_jobs, 1);
    assert!(store.get_reconciliation_job(&job.id).is_none());
}

#[test]
fn 照合ジョブの容量上限を超えると開始しない() {
    let mut confirmed_store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_confirmed_resource_ids: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    assert_eq!(
        confirmed_store.start_reconciliation(
            &ResourceEvent::WorkerStopped {
                worker_id: worker(),
                boot_id: boot(),
                confirmed_resource_ids: vec![resource("resource-1"), resource("resource-2")],
                operation_id: operation("worker-stopped-1"),
                at: 0,
            },
            0,
        ),
        Err(ReconciliationError::CapacityExceeded(
            "confirmed resource capacity exceeded"
        ))
    );

    let mut target_store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_reconciliation_targets: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    target_store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set server quota");
    target_store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set user quota");
    let first = reserved(target_store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let second = reserved(target_store.reserve(&claim(1, None), operation("reserve-2"), 0));
    allocate(&mut target_store, &first, "resource-1", "allocate-1", 0);
    allocate(&mut target_store, &second, "resource-2", "allocate-2", 0);
    assert_eq!(
        target_store.start_reconciliation(
            &ResourceEvent::WorkerStopped {
                worker_id: worker(),
                boot_id: boot(),
                confirmed_resource_ids: Vec::new(),
                operation_id: operation("worker-stopped-2"),
                at: 0,
            },
            0,
        ),
        Err(ReconciliationError::CapacityExceeded(
            "reconciliation target capacity exceeded"
        ))
    );
}

#[test]
fn 照合対象の上限を超える確保通知は容量超過で拒否する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_reconciliation_targets: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    for scope in [server_scope(), user_scope()] {
        store
            .set_quota_limit(QuotaLimit {
                scope,
                max_count: 3,
                max_bytes: 10,
            })
            .expect("set quota");
    }
    let first = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let second = reserved(store.reserve(&claim(1, None), operation("reserve-2"), 0));
    allocate(&mut store, &first, "resource-1", "allocate-1", 0);
    let started = store.apply_event(
        ResourceEvent::WorkerStopped {
            worker_id: worker(),
            boot_id: boot(),
            confirmed_resource_ids: Vec::new(),
            operation_id: operation("worker-stopped-1"),
            at: 1,
        },
        1,
    );
    let ApplyEventResult::ReconciliationStarted(job) = started else {
        panic!("reconciliation did not start");
    };

    let late = allocate(&mut store, &second, "resource-2", "allocate-late", 2);
    assert_eq!(
        late,
        ApplyEventResult::Transition(TransitionResult::Rejected(
            TransitionRejectionReason::CapacityExhausted
        ))
    );
    assert_eq!(
        store
            .get_reservation(&second.id)
            .expect("reservation")
            .state,
        ResourceState::Reserved
    );
    assert_eq!(
        store
            .get_reconciliation_job(&job.id)
            .expect("reconciliation job")
            .target_count,
        1
    );
}

#[test]
fn 遅延確保と解放失敗は相関情報を補完して照合対象にする() {
    let mut store = store(2, 10);
    let delayed = reserved(store.reserve(&claim(1, None), operation("reserve-delayed"), 0));
    let failed = reserved(store.reserve(&claim(1, None), operation("reserve-failed"), 0));
    for (reservation, operation_id) in [(&delayed, "unknown-delayed"), (&failed, "unknown-failed")]
    {
        store.apply_event(
            ResourceEvent::OutcomeUnknown {
                reservation_id: reservation.id.clone(),
                operation_id: operation(operation_id),
                at: 1,
            },
            1,
        );
    }
    store.apply_event(
        ResourceEvent::ReleaseRequested {
            reservation_id: delayed.id.clone(),
            operation_id: operation("release-delayed"),
            at: 2,
        },
        2,
    );
    let delayed_applied = store.apply_event(
        ResourceEvent::Allocated {
            reservation_id: delayed.id.clone(),
            resource_id: resource("resource-delayed"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("allocate-delayed"),
            at: 3,
        },
        3,
    );
    let ApplyEventResult::Transition(TransitionResult::Applied(delayed_applied)) = delayed_applied
    else {
        panic!("delayed allocation was not applied");
    };
    assert_eq!(delayed_applied.state, ResourceState::ReleasePending);
    assert_eq!(
        delayed_applied.resource_id,
        Some(resource("resource-delayed"))
    );

    let failed_applied = store.apply_event(
        ResourceEvent::ReleaseFailed {
            reservation_id: failed.id.clone(),
            resource_id: resource("resource-failed"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-failed"),
            at: 3,
        },
        3,
    );
    let ApplyEventResult::Transition(TransitionResult::Applied(failed_applied)) = failed_applied
    else {
        panic!("release failure was not applied");
    };
    assert_eq!(failed_applied.state, ResourceState::InUse);
    assert_eq!(
        failed_applied.resource_id,
        Some(resource("resource-failed"))
    );

    let job = store
        .start_reconciliation(
            &ResourceEvent::WorkerStopped {
                worker_id: worker(),
                boot_id: boot(),
                confirmed_resource_ids: Vec::new(),
                operation_id: operation("worker-stopped-correlation"),
                at: 4,
            },
            4,
        )
        .expect("reconciliation job");
    assert_eq!(job.target_count, 2);
    let batch = store
        .continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor: 0,
                limit: None,
            },
            4,
        )
        .expect("reconciliation batch");
    assert!(batch.isolated.contains(&delayed.id));
    assert!(batch.isolated.contains(&failed.id));
}

#[test]
fn 隔離済みの資源も停止確認後に解放する() {
    let mut store = store(2, 10);
    let reserved =
        reserved(store.reserve(&claim(1, None), operation("reserve-isolated-confirmed"), 0));
    allocate(&mut store, &reserved, "resource-1", "allocate-1", 0);
    store.apply_event(
        ResourceEvent::Isolate {
            reservation_id: reserved.id.clone(),
            operation_id: operation("isolate-1"),
            at: 1,
        },
        1,
    );
    let job = store
        .start_reconciliation(
            &ResourceEvent::WorkerStopped {
                worker_id: worker(),
                boot_id: boot(),
                confirmed_resource_ids: vec![resource("resource-1")],
                operation_id: operation("worker-stopped-isolated"),
                at: 2,
            },
            2,
        )
        .expect("reconciliation job");
    let batch = store
        .continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor: 0,
                limit: None,
            },
            2,
        )
        .expect("reconciliation batch");
    assert_eq!(batch.reclaimed, vec![reserved.id.clone()]);
    assert_eq!(
        store
            .get_reservation(&reserved.id)
            .expect("reservation")
            .state,
        ResourceState::Released
    );
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        0
    );
}
