# Authorization パッケージ設計

この文書は、認可ルールを追加・変更するときに、仕様・実装・検証のどこを更新し、何をCIで確認するかを定める。Phase 0 の設計確定を目的とし、実装コードの変更は後続フェーズで行う。

対象は `packages/authorization` の Participant、ProjectUser、Management API credential の認可判断、入力検証、監査target、および認可判断とドメイン不変条件の責務境界とする。JWTの署名検証、暗号処理、Management・Signalingの状態遷移は対象外とする。

## 基本原則

認可の定義が複数箇所へ分散すると更新漏れが起きる。一方で、実装と期待値を同じ定義から生成すると、同じ誤りを両方が持つ。このため、共有する事実と、独立して検証する判断を分ける。

| 情報 | 管理方法 |
|---|---|
| operation・role・scope・reason・ルールID | `src/contracts/identifiers.ts` の機械可読な定義 |
| 入力・出力・監査targetの契約 | `src/contracts/` の型とvalidator |
| 実際の認可判断 | TypeScriptのルール関数と判定順序 |
| 期待される認可判断 | 独立したLeanモデル |
| 受け入れ条件 | 人間が書いた個別テスト |
| 入力の組み合わせ | Leanの有限列挙とPBT |
| 仕様と検証の対応 | ルールIDによる機械的な追跡 |

識別子・型・スキーマは共有してよい。許可・拒否の期待値、判定順序の意味、ロール・scopeの包含関係は共有しない。

## 静的認可ポリシーの正本

role、operation、scope、grant、role ごとの許可 operation、scope ごとの許可 operation、対象 ID 要件、参加 JWT の subject 条件、Owner 管理制約、時刻契約は `../../docs/auth/authorization-spec/authorization-policy.json` を唯一の正本とする。TypeScript と Lean の静的定義は次の生成物を使い、手で同期しない。

- `src/generated/policy.ts`
- `proofs/Authorization/GeneratedPolicy.lean`

生成には `node ../../scripts/generate-authorization-policy.mjs`、生成物の一致確認には `../../scripts/check-authorization-generated.sh` を使う。判断ルールの ID、reason、判定順序はこの README と各ルール関数を正本とし、静的な許可表から生成しない。

JSON 正本の検証、仕様 ID Traceability、仕様/Lean mutation は `../../docs/auth/authorization-verification.md` に従う。

## 信頼境界と入出力契約

生の入力を認可関数へ直接渡さない。入力検証と認可判断を分ける。

- `validateParticipantAuthorizationInput(raw: unknown)` は、必須項目、operation、grantのキーとboolean、状態enum、ID形式を検証し、`ValidatedParticipantInput` を返す。
- `authorizeParticipantAction(input: ValidatedParticipantInput)` は、検証済みの入力だけを受け取る。
- ProjectUser と Management API credential も同じ構造にする。
- 不明なgrant、非booleanのgrant、余分なtarget IDはvalidatorで拒否する。
- 認可判断の `target` は呼び出し元のオブジェクトをそのまま返さず、操作と必須IDからcanonical targetを構築する。
- 監査へ渡す結果は `allowed`、`operation`、`target`、`reason` を持つ。許可時だけ `reason` は `allowed` になる。

不正な入力の扱いは、validatorの結果と認可判断の結果を区別する。呼び出し側が単一の拒否結果を必要とする場合は、`authorizeFromRaw` のような便宜関数でvalidatorの失敗を `credential-input-invalid` へ対応付ける。

## 判定関数の構造

判定順序の管理と個別ルールの実装を分ける。汎用的なルールエンジンは作らない。

```ts
const participantRules = [
  checkProject,
  checkCredentialTarget,
  checkSubject,
  checkGrant,
  checkOperationSpecific,
] as const;

export function authorizeParticipantAction(
  input: ValidatedParticipantInput,
): ParticipantAuthorizationDecision {
  const target = buildParticipantTarget(input);

  for (const rule of participantRules) {
    const violation = rule(input);
    if (violation !== null) {
      return deny(input, target, violation);
    }
  }

  return allow(input, target);
}
```

