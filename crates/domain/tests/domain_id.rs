use std::time::{SystemTime, UNIX_EPOCH};
use ulid::Ulid;
use webrtc_domain::{
    AccountId, ApplicationId, ApplicationSigningKeyId, InvalidDomainId, ManagementApiCredentialId,
    ParticipantDeviceId, ParticipantId, ProjectId, ProjectUserId, RoomId,
};

fn assert_id_contract<T>(parse: fn(&str) -> Result<T, InvalidDomainId>, as_str: fn(&T) -> &str) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is before Unix epoch");
    let timestamp_ms = u64::try_from(now.as_millis()).expect("timestamp is too large");
    let valid_id = Ulid::from_parts(timestamp_ms, u128::from(now.subsec_nanos())).to_string();
    let parsed_id = parse(&valid_id);
    assert_eq!(parsed_id.as_ref().map(as_str), Ok(valid_id.as_str()));

    let invalid_ids = [
        String::new(),
        valid_id[..valid_id.len() - 1].to_owned(),
        format!("{}U", &valid_id[..valid_id.len() - 1]),
        format!("bad_{valid_id}"),
    ];

    for invalid_id in invalid_ids {
        assert!(parse(&invalid_id).is_err());
    }

    let lowercase_id = parse(&valid_id.to_lowercase()).expect("lowercase ULID is valid");
    assert_eq!(as_str(&lowercase_id), valid_id);
}

#[test]
fn 各ドメイン識別子は規定形式だけを受け入れる() {
    assert_id_contract(ProjectId::parse, ProjectId::as_str);
    assert_id_contract(AccountId::parse, AccountId::as_str);
    assert_id_contract(ProjectUserId::parse, ProjectUserId::as_str);
    assert_id_contract(ApplicationId::parse, ApplicationId::as_str);
    assert_id_contract(
        ApplicationSigningKeyId::parse,
        ApplicationSigningKeyId::as_str,
    );
    assert_id_contract(
        ManagementApiCredentialId::parse,
        ManagementApiCredentialId::as_str,
    );
    assert_id_contract(RoomId::parse, RoomId::as_str);
    assert_id_contract(ParticipantId::parse, ParticipantId::as_str);
    assert_id_contract(ParticipantDeviceId::parse, ParticipantDeviceId::as_str);
}
