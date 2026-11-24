# 認可ポリシーの形式検証

## 目的

ProjectUser のロール、Management API credential の scope、参加 JWT の grants による認可判断を、Lean 4 の有限モデルで証明する。あわせて、Lean モデルと TypeScript 実装の判定結果を、モデル化した有限入力の全組み合わせで照合する。

Lean モデルは TypeScript の認可ロジックから生成しない。[外部認証との連携・認可・権限の失効](authorization.md)と[Management サーバー・管理 API](../platform/management.md)を読み、独立して定義する。

## 保証する範囲

| 対象 | 保証する内容 |
|---|---|
| Lean モデル | 任意の入力から有限ケースへの抽象化で認可判定が変わらないこと。ロール・操作・scope の包含関係と拒否条件。 |
| TypeScript 実装 | Lean モデルと同じ有限ケースで、許可・拒否と理由が一致すること。 |
| 仕様との対応 | 仕様 ID と Lean の定義・定理、TypeScript テスト、照合ケースの対応。意味的な妥当性は人間が確認する。 |

TypeScript コード自体の形式検証、HTTP、JWT 署名検証、DB、管理 UI の実装検証は対象外とする。TLA+ が担当する状態遷移・並行性・失効競合のモデル検査も対象外とする。

## 仕様 ID と対応

認可判断に影響する仕様の条件には、次の接頭辞で ID を付ける。

| 接頭辞 | 対象 |
|---|---|
| `AUTH-PART-` | 参加 JWT の grants、subject、Room・Session・Participant の状態と対応 |
| `AUTH-PU-` | ProjectUser のロール、操作、Owner 管理制約、対象 ID |
| `AUTH-MC-` | Management API credential の scope、失効、期限、Project、対象 ID |
| `AUTH-VER-` | Lean モデル、有限ケース、照合、CI の検証条件 |

仕様 ID と、Lean の定義・定理、TypeScript テスト、照合ケースは多対多で対応してよい。1 つの仕様条件を複数の定理で確認でき、1 つの定理が複数の仕様条件を確認できる。

対応表は [`packages/authorization/test/spec-map.json`](../../packages/authorization/test/spec-map.json) に置く。各仕様 ID は、説明、Lean の定理、TypeScript テスト、照合ケース、必要なスクリプトを持つ。

対応漏れの検出と意味的な妥当性の確認を区別する。

- CI は、仕様 ID が対応表に存在すること、対応先の定理・テスト・照合ケースが存在すること、逆方向の対応先が未登録でないことを検査する。
- 人間は、仕様 ID の条件を Lean の定義が実際に表現していること、定理が結論を先取りしていないこと、TypeScript テストが同じ条件を確認していることをレビューする。
- CI の成功を、仕様とモデルの意味的な一致の証明として扱わない。

## 抽象化と有限ケース

Lean モデルは、文字列、ID、時刻などの具体値を直接列挙しない。任意の文字列、ID、有限または非有限の時刻を入力として受け取り、認可判断に影響する比較だけを有限ケースへ抽象化する。

認可判断に影響する要素をすべて有限ケースに含める。少なくとも次を含む。

- 参加 JWT の全 grants
- Management API credential の scope 集合と、未知 scope の有無
- 操作、操作対象のロール、変更後のロール、現在のロールの欠落・不正値
- Project、Room、Session、Participant の状態
- subject、Project、Room、Session、Participant の一致・不一致・欠落
- 対象 ID の有無
- credential の失効、期限前・期限到達・期限値不正

有限ケースは、認可判断の経路ごとに上記の要素の直積を定義し、その和を全ケースとする。各要素の全値を列挙し、参加 JWT、ProjectUser、Management API credential の各ケース一覧が全ケースを含むことを Lean で証明する。

任意の入力 `input` について、次を Lean で証明する。

```text
decideConcrete input = decideCase (toCase input)
```

`toCase` は、入力の比較結果を有限ケースへ写す。この定理により、有限ケースの列挙が認可判断を変えないことを確認する。

具体入力の判定は、完全な抽象化ビューである `toCase` を通る形で定義する。Lean の定理は、具体入力の判定が有限ケースの判定に因子化されることを示す。TypeScript 実装との独立した一致は、後述の全件照合で確認する。

文字列、ID、時刻を有限ケースへ落とすときは、次の同値類を使う。

| 入力 | 同値類 |
|---|---|
| ID、subject、Room 名 | 欠落、空、一致、不一致 |
| 時刻 | 非有限、期限前、期限到達、期限後 |

同値類の代表値を変えても判定が変わらないことを、TypeScript の照合テストで確認する。

## TypeScript 実装との照合

Lean モデルは、有限ケースの軸、各ケースの許可・拒否、理由を機械可読な形で出力する。TypeScript の照合テストは、この出力から全ケースを再構成し、実際の認可関数の結果と比較する。

照合で不一致が見つかった場合は、#96 の中で TypeScript 実装または Lean モデルを修正する。どちらを修正するかは仕様に照らして決め、同じケースを回帰テストと証明に残す。

ロール、操作、scope を追加したときは、Lean のモデルと TypeScript の公開定数の両方を更新する。片方だけを更新した場合は、照合テストまたは対応表の検査を失敗させる。

## CI の検査

CI では次を実行する。

- Lean のビルド
- `sorry` を残さないこと
- 意図しない公理への依存がないこと。定理ごとに依存する公理を出力し、許可した公理以外を検出する。現在の許可リストは `propext`、`Classical.choice`、`Quot.sound` とする。
- 有限ケースの完全性の定理
- 抽象化不変性の定理
- TypeScript 実装との全ケース照合
- 仕様 ID の対応漏れ

仕様 ID の対応検査は [`packages/authorization/test/spec-map.test.ts`](../../packages/authorization/test/spec-map.test.ts) で行う。すべての対象定理と照合ケースが少なくとも 1 つの仕様 ID に対応し、参照されたテスト名・スクリプト・ケースが存在することを検査する。仕様 ID の一覧が仕様の全条件を網羅しているかは、人間がレビューする。

公理の許可リストは、証明に必要な最小限の公理だけを記録する。許可リストを増やす場合は、その公理が必要な理由と適用範囲をレビューする。

## 受け入れ条件

- Lean のビルドが成功し、`sorry` を残さない。
- 現在の全ロール、操作、scope、grants、状態、対象 ID の有無が有限ケースに含まれる。
- 有限ケースの完全性と、抽象化不変性が Lean で証明されている。
- Lean モデルと TypeScript 実装の許可・拒否と理由が、全有限ケースで一致する。
- ロール、操作、scope の追加時に、モデル・実装・照合ケースの更新漏れを CI が検出する。
- 仕様 ID の対応表に未対応がないことを CI が検出し、意味的な妥当性を人間がレビューしている。
- Lean 証明が保証する範囲と、保証しない範囲が文書化されている。
