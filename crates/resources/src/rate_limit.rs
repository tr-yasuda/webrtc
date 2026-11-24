use std::collections::HashMap;

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
}

pub struct InMemoryRateLimitTable {
    entries: HashMap<String, RateLimitEntry>,
    options: RateLimitOptions,
    global_window_started_at: Option<u64>,
    global_count: u64,
    global_bytes: u64,
    entry_bytes: u64,
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

        let mut entry = match self.entries.get(key).cloned() {
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
                }
            }
        };

        entry.last_used_at = now;
        if entry.count >= self.options.max_requests_per_key
            || cost_bytes > self.options.max_bytes_per_key.saturating_sub(entry.bytes)
        {
            let reason = if entry.count >= self.options.max_requests_per_key {
                RateLimitRejectionReason::RequestLimit
            } else {
                RateLimitRejectionReason::BandwidthLimit
            };
            let retry = retry_after_ms(entry.window_started_at, self.options.window_ms, now);
            self.entries.insert(key.to_owned(), entry);
            return RateLimitDecision::rejected_with_retry(reason, retry);
        }

        entry.count += 1;
        entry.bytes += cost_bytes;
        self.entries.insert(key.to_owned(), entry);
        self.global_count += 1;
        self.global_bytes += cost_bytes;
        RateLimitDecision::allowed()
    }

    pub fn sweep(&mut self, now: u64) {
        let idle_ttl_ms = self.options.idle_ttl_ms;
        let window_ms = self.options.window_ms;
        let mut removed_bytes = 0;
        self.entries.retain(|_, entry| {
            let expired = now >= entry.last_used_at + idle_ttl_ms
                && now >= entry.window_started_at + window_ms;
            if expired {
                removed_bytes += entry.size_bytes;
            }
            !expired
        });
        self.entry_bytes = self.entry_bytes.saturating_sub(removed_bytes);
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
}

fn retry_after_ms(window_started_at: u64, window_ms: u64, now: u64) -> u64 {
    window_started_at
        .saturating_add(window_ms)
        .saturating_sub(now)
}