- 判定順序は `authorize.ts` の配列1か所で読める。
- 各ルールは `RuleViolation | null` を返す純粋関数とし、ルールIDとreasonを持つ。
- `checkOperationSpecific` は `room.create`、`room.join`、`media/data` へ明示的に分岐する。
- ルールの追加・削除・順序変更は、個別テストと優先順位テストで検出する。

## ソース構成

```
src/
  contracts/
    identifiers.ts
    validation.ts
    rules.ts
    participant.ts
    project-user.ts
    management-credential.ts
  participant/
    authorize.ts
    target.ts
    rules/
      project.ts
      credential-target.ts
      subject.ts
      grant.ts
      operation-specific.ts
      room-create.ts
      room-join.ts
      media-data.ts
  project-user/
    authorize.ts
    target.ts
    role-matrix.ts
    rules/
      project.ts
      actor.ts
      target-id.ts
      role.ts
      owner-management.ts
  management-credential/
    authorize.ts
    target.ts
    scope-matrix.ts
    rules/
      credential.ts
      project-target.ts
      scope.ts
      target-id.ts
  index.ts
```

ルールIDと仕様・テスト・形式検証の対応は、この文書のルール表を正本とし、`scripts/check-traceability.mjs` が `traceability.md` を生成する。`contracts/rules.ts` は実行時の `RuleViolation`（reasonだけ）を持ち、ルールIDや認可条件は持たない。

## テスト構成

```
test/
  participant/
  project-user/
  management-credential/
  pbt/
  conformance/
  contract/
```

- テストファイルは認可ルール群と変更理由で分ける。`describe` の数や階層は固定しない。
- 共通の正常系シナリオは `support/` に置く。複数の違反条件を同時に試すテストでは、複数項目を明示的に変更してよい。
- 前提条件を隠すdeep mergeの汎用ビルダーは作らない。テストを読んだ人が、どの条件を変えたかを追えることを優先する。
- 監査targetや決定の envelope など、全判定に共通する契約のアサーションは共有してよい。ケース固有の期待reasonやtargetを共通関数で隠さない。
- ルールIDはREADMEのルール表と `traceability.md` で追跡し、テスト名は条件と期待する許可・拒否が分かる名前にする。
- IDは固定値を使い、実行ごとの乱数に依存しない。
- `test/package.test.ts` はビルド済みパッケージを読み込むため、`tsconfig.test.json` の型検査から除外し、ビルド後のVitestで確認する。
- `test:conformance` はLeanの全有限ケースとTypeScript実装を照合する。詳細は `test/conformance/README.md` を参照する。
- `check:traceability` はルール表、仕様見出し、テストファイル、Lean/TLAの対応を検査し、`traceability.md` の差分を検出する。

## ルールID

ルールIDは `系統-分類-連番` とする。READMEのルール表、`traceability.md`、仕様、テストファイル、形式検証の対応に使う。実行時の `RuleViolation` はreasonだけを返す。

### 入力検証

入力検証は認可判断とは別の `ValidationFailureReason` を返す。`authorizeFromRaw` は呼び出し契約に応じて、これを拒否結果の `credential-input-invalid` などへ変換する。

| ルールID | 条件 | ValidationFailureReason |
|---|---|---|
| `P-INPUT-001` | 入力の必須項目・型が不正 | `input-invalid` |
| `P-INPUT-002` | 定義外のParticipant operation | `unsupported-operation` |
| `P-INPUT-003` | grantsがplain objectでない | `input-invalid` |
| `P-INPUT-004` | grantsに未知のキーがある | `unsupported-grant` |
| `P-INPUT-005` | grantsの値がbooleanでない | `grant-invalid` |
| `PU-INPUT-001` | 入力の必須項目・型が不正 | `input-invalid` |
| `PU-INPUT-002` | 定義外のManagement operation | `unsupported-operation` |
| `PU-INPUT-003` | actorのroleが定義外 | `unsupported-role` |
| `PU-INPUT-004` | currentRoleまたはnextRoleが定義外 | `unsupported-role` |
| `MC-INPUT-001` | 入力の必須項目・型が不正 | `input-invalid` |
| `MC-INPUT-002` | scopesが配列でない | `input-invalid` |
| `MC-INPUT-003` | scopesに未知の値がある | `unsupported-scope` |
| `MC-INPUT-004` | 定義外のManagement operation | `unsupported-operation` |
| `MC-INPUT-005` | targetが操作に対して曖昧、または余分なIDを持つ | `target-invalid` |

