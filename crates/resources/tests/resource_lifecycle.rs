use std::sync::{Arc, Mutex};

use webrtc_resources::{
    ApplyEventResult, BootId, InMemoryResourceStore, OperationId, QuotaLimit, QuotaScope,
    QuotaScopeKind, ReconciliationBatchOptions, Reservation, ReservationFilter,
    ReservationPageOptions, ReserveRejectionReason, ReserveResult, ResourceClaim, ResourceEvent,
    ResourceId, ResourceStoreOptions, TransitionResult, WorkerId,
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
fn 空き枠1への並行要求では1件だけ確保に成功する() {
    let store = Arc::new(Mutex::new(store(1, 10)));
    let mut handles = Vec::new();
    for index in 0..2 {
        let store = Arc::clone(&store);
        handles.push(std::thread::spawn(move || {
            store.lock().expect("lock store").reserve(
                &claim(1, None),
                operation(&format!("reserve-{index}")),
                0,
            )
        }));
    }

    let results: Vec<ReserveResult> = handles
        .into_iter()
        .map(|handle| handle.join().expect("join thread"))
        .collect();
    let successes = results
        .iter()
        .filter(|result| matches!(result, ReserveResult::Reserved(_)))
        .count();
    assert_eq!(successes, 1);
    assert_eq!(
        store
            .lock()
            .expect("lock store")
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );
}

#[test]
fn 確保通知が重複しても計上を増やさない() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let first = allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    let duplicate = allocate(&mut store, &reservation, "resource-1", "allocate-1", 2);

    assert_eq!(first, duplicate);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );
}

#[test]
fn 解放通知の消失後も照合で解放を確定できる() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    store.apply_event(
        ResourceEvent::ReleaseRequested {
            reservation_id: reservation.id.clone(),
            operation_id: operation("release-request"),
            at: 2,
        },
        2,
    );
    store.apply_event(
        ResourceEvent::OutcomeUnknown {
            reservation_id: reservation.id.clone(),
            operation_id: operation("release-unknown"),
            at: 3,
        },
        3,
    );

    let released = store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-confirmed"),
            at: 4,
        },
        4,
    );

    assert!(matches!(
        released,
        ApplyEventResult::Transition(TransitionResult::Applied(_))
    ));
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        0
    );
}

#[test]
fn 確保直後の完了通知を失っても照合で結果を確定する() {
    let mut store = store(1, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    store.apply_event(
        ResourceEvent::OutcomeUnknown {
            reservation_id: reservation.id.clone(),
            operation_id: operation("allocate-unknown"),
            at: 1,
        },
        1,
    );
    assert_eq!(
        store.reserve(&claim(1, None), operation("reserve-2"), 2),
        ReserveResult::Rejected(ReserveRejectionReason::QuotaExceeded)
    );

    let resolved = allocate(
        &mut store,
        &reservation,
        "resource-1",
        "allocate-recovered",
        3,
    );
    assert!(matches!(
        resolved,
        ApplyEventResult::Transition(TransitionResult::Applied(_))
    ));
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
fn 解放通知が重複しても二重返却しない() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    let event = ResourceEvent::Released {
        reservation_id: reservation.id.clone(),
        resource_id: resource("resource-1"),
        worker_id: worker(),
        boot_id: boot(),
        operation_id: operation("release-1"),
        at: 2,
    };
    store.apply_event(event.clone(), 2);
    store.apply_event(event, 2);
    let late = store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-2"),
            at: 3,
        },
        3,
    );

    assert_eq!(
        late,
        ApplyEventResult::Transition(TransitionResult::Ignored(
            webrtc_resources::IgnoreReason::AlreadyReleased
        ))
    );
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        0
    );
}

