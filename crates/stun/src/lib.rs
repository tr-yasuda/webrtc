pub const MAGIC_COOKIE: u32 = 0x2112_a442;

#[cfg(test)]
mod tests {
    use super::MAGIC_COOKIE;

    #[test]
    fn マジッククッキーのバイト列は仕様どおり() {
        assert_eq!(MAGIC_COOKIE.to_be_bytes(), [0x21, 0x12, 0xa4, 0x42]);
    }
}
