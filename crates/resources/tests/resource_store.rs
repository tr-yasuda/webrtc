use std::sync::{Arc, Mutex};

use webrtc_resources::{
    ApplyEventResult, BootId, IgnoreReason, InMemoryResourceStore, OperationId, QuotaDeleteResult,
    QuotaLimit, QuotaScope, QuotaScopeKind, QuotaUsage, ReconciliationBatchOptions,
    ReconciliationError, ReconciliationJobStatus, Reservation, ReservationFilter,
    ReservationPageOptions, ReserveRejectionReason, ReserveResult, ResourceClaim, ResourceEvent,
    ResourceId, ResourceState, ResourceStoreOptions, TransitionRejectionReason, TransitionResult,
    WorkerId,
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
