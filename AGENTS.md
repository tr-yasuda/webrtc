# Repository Guidelines

## リポジトリ構成

[全体構成](docs/platform/overview.md)で用語とコンポーネントの責務を確認し、[仕様一覧](docs/README.md)から担当する仕様を探します。共通要件は `docs/platform/`、個別仕様は `docs/signaling/`、`docs/sfu/`、`docs/client-sdk/` などにあります。

アプリケーション制御、Signaling、Client SDK、管理 UI は TypeScript で実装し、パッケージを `packages/` に置きます。プロトコル処理と SFU の中核は Rust で実装し、クレートを `crates/` に置きます。

## 仕様の書き方

仕様は日本語で書き、全体構成で定義した用語を使います。正常時の振る舞い、失敗時の扱い、受け入れ条件は、その振る舞いを担当するコンポーネントの仕様に記載します。

内容が分かる見出しを付け、ファイル名は `key-management.md` のように小文字とハイフンで統一します。仕様を追加・移動したら、`docs/README.md` の一覧を更新します。

## 開発と検証

### セットアップ

mise と、Rust のリンクに使うホスト OS の C ツールチェーンを用意してください。Linux では GCC など、macOS では Xcode Command Line Tools を使用できます。Lean の検証には Elan を公式手順で導入し、Elan の `bin` ディレクトリを PATH に追加してください。 [Lean のセットアップ](https://lean-lang.org/install/manual/)

`pnpm` や `moon` を直接実行できるよう、使っているシェルで mise を有効にします。Bash で現在のセッションを有効にするには `eval "$(mise activate bash)"` を実行します。他のシェルや起動時の設定は公式手順を参照してください。 [mise のシェル設定](https://mise.jdx.dev/shell-setup.html)

クローン後、リポジトリのルートで次を実行します。

```sh
mise trust
mise install
pnpm install --frozen-lockfile
```

ローカルでは [mise.toml](mise.toml) でツールのバージョンを固定します。GitHub Actions は [CI ワークフロー](.github/workflows/ci.yml) の各セットアップステップで導入します。pnpm のバージョンは [package.json](package.json) の `packageManager` に揃え、pnpm と Cargo の依存関係はロックファイルで固定します。
Elan は Lake パッケージの [lean-toolchain](crates/stun/verification/lean/lean-toolchain) に指定した Lean を初回の検証時に取得します。エディターと CI もこのファイルで同じバージョンを選びます。

Moon は `packages/*/package.json` から TypeScript プロジェクトを検出します。Browser SDK と同じ名前のビルド・型検査・テスト用スクリプトを `package.json` に定義します。`tsconfig.json` の `noEmit` を有効にし、型検査は `tsc` で行います。

- TypeScript のライブラリや配布パッケージは tsdown でビルドし、JavaScript と型宣言を `dist/` に生成します。
- TypeScript のサーバーアプリケーションは `tsc --project tsconfig.build.json` でビルドします。ビルド用設定は `tsconfig.json` を継承し、`noEmit: false`、`rootDir: "src"`、`outDir: "dist"` を指定します。

Rust はルートの Cargo ワークスペースを一つの Moon プロジェクトとして扱います。`crates/` のクレートはワークスペース全体の検証に含まれます。`target/` の成果物は Cargo が再利用します。

### 検証

GitHub Actions はツールをセットアップした後、次のコマンドを個別のステップで実行します。ローカルでもリポジトリのルートから実行できます。

```sh
pnpm run format:check
pnpm run lint
pnpm test
moon run rust:format
moon run rust:typecheck
moon run rust:lint
moon run rust:build
moon run rust:test
moon run stun-lean:verify
moon run browser-sdk-tla:verify
```

ルートで `pnpm lint` を実行すると JavaScript・TypeScript を静的解析し、`pnpm format:check` を実行すると `.oxfmtrc.json` が対象とする JavaScript・TypeScript・JSON・JSONC・TOML の整形を確認します。修正には `pnpm lint:fix` と `pnpm format` を使います。

`pnpm typecheck` と `pnpm build` は、ルートでは全 TypeScript パッケージ、各パッケージ内ではそのパッケージが対象です。tsdown はビルド時に `dist/` を作り直します。

ルートの `pnpm test` は Moon で `packages/` 配下の型検査・ビルド・Vitest を順に実行します。パッケージ内の `pnpm test` はビルド済みの成果物に対して Vitest を実行します。パッケージ内で型検査とビルドから実行するには `moon run '~:test'` を使います。

Rust と形式検証を個別に実行する場合は、リポジトリのルートで次のコマンドを使います。

| コマンド | 検証内容 |
| --- | --- |
| `moon run rust:test` | Cargo ワークスペースのテストを実行する |
| `moon run stun-lean:verify` | [STUN の属性長](crates/stun/verification/lean/StunVerification/AttributeLength.lean)がパディングで 4 バイト境界に揃うことを証明する |
| `moon run browser-sdk-tla:verify` | [Browser SDK の接続通知](packages/browser-sdk/verification/tla/ConnectionNotifications.tla)が現在の接続状態を巻き戻さないことを検査する |

コンポーネント固有の形式検証は、担当するクレートまたはパッケージの `verification/` に置きます。複数のコンポーネントにまたがるモデルは、対象となる共通仕様からたどれる場所に置きます。Lake は証明ライブラリ配下のモジュールを `import` の有無にかかわらず検査し、`sorry` をエラーにします。
TLC の初回実行では、`curl` と `openssl` を使って公式 JAR を取得・照合します。

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