### Participant

| ルールID | 条件 | reason |
|---|---|---|
| `P-PROJ-001` | Projectがactiveでない | `project-not-active` |
| `P-TGT-001` | credentialのProject・Room名、RoomのProjectが一致しない | `credential-target-mismatch` |
| `P-SUB-001` | credentialのsubjectが空 | `subject-required` |
| `P-SUB-002` | ParticipantのexternalUserIdが空 | `subject-required` |
| `P-SUB-003` | ParticipantのexternalUserIdがsubjectと一致しない | `subject-mismatch` |
| `P-GRANT-001` | 操作に対応するgrantがtrueでない | `grant-not-granted` |
| `P-RC-001` | 既存Roomへのroom.create | `room-already-exists` |
| `P-RC-002` | room.joinを持たないroom.create | `room-join-required` |
| `P-RC-003` | room.createにSessionが渡された | `session-target-mismatch` |
| `P-RC-004` | room.createにParticipantが渡された | `participant-target-mismatch` |
| `P-RJ-001` | 未作成Roomへのroom.joinでroom.createがない | `room-create-required` |
| `P-RJ-002` | 未作成Roomへのroom.joinでSessionが渡された | `session-target-mismatch` |
| `P-RJ-003` | 未作成Roomへのroom.joinでParticipantが渡された | `participant-target-mismatch` |
| `P-RJ-004` | 既存Roomがactiveでない | `room-not-active` |
| `P-RJ-005` | Sessionだけが渡され、Participantがない | `participant-required` |
| `P-RJ-006` | Sessionがactiveでない | `session-not-active` |
| `P-RJ-007` | SessionのProject・Room・Participantが一致しない | `session-target-mismatch` |
| `P-RJ-008` | Participantがactiveでない | `participant-not-active` |
| `P-RJ-009` | ParticipantのRoomが一致しない | `participant-target-mismatch` |
| `P-MD-001` | Roomがactiveでない | `room-not-active` |
| `P-MD-002` | Sessionがない | `session-required` |
| `P-MD-003` | Sessionがactiveでない | `session-not-active` |
| `P-MD-004` | Participantがない | `participant-required` |
| `P-MD-005` | Participantがactiveでない | `participant-not-active` |
| `P-MD-006` | SessionのProject・Room・Participantが一致しない | `session-target-mismatch` |
| `P-MD-007` | ParticipantのRoomが一致しない | `participant-target-mismatch` |
| `P-ALLOW-001` | すべてのルールを満たす | `allowed` |

`P-INPUT-*` はvalidatorで処理し、認可関数は検証済み入力だけを受け取る。既存の `unsupported-operation` は `authorizeFromRaw` の変換先として残す。

### ProjectUser

| ルールID | 条件 | reason |
|---|---|---|
| `PU-PROJ-001` | Projectがactiveでない | `project-not-active` |
| `PU-ACTOR-001` | actorのProjectが一致しない | `actor-project-mismatch` |
| `PU-TGT-001` | 対象資源のProjectが一致しない | `target-project-mismatch` |
| `PU-ROLE-001` | actorのroleがない | `project-user-role-missing` |
| `PU-ID-001` | 操作に必要なtarget IDがない | `target-id-required` |
| `PU-ROLE-004` | roleに許可されていない操作 | `insufficient-role` |
| `PU-ROLE-005` | 付与・ロール変更にnextRoleがない | `project-user-next-role-required` |
| `PU-ROLE-006` | 除外・ロール変更にcurrentRoleがない | `project-user-current-role-required` |
| `PU-OWNER-001` | AdminがOwnerを付与・除外・変更する | `owner-management-forbidden` |
| `PU-ALLOW-001` | すべてのルールを満たす | `allowed` |

actor・currentRole・nextRoleの定義外は `PU-INPUT-003/004` で検証し、認可関数は検証済み入力だけを受け取る。既存の `project-user-role-invalid` は `authorizeFromRaw` の変換先として残す。

### Management API credential

