# 認可仕様の管理と形式検証

## 目的

認可仕様を独立した管理対象として扱い、チームの誰もが安全に変更できる状態を作る。

静的な認可ポリシーは JSON を唯一の正本とし、TypeScript と Lean の静的定義を生成する。認可の判定ロジックは `packages/authorization` のルール関数として独立して実装し、Lean の有限モデル、全件 conformance、プロパティベーステスト、mutation で確認する。

## 正本

### 静的認可ポリシー

`docs/auth/authorization-spec/authorization-policy.json` を唯一の正本とする。

- role、operation、scope、grant、参加 JWT の operation
- role ごとの許可 operation
- scope ごとの許可 operation
- operation ごとの対象 ID 要件
- 参加 JWT の subject 必須・一致条件
- ProjectUser の Owner 管理制約
- Management API credential の ProjectUser 非継承対象
- 時刻の契約
- 仕様 ID と必要な検証手法
- 検証対象外の条件と、その理由・追跡先

`docs/auth/authorization-spec/authorization-policy.schema.json` で構造を定義し、`docs/auth/authorization-spec/README.md` に変更手順と境界を記載する。

### 認可判断ルール

個別の判断順序、reason、対象 ID の組み立て、入力検証の契約は `packages/authorization/README.md` のルール表を正本とする。JSON は静的な許可表・制約・時刻契約の正本であり、ルール関数の判定順序はコードと個別テストで管理する。

二つの正本は役割が異なる。

- JSON は「どの role がどの operation を許可されるか」などの静的事実を持つ。
- `packages/authorization/README.md` は「どの条件でどの reason を返すか」という判断ルールを持つ。

同じ値を両方へ手で書かない。静的事実は JSON から生成し、判断ルールはコードと独立した Lean モデルで確認する。

## 生成

`node scripts/generate-authorization-policy.mjs` は JSON から次を生成する。

- `packages/authorization/src/generated/policy.ts`
- `packages/authorization/proofs/Authorization/GeneratedPolicy.lean`

生成物は並び順・整形・改行を固定し、生成時刻などの非決定的な値を含めない。生成元の SHA-256 とスキーマバージョンをヘッダーに記録する。生成物を手で編集しない。

TypeScript では `contracts/identifiers.ts`、`project-user/role-matrix.ts`、`management-credential/scope-matrix.ts`、対象 ID のルール、参加 JWT の grant・Room 要件が生成値を使う。Lean では `Authorization/Types.lean` などが `Authorization/GeneratedPolicy.lean` を import する。

## 仕様データの検証

`scripts/check-authorization-generated.sh` は次を実行する。

- JSON Schema 検証
- 重複キー検出
- role・operation・scope・grant・target・case group・仕様 ID の参照整合性
- role、operation、scope、grant の定義の網羅性
- 対象外条件の理由と追跡先
- TypeScript / Lean 生成物が JSON と一致すること

## TypeScript 実装

認可パッケージは入力検証と認可判断を分ける。

- `validate*AuthorizationInput(raw)` が必須項目、型、operation、grant、scope、role、target ID を検証する。
- `authorize*Action(validatedInput)` は検証済み入力だけを受け取る。
- 判断順序は `authorize.ts` のルール配列で読める。
- 各ルールは reason だけを返し、ルール ID や認可条件を持たない。
- `authorize*FromRaw` は validator の失敗を呼び出し契約に応じた拒否結果へ変換する。

生入力から検証済み入力への抽象化は validator が担い、`Conformance/ValidationCases.lean` と `scripts/run-authorization-conformance.mjs` の validation cases、contract tests で全件確認する。

参加 JWT の grant は、未知キーと非 boolean を入力不正として拒否する。未指定の grant は false として扱い、対象 operation の grant が true でない場合は `grant-not-granted` で拒否する。

時刻は Unix epoch ミリ秒の safe integer とする。`Number.isSafeInteger` を満たさない値、小数、`NaN`、`±Infinity`、safe integer の範囲外は拒否する。

## Lean モデル

Lean モデルは `packages/authorization/proofs/Authorization` に置く。

- `Authorization/Types.lean` は生成された Role・Operation・Scope・Grant・許可表を import し、状態と入力ケースを定義する。
- `Authorization/Participant.lean`、`ProjectUser.lean`、`ManagementCredential.lean` は TypeScript とは独立した判定ルールを持つ。
- `Authorization/Theorems.lean` は soundness、completeness、監査 target、最初の失敗 reason、非干渉性、Owner 管理境界、credential の ProjectUser 非継承、role 包含関係、scope 分割を証明する。
- `Conformance` は Lean の有限ケースと TypeScript 実装を全件照合する。

有限ケースは operation、状態、対象一致、role、対象 ID の有無、変更前後の role、grant の全組合せ、scope の全組合せ、失効・期限クラスを含む。conformance は次の件数を検査する。

- Participant: 218,503 ケース（判定 218,496、入力検証失敗 7）
- ProjectUser: 38,010 ケース（判定 38,000、入力検証失敗 10）
- Management API credential: 29,192 ケース（判定 19,456、入力検証失敗 9,736）

