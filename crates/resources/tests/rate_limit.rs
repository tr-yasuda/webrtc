use webrtc_resources::{InMemoryRateLimitTable, RateLimitOptions, RateLimitRejectionReason};

fn base_options() -> RateLimitOptions {
    RateLimitOptions {
        max_entries: 2,
        max_bytes: 100,
        entry_overhead_bytes: 8,
        idle_ttl_ms: 10,
        window_ms: 100,
        max_requests_per_key: 2,
        max_bytes_per_key: 100,
        max_requests_global: 100,
        max_bytes_global: 1_000,
    }
}

fn table(overrides: impl FnOnce(&mut RateLimitOptions)) -> InMemoryRateLimitTable {
    let mut options = base_options();
    overrides(&mut options);
    InMemoryRateLimitTable::new(options).expect("create rate limit table")
}

#[test]
fn 制限期間が残っている項目を_ttl_で早期削除しない() {
    let mut table = table(|options| {
        options.max_entries = 1;
        options.idle_ttl_ms = 5;
        options.window_ms = 100;
        options.max_requests_per_key = 1;
    });
    assert!(table.consume("source-a", 1, 0).allowed);

    table.sweep(20);
    assert_eq!(table.get_usage().entries, 1);
    let decision = table.consume("source-a", 1, 20);
    assert!(!decision.allowed);
    assert_eq!(
        decision.reason,
        Some(RateLimitRejectionReason::RequestLimit)
    );
}

#[test]
fn 上限到達時は期限切れの項目だけを回収する() {
    let mut table = table(|options| {
        options.max_entries = 1;
        options.idle_ttl_ms = 10;
        options.window_ms = 10;
    });
    assert!(table.consume("source-a", 1, 0).allowed);
    assert!(table.consume("source-b", 1, 20).allowed);
    assert_eq!(table.get_usage().entries, 1);
}

#[test]
fn 空きがなければ新規登録を抑制する() {
    let mut table = table(|options| {
        options.max_entries = 1;
        options.idle_ttl_ms = 100;
        options.window_ms = 100;
    });
    assert!(table.consume("source-a", 1, 0).allowed);
    let decision = table.consume("source-b", 1, 1);
    assert!(!decision.allowed);
    assert_eq!(decision.reason, Some(RateLimitRejectionReason::EntryLimit));
}

#[test]
fn 項目を削除して再登録してもサーバー全体の制限をリセットしない() {
    let mut table = table(|options| {
        options.max_entries = 1;
        options.idle_ttl_ms = 5;
        options.window_ms = 100;
        options.max_requests_per_key = 10;
        options.max_requests_global = 2;
    });
    assert!(table.consume("source-a", 1, 0).allowed);
    assert!(table.consume("source-a", 1, 6).allowed);
    let decision = table.consume("source-b", 1, 7);
    assert!(!decision.allowed);
    assert_eq!(
        decision.reason,
        Some(RateLimitRejectionReason::RequestLimit)
    );
}

#[test]
fn 総メモリ量の上限を超える登録を抑制する() {
    let mut table = table(|options| {
        options.max_entries = 10;
        options.max_bytes = 20;
        options.entry_overhead_bytes = 8;
    });
    assert!(table.consume("source-a", 1, 0).allowed);
    let decision = table.consume("source-b", 1, 1);
    assert!(!decision.allowed);
    assert_eq!(decision.reason, Some(RateLimitRejectionReason::ByteLimit));
}

#[test]
fn 制限期間が終われば件数をリセットする() {
    let mut table = table(|options| {
        options.max_requests_per_key = 1;
        options.window_ms = 10;
        options.idle_ttl_ms = 100;
    });
    assert!(table.consume("source-a", 1, 0).allowed);
    assert!(!table.consume("source-a", 1, 5).allowed);
    assert!(table.consume("source-a", 1, 10).allowed);
}

#[test]
fn 不正なキーは拒否する() {
    let mut table = table(|_| {});
    let decision = table.consume("", 1, 0);
    assert!(!decision.allowed);
    assert_eq!(
        decision.reason,
        Some(RateLimitRejectionReason::InvalidRequest)
    );
}

#[test]
fn キー単位と全体の帯域上限を超える要求を拒否する() {
    let mut table = table(|options| {
        options.max_entries = 10;
        options.max_bytes_per_key = 5;
        options.max_bytes_global = 7;
        options.max_requests_per_key = 10;
        options.max_requests_global = 10;
    });

    assert_eq!(
        table.consume("source-a", 6, 0).reason,
        Some(RateLimitRejectionReason::BandwidthLimit)
    );
    assert!(table.consume("source-a", 4, 0).allowed);
    assert_eq!(
        table.consume("source-b", 4, 0).reason,
        Some(RateLimitRejectionReason::BandwidthLimit)
    );
    assert_eq!(
        table.consume("source-a", 2, 0).reason,
        Some(RateLimitRejectionReason::BandwidthLimit)
    );
}
