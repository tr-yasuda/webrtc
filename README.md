# webrtc

仕様は [docs/README.md](docs/README.md) を参照してください。

## 開発環境

mise と、Rust のリンクに使うホスト OS の C ツールチェーンを用意してください。Linux では GCC など、macOS では Xcode Command Line Tools を使用できます。

クローン後にリポジトリのルートで実行します。

```sh
mise trust
mise install
mise run setup
mise run verify
```

mise がツールのバージョンを固定し、pnpm と Cargo が各ワークスペースの依存関係を管理します。ロックファイルはリポジトリで管理します。

- TypeScript は [Browser SDK](packages/browser-sdk) の最小構成です。ビルド後にパッケージとして読み込めることをテストします。
- Rust は [STUN](crates/stun) の最小構成です。STUN ヘッダーの Magic Cookie をテストします。

`mise run verify` は GitHub Actions の SHA 固定を検査し、Moon で両言語のビルド・型検査・静的解析・テストを実行します。GitHub Actions も同じコマンドを実行します。個別に実行する場合は `mise exec -- moon run browser-sdk:test` や `mise exec -- moon run stun:lint` を使用できます。

Moon は `packages/*/package.json` と `crates/*/Cargo.toml` からプロジェクトを検出します。TypeScript の共通タスクは `tsconfig.json` があるパッケージに適用されます。`outDir` を `dist` に設定してください。ビルドのたびに `dist/` を作り直します。Rust クレートにも共通タスクが適用されます。

## License

Licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution information.