Lean の定理には `@[auth_spec "AUTH-..."]` を付け、仕様 ID と対応させる。`native_decide` は有限列挙の検査に使う。公理検査は `propext`、`Classical.choice`、`Quot.sound` と、`native_decide` が生成する定理単位の検査公理だけを許可する。

## Traceability

Traceability は二層で管理する。

1. `pnpm --filter @webrtc/authorization check:traceability` が README のルール ID、仕様見出し、テストファイル、Lean/TLA の対応を生成・検査する。
2. `node scripts/check-authorization-traceability.mjs` が JSON の `AUTH-*` 仕様 ID、Lean 定理属性、Vitest の JSON レポート、conformance 実行 manifest、仕様 mutation 結果から対応行列を生成する。

Vitest は `test/auth-spec.ts` の `authSpecName` で個別テスト・property 単位に ID を付与できる。Traceability は未知 ID、参照切れ、必要な検証手法の欠落を CI で検出する。手動の対応表は持たない。

検証実績には `status=passed` のテストだけを使い、`test/pbt/` 配下のテストを `property_test`、それ以外を `typescript_test` として区別する。conformance は実行時に group 別件数と仕様 ID を含む manifest を生成し、各仕様が要求する case group の存在を照合する。

CI が検査するのは機械的な対応関係までとする。仕様 JSON と規範文章の意味的な一致、定理・テストが実際に条件を確認しているかは人間がレビューする。

## Mutation Testing

StrykerJS は `packages/authorization/stryker.config.mjs` で認可判断を実装するモジュールを対象にする。入力検証の契約は 100% の statement/function/line coverage と contract tests で別に確認する。

- Stryker の全件実行: 597 mutant、Mutation Score 100.00、1 分 58 秒
- 生存 mutation と no coverage は 0
- 仕様データ mutation: 11 件を独立したセキュリティ不変条件で検出
- Lean モデル mutation: Owner の許可削除、Admin の変更後 Owner チェック削除、ProjectUser 除外操作への credential scope 追加を検出

`scripts/check-authorization-stryker-report.mjs` は、未処理の生存 mutation、no coverage、timeout を失敗にする。等価 mutation を除外する場合は `packages/authorization/mutation-exclusions.json` に個別根拠を記録し、使われていない除外も失敗にする。現在の除外は 0 件。

Mutation Score は参考値とし、それを唯一の品質基準にしない。セキュリティ上重要な mutation は、等価 mutation の個別根拠がない限り生存を許可しない。

## 開発フロー

1. 静的な認可ポリシーを変える場合は JSON、Schema、README を変更する。
2. 判断ルールを変える場合は `packages/authorization/README.md` のルール表と該当ルールを変更する。
3. 生成物を再生成し、差分がないことを確認する。
4. 必要な Lean 定理、個別テスト、property、contract test を更新する。
5. conformance、Traceability、mutation を実行する。
6. PR に意味的なポリシー差分を出力する。
7. CI が機械的な対応関係を確認し、人間が意味的な妥当性をレビューする。

### ローカル確認

```sh
scripts/check-authorization-generated.sh
node scripts/check-authorization-policy-mutations.mjs
pnpm --filter @webrtc/authorization test
pnpm --filter @webrtc/authorization test:coverage
pnpm --filter @webrtc/authorization test:conformance
pnpm --filter @webrtc/authorization check:traceability
node scripts/check-authorization-traceability.mjs
scripts/check-authorization-axioms.sh
node scripts/check-authorization-lean-mutations.mjs
pnpm --filter @webrtc/authorization mutation
pnpm --filter @webrtc/authorization mutation:check
```

## 対象外

- HTTP、JWT の解析・署名検証、DB、管理 UI の実装検証
- Project に最低1人の Owner を残す状態遷移・並行更新の不変条件。Management の transaction と TLA+（#85）で扱う。
- TLA+ が担当する状態遷移・並行性・失効競合のモデル検査

## 受け入れ条件

- JSON が Schema に適合し、重複キー、参照切れ、定義の網羅性に問題がない。
- TypeScript と Lean の静的定義が JSON から決定論的に生成され、CI の再生成で差分がない。
- 認可判断が検証済み入力だけを受け取り、入力検証と判断が分離されている。
- Lean の soundness、completeness、監査 target、最初の失敗 reason、非干渉性、Owner 管理境界が証明されている。
- Lean の有限ケースと TypeScript 実装が全件一致する。
- 時刻が safe integer ミリ秒の契約に従い、小数・非有限・範囲外を拒否する。
- `sorry` がなく、許可リスト外の公理への依存がない。
- README ルール Traceability と JSON 仕様 ID Traceability が CI で生成・検査される。
- StrykerJS の対象が認可判断のプロダクションコードで、未処理の生存 mutation がない。
- 仕様データ mutation と Lean モデル mutation が検出される。
- PR に意味的なポリシー差分が出力される。
- CI で整形、lint、型検査、テスト、coverage、conformance、Traceability、mutation が個別に失敗する。
