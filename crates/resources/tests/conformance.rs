use serde::Deserialize;
use webrtc_resources::{
    ApplyEventResult, BootId, InMemoryResourceStore, OperationId, QuotaLimit, QuotaScope,
    QuotaScopeKind, ReconciliationBatchOptions, Reservation, ReserveRejectionReason, ReserveResult,
    ResourceClaim, ResourceEvent, ResourceId, ResourceStateExt, ResourceStoreOptions, WorkerId,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioFile {
    store: StoreConfig,
    quotas: Vec<QuotaConfig>,
    claim_scopes: Vec<JsonScope>,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreConfig {
    reservation_ttl_ms: u64,
    in_use_ttl_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonScope {
    kind: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaConfig {
    #[serde(flatten)]
    scope: JsonScope,
    max_count: u64,
    max_bytes: u64,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum Step {
    Reserve {
        operation: String,
        size_bytes: u64,
        ttl_ms: Option<u64>,
        now: Option<u64>,
        expect: Option<String>,
    },
    Allocate {
        reservation: usize,
        resource: String,
        operation: String,
        now: u64,
    },
    ReleaseRequested {
        reservation: usize,
        operation: String,
        now: u64,
    },
    Released {
        reservation: usize,
        resource: String,
        operation: String,
        now: u64,
    },
    ReleaseFailed {
        reservation: usize,
        resource: String,
        operation: String,
        now: u64,
    },
    OutcomeUnknown {
        reservation: usize,
        operation: String,
        now: u64,
    },
    Isolate {
        reservation: usize,
        operation: String,
        now: u64,
    },
    WorkerStopped {
        confirmed: Vec<String>,
        operation: String,
        now: u64,
    },
    Expire {
        now: u64,
    },
    Assert {
        reservation: Option<usize>,
        state: Option<String>,
        used_count: Option<u64>,
    },
}

fn scope_kind(value: &str) -> QuotaScopeKind {
    match value {
        "server" => QuotaScopeKind::Server,
        "room" => QuotaScopeKind::Room,
        "user" => QuotaScopeKind::User,
        other => panic!("unknown quota scope kind: {other}"),
    }
}

fn quota_scope(scope: &JsonScope) -> QuotaScope {
    QuotaScope::new(scope_kind(&scope.kind), scope.key.clone())
}

fn operation(value: &str) -> OperationId {
    OperationId::parse(value).expect("operation id")
}

fn resource(value: &str) -> ResourceId {
    ResourceId::parse(value).expect("resource id")
}

fn reservation_at(reservations: &[Reservation], index: usize) -> &Reservation {
    reservations
        .get(index)
        .unwrap_or_else(|| panic!("reservation {index} is missing"))
}

fn rejection_reason(value: &str) -> ReserveRejectionReason {
    match value {
        "invalid-claim" => ReserveRejectionReason::InvalidClaim,
        "limit-not-configured" => ReserveRejectionReason::LimitNotConfigured,
        "quota-exceeded" => ReserveRejectionReason::QuotaExceeded,
        other => panic!("unknown rejection reason: {other}"),
    }
}

#[test]
fn 共通シナリオで状態と計上が一致する() {
    let file: ScenarioFile = serde_json::from_str(include_str!(
        "../../../packages/resources/specs/lifecycle-scenarios.json"
    ))
    .expect("scenario file");
    let worker_id = WorkerId::parse("conformance-worker").expect("worker id");
    let boot_id = BootId::parse("conformance-boot").expect("boot id");
    let claim_scopes: Vec<QuotaScope> = file.claim_scopes.iter().map(quota_scope).collect();
    let server_scope = claim_scopes
        .iter()
        .find(|scope| scope.kind == QuotaScopeKind::Server)
        .expect("server scope")
        .clone();

    for scenario in &file.scenarios {
        let mut store = InMemoryResourceStore::new(ResourceStoreOptions {
            in_use_ttl_ms: file.store.in_use_ttl_ms,
            ..ResourceStoreOptions::new(file.store.reservation_ttl_ms)
        })
        .expect("create in-memory store");
        for quota in &file.quotas {
            store
                .set_quota_limit(QuotaLimit {
                    scope: quota_scope(&quota.scope),
                    max_count: quota.max_count,
                    max_bytes: quota.max_bytes,
                })
                .expect("set quota");
        }

        let mut reservations: Vec<Reservation> = Vec::new();
        for step in &scenario.steps {
            match step {
                Step::Reserve {
                    operation: op,
                    size_bytes,
                    ttl_ms,
                    now,
                    expect,
                } => {
                    let result = store.reserve(
                        &ResourceClaim {
                            scopes: claim_scopes.clone(),
                            size_bytes: *size_bytes,
                            ttl_ms: *ttl_ms,
                        },
                        operation(op),
                        now.unwrap_or(0),
                    );
                    if let Some(expected) = expect {
                        assert_eq!(
                            result,
                            ReserveResult::Rejected(rejection_reason(expected)),
                            "{}",
                            scenario.name
                        );
                    } else {
                        match result {
                            ReserveResult::Reserved(reservation) => reservations.push(reservation),
                            other => panic!("{}: reservation failed: {other:?}", scenario.name),
                        }
                    }
                }
                Step::Allocate {
                    reservation,
                    resource: resource_id,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::Allocated {
                            reservation_id: reservation.id.clone(),
                            resource_id: resource(resource_id),
                            worker_id: worker_id.clone(),
                            boot_id: boot_id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::ReleaseRequested {
                    reservation,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::ReleaseRequested {
                            reservation_id: reservation.id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::Released {
                    reservation,
                    resource: resource_id,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::Released {
                            reservation_id: reservation.id.clone(),
                            resource_id: resource(resource_id),
                            worker_id: worker_id.clone(),
                            boot_id: boot_id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::ReleaseFailed {
                    reservation,
                    resource: resource_id,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::ReleaseFailed {
                            reservation_id: reservation.id.clone(),
                            resource_id: resource(resource_id),
                            worker_id: worker_id.clone(),
                            boot_id: boot_id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::OutcomeUnknown {
                    reservation,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::OutcomeUnknown {
                            reservation_id: reservation.id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::Isolate {
                    reservation,
                    operation: op,
                    now,
                } => {
                    let reservation = reservation_at(&reservations, *reservation);
                    store.apply_event(
                        ResourceEvent::Isolate {
                            reservation_id: reservation.id.clone(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                }
                Step::WorkerStopped {
                    confirmed,
                    operation: op,
                    now,
                } => {
                    let result = store.apply_event(
                        ResourceEvent::WorkerStopped {
                            worker_id: worker_id.clone(),
                            boot_id: boot_id.clone(),
                            confirmed_resource_ids: confirmed
                                .iter()
                                .map(|value| resource(value))
                                .collect(),
                            operation_id: operation(op),
                            at: *now,
                        },
                        *now,
                    );
                    let ApplyEventResult::ReconciliationStarted(job) = result else {
                        panic!("{}: reconciliation did not start", scenario.name);
                    };
                    let mut cursor = 0;
                    loop {
                        let batch = store
                            .continue_reconciliation(
                                &job.id,
                                ReconciliationBatchOptions {
                                    cursor,
                                    limit: None,
                                },
                                *now,
                            )
                            .expect("reconciliation batch");
                        if !batch.has_more {
                            break;
                        }
                        cursor = batch.next_cursor.expect("reconciliation cursor is missing");
                    }
                }
                Step::Expire { now } => {
                    store.expire(*now, None);
                }
                Step::Assert {
                    reservation,
                    state,
                    used_count,
                } => {
                    if let (Some(index), Some(expected_state)) = (reservation, state) {
                        let reservation_id = reservation_at(&reservations, *index).id.clone();
                        assert_eq!(
                            store
                                .get_reservation(&reservation_id)
                                .expect("reservation")
                                .state
                                .as_str(),
                            expected_state,
                            "{}",
                            scenario.name
                        );
                    }
                    if let Some(expected_count) = used_count {
                        assert_eq!(
                            store
                                .get_quota_usage(&server_scope)
                                .expect("server usage")
                                .used_count,
                            *expected_count,
                            "{}",
                            scenario.name
                        );
                    }
                }
            }
        }
    }
}
