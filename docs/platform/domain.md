# 共通ドメイン型と ID 契約

## 適用範囲

Management・Signaling・Client SDK は、この文書の共通ドメイン型と ID 契約を使う。共通型は概念の識別と関連付けだけを表し、認可・状態遷移・生成・保存・照会などの業務ロジックと永続化処理を含めない。それらは各コンポーネントの仕様と実装が担う。

TypeScript は `@webrtc/domain`、Rust は `webrtc-domain` を使う。両者の型名と語義はこの文書に一致させる。

## Member と Participant

`Participant` は[用語](overview.md#用語)で定義する参加者を表す。`Member` は `Participant` の別名であり、Management API・Signaling・Client SDK で別の対象を指す語として使わない。`MemberId` も `ParticipantId` の別名とし、同じ参加者 ID を指す。

`ParticipantDevice` は同じ参加者が使う参加端末を表し、[ルームと参加端末のライフサイクル](rooms.md#ルーム参加者権限)の用語に一致する。`Participant` と `ParticipantDevice` は別々に識別する。

## ドメイン型

| 型 | 語義 |
|---|---|
| `Project` | 顧客アプリケーション・鍵・利用量・監査を束ねるテナント境界 |
| `Account` | Management UI にログインする管理主体 |
| `ProjectUser` | Project 内の権限ロールを持つ Account と Project の関係 |
| `Application` | Project に属し、参加 JWT に署名するための鍵を保有する顧客アプリケーション |
| `ApplicationSigningKey` | Application が参加 JWT に HS256 署名を行うための鍵 |
| `ManagementApiCredential` | Management API 専用の顧客サーバー用認証情報 |
| `Room` | 参加者が音声・映像・データを共有する単位。`name` は Project 内で一意とする |
| `Participant` / `Member` | ルームに参加する利用者 |
| `ParticipantDevice` | Participant がルームに参加するためのブラウザー側主体 |
| `ConnectionState` | 接続確立・維持・失敗・終了を表す共通の粗い状態 |
| `ResourceState` | 資源の予約・使用・解放と、確保・解放の結果不明を表す状態 |

## 名前

`Project`・`Account`・`ProjectUser`・`Application`・`ApplicationSigningKey`・`ManagementApiCredential`・`Room`・`Participant` / `Member`・`ParticipantDevice` は `name` を持つ。`name` はドメイン上の名前であり、人間用の表示だけを目的としない。

`Room.name` は Project 内で一意な Room の識別名であり、Room の作成前から参加 JWT の `room` 対象と既存 Room の照合に使う。作成後の正本 ID は `RoomId` とし、Signaling は `ProjectId` と `Room.name` で既存 Room を照合する。`Room.name` の入力上限・不正値の扱いは参加 JWT と Signaling の仕様で定める。

`Room.name` 以外の `name` は表示・監査・管理のための名前であり、重複を許す。それらの入力上限・不正値の扱い・表示方法は Management API と管理 UI の仕様で定める。どの `name` も、認可・操作対象の確認・監査の正本を ID の代わりに置き換えない。

## 関連付け

| 型 | 関連 ID |
|---|---|
| `ProjectUser` | `ProjectId` と `AccountId` |
| `Application` | `ProjectId` |
| `ApplicationSigningKey` | `ApplicationId` |
| `ManagementApiCredential` | `ProjectId` |
| `Room` | `ProjectId` |
| `Participant` / `Member` | `RoomId` |
| `ParticipantDevice` | `ParticipantId` |

## ID 形式

共通 ID は文字列とし、業務名や設定値から推測できる値を使わない不透明な識別子とする。各 ID は 26 文字の ULID だけを受け入れる。

ULID は 128 bit を 26 文字の Crockford Base32 で表す。正本表記は大文字とし、先頭 1 文字は `[0-7]`、残り 25 文字は `[0-9A-HJKMNP-TV-Z]` とする。パーサーは小文字入力を受け付け、解析後に大文字へ正規化して保持する。先頭が `8`〜`Z` の値、`I`・`L`・`O`・`U`、Crockford Base32 以外の文字、長さが 26 文字でない値は拒否する。

ID を生成する実装は ULID を使う。共通型は生成処理を持たず、境界で受け取った ID の形式だけを検証する。TypeScript の branded type と Rust の newtype は、値の形式が同じでも型を混用できないように区別する。

TypeScript では `parseProjectId` などの `parse<型名>` 関数、Rust では各 ID 型の `parse` メソッドを使う。空文字・長さ不足・長さ超過・Crockford Base32 以外の文字を含む値は、例外を投げずに失敗結果として返す。

## 状態型

`ConnectionState` は、各コンポーネントが管理する詳細状態を一つに統合しない。この型は通知や管理表示で横断比較できる粗い状態だけを表す。

| 状態 | 語義 |
|---|---|
| `connecting` / `Connecting` | 接続の確立を試みている |
| `connected` / `Connected` | 対象接続がその定義された用途に使える |
| `reconnecting` / `Reconnecting` | 確立済み接続の再確立を試みている |
| `failed` / `Failed` | 現在の対象では自動再試行を続けない |
| `closed` / `Closed` | 意図的に終了した、または対象として扱わない |

`ResourceState` は[共通の資源管理](resources.md#予約確保解放)の計上と照合に対応させる。

| 状態 | 語義 |
|---|---|
| `reserved` / `Reserved` | 予約枠を計上し、資源はまだ使用していない |
| `in-use` / `InUse` | 資源を使用しており、計上を続ける |
| `release-pending` / `ReleasePending` | 解放処理中であり、完了確認までは計上を続ける |
| `isolated` / `Isolated` | 照合・回収のために新規割り当てから外し、解放確認まで計上を続ける |
| `released` / `Released` | 解放を確認し、計上から外せる |
| `result-unknown` / `ResultUnknown` | 確保・解放の結果不明であり、照合・回収が終わるまで計上を続ける |
