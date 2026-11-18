pub const MAGIC_COOKIE: u32 = 0x2112_a442;

#[cfg(test)]
mod tests {
    use super::MAGIC_COOKIE;

    #[test]
    fn magic_cookie_matches_the_stun_wire_format() {
        assert_eq!(MAGIC_COOKIE.to_be_bytes(), [0x21, 0x12, 0xa4, 0x42]);
    }
}
