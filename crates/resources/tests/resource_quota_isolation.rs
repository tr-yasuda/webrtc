use webrtc_resources::{
    ApplyEventResult, BootId, IgnoreReason, InMemoryResourceStore, OperationId, QuotaDeleteResult,
    QuotaLimit, QuotaScope, QuotaScopeKind, QuotaUsage, Reservation, ReserveRejectionReason,
    ReserveResult, ResourceClaim, ResourceEvent, ResourceId, ResourceState, ResourceStoreOptions,
    TransitionResult, WorkerId,
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
fn バイト上限を下回った状態ではゼロサイズの予約も拒否する() {
    let mut store = store(2, 10);
    reserved(store.reserve(&claim(10, None), operation("reserve-1"), 0));
    for scope in [server_scope(), user_scope()] {
        store
            .set_quota_limit(QuotaLimit {
                scope,
                max_count: 2,
                max_bytes: 5,
            })
            .expect("lower quota");
    }

    assert_eq!(
        store.reserve(&claim(0, None), operation("reserve-zero"), 0),
        ReserveResult::Rejected(ReserveRejectionReason::QuotaExceeded)
    );
}

#[test]
fn 明示的な隔離は計上を維持し解放確認で返却する() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);

    let isolated = store.apply_event(
        ResourceEvent::Isolate {
            reservation_id: reservation.id.clone(),
            operation_id: operation("isolate-1"),
            at: 2,
        },
        2,
    );
    let ApplyEventResult::Transition(TransitionResult::Applied(isolated)) = isolated else {
        panic!("isolation was not applied");
    };
    assert_eq!(isolated.state, ResourceState::Isolated);
    assert_eq!(
        store.apply_event(
            ResourceEvent::Isolate {
                reservation_id: reservation.id.clone(),
                operation_id: operation("isolate-2"),
                at: 3,
            },
            3,
        ),
        ApplyEventResult::Transition(TransitionResult::Ignored(IgnoreReason::Duplicate))
    );
    assert!(!store.expire(2_000, None).has_more);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );

    let released = store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-1"),
            at: 4,
        },
        4,
    );
    let ApplyEventResult::Transition(TransitionResult::Applied(released)) = released else {
        panic!("release was not applied");
    };
    assert_eq!(released.state, ResourceState::Released);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        0
    );
}

#[test]
fn 解放済みの予約への明示的な隔離は無視する() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-1"),
            at: 2,
        },
        2,
    );

    assert_eq!(
        store.apply_event(
            ResourceEvent::Isolate {
                reservation_id: reservation.id,
                operation_id: operation("isolate-late"),
                at: 3,
            },
            3,
        ),
        ApplyEventResult::Transition(TransitionResult::Ignored(IgnoreReason::AlreadyReleased))
    );
}

#[test]
fn 使用中のスコープは削除せず解放後に削除できる() {
    let mut store = store(2, 10);
    let room_scope = QuotaScope::new(QuotaScopeKind::Room, "room-a");
    store
        .set_quota_limit(QuotaLimit {
            scope: room_scope.clone(),
            max_count: 1,
            max_bytes: 10,
        })
        .expect("set room quota");
    let reservation = reserved(store.reserve(
        &ResourceClaim::new(vec![server_scope(), room_scope.clone()], 1),
        operation("reserve-room"),
        0,
    ));
    assert_eq!(
        store.delete_quota_scope(&room_scope),
        QuotaDeleteResult::InUse(QuotaUsage {
            scope: room_scope.clone(),
            max_count: 1,
            max_bytes: 10,
            used_count: 1,
            used_bytes: 1,
        })
    );

    store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id,
            resource_id: resource("resource-room"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-room"),
            at: 1,
        },
        1,
    );
    assert_eq!(
        store.delete_quota_scope(&room_scope),
        QuotaDeleteResult::Deleted
    );
    assert!(store.get_quota_usage(&room_scope).is_none());
    assert_eq!(
        store.delete_quota_scope(&room_scope),
        QuotaDeleteResult::NotFound
    );
    assert_eq!(
        store.reserve(
            &ResourceClaim::new(vec![server_scope(), room_scope], 1),
            operation("reserve-after-delete"),
            2,
        ),
        ReserveResult::Rejected(ReserveRejectionReason::LimitNotConfigured)
    );
}
