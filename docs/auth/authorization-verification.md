# 認可仕様の管理と形式検証

## 目的

認可仕様を独立した管理対象として扱い、チームの誰もが安全に変更できる状態を作る。

静的な認可ポリシーは一つの正本から管理し、TypeScript と Lean の静的定義は決定論的に生成する。認可の判定ロジックは TypeScript と Lean で独立して実装し、有限ケースの全件照合と Lean の証明で対応を確認する。

この文書は現行の設計、変更手順、CI が確認する範囲を示す。仕様 JSON と規範文章の意味的な妥当性は人間がレビューする。

## 正本

静的な認可ポリシーの正本は、次の仕様領域に置く。

- `docs/auth/authorization-spec/authorization-policy.json`: 認可ポリシーの唯一の正本
- `docs/auth/authorization-spec/authorization-policy.schema.json`: JSON Schema
- `docs/auth/authorization-spec/README.md`: 意味、適用範囲、変更手順、保証しない範囲

JSON は次を含む。

- role、operation、scope、grant の定義
- role ごとの許可 operation
- scope ごとの許可 operation
- operation ごとの対象 ID 要件
- 参加 JWT の grant、subject 必須・一致条件
- ProjectUser の管理制約
- Management API credential の制約
- 時刻の契約
- 仕様 ID と必要な検証手法
- 検証対象外の条件と、その理由・追跡先

`schemaVersion` は JSON の構造を変えたときに更新する。ポリシー自体の変更履歴は Git で管理し、外部との互換性管理が必要になった時点でポリシーのバージョンを追加する。

PR では `node scripts/policy-diff.mjs --base-ref origin/main` を実行し、role、operation、scope、grant、許可関係、対象 ID 要件、参加 JWT の subject 条件、時刻契約、ケース group、仕様ルールの意味的な差分を仕様 ID 付きで確認する。

## 仕様データの検証

`scripts/validate-authorization-policy.mjs` は JSON Schema による構造検証だけでは不十分なため、次を検証する。

- 重複キーがないこと。`jsonc-parser` の構文木を使い、`JSON.parse` だけで済ませない。
- role、operation、scope、grant、仕様 ID の参照先が存在すること。
- 各 role に許可 operation の定義があること。
- 各 operation に、必要な対象 ID・状態・grant の定義があること。
- 各 scope に許可 operation の定義があること。
- 各 grant に意味と適用先があること。
- 各仕様 ID に、必要な検証手法が定義されていること。
- 対象外の条件に、理由と追跡先があること。
- 同じ仕様 ID が重複していないこと。
- 生成対象の値がすべて JSON から決定できること。

実行コマンドは `scripts/check-authorization-generated.sh` にまとめる。このスクリプトは仕様検証と生成物の再生成チェックを順に実行する。

## 生成

`scripts/generate-authorization-policy.mjs` は正本の JSON から TypeScript と Lean の静的定義を決定論的に生成する。

- TypeScript: role、operation、scope、grant、許可表、対象 ID 要件、参加 JWT の subject 条件、時刻契約
- Lean: role、operation、scope、grant、許可表、対象 ID 要件、参加 JWT の subject 条件、時刻契約、ケース軸、仕様 ID

生成物は並び順・整形・改行を固定し、生成時刻などの非決定的な値を含めない。生成元の SHA-256 とスキーマバージョンをヘッダーに記録する。

生成物はリポジトリに含め、CI で再生成して差分がないことを確認する。生成物を手で編集しない。

認可の判定ロジック、Lean の定理、TypeScript のテストは生成しない。TypeScript と Lean の判定ロジックは独立して実装する。

既存の公開 API の名前・型・export は維持する。生成物は内部の静的定義として使い、既存 module から re-export する。

## Lean モデル

Lean の静的定義は `AuthorizationVerification.GeneratedPolicy` を使い、判定ロジックは独立して定義する。

- `Concrete.lean` の `decideParticipantConcrete`、`decideProjectUserConcrete`、`decideCredentialConcrete` は具体入力から直接判定する。
- 有限ケースの判定は `decideParticipantCase`、`decideProjectUserCase`、`decideCredentialCase` で定義する。
- `participant_abstraction`、`project_user_abstraction`、`credential_abstraction` は、独立した concrete evaluator と有限ケース判定の等式を証明する。`rfl` の使用自体は制約しない。
- 有限ケースの完全性は `participant_cases_complete`、`project_user_cases_complete`、`project_user_invalid_operation_cases_complete`、`credential_cases_complete` で証明する。
- Owner の全操作許可、Admin・Operator・Auditor の制約、Admin の Owner 管理禁止、credential の ProjectUser 管理非継承を、全 role・operation・状態を量化した定理で証明する。