| ルールID | 条件 | reason |
|---|---|---|
| `MC-CRED-001` | credentialが失効している | `credential-revoked` |
| `MC-CRED-002` | 期限値または現在時刻が有限の数値でない | `credential-expiry-invalid` |
| `MC-CRED-003` | 現在時刻が期限以上 | `credential-expired` |
| `MC-TGT-001` | credentialまたはtargetのProjectが一致しない | `credential-target-mismatch` |
| `MC-PROJ-001` | Projectがactiveでない | `project-not-active` |
| `MC-ID-001` | 操作に必要なtarget IDがない | `target-id-required` |
| `MC-SCOPE-001` | operationがcredentialの許可対象でない | `credential-operation-not-allowed` |
| `MC-SCOPE-002` | 必要なscopeがない | `credential-scope-missing` |
| `MC-ALLOW-001` | すべてのルールを満たす | `allowed` |

scopesの形・未知のscope・operationの定義外は `MC-INPUT-002/003/004` で検証する。既存の `credential-input-invalid` と `unsupported-operation` は `authorizeFromRaw` の変換先として残す。

### ドメイン不変条件

認可判断とは別に、Managementのトランザクションが保証する不変条件を管理する。

| ルールID | 条件 | 結果 |
|---|---|---|
| `DI-OWNER-001` | Ownerの除外・降格後も有効なOwnerが1人以上残る | 成立 |
| `DI-OWNER-002` | Ownerの除外・降格でOwnerが0人になる | 不成立（不変条件違反） |

`DI-OWNER-*` は `authorizeProjectUserAction` のreasonに含めない。認可は操作主体の権限を返し、ドメイン不変条件はManagementのトランザクションが別の結果として返す。

## 有限domain

Leanの有限モデルは、生の文字列や暗号処理ではなく、判定に影響する同値クラスを列挙する。すべての組み合わせを対象とし、サンプリングしない。

入力形状が不正なケースは、他の次元と直積せず、独立したケースとして列挙する。形状不正の入力に対して、無意味な全組み合わせを生成しない。

### Participant

| 次元 | 値 |
|---|---|
| operation | `room.create`、`room.join`、`media.publish`、`media.subscribe`、`data.send`、定義外 |
| Project状態 | active、suspended |
| credential Project | 一致、不一致 |
| credential Room名 | 一致、不一致 |
| RoomのProject | 一致、不一致 |
| Roomの状態 | absent、active、deleting、deleted |
| Session | なし、あり（active/revoked/ended × Project/Room/Participantの一致/不一致） |
| Participant | なし、あり（active/revoked/left × Roomの一致/不一致 × externalUserIdの一致/不一致/空） |
| subject | 空、非空 |
| grants | 5操作のboolean 32通り、未知キー、非boolean |
| 入力形状 | 正常、必須項目欠落、型不正、target形状不正 |

### ProjectUser

| 次元 | 値 |
|---|---|
| operation | 既知19、定義外 |
| actor role | owner、admin、operator、auditor、null、定義外 |
| Project状態 | active、suspended |
| actorのProject | 一致、不一致 |
| targetのProject | 一致、不一致 |
| target ID | あり、なし |
| currentRole | なし、4ロール、定義外 |
| nextRole | なし、4ロール、定義外 |
| target種別 | operationごとの必須target（account、projectUser、room、session、participant、resource） |

### Management API credential

| 次元 | 値 |
|---|---|
| operation | 既知19、定義外 |
| scopes | 4 scopeの部分集合16通り、未知scope、非配列 |
| revoked | true、false、不正値 |
| 期限 | 有効、期限到達、期限値不正 |
| 現在時刻 | 有限、非有限 |
| Project状態 | active、suspended |
| credentialのProject | 一致、不一致 |
| targetのProject | 一致、不一致 |
| target ID | あり、なし |
| target形状 | 一意、曖昧、余分なID |

### 列挙と比較

Leanの `Conformance/Enumerate.lean` が抽象入力の全組み合わせとJSON整形を、`Conformance/ValidationCases.lean` がvalidatorの不正入力ケースを定義する。TypeScriptの `test/conformance/` が全件を読み、validatorの成否と失敗理由を比較する。validatorが成功したケースだけ判定関数の結果を比較する。

入力キー順、targetの項目順、reasonの表記を固定する。出力が大きい場合はoperation・role・scope単位のbucketに分け、bucketごとに `cmp` する。全件照合を維持する。スクリプトは系統別のケース数、認可判断の比較件数、validator失敗件数を固定値と照合し、空のJSONLやケース欠落を失敗させる。