#[test]
fn worker_再起動後は解放を確認できた資源だけを回収する() {
    let mut store = store(3, 10);
    let first = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let second = reserved(store.reserve(&claim(1, None), operation("reserve-2"), 0));
    allocate(&mut store, &first, "resource-1", "allocate-1", 1);
    allocate(&mut store, &second, "resource-2", "allocate-2", 1);

    let result = store.apply_event(
        ResourceEvent::WorkerStopped {
            worker_id: worker(),
            boot_id: boot(),
            confirmed_resource_ids: vec![resource("resource-1")],
            operation_id: operation("worker-stopped-1"),
            at: 2,
        },
        2,
    );
    let ApplyEventResult::ReconciliationStarted(job) = result else {
        panic!("worker stop did not start reconciliation");
    };
    let reclaimed = store
        .continue_reconciliation(
            &job.id,
            ReconciliationBatchOptions {
                cursor: 0,
                limit: None,
            },
            2,
        )
        .expect("reconciliation batch");
    assert_eq!(reclaimed.reclaimed, vec![first.id.clone()]);
    assert_eq!(reclaimed.isolated, vec![second.id.clone()]);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );

    let stale = store.apply_event(
        ResourceEvent::Released {
            reservation_id: second.id.clone(),
            resource_id: resource("resource-2"),
            worker_id: worker(),
            boot_id: BootId::parse("boot-2").expect("boot id"),
            operation_id: operation("release-stale"),
            at: 3,
        },
        3,
    );
    assert_eq!(
        stale,
        ApplyEventResult::Transition(TransitionResult::Ignored(
            webrtc_resources::IgnoreReason::StaleBoot
        ))
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
fn 結果不明の間は枠を返却しない() {
    let mut store = store(1, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    store.apply_event(
        ResourceEvent::OutcomeUnknown {
            reservation_id: reservation.id.clone(),
            operation_id: operation("unknown-1"),
            at: 2,
        },
        2,
    );

    let second = store.reserve(&claim(1, None), operation("reserve-2"), 3);
    assert_eq!(
        second,
        ReserveResult::Rejected(ReserveRejectionReason::QuotaExceeded)
    );
}

#[test]
fn 期限切れの予約は解放し使用中の資源は隔離して計上を続ける() {
    let mut store = store(2, 10);
    let first = reserved(store.reserve(&claim(1, Some(10)), operation("reserve-1"), 0));
    assert_eq!(store.expire(10, None).released, vec![first.id.clone()]);
    assert_eq!(
        store.get_reservation(&first.id).expect("reservation").state,
        webrtc_resources::ResourceState::Released
    );

    let in_use = reserved(store.reserve(&claim(1, Some(10)), operation("reserve-2"), 0));
    allocate(&mut store, &in_use, "resource-2", "allocate-2", 1);
    assert_eq!(store.expire(10, None).isolated, vec![in_use.id.clone()]);
    assert_eq!(
        store
            .get_reservation(&in_use.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::Isolated
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
fn expire_は_limit_件ずつ処理し隔離済みを次回対象にしない() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        reconciliation_batch_size: 2,
        ..ResourceStoreOptions::new(1_000)
    })
    .expect("create in-memory store");
    store
        .set_quota_limit(QuotaLimit {
            scope: server_scope(),
            max_count: 5,
            max_bytes: 10,
        })
        .expect("set server quota");
    store
        .set_quota_limit(QuotaLimit {
            scope: user_scope(),
            max_count: 5,
            max_bytes: 10,
        })
        .expect("set user quota");
    let _first = reserved(store.reserve(&claim(1, Some(5)), operation("reserve-1"), 0));
    let second = reserved(store.reserve(&claim(1, Some(5)), operation("reserve-2"), 0));
    let _third = reserved(store.reserve(&claim(1, Some(5)), operation("reserve-3"), 0));
    allocate(&mut store, &second, "resource-2", "allocate-2", 0);

    let first_batch = store.expire(5, Some(2));
    assert_eq!(first_batch.released.len() + first_batch.isolated.len(), 2);
    assert!(first_batch.has_more);

    let second_batch = store.expire(5, Some(2));
    assert_eq!(second_batch.released.len() + second_batch.isolated.len(), 1);
    assert!(!second_batch.has_more);

    let third_batch = store.expire(5, Some(2));
    assert!(third_batch.released.is_empty());
    assert!(third_batch.isolated.is_empty());
    assert!(!third_batch.has_more);
    assert_eq!(
        store
            .get_reservation(&second.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::Isolated
    );
}

#[test]
fn 予約と資源の対応が違う通知を拒否する() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    let mismatched = store.apply_event(
        ResourceEvent::Released {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-2"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-1"),
            at: 2,
        },
        2,
    );

    assert_eq!(
        mismatched,
        ApplyEventResult::Transition(TransitionResult::Rejected(
            webrtc_resources::TransitionRejectionReason::CorrelationMismatch
        ))
    );
    assert_eq!(
        store
            .get_reservation(&reservation.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::InUse
    );
}

#[test]
fn 同じ操作idの再送は保存済みの結果を返す() {
    let mut store = store(2, 10);
    let first = store.reserve(&claim(1, None), operation("reserve-1"), 0);
    let second = store.reserve(&claim(1, None), operation("reserve-1"), 0);

    assert_eq!(first, second);
    assert_eq!(
        store
            .get_quota_usage(&server_scope())
            .expect("quota usage")
            .used_count,
        1
    );
}

#[test]
fn 上限が未設定のスコープでは予約を拒否する() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions::new(1_000))
        .expect("create in-memory store");
    let result = store.reserve(&claim(1, None), operation("reserve-1"), 0);

    assert_eq!(
        result,
        ReserveResult::Rejected(ReserveRejectionReason::LimitNotConfigured)
    );
}

