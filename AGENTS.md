# Repository Guidelines

## リポジトリ構成

[全体構成](docs/platform/overview.md)で用語とコンポーネントの責務を確認し、[仕様一覧](docs/README.md)から担当する仕様を探します。共通要件は `docs/platform/`、個別仕様は `docs/signaling/`、`docs/sfu/`、`docs/client-sdk/` などにあります。

アプリケーション制御、Signaling、Client SDK、管理 UI は TypeScript で実装し、パッケージを `packages/` に置きます。プロトコル処理と SFU の中核は Rust で実装し、クレートを `crates/` に置きます。

## 仕様の書き方

仕様は日本語で書き、全体構成で定義した用語を使います。正常時の振る舞い、失敗時の扱い、受け入れ条件は、その振る舞いを担当するコンポーネントの仕様に記載します。

内容が分かる見出しを付け、ファイル名は `key-management.md` のように小文字とハイフンで統一します。仕様を追加・移動したら、`docs/README.md` の一覧を更新します。

## 開発と検証

### セットアップ

Node.js、pnpm、Rust（Clippy と rustfmt を含む）、Moon、zizmor を [mise.toml](mise.toml) に記載のバージョンで用意してください。Rust のリンクには、Linux では GCC など、macOS では Xcode Command Line Tools が必要です。

mise でツールを揃える場合は、リポジトリのルートで次を実行します。Bash 以外のシェルでは公式手順を参照してください。 [mise のシェル設定](https://mise.jdx.dev/shell-setup.html)

```sh
eval "$(mise activate bash)"
mise trust
mise install
```

ツールに PATH が通ったら、リポジトリのルートで次を実行します。GitHub Actions でも同じコマンドを実行します。

```sh
pnpm install --frozen-lockfile
```

依存関係は pnpm と Cargo のロックファイルで管理します。ツールのバージョンを更新するときは、ローカル用の `mise.toml` と、CI が使う [ワークフロー](.github/workflows/ci.yml)・[package.json](package.json) の該当箇所を揃えます。

Moon は `packages/*/package.json` から TypeScript プロジェクトを検出します。Browser SDK と同じ名前のビルド・型検査・テスト用スクリプトを `package.json` に定義します。`tsconfig.json` の `noEmit` を有効にし、型検査は `tsc` で行います。

- TypeScript のライブラリや配布パッケージは tsdown でビルドし、JavaScript と型宣言を `dist/` に生成します。
- TypeScript のサーバーアプリケーションは `tsc --project tsconfig.build.json` でビルドします。ビルド用設定は `tsconfig.json` を継承し、`noEmit: false`、`rootDir: "src"`、`outDir: "dist"` を指定します。

Rust はルートの Cargo ワークスペースを一つの Moon プロジェクトとして扱います。`crates/` のクレートはワークスペース全体の検証に含まれます。`target/` の成果物は Cargo が再利用します。

### 検証

CI と同じ検証を行うには、ルートで各コマンドを上から順に実行します。`--upstream none` を指定すると、Moon は前のステップで済ませた型検査やビルドを再実行しません。

| ステップ | コマンド |
| --- | --- |
| GitHub Actions の監査 | `pnpm run check:actions` |
| TypeScript などの整形チェック | `pnpm run format:check` |
| Rust の整形チェック | `moon run :format` |
| TypeScript などの静的解析 | `pnpm run lint` |
| Rust の静的解析 | `moon run :lint` |
| 型検査 | `moon run :typecheck` |
| ビルド | `moon run :build --upstream none` |
| テスト | `moon run :test --upstream none` |

ルートで `pnpm lint` を実行すると JavaScript・TypeScript を静的解析し、`pnpm format:check` を実行すると `.oxfmtrc.json` が対象とする JavaScript・TypeScript・JSON・JSONC・TOML の整形を確認します。修正には `pnpm lint:fix` と `pnpm format` を使います。

`pnpm typecheck` と `pnpm build` は、ルートでは全 TypeScript パッケージ、各パッケージ内ではそのパッケージが対象です。tsdown はビルド時に `dist/` を作り直します。

ルートの `pnpm test` は Moon で `packages/` 配下の型検査・ビルド・テストを順に実行します。パッケージ内の `pnpm test` はビルド済みの成果物に対してテストを実行します。パッケージ内で型検査とビルドから実行するには `moon run '~:test'` を使います。

| 検証 | TypeScript | Rust |
| --- | --- | --- |
| 整形チェック | Oxfmt | `cargo fmt --all --check` |
| 型検査 | TypeScript 7 の `tsc` | `cargo check --workspace --all-targets --locked` |
| 静的解析 | Oxlint | `cargo clippy --workspace --all-targets --locked` |

`moon run rust:lint` は `CARGO_BUILD_WARNINGS=deny` を適用し、lint の警告をエラーとして扱います。

Browser SDK のテストはビルド後にパッケージを読み込めることを、STUN のテストはヘッダーの Magic Cookie を確認します。

テストケース名は日本語で書き、どの条件でどんな振る舞いを確かめるかが分かる名前にします。

実装を追加するときは、[実装・検証方針](docs/platform/verification.md)に沿って型検査と静的解析を設定します。振る舞いを変えるときは、担当仕様の受け入れ条件と共通のセキュリティ・資源管理要件を照合します。対象に応じてモデル検査、ファジング、プロパティベーステストを選び、検証条件・範囲・結果を記録します。

文書を変更したら、`git diff --check` で追跡済みファイルの空白エラーを、`git status --short` で新規ファイルを確認します。Markdown のプレビューで相対リンクと見出しへのリンクをたどります。

### GitHub Actions

他の GitHub リポジトリの Action や再利用ワークフローは、GitHub 公式のものも含め、配布元で確認した 40 桁のコミット SHA で `uses:` を固定します。追加・更新には、ローカルで `pinact run` を使用できます。

## コミットとプルリクエスト

コミットの件名は Conventional Commits に従い、`<type>(<scope>): <日本語の要約>` の形式で書きます。変更内容に応じて `docs`、`chore`、`feat`、`fix` などの型を選びます。スコープは任意です。本文を付ける場合も日本語で書きます。

- `docs(sfu): 購読解除時の受け入れ条件を明記する`
- `chore: リポジトリの運用設定を更新する`

プルリクエストには変更内容、影響する仕様、実施した確認を記載し、関連する Issue があればリンクします。`.github/CODEOWNERS` に基づき、リポジトリのオーナーにレビューを依頼します。