各ケースは次の形にする。

```json
{"kind":"participant","caseType":"authorization","input":{},"validation":{"ok":true},"decision":{"allowed":false,"reason":"subject-mismatch","targetKeys":["projectId","roomName"]}}
```

validatorの不正入力ケースは `caseType` を `validation` とし、`validation` に失敗理由を入れて `decision` を省略する。

```json
{"kind":"participant","caseType":"validation","input":{},"validation":{"ok":false,"reason":"input-invalid"}}
```

有限モデルの対象外は、生のJSON形状の全パターン、JWT署名・暗号検証、Management・Signalingの状態遷移、並行実行の競合とする。これらはPBT、Fuzzing、統合試験、TLA+で補う。

## Leanモデルと定理

LeanモデルはTypeScript実装から独立して手書きし、抽象入力に対する `decide` を持つ。認可条件・判定順序・有限domainをTypeScriptから生成しない。`proofs/` のモデルと `proofs/Conformance/` の列挙が、`test:conformance` でTypeScript実装と照合される。

| 定理 | 保証内容 |
|---|---|
| `participant_decide_total` / `project_user_decide_total` / `management_credential_decide_total` | 契約内のすべての入力に判定が存在する |
| `participant_decide_deterministic` など | 同じ入力から同じ判定を得る |
| `participant_allow_sound` / `project_user_allow_sound` / `management_credential_allow_sound` | 許可なら必要条件がすべて成立する |
| `participant_allow_complete` / `project_user_allow_complete` / `management_credential_allow_complete` | 必要十分な許可条件を満たせば許可される |
| `participant_first_failure_all` など | 最優先の違反条件に対応するreasonを返す |
| `participant_non_interference` / `project_user_non_interference` / `management_credential_non_interference` | 無関係な入力項目が判定を変えない |
| `participant_audit_target_exact` / `project_user_audit_target_exact` / `management_credential_audit_target_exact` | targetに必要な情報だけが含まれる |
| `management_credential_rejects_project_user_management` | credential は ProjectUser 管理操作を scope に関係なく許可しない |
| `validation_rejects_unknown_grant` | 未知のgrantを拒否する |
| `validation_rejects_non_boolean_grant` | 非booleanのgrantを拒否する |
| `role_inclusion_conditional` / `role_non_inclusion` | ロールの条件付き包含と非包含 |
| `scope_partition` | scopeの排他・網羅 |
| `owner_admin_boundary` | AdminがOwnerを操作できない |

ProjectUserのロール包含は、操作名の集合だけでなく、対象role、Project状態、target IDの条件を含む関係として定義する。Owner・Admin・Operator・Auditorの包含と非包含を、条件付きで証明する。

最後のOwnerは認可モデルではなく、ドメイン不変条件のモデルで証明する。

有限モデルは `proofs/Conformance/Main.lean` が全件をJSONLで出力し、`scripts/run-authorization-conformance.mjs` がTypeScript実装と比較する。現在は Participant 215,046、ProjectUser 38,010、Management API credential 29,192 の合計 282,248 ケースを照合する。うち認可判断を比較するのは 272,496 ケース、validator失敗を比較するのは 9,752 ケースで、サンプリングしない。

## 認可とドメイン不変条件の境界

最後のOwnerを削除・降格してはいけない制約は、操作主体の権限に関係なく成立するドメイン不変条件とする。

| 判定 | 責務 | 結果 |
|---|---|---|
| このProjectUserがOwnerを除外・降格する権限を持つか | Authorization | 許可・拒否 |
| 操作後もProjectが有効なOwnerを1人以上持つか | Managementのドメイン不変条件 | 成立・不成立 |

- `authorizeProjectUserAction` は `activeOwnerCount` を受け取らない。
- 純粋な不変条件関数を `packages/domain/src/project-owner.ts` に置き、Managementのトランザクションが認可判定後に呼ぶ。
- ManagementはOwner集合をロックし、現在のOwner数を読み、認可判定と不変条件検査を行ってから確定する。
- 認可拒否は `403`、不変条件違反は `409` など、監査で区別できる結果にする。
- 2人のOwnerを同時に削除する競合は、ManagementのTLA+モデルで検証する。純粋な不変条件関数だけでは並行更新を防げない。

