use webrtc_domain::{
    AccountId, ApplicationId, ApplicationSigningKeyId, InvalidDomainId, ManagementApiCredentialId,
    ParticipantDeviceId, ParticipantId, ProjectId, ProjectUserId, RoomId,
};

fn assert_id_contract<T>(
    parse: fn(&str) -> Result<T, InvalidDomainId>,
    as_str: fn(&T) -> &str,
    valid_id: &str,
) {
    let parsed_id = parse(valid_id);
    assert_eq!(parsed_id.as_ref().map(as_str), Ok(valid_id));

    let body_start = valid_id.find('_').map(|index| index + 1).unwrap();
    let invalid_ids = [
        String::new(),
        valid_id[..valid_id.len() - 1].to_owned(),
        format!("{}A", &valid_id[..valid_id.len() - 1]),
        format!("bad_{}", &valid_id[body_start..]),
    ];

    for invalid_id in invalid_ids {
        assert!(parse(&invalid_id).is_err());
    }
}

#[test]
fn 各ドメイン識別子は規定形式だけを受け入れる() {
    assert_id_contract(
        ProjectId::parse,
        ProjectId::as_str,
        "prj_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        AccountId::parse,
        AccountId::as_str,
        "acct_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ProjectUserId::parse,
        ProjectUserId::as_str,
        "pusr_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ApplicationId::parse,
        ApplicationId::as_str,
        "app_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ApplicationSigningKeyId::parse,
        ApplicationSigningKeyId::as_str,
        "sig_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ManagementApiCredentialId::parse,
        ManagementApiCredentialId::as_str,
        "cred_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        RoomId::parse,
        RoomId::as_str,
        "room_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ParticipantId::parse,
        ParticipantId::as_str,
        "part_abcdefghij0123456789qrstuv",
    );
    assert_id_contract(
        ParticipantDeviceId::parse,
        ParticipantDeviceId::as_str,
        "pdev_abcdefghij0123456789qrstuv",
    );
}
