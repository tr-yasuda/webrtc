use std::fmt;

use crate::id::{BootId, OperationId, ReconciliationJobId, ReservationId, ResourceId, WorkerId};
use crate::state::ResourceState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum QuotaScopeKind {
    Server,
    Room,
    User,
}

impl QuotaScopeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Server => "server",
            Self::Room => "room",
            Self::User => "user",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QuotaScope {
    pub kind: QuotaScopeKind,
    pub key: String,
}

impl QuotaScope {
    pub fn new(kind: QuotaScopeKind, key: impl Into<String>) -> Self {
        Self {
            kind,
            key: key.into(),
        }
    }

    pub fn storage_key(&self) -> String {
        format!("{}:{}", self.kind.as_str(), self.key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotaLimit {
    pub scope: QuotaScope,
    pub max_count: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotaUsage {
    pub scope: QuotaScope,
    pub max_count: u64,
    pub max_bytes: u64,
    pub used_count: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuotaDeleteResult {
    Deleted,
    InUse(QuotaUsage),
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceClaim {
    /// サーバー全体の上限を適用するため、`server` スコープを1つ以上含める。
    pub scopes: Vec<QuotaScope>,
    pub size_bytes: u64,
    pub ttl_ms: Option<u64>,
}

impl ResourceClaim {
    pub fn new(scopes: Vec<QuotaScope>, size_bytes: u64) -> Self {
        Self {
            scopes,
            size_bytes,
            ttl_ms: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    pub id: ReservationId,
    pub state: ResourceState,
    pub scopes: Vec<QuotaScope>,
    pub size_bytes: u64,
    pub resource_id: Option<ResourceId>,
    pub worker_id: Option<WorkerId>,
    pub boot_id: Option<BootId>,
    pub version: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceEvent {
    Allocated {
        reservation_id: ReservationId,
        resource_id: ResourceId,
        worker_id: WorkerId,
        boot_id: BootId,
        operation_id: OperationId,
        at: u64,
    },
    ReleaseRequested {
        reservation_id: ReservationId,
        operation_id: OperationId,
        at: u64,
    },
    Released {
        reservation_id: ReservationId,
        resource_id: ResourceId,
        worker_id: WorkerId,
        boot_id: BootId,
        operation_id: OperationId,
        at: u64,
    },
    ReleaseFailed {
        reservation_id: ReservationId,
        resource_id: ResourceId,
        worker_id: WorkerId,
        boot_id: BootId,
        operation_id: OperationId,
        at: u64,
    },
    OutcomeUnknown {
        reservation_id: ReservationId,
        operation_id: OperationId,
        at: u64,
    },
    Isolate {
        reservation_id: ReservationId,
        operation_id: OperationId,
        at: u64,
    },
    WorkerStopped {
        worker_id: WorkerId,
        boot_id: BootId,
        confirmed_resource_ids: Vec<ResourceId>,
        operation_id: OperationId,
        at: u64,
    },
}

impl ResourceEvent {
    pub fn operation_id(&self) -> &OperationId {
        match self {
            Self::Allocated { operation_id, .. }
            | Self::ReleaseRequested { operation_id, .. }
            | Self::Released { operation_id, .. }
            | Self::ReleaseFailed { operation_id, .. }
            | Self::OutcomeUnknown { operation_id, .. }
            | Self::Isolate { operation_id, .. }
            | Self::WorkerStopped { operation_id, .. } => operation_id,
        }
    }

    pub fn at(&self) -> u64 {
        match self {
            Self::Allocated { at, .. }
            | Self::ReleaseRequested { at, .. }
            | Self::Released { at, .. }
            | Self::ReleaseFailed { at, .. }
            | Self::OutcomeUnknown { at, .. }
            | Self::Isolate { at, .. }
            | Self::WorkerStopped { at, .. } => *at,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveRejectionReason {
    InvalidClaim,
    LimitNotConfigured,
    QuotaExceeded,
    CapacityExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionRejectionReason {
    NotFound,
    InvalidTransition,
    CorrelationMismatch,
    CapacityExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreReason {
    Duplicate,
    AlreadyReleased,
    StaleBoot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReserveResult {
    Reserved(Reservation),
    Rejected(ReserveRejectionReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransitionResult {
    Applied(Reservation),
    Ignored(IgnoreReason),
    Rejected(TransitionRejectionReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconciliationJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

impl ReconciliationJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciliationJob {
    pub id: ReconciliationJobId,
    pub worker_id: WorkerId,
    pub boot_id: BootId,
    pub status: ReconciliationJobStatus,
    pub last_target_seq: u64,
    pub target_count: usize,
    pub target_bytes: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconciliationBatchOptions {
    pub cursor: u64,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciliationBatchResult {
    pub reclaimed: Vec<ReservationId>,
    pub isolated: Vec<ReservationId>,
    pub unchanged: Vec<ReservationId>,
    pub next_cursor: Option<u64>,
    pub has_more: bool,
    pub status: ReconciliationJobStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReconciliationError {
    InvalidEvent(&'static str),
    JobNotFound(ReconciliationJobId),
    CursorMismatch { expected: u64, actual: u64 },
    CapacityExceeded(&'static str),
}

impl fmt::Display for ReconciliationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEvent(message) => formatter.write_str(message),
            Self::JobNotFound(job_id) => {
                write!(formatter, "reconciliation job not found: {job_id}")
            }
            Self::CursorMismatch { expected, actual } => {
                write!(
                    formatter,
                    "reconciliation cursor mismatch: expected {expected}, got {actual}"
                )
            }
            Self::CapacityExceeded(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ReconciliationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplyEventResult {
    Transition(TransitionResult),
    ReconciliationStarted(ReconciliationJob),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceStoreOptions {
    pub reservation_ttl_ms: u64,
    pub in_use_ttl_ms: Option<u64>,
    pub operation_retention_ms: u64,
    pub released_reservation_retention_ms: u64,
    pub cleanup_batch_size: usize,
    pub max_operation_records: usize,
    pub max_released_reservations: usize,
    pub max_scopes_per_claim: usize,
    pub reconciliation_batch_size: usize,
    pub reconciliation_job_retention_ms: u64,
    pub max_confirmed_resource_ids: usize,
    pub max_confirmed_resource_bytes: u64,
    pub max_reconciliation_targets: usize,
    pub max_reconciliation_target_bytes: u64,
}

pub const DEFAULT_OPERATION_RETENTION_MS: u64 = 24 * 60 * 60 * 1_000;
pub const DEFAULT_RELEASED_RESERVATION_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const DEFAULT_CLEANUP_BATCH_SIZE: usize = 1_000;
pub const DEFAULT_MAX_OPERATION_RECORDS: usize = 100_000;
pub const DEFAULT_MAX_RELEASED_RESERVATIONS: usize = 100_000;
pub const DEFAULT_MAX_SCOPES_PER_CLAIM: usize = 16;
pub const DEFAULT_RECONCILIATION_BATCH_SIZE: usize = 1_000;
pub const DEFAULT_RECONCILIATION_JOB_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const DEFAULT_MAX_CONFIRMED_RESOURCE_IDS: usize = 10_000;
pub const DEFAULT_MAX_CONFIRMED_RESOURCE_BYTES: u64 = 2 * 1024 * 1024;
pub const DEFAULT_MAX_RECONCILIATION_TARGETS: usize = 100_000;
pub const DEFAULT_MAX_RECONCILIATION_TARGET_BYTES: u64 = 16 * 1024 * 1024;

impl ResourceStoreOptions {
    pub fn new(reservation_ttl_ms: u64) -> Self {
        Self {
            reservation_ttl_ms,
            in_use_ttl_ms: None,
            operation_retention_ms: DEFAULT_OPERATION_RETENTION_MS,
            released_reservation_retention_ms: DEFAULT_RELEASED_RESERVATION_RETENTION_MS,
            cleanup_batch_size: DEFAULT_CLEANUP_BATCH_SIZE,
            max_operation_records: DEFAULT_MAX_OPERATION_RECORDS,
            max_released_reservations: DEFAULT_MAX_RELEASED_RESERVATIONS,
            max_scopes_per_claim: DEFAULT_MAX_SCOPES_PER_CLAIM,
            reconciliation_batch_size: DEFAULT_RECONCILIATION_BATCH_SIZE,
            reconciliation_job_retention_ms: DEFAULT_RECONCILIATION_JOB_RETENTION_MS,
            max_confirmed_resource_ids: DEFAULT_MAX_CONFIRMED_RESOURCE_IDS,
            max_confirmed_resource_bytes: DEFAULT_MAX_CONFIRMED_RESOURCE_BYTES,
            max_reconciliation_targets: DEFAULT_MAX_RECONCILIATION_TARGETS,
            max_reconciliation_target_bytes: DEFAULT_MAX_RECONCILIATION_TARGET_BYTES,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReservationFilter {
    pub worker_id: Option<WorkerId>,
    pub boot_id: Option<BootId>,
    pub state: Option<ResourceState>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReservationPageOptions {
    pub cursor: Option<ReservationId>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationPage {
    pub reservations: Vec<Reservation>,
    pub next_cursor: Option<ReservationId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionCleanupResult {
    pub deleted_operations: usize,
    pub deleted_released_reservations: usize,
    pub evicted_released_reservations: usize,
    pub operation_count: usize,
    pub released_reservation_count: usize,
    pub operation_capacity_exceeded: bool,
    pub deleted_reconciliation_jobs: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpireBatchResult {
    pub released: Vec<ReservationId>,
    pub isolated: Vec<ReservationId>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceStoreError {
    InvalidOptions(&'static str),
    InvalidQuota,
    InvalidClaim,
    QuotaMissing(String),
    QuotaAccountingInconsistent(String),
}

impl fmt::Display for ResourceStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOptions(message) => write!(formatter, "{message}"),
            Self::InvalidQuota => formatter.write_str("quota limits are invalid"),
            Self::InvalidClaim => formatter.write_str("resource claim is invalid"),
            Self::QuotaMissing(key) => write!(formatter, "quota is missing for {key}"),
            Self::QuotaAccountingInconsistent(key) => {
                write!(formatter, "quota accounting is inconsistent for {key}")
            }
        }
    }
}

impl std::error::Error for ResourceStoreError {}