#[test]
fn 一覧は指定した所有者と状態で絞り込める() {
    let mut store = store(2, 10);
    let first = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    let _second = reserved(store.reserve(&claim(1, None), operation("reserve-2"), 0));
    allocate(&mut store, &first, "resource-1", "allocate-1", 1);

    let page = store.list_reservations_page(
        &ReservationFilter {
            worker_id: Some(worker()),
            boot_id: Some(boot()),
            state: Some(webrtc_resources::ResourceState::InUse),
        },
        &ReservationPageOptions::default(),
    );
    assert_eq!(page.reservations.len(), 1);
    assert_eq!(page.reservations[0].id, first.id);
}

#[test]
fn 内部一覧は_id_順にページングし重複欠落しない() {
    let mut store = store(5, 10);
    let mut expected = Vec::new();
    for index in 0..5 {
        expected.push(
            reserved(store.reserve(&claim(1, None), operation(&format!("reserve-{index}")), 0)).id,
        );
    }
    expected.sort();

    let mut collected = Vec::new();
    let mut cursor = None;
    loop {
        let page = store.list_reservations_page(
            &ReservationFilter::default(),
            &ReservationPageOptions {
                cursor,
                limit: Some(2),
            },
        );
        collected.extend(
            page.reservations
                .iter()
                .map(|reservation| reservation.id.clone()),
        );
        match page.next_cursor {
            Some(next_cursor) => cursor = Some(next_cursor),
            None => break,
        }
    }

    assert_eq!(collected, expected);
}

#[test]
fn 操作記録の監査時刻を保存する() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));

    assert_eq!(
        store.operation_occurred_at(&operation("reserve-1")),
        Some(0)
    );
    store.apply_event(
        ResourceEvent::Allocated {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("allocate-1"),
            at: 20,
        },
        30,
    );
    assert_eq!(
        store.operation_occurred_at(&operation("allocate-1")),
        Some(20)
    );
    assert_eq!(
        store.operation_recorded_at(&operation("allocate-1")),
        Some(30)
    );
}

#[test]
fn 解放失敗では使用中に戻り計上を維持する() {
    let mut store = store(2, 10);
    let reservation = reserved(store.reserve(&claim(1, None), operation("reserve-1"), 0));
    allocate(&mut store, &reservation, "resource-1", "allocate-1", 1);
    store.apply_event(
        ResourceEvent::ReleaseRequested {
            reservation_id: reservation.id.clone(),
            operation_id: operation("release-request"),
            at: 2,
        },
        2,
    );

    let failed = store.apply_event(
        ResourceEvent::ReleaseFailed {
            reservation_id: reservation.id.clone(),
            resource_id: resource("resource-1"),
            worker_id: worker(),
            boot_id: boot(),
            operation_id: operation("release-failed"),
            at: 3,
        },
        3,
    );

    assert!(matches!(
        failed,
        ApplyEventResult::Transition(TransitionResult::Applied(_))
    ));
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
fn 使用中の_ttl_が確保後の期限を上書きする() {
    let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
        in_use_ttl_ms: Some(5),
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
    assert_eq!(
        store
            .get_reservation(&reservation.id)
            .expect("reservation")
            .expires_at,
        Some(5)
    );
    assert!(store.expire(4, None).released.is_empty());
    assert_eq!(store.expire(5, None).isolated, vec![reservation.id.clone()]);
    assert_eq!(
        store
            .get_reservation(&reservation.id)
            .expect("reservation")
            .state,
        webrtc_resources::ResourceState::Isolated
    );
}

#[test]
fn ルーム単位の上限を超える予約を拒否する() {
    let room_scope = QuotaScope::new(QuotaScopeKind::Room, "room-a");
    let mut store = store(5, 10);
    store
        .set_quota_limit(QuotaLimit {
            scope: room_scope.clone(),
            max_count: 1,
            max_bytes: 10,
        })
        .expect("set room quota");
    let room_claim = ResourceClaim {
        scopes: vec![server_scope(), room_scope.clone(), user_scope()],
        size_bytes: 1,
        ttl_ms: None,
    };

    assert!(matches!(
        store.reserve(&room_claim, operation("room-1"), 0),
        ReserveResult::Reserved(_)
    ));
    assert_eq!(
        store.reserve(&room_claim, operation("room-2"), 0),
        ReserveResult::Rejected(ReserveRejectionReason::QuotaExceeded)
    );
    assert_eq!(
        store
            .get_quota_usage(&room_scope)
            .expect("room usage")
            .used_count,
        1
    );
}

#[test]
fn server_スコープがない予約を拒否する() {
    let mut store = store(2, 10);
    let user_only_claim = ResourceClaim {
        scopes: vec![user_scope()],
        size_bytes: 1,
        ttl_ms: None,
    };

    assert_eq!(
        store.reserve(&user_only_claim, operation("reserve-user-only"), 0),
        ReserveResult::Rejected(ReserveRejectionReason::InvalidClaim)
    );
    assert_eq!(
        store
            .get_quota_usage(&user_scope())
            .expect("user usage")
            .used_count,
        0
    );
}
