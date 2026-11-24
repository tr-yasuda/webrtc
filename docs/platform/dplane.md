# D-Plane のプロセスモデルと IPC 境界

## 前提

- C-Plane は TypeScript、D-Plane は Rust で実装する。
- Node host は TypeScript で実装し、Management・Signaling と同様に Fastify を制御 API に使用できる。Fastify はメディアパケットを扱わない。
- TURN と SFU が公開する UDP / TCP ポートは D-Plane が所有する。Node host はメディアソケットを持たない。
- 初期構成では Node host、TURN プロセス、SFU Worker を同じ Compute Engine 上に置く。将来は D-Plane を別 VM や独立サービスへ移せる。
- プロセスの生存期間は supervisor（systemd など）が管理する。Node host は D-Plane プロセスの OS 上の親プロセスではない。

## プロセス構成

| プロセス | 実装 | 責務 | 持たないもの |
|---|---|---|---|
| Node host | TypeScript | Signaling からの制御 API、D-Plane プロセスの起動・停止・監視、Room 配置、容量予約、統計集約 | メディアソケット、ICE / DTLS / SRTP / SCTP の状態 |
| TURN プロセス | Rust | 待受ポートの維持、Allocation・Permission・Channel Binding の処理、中継 | DB 接続、公開 HTTP API |
| SFU Worker | Rust | 複数 Room の Router、WebRTC Transport、メディア転送、DataChannel 中継 | DB 接続、公開 HTTP API |
| supervisor | systemd など | プロセスの起動・停止、異常終了の検出 | メディア処理、配置判断 |

Node host は D-Plane の制御だけを行い、パケット単位の処理を IPC に流さない。Signaling から Node host への制御 API はサービス間認証を行う。Node host から D-Plane への制御は UDS に限定する。

## プロセスの生存期間と制御接続

Node host と D-Plane プロセス（TURN と SFU Worker）は独立して起動・停止する。Node host が終了しても D-Plane プロセスは直ちに終了せず、新しい Node host の接続を待つ。

D-Plane プロセスは runtime directory にプロセスの識別子、UDS のパス、PID、プロトコル版、能力、状態を公開する。新しい Node host は起動時にこれを走査し、生存するプロセスに接続してスナップショットを取得する。

Node host は VM ごとの controller lock を取得し、永続化された `controllerEpoch` を原子的に増やす。`controllerEpoch` は VM の再起動後も単調増加する。永続状態を失った場合は、既存の D-Plane プロセスを新しい制御下に置かず、supervisor に停止を要求して再作成する。

- `controllerId` は Node host のプロセスインスタンスを識別する。
- `controllerEpoch` は VM の制御世代を識別する。新しい Node host が制御を引き継ぐときに増える。
- `controlSessionId` は、D-Plane プロセスが IPC 接続ごとに払い出す。D-Plane プロセスは同じ `controllerId` と `controllerEpoch` の再接続を受け付け、古い制御接続を無効化する。別の `controllerId` は、より大きい `controllerEpoch` の場合だけ受け付ける。

Node host は IPC の再接続で `controllerId` と `controllerEpoch` を維持し、Node host プロセスを再起動した場合だけ新しい `controllerId` とより大きい `controllerEpoch` を使う。

D-Plane プロセスは現在の制御接続と `controlSessionId` を保持し、古い接続から届いたコマンドを実行しない。同じ epoch の再接続では、新しい接続を有効にし、古い接続を閉じる。

## Worker のライフサイクル

Worker は、プロセスの起動・停止と制御接続の状態を別々に持つ。

### プロセスの起動・停止

| 状態 | 条件 | 新規 Room の受付 | 停止・終了 |
|---|---|---|---|
| Starting | プロセス起動中 | 不可 | - |
| Active | Room または予約がある | 可 | - |
| Idle | Room 0 かつ予約 0 | 可 | 30 秒の idle timeout を開始 |
| Draining | drain 指示 | 不可 | 既存 Room の終了または退役期限後に Stopping |
| Stopping | idle timeout 到達、または Draining 完了 | 不可 | 資源解放後に Exited |
| Exited | プロセス終了 | 不可 | - |