### 有限ケース

ケース型は、認可判定が参照するすべての判断要素を含む。

- 参加 JWT: grant の全 32 組合せ、grant 不正の種類（未知キー、非 boolean、既知キー欠落、非 object）、project 状態、credential と対象の一致、Room・Session・Participant の状態と対応、subject の有無・一致・不一致、不正 operation
- ProjectUser: actor role の missing/invalid/valid、全 operation、project 状態、actor/target の Project 一致、対象 ID の missing/empty/valid、変更前・変更後の role
- credential: 失効、期限クラス、credential/target の Project 一致、project 状態、scope 集合の全組合せと不正 scope、operation の invalid/valid、対象 ID の missing/empty/valid

時刻は Unix epoch ミリ秒の safe integer とする。`Number.isSafeInteger` を満たさない値、小数、`NaN`、`±Infinity`、safe integer の範囲外は拒否する。Lean では safe integer の下限・上限、境界の前後、小数、非有限、範囲外、欠落を `CredentialTimeCase` として列挙し、任意の時刻入力から有限ケースへの抽象化で判定が変わらないことを `credentialTimeCase_abstraction` で証明する。

`sorry` を残さず、許可リスト外の公理に依存しない。`scripts/check-authorization-axioms.sh` は複数行の公理出力を解析し、`@[auth_spec]` を持つ定理と `Axioms.lean` の `#print axioms` 一覧が双方向に一致することも検査する。

## Traceability

対応行列は手動で管理しない。仕様 ID を各成果物に埋め込み、CI が行列を生成する。

- 仕様 JSON の各ルールが `AUTH-*` ID を持つ。
- Lean の定理は専用属性 `@[auth_spec "AUTH-..."]` を持ち、namespace やディレクトリ構成には依存しない。
- Vitest は `test/auth-spec.ts` の `authSpecName` / `authSpecTest` を使い、suite 単位だけでなく個別テスト・property 単位でも ID を付与できる。
- 有限ケースの group は仕様 JSON から ID を引き継ぎ、Lean の manifest に `specIds` として出力する。

`scripts/check-authorization-traceability.mjs` は、Lean の属性、Vitest の JSON レポート、有限ケース manifest、仕様 mutation の結果から `.cache/authorization-traceability.json` と `.cache/authorization-traceability.md` を生成する。少なくとも次を検査する。

- 未知の仕様 ID を参照していないこと。
- 仕様 ID の参照切れがないこと。
- 仕様ごとに定義した必要な検証手法が欠けていないこと。
- 対象外の条件に理由と追跡先があること。
- ディレクトリ構成・namespace の変更で対応が壊れないこと。
- 手動の対応表が存在しないこと。

CI が検査するのは機械的な対応関係までとする。仕様 JSON と規範文章の意味的な一致、定理・テストが実際に条件を確認しているかは人間がレビューする。

## 検証手法

仕様 ID ごとに必要な検証手法を定義する。すべての仕様に同じ手法を要求しない。

| 検証手法 | 確認する内容 |
|---|---|
| `lean_proof` | Lean の普遍定理・ concrete evaluator と有限ケース判定の一致 |
| `conformance` | TypeScript 実装と Lean の有限ケース判定の全件照合 |
| `typescript_test` | 個別の振る舞い・回帰テスト |
| `property_test` | 同値類・不変条件・入力生成 |
| `mutation` | セキュリティ上重要な mutation の検出 |
| `review` | 人間による意味的な妥当性確認 |
| `out_of_scope` | 検証対象外の理由と追跡先 |
| `ci_script` | CI スクリプトによる生成・公理・Traceability の検査 |

仕様 JSON の各ルールは、必要な手法の一覧を持つ。Traceability は、一覧に含まれる手法の成果物が存在することを確認する。

## Mutation Testing

StrykerJS を採用し、認可のプロダクションコード全体を検証する。生成コードは Stryker の対象外とし、生成元の仕様データに対するポリシー固有の mutation で補完する。

