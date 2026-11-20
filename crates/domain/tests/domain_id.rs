use webrtc_domain::{
    AccountId, ApplicationId, ApplicationSigningKeyId, InvalidDomainId, ManagementApiCredentialId,
    ParticipantDeviceId, ParticipantId, ProjectId, ProjectUserId, RoomId,
};

fn assert_id_contract<T>(parse: fn(&str) -> Result<T, InvalidDomainId>, as_str: fn(&T) -> &str) {
    let valid_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    let parsed_id = parse(valid_id);
    assert_eq!(parsed_id.as_ref().map(as_str), Ok(valid_id));

    let invalid_ids = [
        String::new(),
        valid_id[..valid_id.len() - 1].to_owned(),
        format!("{}U", &valid_id[..valid_id.len() - 1]),
        valid_id.to_lowercase(),
        format!("bad_{valid_id}"),
    ];

    for invalid_id in invalid_ids {
        assert!(parse(&invalid_id).is_err());
    }
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
