use webrtc_resources::{
    BootId, MAX_OPAQUE_ID_LENGTH, OperationId, ReservationId, ResourceId, WorkerId,
};

macro_rules! assert_id_contract {
    ($name:ident) => {{
        let maximum_length = "a".repeat(MAX_OPAQUE_ID_LENGTH);
        assert_eq!(
            $name::parse(maximum_length.clone())
                .expect("maximum length id")
                .as_str(),
            maximum_length
        );
        assert!($name::parse("").is_err());
        assert!($name::parse("   ").is_err());
        assert!($name::parse("a".repeat(MAX_OPAQUE_ID_LENGTH + 1)).is_err());
        let non_ascii = "あ".repeat(MAX_OPAQUE_ID_LENGTH);
        assert_eq!(
            $name::parse(non_ascii.clone())
                .expect("non-ascii maximum length id")
                .as_str(),
            non_ascii
        );
        assert!($name::parse("あ".repeat(MAX_OPAQUE_ID_LENGTH + 1)).is_err());
    }};
}

#[test]
fn 各資源識別子は非空かつ長さ上限以内の値だけを受け入れる() {
    assert_id_contract!(ReservationId);
    assert_id_contract!(ResourceId);
    assert_id_contract!(OperationId);
    assert_id_contract!(WorkerId);
    assert_id_contract!(BootId);

    assert!(ReservationId::new().as_str().len() <= MAX_OPAQUE_ID_LENGTH);
    assert!(ResourceId::new().as_str().len() <= MAX_OPAQUE_ID_LENGTH);
    assert!(OperationId::new().as_str().len() <= MAX_OPAQUE_ID_LENGTH);
}
