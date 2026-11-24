# 認可仕様

このディレクトリは、静的な認可ポリシーの正本を管理する。

- `authorization-policy.json`: 認可ポリシーの唯一の正本
- `authorization-policy.schema.json`: JSON Schema

TypeScript と Lean の role・operation・scope・grant・許可表・対象 ID 要件・参加 JWT の subject 条件・時刻契約は、この JSON から決定論的に生成する。生成物を手で編集しない。認可の判定ロジックは TypeScript と Lean で独立して実装し、生成された静的定義を使う。

- `packages/authorization/src/generated/policy.ts`: TypeScript の静的定義
- `packages/authorization/proofs/Authorization/GeneratedPolicy.lean`: Lean の静的定義

判断ルール、reason、入力検証の契約は `packages/authorization/README.md` を正本とする。検証の目標、Traceability、Mutation Testing、受け入れ条件は[認可仕様の管理と形式検証](../authorization-verification.md)に従う。

## 変更手順

1. `authorization-policy.json` を変更する。
2. `docs/auth/authorization-verification.md` の規範条件と意味が一致することを確認する。
3. JSON Schema、重複キー、参照整合性、網羅性を検証する。
4. TypeScript と Lean の静的定義を生成する。
5. 必要な Lean 定理、TypeScript テスト、property、mutation を更新する。
6. 意味的なポリシー差分を PR に出力する。

変更後は次を実行する。

```sh
scripts/check-authorization-generated.sh
node scripts/check-authorization-policy-mutations.mjs
pnpm --filter @webrtc/authorization test
pnpm --filter @webrtc/authorization test:coverage
pnpm --filter @webrtc/authorization test:conformance
pnpm --filter @webrtc/authorization check:traceability
node scripts/check-authorization-traceability.mjs
scripts/check-authorization-axioms.sh
pnpm --filter @webrtc/authorization mutation
pnpm --filter @webrtc/authorization mutation:check
node scripts/check-authorization-lean-mutations.mjs
```

`constraints.participantSubject` は、参加 JWT の subject を必須にするか、Participant の ExternalUser と一致させるかを定義する。`constraints.adminOwnerManagement`、`constraints.credentialProjectUserOperations`、`targetRequirements`、`timeContract` も認可判定が参照する正本であり、生成物へ反映される。

仕様 ID は `AUTH-*` 形式で JSON に一度だけ定義する。Lean の定理には専用属性、TypeScript のテストには ID helper を使い、対応行列は CI が生成する。ルール ID の Traceability は `packages/authorization/README.md` から生成する。手動の対応表は作らない。

## Schema バージョンと履歴

`schemaVersion` は JSON の構造を変えたときに更新する。ポリシー自体の変更履歴は Git で管理する。外部との互換性管理が必要になった時点で、ポリシーのバージョンを追加する。

## 検証の境界

- 認可仕様の形式検証は、認可判断のモデルと TypeScript 実装の対応を対象とする。
- HTTP、JWT の解析・署名検証、DB、管理 UI の実装は対象外。
- Project に最低1人の Owner を残す状態遷移・並行更新の不変条件は、Management の transaction と TLA+（#85）で扱う。
- TLA+ が担当する状態遷移・並行性・失効競合のモデル検査は対象外。

対象外の条件は JSON の `specRules` に `out_of_scope`、理由、追跡先を記録する。