- idle timeout 中に新しい Room が割り当てられたら、停止をキャンセルして Active に戻る。
- drain は新規 Room の割り当てだけを止める。既存 Room の通話・途中参加・再接続は、移行完了または退役期限まで継続する。
- Draining 中も既存 Room の Transport 作成・再接続は許可する。強制停止とは区別する。
- Stopping に入った Worker は新しい Room を受け付けない。割り当てが必要なら Node host が別 Worker を起動する。
- Worker 数は 0 まで縮退できる。Node host と TURN プロセスは残る。
- Worker の再起動は Node host が需要と容量を見て要求する。supervisor は空の Worker を残さないよう、自動再起動を無効にする。

### 制御接続の状態

| 状態 | 条件 | 既存メディア | 新規 Room / Transport |
|---|---|---|---|
| Connected | 制御接続が有効 | 継続 | 可 |
| Orphaned | 制御接続が切断 | 継続 | 不可 |
| ForcedDraining | orphan timeout 到達 | 停止へ移行 | 不可 |
| Exited | プロセス終了 | 停止 | 不可 |

Orphaned では、既知の認可期限をローカルで適用する。認可期限が orphan timeout より早く切れる場合は、その時点で対象のメディアを停止する。orphan timeout は暫定 120 秒とし、設定可能にする。期限を超えたら ForcedDraining に移り、すべてのメディアを停止して資源を解放する。

Node host が Orphaned の間に戻った場合は、接続元の `controllerId` と `controllerEpoch` を検証して Connected に戻す。戻った時点で有効な認可を再確認し、失効しているメディアを停止する。ForcedDraining に入った Worker は再開しない。

制御接続が orphan timeout に達した場合、プロセスの起動・停止状態は Stopping に移り、ForcedDraining として全メディアを停止する。

## TURN プロセスのライフサイクル

TURN プロセスは待受ポートを維持するため常駐し、SFU Worker のような idle timeout で停止しない。Allocation はクライアントの Allocate 時に確保し、TURN の TTL で解放する。