不変条件関数は認可パッケージのrole型に依存させない。

```ts
export type ProjectOwnerChange =
  | { readonly kind: "remove"; readonly currentIsOwner: boolean }
  | {
      readonly kind: "changeRole";
      readonly currentIsOwner: boolean;
      readonly nextIsOwner: boolean;
    };

export type ProjectOwnerInvariantResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "last-owner" | "owner-count-invalid";
    };

export function checkProjectOwnerInvariant(input: {
  readonly activeOwnerCount: number;
  readonly change: ProjectOwnerChange;
}): ProjectOwnerInvariantResult;
```

`currentIsOwner` と `nextIsOwner` は呼び出し側が現在のProjectUserロールから導出する。`activeOwnerCount` は変更前の有効Owner数とする。不変条件関数は、Ownerが減る変更で `activeOwnerCount` が1以下なら `last-owner` を返す。

この境界は `docs/platform/management.md` に反映済みで、純粋関数のテストは `packages/domain/test/project-owner.test.ts`、並行更新のモデルは `packages/domain/specs/ProjectOwner.tla` に置く。`docs/auth/credentials.md` のgrant検証条件と、`docs/auth/authorization.md` の判定結果・監査targetの契約も、validatorとcanonical targetに合わせて更新済み。

## PBT

