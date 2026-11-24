use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::sync::Arc;

use crate::contract::ResourceStoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitRejectionReason {
    InvalidRequest,
    EntryLimit,
    ByteLimit,
    RequestLimit,
    BandwidthLimit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub reason: Option<RateLimitRejectionReason>,
    pub retry_after_ms: Option<u64>,
}

impl RateLimitDecision {
    pub fn allowed() -> Self {
        Self {
            allowed: true,
            reason: None,
            retry_after_ms: None,
        }
    }

    pub fn rejected(reason: RateLimitRejectionReason) -> Self {
        Self {
            allowed: false,
            reason: Some(reason),
            retry_after_ms: None,
        }
    }

    pub fn rejected_with_retry(reason: RateLimitRejectionReason, retry_after_ms: u64) -> Self {
        Self {
            allowed: false,
            reason: Some(reason),
            retry_after_ms: Some(retry_after_ms),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RateLimitOptions {
    pub max_entries: usize,
    pub max_bytes: u64,
    pub entry_overhead_bytes: u64,
    pub idle_ttl_ms: u64,
    pub window_ms: u64,
    pub max_requests_per_key: u64,
    pub max_bytes_per_key: u64,
    pub max_requests_global: u64,
    pub max_bytes_global: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitUsage {
    pub entries: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone)]
struct RateLimitEntry {
    window_started_at: u64,
    count: u64,
    bytes: u64,
    last_used_at: u64,
    size_bytes: u64,
    expires_at: u64,
    generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpiryRecord {
    key: Arc<str>,
    expires_at: u64,
    generation: u64,
}

impl Ord for ExpiryRecord {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.expires_at
            .cmp(&other.expires_at)
            .then_with(|| self.key.cmp(&other.key))
    }
}

impl PartialOrd for ExpiryRecord {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

pub struct InMemoryRateLimitTable {
    entries: HashMap<Arc<str>, RateLimitEntry>,
    options: RateLimitOptions,
    global_window_started_at: Option<u64>,
    global_count: u64,
    global_bytes: u64,
    entry_bytes: u64,
    expiry_heap: BinaryHeap<Reverse<ExpiryRecord>>,
}

impl InMemoryRateLimitTable {
    pub fn new(options: RateLimitOptions) -> Result<Self, ResourceStoreError> {
        if options.max_entries == 0
            || options.max_bytes == 0
            || options.idle_ttl_ms == 0
            || options.window_ms == 0
            || options.max_requests_per_key == 0
            || options.max_bytes_per_key == 0
            || options.max_requests_global == 0
            || options.max_bytes_global == 0
        {
            return Err(ResourceStoreError::InvalidOptions(
                "rate limit capacities and durations must be positive",
            ));
        }

        Ok(Self {
            entries: HashMap::new(),
            options,
            global_window_started_at: None,
            global_count: 0,
            global_bytes: 0,
            entry_bytes: 0,
            expiry_heap: BinaryHeap::new(),
        })
    }

    pub fn consume(&mut self, key: &str, cost_bytes: u64, now: u64) -> RateLimitDecision {
        if key.is_empty() {
            return RateLimitDecision::rejected(RateLimitRejectionReason::InvalidRequest);
        }
        if cost_bytes > self.options.max_bytes_per_key {
            return RateLimitDecision::rejected(RateLimitRejectionReason::BandwidthLimit);
        }

        let global_start = self.reset_global_window(now);
        if self.global_count >= self.options.max_requests_global
            || cost_bytes
                > self
                    .options
                    .max_bytes_global
                    .saturating_sub(self.global_bytes)
        {
            return RateLimitDecision::rejected_with_retry(
                if self.global_count >= self.options.max_requests_global {
                    RateLimitRejectionReason::RequestLimit
                } else {
                    RateLimitRejectionReason::BandwidthLimit
                },
                retry_after_ms(global_start, self.options.window_ms, now),
            );
        }

        let key = self
            .entries
            .get_key_value(key)
            .map(|(stored, _)| Arc::clone(stored))
            .unwrap_or_else(|| Arc::from(key));
        let mut entry = match self.entries.get(key.as_ref()).cloned() {
            Some(existing) => {
                let mut entry = existing;
                if now >= entry.window_started_at + self.options.window_ms {
                    entry.window_started_at = now;
                    entry.count = 0;
                    entry.bytes = 0;
                }
                entry
            }
            None => {
                self.sweep(now);
                if self.entries.len() >= self.options.max_entries {
                    return RateLimitDecision::rejected(RateLimitRejectionReason::EntryLimit);
                }
                let size_bytes = self
                    .options
                    .entry_overhead_bytes
                    .saturating_add(key.len() as u64);
                if size_bytes > self.options.max_bytes.saturating_sub(self.entry_bytes) {
                    return RateLimitDecision::rejected(RateLimitRejectionReason::ByteLimit);
                }
                self.entry_bytes += size_bytes;
                RateLimitEntry {
                    window_started_at: now,
                    count: 0,
                    bytes: 0,
                    last_used_at: now,
                    size_bytes,
                    expires_at: 0,
                    generation: 0,
                }
            }
        };

        entry.last_used_at = now;
        self.refresh_expiry(&key, &mut entry);
        if entry.count >= self.options.max_requests_per_key
            || cost_bytes > self.options.max_bytes_per_key.saturating_sub(entry.bytes)
        {
            let reason = if entry.count >= self.options.max_requests_per_key {
                RateLimitRejectionReason::RequestLimit
            } else {
                RateLimitRejectionReason::BandwidthLimit
            };
            let retry = retry_after_ms(entry.window_started_at, self.options.window_ms, now);
            self.entries.insert(key, entry);
            self.compact_expiry_heap();
            return RateLimitDecision::rejected_with_retry(reason, retry);
        }

        entry.count += 1;
        entry.bytes += cost_bytes;
        self.entries.insert(key, entry);
        self.compact_expiry_heap();
        self.global_count += 1;
        self.global_bytes += cost_bytes;
        RateLimitDecision::allowed()
    }

    pub fn sweep(&mut self, now: u64) {
        loop {
            let Some(Reverse(record)) = self.expiry_heap.peek() else {
                return;
            };
            if record.expires_at > now {
                return;
            }
            let record = self.expiry_heap.pop().expect("expiry record was peeked").0;
            let Some(entry) = self.entries.get(record.key.as_ref()) else {
                continue;
            };
            if entry.generation != record.generation || entry.expires_at != record.expires_at {
                continue;
            }
            let removed_bytes = entry.size_bytes;
            self.entries.remove(record.key.as_ref());
            self.entry_bytes = self.entry_bytes.saturating_sub(removed_bytes);
        }
    }

    pub fn get_usage(&self) -> RateLimitUsage {
        RateLimitUsage {
            entries: self.entries.len(),
            bytes: self.entry_bytes,
        }
    }

    fn reset_global_window(&mut self, now: u64) -> u64 {
        match self.global_window_started_at {
            Some(start) if now < start + self.options.window_ms => start,
            _ => {
                self.global_window_started_at = Some(now);
                self.global_count = 0;
                self.global_bytes = 0;
                now
            }
        }
    }

    fn refresh_expiry(&mut self, key: &Arc<str>, entry: &mut RateLimitEntry) {
        entry.generation += 1;
        entry.expires_at = (entry.last_used_at + self.options.idle_ttl_ms)
            .max(entry.window_started_at + self.options.window_ms);
        self.expiry_heap.push(Reverse(ExpiryRecord {
            key: Arc::clone(key),
            expires_at: entry.expires_at,
            generation: entry.generation,
        }));
    }

    fn compact_expiry_heap(&mut self) {
        let limit = self.entries.len().saturating_mul(2).max(64);
        if self.expiry_heap.len() <= limit {
            return;
        }
        self.expiry_heap.clear();
        for (key, entry) in &self.entries {
            self.expiry_heap.push(Reverse(ExpiryRecord {
                key: Arc::clone(key),
                expires_at: entry.expires_at,
                generation: entry.generation,
            }));
        }
    }
}

fn retry_after_ms(window_started_at: u64, window_ms: u64, now: u64) -> u64 {
    window_started_at
        .saturating_add(window_ms)
        .saturating_sub(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> RateLimitOptions {
        RateLimitOptions {
            max_entries: 10,
            max_bytes: 100,
            entry_overhead_bytes: 8,
            idle_ttl_ms: 1_000_000,
            window_ms: 1_000_000,
            max_requests_per_key: 1,
            max_bytes_per_key: 100,
            max_requests_global: 1_000_000,
            max_bytes_global: 1_000_000,
        }
    }

    #[test]
    fn 同一キーへの拒否要求で期限索引が無制限に増えない() {
        let mut table = InMemoryRateLimitTable::new(options()).expect("create rate limit table");
        assert!(table.consume("source-a", 1, 0).allowed);
        for now in 1..=10_000 {
            let _ = table.consume("source-a", 1, now);
        }

        assert!(table.expiry_heap.len() <= 64);
    }
}