Node host の再起動時は TURN プロセスを生存させ、新しい Node host が制御を引き継ぐ。TURN プロセスの再起動では、既存 Allocation は失われる。制御接続が切れた場合の新規確保と既存 Allocation の扱いは、[TURN プロセスの生存期間と制御接続](../turn/allocation.md#プロセスの生存期間と制御接続)に従い、orphan timeout を上限とする。

TURN の資格情報の期限切れは、新規 Allocate、Refresh、新しい Permission・Channel Binding の作成を拒否する条件であり、既存 Allocation の停止条件ではない。

## Room と Router のライフサイクル

C-Plane の Room は明示的な削除まで保持する。D-Plane の Router は Room の実行時状態であり、最後の参加者が退出した後に閉じる。

- 明示的な退出では、再接続猶予を設けない。処理中の操作と資源の解放を確認してから Router を閉じる。
- 異常切断では、初期値 30 秒の再接続猶予を設ける。猶予中に参加者が戻れば閉鎖をキャンセルする。
- 参加者・Transport がない状態が設定時間続いた Router は、C-Plane の指示が届かない場合も閉じる。
- Router を閉じた後も C-Plane の Room と履歴は保持する。再参加時は新しい Router を作成する。

Worker の idle 判定は、Router を閉じた後に行う。Router の閉鎖待ちや容量予約が残っている間は idle としない。

## 容量管理

容量の上限は CPU・帯域・参加者数とし、実使用量と予約量の合計で判定する。

- 予約は Room 作成、参加者受入、Transport、Produce、Consume などの操作単位で行う。
- 予約は操作の成功で使用中へ移し、失敗・期限切れ・結果不明の照合後に解放する。
- 同じ Worker の空き容量を、並行する複数の操作へ二重に割り当てない。
- C-Plane から Node host への Room 割り当ては、Node host の予約成功で確定する。予約に失敗したら、別 Worker、別 Host、拒否の順に扱う。
- CPU は操作種別ごとの固定コストで見積もり、Worker の実測 CPU が予約を超えた場合は新規受入を止める。
- 帯域は交渉したビットレートと Simulcast・SVC の層に基づいて予約し、実測値で受入を調整する。
- 既存 Room の増員で容量が不足した場合の移行条件は、SFU の配置・移行の仕様で別に定める。

容量予約の台帳は Node host が持ち、Worker は自身の上限を強制する。Node host の再起動時は Worker のスナップショットから予約を再構築する。Worker の再起動時は、失われた予約を C-Plane の意図状態と照合して再配置する。TURN の容量は [TURN Allocation の認証後の資源上限](../turn/allocation.md#認証後の資源上限)に従う。

## 認可と Orphaned

Orphaned 中は、次の規則で既存メディアを扱う。

- 既知の認可期限と失効条件を、各プロトコルの仕様に従って適用する。
- 新規 Room、Transport、Produce、Consume は受け付けない。
- orphan timeout を超えたら、認可期限が残っていても停止する。
- Node host が戻ったら、有効な認可を再確認してから再開する。

未知の失効通知は Orphaned 中に受け取れない。orphan timeout は、この間に失効が反映されない最大時間として扱う。Signaling の切断中の停止条件は、[Signaling の再接続](../signaling/session.md#切断を検出したとき)と[認可仕様の反映期限](../auth/authorization.md#有効期限権限変更失効の反映)に従う。

## 状態の識別子

| 識別子 | 所有者 | 意味 |
|---|---|---|
| `controllerEpoch` | Node host / VM | 制御を許可する世代。VM 再起動後も単調増加する |
| `controllerId` | Node host | Node host のプロセスインスタンス |
| `controlSessionId` | D-Plane プロセス | IPC 接続の識別。同じ epoch の再接続で古い接続を無効化する |
| `processInstanceId` | D-Plane プロセス | プロセスのインスタンス。再起動で変わる。SFU Worker では `workerInstanceId` と呼ぶ |
| `assignmentVersion` | Signaling | Room の SFU 割り当ての版。割り当て変更で単調増加する |
| `ownerEpoch` | Signaling / Worker | 割り当てを作成・変更したときの `controllerEpoch`。所有の由来を示す |
| `commandId` | C-Plane / Node host | 操作の識別。冪等性と保留中操作の照合に使う |

`controllerEpoch` は D-Plane プロセスを制御できる世代、`ownerEpoch` は個々の Room 割り当てを所有していた制御世代である。`ownerEpoch` は割り当ての由来を示すが、それだけで現在の Worker や Room の所有権を主張しない。`ownerEpoch` が現在より古いことは孤児判定の必須条件ではない。

## Signaling 再起動時の照合

Signaling は再起動後、永続化された割り当てと Node host のスナップショットを照合する。Worker にある Room の実行状態を、DB に同じ Room がないことだけで孤児として閉じない。

孤児として閉じるのは、対象の `(Room, processInstanceId, assignmentVersion)` について、次のすべてを確認できた場合だけとする。

- 対象の `commandId` の保留中・結果不明の操作がない。
- DB に、対象の `(Room, processInstanceId, assignmentVersion)` と一致する現在の割り当てがない。
- 現在の Node host が、対象の Worker と Router を現在の割り当てとして主張していない。
- Node host / Signaling が、対象の `(Room, processInstanceId, assignmentVersion)` を現在の割り当てとして保持していない。
- 確認期間を置いて再照合しても結果が変わらない。

DB に同じ Room のより新しい `assignmentVersion` がある場合は、対象の古い割り当てを孤児として扱える。DB の割り当てが Worker の版より古い場合は、未確定の割り当てとして修復し、孤児にしない。`ownerEpoch` の新旧だけでは閉じない。

照合が確定するまでの対象の割り当ては Quarantine とし、その割り当ての既存メディアは継続するが、新規参加と Transport 作成を拒否する。同じ Room の新しい割り当ては通常どおり扱う。対象の割り当てが現在のものとして確認できれば Active に戻し、孤児が確定したら対象の Router を閉じて容量を解放する。判定できない場合は Quarantine を維持し、運用者に通知する。

DB にあるが Worker にない割り当ては失敗として再配置する。再配置には新しい `assignmentVersion` を払い出し、古い Worker が後から接続しても古い版の操作を適用しない。

## IPC 契約

gRPC over UDS を第一候補とする。契約はメッセージの意味論として定義し、gRPC と protobuf は実装時に確定する。

### 接続

- プロトコル版、`controllerId`、`controllerEpoch`、`controlSessionId`、`processInstanceId`、能力、上限を交換する。
- 版が非互換なら接続を拒否する。
- UDS のファイル権限と peer credential で呼び出し元を制限する。公開ネットワークには待ち受けない。
- 同じ `controllerId` と `controllerEpoch` の再接続は許可し、古い制御接続を無効化する。
- より大きい `controllerEpoch` の別 `controllerId` は制御を引き継げる。

### プロセス分離と制御ソケットの権限

Node host、TURN プロセス、SFU Worker は、別々のサービス UID で実行する。

| プロセス | サービス UID | 制御グループ |
|---|---|---|
| Node host | `webrtc-node` | `webrtc-turn-ctrl` と `webrtc-sfu-ctrl` |
| TURN プロセス | `webrtc-turn` | `webrtc-turn-ctrl` |
| SFU Worker | `webrtc-sfu` | `webrtc-sfu-ctrl` |

TURN と SFU Worker は互いの制御グループへ所属させない。Node host だけが両方の制御グループへ所属し、両方の制御ソケットへ接続できる。

runtime directory と制御ソケットは、次の条件を満たす。

| 対象 | 所有者 | 権限 |
|---|---|---|
| TURN の runtime directory | `webrtc-turn:webrtc-turn-ctrl` | `0700` または `0750` |
| TURN の制御ソケット | `webrtc-turn:webrtc-turn-ctrl` | `0600` または `0660` |
| SFU の runtime directory | `webrtc-sfu:webrtc-sfu-ctrl` | `0700` または `0750` |
| SFU の制御ソケット | `webrtc-sfu:webrtc-sfu-ctrl` | `0600` または `0660` |

具体的な値は、同一 UID を使わない構成を前提に、公開ネットワークからアクセスできず、意図した制御グループだけがアクセスできる最小権限とする。起動時に所有者・権限・パスを検証し、条件を満たさなければ待ち受けない。

D-Plane は、接続元の peer UID が `webrtc-node` であることを確認する。Node host は、接続先の peer UID が期待する TURN または SFU の UID であること、socket の所有者・権限・パスが期待値と一致することを確認する。

`SO_PEERCRED` の GID は接続元の主 GID だけを返す。補助グループによるアクセス制御はファイル権限で行い、認証は peer UID で行う。PID は識別子に使わない。接続インスタンスは `controllerId`、`controllerEpoch`、`controlSessionId` で識別する。

UDS は同一ホスト内の制御経路であり、TLS を要求しない。別 VM に分離する場合は、別プロファイルで相互認証と暗号化を定義する。

### コマンドとイベント

コマンドには少なくとも次を含める。

- Room の Router 作成・閉鎖、状態スナップショットの取得
- Transport の作成・接続・閉鎖
- Produce・Consume の作成・閉鎖、pause・resume
- DataChannel の開閉
- 容量の予約・解放
- drain、shutdown、heartbeat

イベントには少なくとも次を含める。

- Room の Router、Transport、Produce、Consume、DataChannel の状態変更
- 容量の使用量と予約量
- 1 分単位の統計
- Worker の異常、制御接続の状態、終了理由

TURN 固有の制御は、TURN の仕様で定めるコマンドとして同じ接続に載せる。

### 意味論

- 各コマンドは `commandId` を持ち、同じ ID の再送を冪等に扱う。
- Room 単位の順序を保証し、異なる Room のコマンドは並行してよい。
- 各コマンドに期限を設け、期限超過は結果不明として扱う。
- 結果不明のコマンドは、スナップショットまたは状態照会で結果を確定する。確認できるまで容量予約を解放しない。
- キューと同時処理数に上限を設け、超過時はバックプレッシャーを返す。
- パケット単位のメディアデータを IPC に流さない。DataChannel の本文も流さない。
- エラーは再試行可否、対象、理由を含む型付きの結果として返す。

### スナップショットとイベント境界

スナップショットには、その時点のシーケンス番号を含める。Node host はスナップショット取得後、同じシーケンス番号以降のイベントを購読する。取得中の変更を欠落させず、重複したイベントはシーケンス番号で排除する。

### 統計

統計は 1 分単位で集約し、期間、シーケンス番号、カウンター、圧縮方式、欠測期間を含める。バッファが上限に達した場合は、隣接する期間を圧縮するか、欠測期間と理由を明示する。古い集約を黙って破棄しない。Signaling は欠測を 0 として扱わない。厳密な利用量計上が必要な場合は、永続バッファの導入を別途検討する。

## 再起動時の復旧

| 障害 | メディア | 復旧 |
|---|---|---|
| Node host 再起動 | 継続 | 新しい Node host が生存する TURN プロセスと SFU Worker に接続し、スナップショットとイベント境界から制御を引き継ぐ。古い制御接続は無効化する |
| Worker 再起動 | その Worker の Room は停止 | Node host が影響 Room を C-Plane に通知し、C-Plane が再配置する。参加端末は再接続する。ICE / DTLS の状態は復元しない |
| Signaling 再起動 | 継続 | 永続化された割り当てと Node host のスナップショットを照合する。孤児の割り当ては Quarantine で確認してから閉じ、欠けた割り当ては再配置する |
| Node host が戻らない | orphan timeout まで継続 | TURN プロセスと Worker は Orphaned となり、新規受付を止める。期限後に既存メディアを停止し、資源を解放する |
| TURN プロセス再起動 | 既存 Allocation は停止 | クライアントは新しい Allocation を作成する。TURN は永続状態を持たない |

## 受け入れ条件

| 条件 | 確認する結果 |
|---|---|
| Node host 再起動 | TURN プロセスと Worker が生存し、メディアが継続する。新しい Node host が状態を引き継ぎ、古い制御接続のコマンドを実行しない |
| TURN の常駐と Allocation | Node host 再起動後も TURN リスナーと既存 Allocation が継続する。Allocation は Allocate 時に確保し、全中継ポートを事前に bind しない |
| TURN の Orphaned | 制御接続が切れたら新規 Allocate を拒否し、既存 Allocation は Allocation・Permission・Channel Binding の期限まで継続する。資格情報の期限切れだけでは停止せず、orphan timeout で停止する |
| 同一 epoch の再接続 | 同じ `controllerId` の再接続を受け付け、古い `controlSessionId` のコマンドを拒否する |
| epoch の永続性 | VM 再起動後も `controllerEpoch` が単調増加する。永続状態を失った場合は既存の D-Plane プロセスを制御しない |
| Worker idle と縮退 | Room 0 かつ予約 0 で 30 秒後に停止し、新規 Room で停止をキャンセルする。Worker 数を 0 にできる |
| drain と強制停止 | drain 中は新規 Room の割り当てだけを止め、既存 Room の通話・途中参加・再接続は退役期限まで継続する。orphan timeout の強制停止と混同しない |
| Room の閉鎖 | 明示退出は処理完了後に閉じ、異常切断は 30 秒の猶予後に閉じる。再接続で閉鎖をキャンセルする |
| 容量予約 | 空き枠 1 に対する同時 Room 作成で、確保が 1 件だけになる。予約中の Worker を idle で停止しない |
| Worker 再起動 | 影響 Room が再配置され、クライアントが再接続する。古い Worker の状態を復元済みとして扱わない |
| Signaling 再起動 | DB にない割り当てを即座に閉じず、`(Room, processInstanceId, assignmentVersion)`、`commandId`、所有状態の照合後に孤児を確定する。同じ Room の新しい割り当てを妨げない |
| Orphaned の認可 | 各プロトコルの仕様で停止条件となる認可期限が orphan timeout より早い場合はその時点で停止し、期限到達で全メディアを停止する |
| 統計の欠測 | バッファ溢れで集約を黙って破棄せず、圧縮または欠測期間を記録する。Signaling は欠測を 0 として扱わない |
| IPC の境界 | メディアパケットと DataChannel 本文が IPC に流れない。UDS が公開ネットワークに露出しない |
| プロセスの独立 | Node host の終了で TURN プロセスと Worker が道連れにならず、停止後のプロセスが残らない |
