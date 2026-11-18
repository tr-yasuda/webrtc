# Repository Guidelines

## リポジトリ構成

[全体構成](docs/platform/overview.md)で用語とコンポーネントの責務を確認し、[仕様一覧](docs/README.md)から担当する仕様を探します。共通要件は `docs/platform/`、個別仕様は `docs/signaling/`、`docs/sfu/`、`docs/client-sdk/` などにあります。

アプリケーション制御、Signaling、Client SDK、管理 UI は TypeScript で実装し、パッケージを `packages/` に置きます。プロトコル処理と SFU の中核は Rust で実装し、クレートを `crates/` に置きます。

## 仕様の書き方

仕様は日本語で書き、全体構成で定義した用語を使います。正常時の振る舞い、失敗時の扱い、受け入れ条件は、その振る舞いを担当するコンポーネントの仕様に記載します。

内容が分かる見出しを付け、ファイル名は `key-management.md` のように小文字とハイフンで統一します。仕様を追加・移動したら、`docs/README.md` の一覧を更新します。

## 開発と検証

### セットアップ

mise と、Rust のリンクに使うホスト OS の C ツールチェーンを用意してください。Linux では GCC など、macOS では Xcode Command Line Tools を使用できます。クローン後、リポジトリのルートで次を実行します。

```sh
mise trust
mise install
mise run setup
mise run verify
```

ツールのバージョンは mise で固定します。依存関係は pnpm と Cargo で管理し、ロックファイルをリポジトリに含めます。

Moon は `packages/*/package.json` と `crates/*/Cargo.toml` からプロジェクトを検出します。TypeScript の共通タスクは `tsconfig.json` があるパッケージに適用されます。`outDir` は `dist` に設定してください。ビルドのたびに `dist/` を作り直します。Rust クレートにも共通タスクが適用されます。

### 検証

`mise run verify` は、Moon で両言語のビルド・整形チェック・型検査・静的解析・テストを実行します。GitHub Actions でも同じコマンドを実行します。整形だけを確認するには `mise exec -- moon run :format`、STUN の静的解析だけを実行するには `mise exec -- moon run stun:lint` を使います。

| 検証 | TypeScript | Rust |
| --- | --- | --- |
| 整形チェック | Oxfmt | Rustfmt |
| 型検査 | TypeScript 7 の `tsc --noEmit` | `cargo check` |
| 静的解析 | Oxlint | Clippy |

Browser SDK のテストはビルド後にパッケージを読み込めることを、STUN のテストはヘッダーの Magic Cookie を確認します。

実装を追加するときは、[実装・検証方針](docs/platform/verification.md)に沿って型検査と静的解析を設定します。振る舞いを変えるときは、担当仕様の受け入れ条件と共通のセキュリティ・資源管理要件を照合します。対象に応じてモデル検査、ファジング、プロパティベーステストを選び、検証条件・範囲・結果を記録します。

文書を変更したら、`git diff --check` で追跡済みファイルの空白エラーを、`git status --short` で新規ファイルを確認します。Markdown のプレビューで相対リンクと見出しへのリンクをたどります。

### GitHub Actions

他の GitHub リポジトリの Action や再利用ワークフローは、GitHub 公式のものも含め、配布元で確認した 40 桁のコミット SHA で `uses:` を固定します。追加・更新には、ローカルで `pinact run` を使用できます。

## コミットとプルリクエスト

コミットの件名は Conventional Commits に従い、`<type>(<scope>): <日本語の要約>` の形式で書きます。変更内容に応じて `docs`、`chore`、`feat`、`fix` などの型を選びます。スコープは任意です。本文を付ける場合も日本語で書きます。

- `docs(sfu): 購読解除時の受け入れ条件を明記する`
- `chore: リポジトリの運用設定を更新する`

プルリクエストには変更内容、影響する仕様、実施した確認を記載し、関連する Issue があればリンクします。`.github/CODEOWNERS` に基づき、リポジトリのオーナーにレビューを依頼します。