- `packages/authorization/stryker.config.mjs` は Vitest runner を使い、`src/**/*.ts` から `src/generated/**` を除いた手書きロジックを対象にする。
- `scripts/check-authorization-policy-mutations.mjs` は JSON の role、scope、grant、対象 ID 要件、参加 JWT の subject 条件、時刻契約を意図的に変更し、独立したセキュリティ不変条件が違反を検出することを確認する。
- `scripts/check-authorization-lean-mutations.mjs` は制約を意図的に壊した Lean モデルのコピーを作り、`lake build` が失敗することを確認する。
- `scripts/check-authorization-stryker-report.mjs` は、未処理の生存 mutation、no coverage、timeout を失敗として扱う。等価 mutation は `packages/authorization/mutation-exclusions.json` に、対象・変更・等価と判断した理由を記録する。使われていない除外も失敗にする。

Mutation Score は参考値とし、それを唯一の品質基準にしない。セキュリティ上重要な mutation は、等価 mutation の個別根拠がない限り生存を許可しない。

2026-11-24 のローカル全件実行では、522 mutant、Mutation Score 98.85、実行時間 5 分 23 秒だった。生存 6 件はすべて等価 mutation として個別根拠を記録した。CI では同じ設定で全件を実行し、実行時間の変化を確認する。

## 開発フロー

1. 仕様 JSON、Schema、README を変更する。
2. Schema、重複キー、参照整合性、網羅性を検証する。
3. TypeScript と Lean の静的定義を生成する。
4. 必要なら TypeScript と Lean の判定ロジックを独立して更新する。
5. Lean の定理、TypeScript のテスト・property に仕様 ID を付与する。
6. 有限ケースの全件照合と mutation を実行する。
7. PR に意味的なポリシー差分を出力する。
8. CI が機械的な対応関係を確認し、人間が意味的な妥当性をレビューする。

開発者が覚えておく必要があるのは、仕様 JSON を正本として変更すること、必要な検証手法を定義すること、生成物を手で編集しないことだけにする。role や scope の一覧を TypeScript と Lean の両方へ手で同期しない。

### ローカル確認

```sh
scripts/check-authorization-generated.sh
node scripts/check-authorization-policy-mutations.mjs
pnpm --filter @webrtc/authorization test
node scripts/check-authorization-traceability.mjs
pnpm --filter @webrtc/authorization mutation
pnpm --filter @webrtc/authorization mutation:check
node scripts/check-authorization-lean-mutations.mjs
moon run :check-proofs
```

## 対象外

- HTTP、JWT の解析・署名検証、DB、管理 UI の実装検証
- Project に最低1人の Owner を残す状態遷移・並行更新の不変条件。Management の transaction と TLA+（#85）で扱い、仕様 JSON の対象外条件に理由と追跡先を記録する。
- TLA+ が担当する状態遷移・並行性・失効競合のモデル検査

## 受け入れ条件

- JSON が Schema に適合し、重複キー、参照切れ、定義の網羅性に問題がない。
- TypeScript と Lean の静的定義が JSON から決定論的に生成され、CI の再生成で差分がない。
- PR に、仕様 ID 付きの意味的なポリシー差分が出力される。
- Traceability の対応行列が自動生成され、未知 ID、参照切れ、必要な検証手法の欠落、対象外理由の欠落を CI が検出する。
- Lean の concrete evaluator と有限ケース判定の一致が、独立した関数間の等式として証明されている。
- Owner、Admin、Operator、Auditor、credential の主要な性質が、代表例ではなく全 role・operation・状態を量化した定理で証明されている。
- 有限ケースが仕様 JSON の全判断要素を含み、完全性が証明されている。
- 時刻が safe integer ミリ秒の契約に従い、小数・非有限・範囲外を拒否する。
- `sorry` がなく、許可リスト外の公理への依存がない。公理検査対象の定理一覧に更新漏れがない。
- TypeScript の判定結果が、全有限ケースで `allowed`、`reason`、`operation`、`target` を含めて仕様どおりである。
- StrykerJS の対象が認可の手書きプロダクションコード全体である。
- セキュリティ上重要な mutation が、独立した不変条件・全件照合・定理のいずれかで検出される。等価 mutation は個別根拠がある。
- 仕様データ mutation と Lean モデル mutation が検出される。
- 全件 mutation の実行時間・生存 mutation を計測し、その結果を CI で確認する。
- CI で検証タスクの失敗箇所が混ざらず、証明・公理検査が TypeScript テストの成否に隠れない。
- 開発フローが文書化され、role・operation・scope の手動同期や暗黙の対応ルールがない。
