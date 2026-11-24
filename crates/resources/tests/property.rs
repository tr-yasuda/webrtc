use proptest::prelude::*;
use webrtc_resources::{
    BootId, InMemoryResourceStore, OperationId, QuotaLimit, QuotaScope, QuotaScopeKind,
    Reservation, ReservationFilter, ReservationPageOptions, ResourceClaim, ResourceEvent,
    ResourceId, ResourceState, ResourceStateExt, ResourceStoreOptions, WorkerId,
};

#[derive(Debug, Clone)]
enum Action {
    Reserve,
    Allocate(usize),
    RequestRelease(usize),
    Release(usize),
    OutcomeUnknown(usize),
    Isolate(usize),
}

fn action() -> impl Strategy<Value = Action> {
    (0u8..6, 0usize..6).prop_map(|(kind, index)| match kind {
        0 => Action::Reserve,
        1 => Action::Allocate(index),
        2 => Action::RequestRelease(index),
        3 => Action::Release(index),
        4 => Action::OutcomeUnknown(index),
        _ => Action::Isolate(index),
    })
}

fn scope() -> QuotaScope {
    QuotaScope::new(QuotaScopeKind::Server, "property-server")
}

fn worker() -> WorkerId {
    WorkerId::parse("property-worker").expect("worker id")
}

fn boot() -> BootId {
    BootId::parse("property-boot").expect("boot id")
}

fn list_all_reservations(store: &InMemoryResourceStore) -> Vec<Reservation> {
    let mut reservations = Vec::new();
    let mut cursor = None;
    loop {
        let page = store.list_reservations_page(
            &ReservationFilter::default(),
            &ReservationPageOptions {
                cursor,
                limit: Some(2),
            },
        );
        reservations.extend(page.reservations);
        match page.next_cursor {
            Some(next_cursor) => cursor = Some(next_cursor),
            None => break,
        }
    }
    reservations
}

fn assert_accounting(store: &InMemoryResourceStore, max_count: u64) {
    let reservations = list_all_reservations(store);
    let counted = reservations
        .iter()
        .filter(|reservation| reservation.state.is_counted())
        .count() as u64;
    let usage = store.get_quota_usage(&scope()).expect("quota usage");

    assert_eq!(usage.used_count, counted);
    assert_eq!(usage.used_bytes, counted);
    assert!(counted <= max_count);
}

proptest! {
    #[test]
    fn 任意の操作列でも計上と状態の不変条件を保つ(actions in prop::collection::vec(action(), 0..30)) {
        let max_count = 3;
        let mut store = InMemoryResourceStore::new(ResourceStoreOptions::new(10_000))
            .expect("create in-memory store");
        store
            .set_quota_limit(QuotaLimit {
                scope: scope(),
                max_count,
                max_bytes: 10,
            })
            .expect("set quota");

        let mut now = 0_u64;
        let mut operation_number = 0_u64;
        let mut resource_number = 0_u64;
        for current in actions {
            now += 1;
            match current {
                Action::Reserve => {
                    store.reserve(
                        &ResourceClaim::new(vec![scope()], 1),
                        OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                        now,
                    );
                    operation_number += 1;
                }
                Action::Allocate(index) => {
                    let candidates: Vec<_> = list_all_reservations(&store)
                        .into_iter()
                        .filter(|reservation| reservation.resource_id.is_none())
                        .collect();
                    if !candidates.is_empty() {
                        let reservation = &candidates[index % candidates.len()];
                        store.apply_event(
                            ResourceEvent::Allocated {
                                reservation_id: reservation.id.clone(),
                                resource_id: ResourceId::parse(format!("resource-{resource_number}")).expect("resource id"),
                                worker_id: worker(),
                                boot_id: boot(),
                                operation_id: OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                                at: now,
                            },
                            now,
                        );
                        operation_number += 1;
                        resource_number += 1;
                    }
                }
                Action::RequestRelease(index) => {
                    let candidates: Vec<_> = list_all_reservations(&store)
                        .into_iter()
                        .filter(|reservation| reservation.state == ResourceState::InUse)
                        .collect();
                    if !candidates.is_empty() {
                        let reservation = &candidates[index % candidates.len()];
                        store.apply_event(
                            ResourceEvent::ReleaseRequested {
                                reservation_id: reservation.id.clone(),
                                operation_id: OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                                at: now,
                            },
                            now,
                        );
                        operation_number += 1;
                    }
                }
                Action::Release(index) => {
                    let candidates: Vec<_> = list_all_reservations(&store)
                        .into_iter()
                        .filter(|reservation| {
                            reservation.resource_id.is_some()
                                && reservation.state != ResourceState::Released
                        })
                        .collect();
                    if !candidates.is_empty() {
                        let reservation = &candidates[index % candidates.len()];
                        let event = ResourceEvent::Released {
                            reservation_id: reservation.id.clone(),
                            resource_id: reservation.resource_id.clone().expect("resource id"),
                            worker_id: worker(),
                            boot_id: boot(),
                            operation_id: OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                            at: now,
                        };
                        store.apply_event(event.clone(), now);
                        store.apply_event(event, now);
                        operation_number += 1;
                    }
                }
                Action::OutcomeUnknown(index) => {
                    let candidates: Vec<_> = list_all_reservations(&store)
                        .into_iter()
                        .filter(|reservation| reservation.state != ResourceState::Released)
                        .collect();
                    if !candidates.is_empty() {
                        let reservation = &candidates[index % candidates.len()];
                        store.apply_event(
                            ResourceEvent::OutcomeUnknown {
                                reservation_id: reservation.id.clone(),
                                operation_id: OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                                at: now,
                            },
                            now,
                        );
                        operation_number += 1;
                    }
                }
                Action::Isolate(index) => {
                    let candidates: Vec<_> = list_all_reservations(&store)
                        .into_iter()
                        .filter(|reservation| reservation.state != ResourceState::Released)
                        .collect();
                    if !candidates.is_empty() {
                        let reservation = &candidates[index % candidates.len()];
                        store.apply_event(
                            ResourceEvent::Isolate {
                                reservation_id: reservation.id.clone(),
                                operation_id: OperationId::parse(format!("operation-{operation_number}")).expect("operation id"),
                                at: now,
                            },
                            now,
                        );
                        operation_number += 1;
                    }
                }
            }

            assert_accounting(&store, max_count);
        }
    }
}
