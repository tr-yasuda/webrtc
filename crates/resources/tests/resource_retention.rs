use webrtc_resources::{
    ApplyEventResult, BootId, InMemoryResourceStore, OperationId, QuotaLimit, QuotaScope,
    QuotaScopeKind, Reservation, ReserveRejectionReason, ReserveResult, ResourceClaim,
    ResourceEvent, ResourceId, ResourceStoreOptions, TransitionResult, WorkerId,
};

const DAY_MS: u64 = 24 * 60 * 60 * 1_000;

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
fn 保持期間を過ぎた操作記録と解放済み_tombstone_だけを削除する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        operation_retention_ms: DAY_MS,
        released_reservation_retention_ms: 7 * DAY_MS,
        cleanup_batch_size: 10,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set user quota");
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 0);
    store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-1"),
            at: 0,
        },
        0,
    );

    let before_expiry = store.cleanup(DAY_MS - 1);
    assert_eq!(before_expiry.deleted_operations, 0);
    assert_eq!(before_expiry.deleted_released_reservations, 0);
    assert_eq!(before_expiry.evicted_released_reservations, 0);
    assert_eq!(
        store.operation_recorded_at(&operation("reserve-1")),
        Some(0)
    );
    assert!(store.get_reservation(&reservation.id).is_some());

    let operation_expiry = store.cleanup(DAY_MS);
    assert_eq!(operation_expiry.deleted_operations, 3);
    assert_eq!(operation_expiry.deleted_released_reservations, 0);
    assert_eq!(operation_expiry.evicted_released_reservations, 0);
    assert_eq!(store.operation_recorded_at(&operation("reserve-1")), None);
    assert!(store.get_reservation(&reservation.id).is_some());

    let reservation_expiry = store.cleanup(7 * DAY_MS);
    assert_eq!(reservation_expiry.deleted_operations, 0);
    assert_eq!(reservation_expiry.deleted_released_reservations, 1);
    assert_eq!(reservation_expiry.evicted_released_reservations, 0);
    assert!(store.get_reservation(&reservation.id).is_none());
}

#[test]
fn cleanup_はバッチ件数ずつ削除する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        cleanup_batch_size: 1,
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
    store.reserve(&claim(1, None), operation("reserve-1"), 0);
    store.reserve(&claim(1, None), operation("reserve-2"), 0);

    assert_eq!(store.cleanup(DAY_MS).deleted_operations, 1);
    assert_eq!(store.cleanup(DAY_MS).deleted_operations, 1);
    assert_eq!(store.cleanup(DAY_MS).deleted_operations, 0);
}

#[test]
fn cleanup_は使用中の予約を削除しない() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        cleanup_batch_size: 10,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set user quota");
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 0);

    assert_eq!(store.cleanup(30 * DAY_MS).deleted_released_reservations, 0);
    assert_eq!(
        store
            .get_reservation(&reservation.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::InUse
    );
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );
}

#[test]
fn 操作記録が上限に達すると_cleanup_後は新規操作を拒否する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_operation_records: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set user quota");
    assert!(matches!(
        store.reserve(&claim(1, None), operation("reserve-1"), 0),
        ReserveResult::Reserved(_)
    ));

    let at_capacity = store.cleanup(0);
    assert_eq!(at_capacity.operation_count, 1);
    assert!(at_capacity.operation_capacity_exceeded);
    assert_eq!(
        store.reserve(&claim(1, None), operation("reserve-2"), 0),
        ReserveResult::Rejected(ReserveRejectionReason::CapacityExhausted)
    );

    let after_expiry = store.cleanup(DAY_MS);
    assert_eq!(after_expiry.operation_count, 0);
    assert!(!after_expiry.operation_capacity_exceeded);
    assert!(matches!(
        store.reserve(&claim(1, None), operation("reserve-3"), DAY_MS),
        ReserveResult::Reserved(_)
    ));
}

#[test]
fn 操作記録が上限に達すると新規通知も拒否する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        max_operation_records: 1,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 2,
            max_bytes: 10,
        })
        .expect("set user quota");
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    store.cleanup(0);

    let blocked = store.apply_event(
        ResourceEvent::Allocated {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("allocate-1"),
            at: 1,
        },
        1,
    );
    assert_eq!(
        blocked,
        ApplyEventResult::Transition(TransitionResult::Rejected(
            webrtc_resources::TransitionRejectionReason::CapacityExhausted
        ))
    );
    assert_eq!(
        store
            .get_reservation(&reservation.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::Reserved
    );
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );
}