PBTは、Leanの有限抽象モデル外の入力、validatorの異常入力、境界値、無関係項目の非干渉性を担当する。詳細は [認可判定の Property-based Testing](../../docs/auth/authorization.md#認可判定の-property-based-testing) に従う。

- `fast-check` 4.11.0 と `@fast-check/vitest` 0.5.0 を使用し、`test/pbt/` で実行する。
- CIは10,000件/性質、ローカルのmutationでは `PBT_RUNS=50` に縮小する。
- seedは実行ごとにランダムにし、失敗時にseedと反例を記録する。`PBT_SEED` と `PBT_PATH` で再現できる。
- Leanの有限列挙をPBTで置き換えない。PBTはモデル外の補完である。

## Mutation Testing

Mutation Testingは、テストが実装の誤りを実際に検出できるかを確認する。カバレッジは診断指標に留める。

- Stryker 10.1.1 と `@stryker-mutator/vitest-runner` 10.1.1 をVitest 5.1.1で使用する。
- TypeScript 7ではStrykerのTypeScript config preprocessorが動かないため、`disableTypeChecks: true` と `inPlace: true` で実行する。型検査は `tsc -p tsconfig.test.json` で別途担保する。
- 変更対象は認可判断の実装（`src/participant/**`、`src/project-user/**`、`src/management-credential/**`）とする。validatorは単体テスト・PBT・conformanceで検証し、mutationの対象外とする。
- 認可判断のmutation scoreは100%を必須とする。2026-11-24時点で597 mutant、100.00%を確認済み。
- PRでは変更ファイル中心、夜間は全体実行にする。conformanceはmutationの対象に含めず、別のオラクルとして実行する。

## 追跡

`scripts/check-traceability.mjs` がREADMEのルール表を正本として、次を検査し、`traceability.md` を生成する。

- 各ルールIDに対応する仕様見出し、テストファイル、Lean定理またはTLA+モデルがある。
- テストファイルがルールのreasonを含む。
- ルール実装が返すreasonはREADMEのルール表に存在する。
- `traceability.md` がREADMEのルール表と一致する。

現在は62ルールを追跡している。operationやreasonを追加した場合は、READMEのルール表、仕様、テスト、Lean/TLAの対応を更新し、`pnpm --filter @webrtc/authorization check:traceability --write` で `traceability.md` を更新する。どれかが欠けるとCIが失敗する。

## CIゲート

| 検証 | PR | 定期CI |
|---|---|---|
| ソース型検査 | 必須 | 必須 |
| テスト型検査 | 必須 | 必須 |
| Lint・Format | 必須 | 必須 |
| 個別テスト | 必須 | 必須 |
| PBT | 必須（縮小） | 拡大・複数seed |
| Coverage | 必須（Statements/Lines 100%、Branches 98%以上） | 必須 |
| Lean証明 | 必須 | 必須 |
| Lean/TS全有限照合 | 必須 | 必須 |
| 仕様・検証の追跡 | 必須 | 必須 |
| Mutation Testing | 必須（全体） | 全体 |
| ビルド済みパッケージ契約 | 必須 | 必須 |

conformanceのケース数、認可判断の比較件数、validator失敗件数が固定値と異なる場合は失敗する。期待値の変更は有限domainまたはvalidatorケースの設計変更としてレビューする。mutation scoreが基準を下回る場合は、equivalent mutantの追加理由がない限り失敗とする。

実行コマンド:

- `pnpm test`
- `pnpm --filter @webrtc/authorization test:coverage`
- `pnpm --filter @webrtc/authorization test:conformance`
- `pnpm --filter @webrtc/authorization check:traceability`
- `pnpm --filter @webrtc/authorization mutation`
- `moon run :check-authorization-proofs`
- `moon run :check-models`

## Phase計画

| Phase | 内容 | 主な成果物 |
|---|---|---|
| 0 | 全認可仕様・責務境界・保証範囲の確定 | この文書、ルールID、有限domain、Leanの定理、CI方針 |
| 1 | 型検査・カバレッジ・同等性検証基盤 | `tsconfig.test.json`、Vitest設定、同等性ハーネス、CI骨格 |
| 2 | 既存テストの機械的分割 | 移動前後のAST・テスト・fixture・coverage比較。移行ハーネスは削除済み |
| 3 | 独立したLeanモデル・PBT・照合基盤 | 生成契約、Leanモデルと定理、有限列挙、TS適合テスト、PBT |
| 4 | 仕様との不一致・既存バグの解消 | 未知grant、canonical target、last-owner境界、照合で見つかった差分 |
| 5 | ソースとテストの責務に基づく構造改善 | `contracts/`、`rules/`、判定順序、テストの系統別配置 |
| 6 | Mutation Testingによる検証品質改善 | Stryker設定、surviving mutantの解消、equivalent mutant管理 |
| 7 | CI・追跡・文書化の最終整備 | `check-traceability.ts`、生成対応表、README、CIゲート |

Phase 3をPhase 4/5より先に置く。実装を直してからLeanモデルを作ると、修正後の実装を正しいものとしてモデル化してしまう。先に仕様から独立したモデルとオラクルを作り、現行実装との差分をバグとして扱う。

## 実装状況

| Phase | 状態 | 根拠 |
|---|---|---|
| 0 | 完了 | この文書、62ルールの `traceability.md` |
| 1 | 完了 | `tsconfig.test.json`、`vitest.config.ts`、coverageしきい値 |
| 2 | 完了 | 3つの巨大テストをルール群別の29テストファイルへ分割 |
| 3 | 完了 | Lean 4.36のモデルと定理、PBT、282,248件の全有限照合 |
| 4 | 完了 | 未知grant、canonical target、最後のOwnerの責務分離、仕様更新、TLA+ |
| 5 | 完了 | `contracts/`、`rules/`、判定順序、canonical target |
| 6 | 完了 | Stryker 597 mutant、認可判断 100.00% |
| 7 | 完了 | traceability、CI、README、仕様の更新 |

## 確認済み事項

- `pnpm test` は authorization の30テストファイル・385テストを含めて成功する。
- Stryker 10.1.1 と `@stryker-mutator/vitest-runner` 10.1.1 は Vitest 5.1.1 で動作する。TypeScript 7では `disableTypeChecks` と `inPlace` が必要。
- `@vitest/coverage-v8` 5.1.1 は Vitest 5.1.1 に対応する。
- `fast-check` 4.11.0 でPBTを実行できる。
- Lean 4.36.0で `check-authorization-proofs` が成功し、`test:conformance` が Participant 215,046、ProjectUser 38,010、Management API credential 29,192 の合計282,248ケースを照合する。認可判断は272,496件、validator失敗は9,752件を比較する。
- `traceability.md` は62ルールを追跡し、CIで差分を検出する。
- coverageはStatements 100%、Lines 100%、Functions 100%、Branches 98.37%。
- `moon run :check-models` で Browser SDK と `ProjectOwner.tla` のモデル検査が成功する。
