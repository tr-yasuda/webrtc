# セキュリティ契約

このディレクトリは、機械的に判定できるセキュリティ条件の正本を置く。

| ファイル | 用途 |
|---|---|
| `contract.json` | TLS / DTLS、通信プロファイル、秘密分類、出力境界、監査イベントと許可フィールド・型、入力検証段階の正本 |
| `contract.schema.json` | `contract.json` の JSON Schema |
| `vectors.json` | TypeScript と Rust が共有する入出力・拒否ケース |
| `components.json` | pnpm / Cargo workspace のコンポーネント登録簿、適用除外 |
| `components.schema.json` | `components.json` の JSON Schema |

## 更新規則

- 仕様の意味は `docs/platform/security.md` と関連 docs に置き、機械判定できる値だけを `contract.json` に置く。
- `packages/security/src/generated/contract.ts` と `crates/security/src/generated.rs` は `scripts/generate-security-contract.mjs` から生成する。手で編集しない。
- コンポーネント一覧は登録簿ではなく、pnpm / Cargo workspace の実コンポーネントから列挙する。登録簿は完全性の検証対象とする。
- 契約・登録簿・検証ルールの変更は `security-contract-change` ラベルを必要とし、通常の実装変更と区別してレビューする。
- 有限回のテストは全入力に対する証明ではない。検証範囲と未検証範囲を docs と Issue に記録する。
