use std::fmt;

pub use webrtc_domain::ResourceState;

// ResourceState は webrtc-domain の公開型のため、遷移判定は拡張 trait として追加する。
pub trait ResourceStateExt: Sized {
    const ALL: [Self; 6];

    fn as_str(&self) -> &'static str;
    fn is_counted(&self) -> bool;
    fn can_transition_to(&self, next: Self) -> bool;
    fn assert_transition_to(&self, next: Self) -> Result<(), ResourceTransitionError>;
}

impl ResourceStateExt for ResourceState {
    const ALL: [Self; 6] = [
        Self::Reserved,
        Self::InUse,
        Self::ReleasePending,
        Self::Isolated,
        Self::Released,
        Self::ResultUnknown,
    ];

    fn as_str(&self) -> &'static str {
        match *self {
            Self::Reserved => "reserved",
            Self::InUse => "in-use",
            Self::ReleasePending => "release-pending",
            Self::Isolated => "isolated",
            Self::Released => "released",
            Self::ResultUnknown => "result-unknown",
        }
    }

    fn is_counted(&self) -> bool {
        *self != Self::Released
    }

    fn can_transition_to(&self, next: Self) -> bool {
        matches!(
            (*self, next),
            (
                Self::Reserved,
                Self::InUse | Self::Released | Self::Isolated | Self::ResultUnknown
            ) | (
                Self::InUse,
                Self::ReleasePending | Self::Released | Self::Isolated | Self::ResultUnknown
            ) | (
                Self::ReleasePending,
                Self::InUse | Self::Released | Self::Isolated | Self::ResultUnknown
            ) | (
                Self::ResultUnknown,
                Self::InUse | Self::ReleasePending | Self::Released | Self::Isolated
            ) | (Self::Isolated, Self::Released)
        )
    }

    fn assert_transition_to(&self, next: Self) -> Result<(), ResourceTransitionError> {
        if self.can_transition_to(next) {
            Ok(())
        } else {
            Err(ResourceTransitionError {
                from: *self,
                to: next,
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceTransitionError {
    pub from: ResourceState,
    pub to: ResourceState,
}

impl fmt::Display for ResourceTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "resource state cannot transition from {} to {}",
            self.from.as_str(),
            self.to.as_str()
        )
    }
}

impl std::error::Error for ResourceTransitionError {}
