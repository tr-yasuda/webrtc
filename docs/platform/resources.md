# 共通の資源管理

## 資源管理

サーバーが保持する接続状態、処理待ち要求、タイマー、管理表、受信・再構成バッファには、件数と総メモリ量の上限を設ける。
上限は設定可能とする。

### 予約・確保・解放

サーバーは、資源を確保する前に利用者別・ルーム別・サーバー全体の枠を予約する。並行要求にも同じ空き枠を一度しか割り当てず、予約済み・使用中・解放待ち・隔離・結果不明の資源を上限に計上する。予約済みから使用中へ移る間も、二重計上や計上漏れを起こさない。

サーバーは予約と確保した資源をそれぞれ識別し、確保・解放・照合の結果が対象の予約と資源に対応することを確認する。途中で失敗した場合、資源を確保していないことを確認できた枠は返却する。すでに資源を確保している枠は、その解放を確認してから返却する。結果を確認できない場合は、次の節の照合・回収に進む。

各状態には、有効期限または解放条件を定める。期限が切れた状態は利用を止めて関連する資源を解放し、解放が完了するまでは件数と総メモリ量に計上する。

D-Plane の容量は、実使用量と予約量の合計で判定する。予約は Room 作成、参加者受入、Transport、Produce、Consume などの操作単位で行い、成功で使用中へ移し、失敗・期限切れ・結果不明の照合後に解放する。同じ Worker の空き容量を、並行する複数の操作へ二重に割り当てない。

Worker の idle 判定には、担当 Room だけでなく予約済みの容量を含める。Room が 0 でも予約が残っている Worker は停止しない。C-Plane から Node host への Room 割り当ては、Node host の予約成功で確定する。予約に失敗した場合は、別 Worker、別 Host、拒否の順に扱う。

再起動時の予約の再構築方法は、次のように分ける。

- Node host: Worker のスナップショットから予約を再構築する。
- Worker: 失われた予約を C-Plane の意図状態と照合する。
- Signaling: 永続化された割り当てと Worker の実状態を照合する。

詳細は [D-Plane のプロセスモデルと IPC 境界](dplane.md)に従う。

### 共通契約と状態遷移

予約・確保・解放の共通契約は、TypeScript と Rust で同じ状態名、遷移、通知の項目を使う。状態は[共通ドメイン型](domain.md#状態型)の `ResourceState` に従う。

| 現在の状態 | 遷移できる状態 |
|---|---|
| `reserved` | `in-use`、`released`、`isolated`、`result-unknown` |
| `in-use` | `release-pending`、`released`、`isolated`、`result-unknown` |
| `release-pending` | `in-use`、`released`、`isolated`、`result-unknown` |
| `result-unknown` | `in-use`、`release-pending`、`released`、`isolated` |
| `isolated` | `released` |
| `released` | なし |

`released` は終端であり、遅延・重複した通知で他の状態に戻さない。`isolated` は新規割り当てから外し、解放を確認するまで計上を続ける。許可されない遷移は状態を変更せず、拒否した理由を呼び出し元へ返す。

予約には、サーバー全体の上限を適用するため `server` スコープを1つ以上含める。含めない予約は `invalid-claim` として拒否する。

### 管理状態の正本と通知の相関

予約枠、利用者・ルーム・サーバー単位の上限、資源状態、照合ジョブとその対象・確認済み資源、および冪等記録の正本は、Signaling が管理する PostgreSQL に置く。実際の接続、バッファ、タイマーは Worker のメモリに置く。Signaling は PostgreSQL に接続し、TURN・SFU host と Worker は DB に接続せず、Signaling の計上受付へ結果を報告する。

通知は予約 ID、資源 ID、操作 ID、Worker の起動世代で対象の予約と資源に対応付ける。予約 ID、資源 ID、操作 ID、Worker ID、起動世代は 1〜128 文字の非空白文字列とし、予約 ID・資源 ID・操作 ID には ULID を生成して使う。通知の発生時刻は操作記録の監査時刻として保存し、状態遷移と TTL にはサーバーが受け付けた処理時刻を使う。同じ操作 ID の再送は保存済みの結果を返し、状態と計上を再度変更しない。異なる起動世代の通知は、解放済みまたは隔離済みの資源を変更しない。資源 ID または Worker ID が一致しない通知は拒否し、状態を変更しない。解放済みの予約は操作記録とともに保持し、遅延した通知の対象を判別する。

送信元ごとのレート制限表は、制限を適用するプロセスに置く。Signaling は PostgreSQL、TURN・SFU host と Worker はメモリの実装を使う。項目は最終利用からの TTL と制限期間の両方が切れるまで削除せず、サーバー全体の計数は項目の削除・再登録でリセットしない。

### 保持と削除

管理表は、状態の正本と冪等性に必要な期間だけ保持し、期限を過ぎた記録をバッチで削除する。削除と容量評価は Signaling が起動時と定期的に実行し、削除件数・上限使用率を監視する。

| 記録 | 保持期間の既定値 | 期限の基準 | 削除後の扱い |
|---|---|---|---|
| 操作記録 `resource_operation` | 24時間 | `recorded_at`（サーバーが処理した時刻） | 同じ操作 ID の再送は新しい操作として扱う。呼び出し側は保持期間を超えて再送しない |
| 解放済み予約 `resource_reservation` の tombstone | 7日 | `updated_at`（解放を処理した時刻） | 遅延通知は `not-found` として捨てる。予約 ID は再利用しないため、新しい予約には影響しない |
| 照合ジョブ `reconciliation_job` | 7日 | `updated_at`（最後に状態を更新した時刻） | 完了・失敗したジョブだけを削除する。対象と確認済み資源も同じバッチで削除する |

- 使用中、解放待ち、隔離、結果不明の予約は削除しない。
- 操作記録の保持期間は、クライアント・Worker の最大再送間隔以上にする。
- tombstone の保持期間は、遅延通知を分類したい期間とする。
- 長期監査は、資源計上イベントや監査ログに別途保存する。監査ログの保持期間は暫定90日とし、監査要件の確認後に確定する。hot table の保持期間を延ばして監査を代替しない。
- 削除は表ごとに `cleanupBatchSize` 件ずつ行い、1回のトランザクションで大量の行を削除しない。

件数上限は、操作記録が `maxOperationRecords`、解放済み tombstone が `maxReleasedReservations` を超えないようにする。上限は `cleanup` の実行時に評価する。

- 操作記録が上限以上なら、期限切れを削除した後も超過している場合に `operationCapacityExceeded` を立て、新規の予約・通知を `capacity-exhausted` で拒否する。cleanup で上限未満に戻るまで再開しない。
- 解放済み tombstone が上限を超える場合は、保持期間内でも古い tombstone から削除して新規予約を継続する。削除された tombstone への遅延通知は `not-found` になる。
- cleanup の間隔の分だけ上限を一時的に超え得る。厳密な上限が必要な場合は、DB のカウンタ行などで admission を直列化する。
- 予約の claim は `maxScopesPerClaim` 個以下のスコープだけを受け付ける。
- `cleanup` の結果に含まれる `operationCount`、`releasedReservationCount`、`evictedReleasedReservations`、`operationCapacityExceeded`、`deletedReconciliationJobs` を metrics とアラートに使う。

既定値は、操作記録100,000件、解放済み tombstone 100,000件、claim のスコープ16個、cleanup のバッチ1,000件とする。

### 監査ログ

監査ログは、障害調査、資源漏れ、管理操作の事後追跡に使う。現在の資源状態の正本や冪等性の記録には使わない。Signaling の PostgreSQL にだけ保存し、メモリ実装は監査先にしない。

資源監査は、共通の監査エンベロープへマッピングして公開する。認可判定、操作結果、リクエスト拒否とは別のイベント種別とし、資源の状態・計数の変更だけを記録する。保存先、トランザクション、保持期間は資源監査の責務として残す。

#### 記録対象

状態を変更した操作だけを記録する。拒否、重複、容量超過、レート制限、読み取り要求は記録しない。

| 操作 | 記録する結果 |
|---|---|
| 予約 `reserve` | 予約成功 |
| 確保・解放・結果不明・隔離の通知 | 状態を変更した `applied` |
| 期限切れ処理 `expire` | 解放または隔離した予約 |
| 照合ジョブ | 新規ジョブの開始、完了、対象予約の解放・隔離 |
| quota 設定・削除 | 上限の作成・更新、使用量 0 のスコープ削除 |

#### 保存項目

`resource_audit_event` には、イベント ID、`recorded_at`、`occurred_at`、操作種別、結果、操作 ID（ある場合）、予約 ID、資源 ID、Worker ID、起動世代、照合ジョブ ID、変更前後の状態、サイズ、quota の変更前後の上限を保存する。

`resource_audit_scope` には、イベント ID、スコープ種別、`scope_ref`、鍵バージョンを保存する。`scope_ref` は次の HMAC で作る。

```text
scope_ref = HMAC-SHA-256(secret[key_version], "v" + key_version + "\0" + kind + "\0" + key)
```

利用者・ルームの `scope_key`、自由文、要求本文、SDP、IP アドレス、認証情報、氏名、メールアドレスは保存しない。監査ログ単体から生のスコープキーは復元できない。ただし `resource_quota` と `resource_reservation` には生の `scope_key` が残るため、DB のアクセス制御と保存時暗号化は別途必要とする。

#### 書き込みと失敗時

監査イベントは状態変更と同じ PostgreSQL トランザクションで書き込む。監査の書き込みに失敗した場合、状態変更もロールバックし、操作を成功として返さない。

secret は DB に保存せず、secret manager または環境変数から渡す。有効な鍵バージョンが設定されていない場合、PostgreSQL 実装は起動時に失敗する。鍵を更新する場合は、照会に必要な旧バージョンを保持期間中残し、`resource_audit_scope.key_version` で区別する。

PostgreSQL 実装の `audit` 設定は必須とし、`keys`、`activeKeyVersion`、`retentionMs`、`cleanupBatchSize` を受け取る。`keys` には照会に使う旧バージョンも含める。鍵バージョンは1〜2,147,483,647の範囲とし、secret が空または空白だけの場合は起動しない。

#### 保持と照会

保持期間は `recorded_at` を基準に暫定90日とする。`audit.retentionMs` で設定し、`cleanupAuditEvents` が `audit.cleanupBatchSize` 件ずつイベントとスコープを削除する。`audit.cleanupBatchSize` の上限は10,000件とする。初期実装は `recorded_at` の索引とバッチ削除を使い、件数が増えた場合は月次パーティションの削除へ移行できる形にする。

照会は内部 API だけに用意する。`scope_kind` と生の `scope_key` から HMAC を計算し、`(scope_kind, scope_ref, recorded_at)` で絞り込む。イベントは `(recorded_at, event_id)` の keyset ページングで返し、生のスコープキーは返さない。

ページサイズの既定値は100件、上限は1,000件とする。`from` は開始時刻を含み、`to` は終了時刻を含まない。

### 結果が不明な場合の照合と回収

タイムアウトや完了通知の消失で確保・解放の結果が分からない場合、サーバーは予約枠を計上したまま、実際の資源と管理記録を照合して結果を確定する。結果が不明な間は、TTL に達しても状態を削除せず、枠を返却しない。管理記録自体が失われた場合は、影響する範囲の新規確保を停止し、記録の再構築または既存資源の解放を確認してから再開する。

照合・回収に使う処理量と待機時間には上限を設ける。その範囲で結果を確定できない場合は、対象を新規割り当てから外して運用者に通知する。隔離した資源を安全に回収・再初期化する手段を用意し、資源ごとに所有者と解放を確認する方法を定める。

Worker プロセスを終了して回収する場合は、Worker の終了と、所有していた資源の解放を確認してから対応する枠を返却する。外部サービスや別プロセスが保持する資源の解放は、Worker の終了とは別に確認する。遅延・重複した通知を処理する場合も、通知を対象の予約と資源に対応付け、枠の二重返却や再利用後の別資源の解放を防ぐ。

### 照合処理のバッチ

期限切れの予約の処理は、1回の呼び出しで `reconciliationBatchSize` 件（既定1,000件）まで行う。処理対象は、有効期限を過ぎ、まだ解放・隔離されていない予約とする。戻り値は解放した予約、隔離した予約、続きがあるかを示す `hasMore` とする。`hasMore` は同じ条件の対象が残っている場合だけ true にし、隔離した予約は次回の対象から外す。呼び出し側は `hasMore` が false になるまで同じ処理時刻で繰り返す。

一覧取得は公開契約に含めず、内部照合・テスト用に予約 ID の keyset ページングだけを用意する。ページは ID 昇順で最大 `reconciliationBatchSize` 件とし、続きがある場合は `nextCursor` を返す。

#### Worker 停止後の照合ジョブ

Signaling は `worker-stopped` 通知を受け取ると、Worker ID と起動世代の組ごとに永続照合ジョブを1つ作成する。同じ組の通知を再送した場合は、既存ジョブを返して新しい対象を作らない。

ジョブは次の表で管理する。

| 表 | 用途 |
|---|---|
| `worker_boot` | Worker ID と起動世代から照合ジョブへの対応。ジョブ作成と遅延した確保通知の対象追記を同じ行ロックで直列化する |
| `reconciliation_job` | 状態、処理済みの `target_seq`、対象件数・バイト数、作成・更新時刻 |
| `reconciliation_target` | 照合対象の予約、資源、確認済みかどうか、処理状態。`(job_id, reservation_id)` を一意にし、`target_seq` で処理順を固定する |
| `reconciliation_confirmed_resource` | 開始時に受け取った確認済み資源 ID とバイト数。バッチごとに再送しない |

対象は、ジョブ開始時点で Worker ID と起動世代に紐づく `released` 以外の予約とする。開始後に届いた確保通知は、`worker_boot` 行をロックした同じトランザクションで `reconciliation_target` に追記する。カーソルには予約 ID ではなく単調増加する `target_seq` を使うため、遅延した確保通知の予約 ID が処理済みの予約より小さくても取りこぼさない。

`continueReconciliation(jobId, { cursor, limit }, now)` は、`cursor` がジョブの `lastTargetSeq` と一致する場合だけ対象を処理する。一致しない場合は `ReconciliationCursorMismatchError` を返し、状態を変更しない。ジョブ行をロックして同一カーソルの並行バッチを直列化し、二重解放を防ぐ。1回の処理件数は `reconciliationBatchSize` 件までとし、戻り値は解放・隔離・変更なしの予約、`nextCursor`、`hasMore`、ジョブ状態とする。

照合対象の予約が見つからない、Worker ID・起動世代・資源 ID が一致しない、または既に解放・隔離済みの場合は、対象を `skipped` として進める。`skipped` は `reclaimed`・`isolated`・`unchanged` のどれにも含めない。

ジョブ状態は `pending`、`running`、`completed`、`failed` とする。対象が残っている間は `running`、全対象を処理すると `completed` になる。完了後に遅延した確保通知で対象が増えた場合は `pending` に戻す。`failed` のジョブには対象を追記しない。

開始時に受け取る `confirmedResourceIds` は、件数が `maxConfirmedResourceIds`、バイト数が `maxConfirmedResourceBytes` を超えてはならない。照合対象は件数が `maxReconciliationTargets`、バイト数が `maxReconciliationTargetBytes` を超えてはならない。開始時に超える場合は `ReconciliationCapacityError` を返す。開始後の追記で超える場合は、確保通知を `capacity-exhausted` として拒否し、管理状態を部分更新しない。

既定値は、確認済み資源10,000件・2MiB、照合対象100,000件・16MiB、ジョブ保持7日とする。cleanup は完了・失敗したジョブを `cleanupBatchSize` 件ずつ削除し、対象と確認済み資源も同じジョブ範囲で削除する。

#### 明示的な隔離

照合の範囲内で結果を確定できない予約は、Signaling の管理 API から `isolate` 通知で明示的に隔離できる。`isolate` 通知は予約 ID と操作 ID を持ち、同じ操作 ID の再送は保存済みの結果を返して状態を再度変更しない。

- `reserved`、`in-use`、`release-pending`、`result-unknown` は `isolated` に遷移する。
- すでに `isolated` の予約への別の操作 ID の通知は `duplicate` として無視する。
- `released` の予約への通知は `already-released` として無視する。
- 隔離しても件数と総メモリ量の計上を維持し、`expire` の対象から外す。
- 解放を確認した `released` 通知で枠を返却する。

### 利用者ごとの上限とレート制限

認証済みの利用者にも資源上限を適用する。
利用者ごとの上限と、サーバー全体の上限を設ける。
制限対象と超過時の応答は、各プロトコルの仕様で定める。

不要になった利用者・ルーム・サーバーのスコープは、`deleteQuotaScope` で上限行を削除できる。削除は `usedCount` と `usedBytes` がどちらも 0 の場合だけ行い、使用中のスコープには `in-use` と現在の使用量を返して行を残す。未登録のスコープには `not-found` を返す。削除後にそのスコープを含む予約要求が届いた場合は `limit-not-configured` として拒否する。解放済み tombstone は計上 0 なので削除を妨げない。

送信元ごとのレート制限管理表には、次の条件を適用する。

- 最大件数と総メモリ量を設定できる。
- 最終利用からの TTL を設定し、期限切れの項目を削除する。
- 制限期間が残っている項目を TTL によって早期削除しない。
- 上限到達時は、期限切れ項目を回収する。空きがなければ新規登録を抑制し、登録を必要とする要求は処理しない。
- 項目の削除・再登録によって、サーバー全体の要求数・応答帯域の制限をリセットしない。

ネットワーク側の送信元アドレスフィルタリングと、サーバー側の要求数・応答帯域制限を併用する。

DTLS の到達性確認前に保持する計数情報も、送信元ごとのレート制限管理表の条件に従う。
DTLS Cookie のステートレス処理と、接続固有の状態を確保する条件は、[共通 DTLS 仕様](../dtls/association.md)で定める。

### 受け入れ条件

受け入れ試験では、送信元の大量変更、並行要求、期限切れ、削除直後の再要求を含める。
保持状態とバッファが設定上限を超えず、項目の削除でサーバー全体の制限を回避できないことを確認する。

資源確保・解放の受け入れ試験には、次の条件を含める。

| 条件 | 確認する結果 |
|---|---|
| 空き枠 1 に対して複数の同時要求 | 確保できるのは最大 1 件 |
| 予約済み容量を含む空き枠 1 に対して複数の同時 Room 作成 | 確保できるのは最大 1 件 |
| 予約が残っている Worker の idle timeout | 予約を解放するまで Worker を停止しない |
| 確保直後の完了通知を消失 | 未確保として再利用せず、照合で結果を確定する |
| 解放通知を消失・重複・遅延 | 過少計上や二重返却を起こさない |
| 管理記録の消失・復旧 | 整合確認前に新規確保を再開しない |
| Node host・Worker・Signaling の再起動 | 予約の二重計上・計上漏れを起こさず、失われた予約を照合して再構築する |
| 隔離した資源の所有 Worker を終了し、再初期化 | 解放を確認できた資源の枠を回収し、別の所有者の資源は解放済みと扱わない |
| 枠の再利用後に古い通知が到着 | 新しい予約と資源の状態を変更しない |
| Worker 停止ジョブの開始後に、処理済みより小さい予約 ID の確保通知が届く | 遅延した確保を `target_seq` で処理し、取りこぼさない |
| 同じカーソルで照合バッチを並行実行 | 1つだけが進み、二重解放しない |
| 結果を確定できない予約を明示的に隔離し、期限を過ぎる | 隔離状態と計上を維持し、`expire` で再処理しない |
| 隔離した予約の解放を確認する | `released` に遷移し、計上を返却する |
| 使用中スコープを削除し、同じスコープで予約する | 削除は `in-use` になり、予約は既存の上限で処理される |
| 解放後にスコープを削除し、同じスコープで予約する | 削除は `deleted` になり、予約は `limit-not-configured` で拒否される |
| 監査ログの書き込みを失敗させる | 資源状態の変更もロールバックし、成功を返さない |
| 同じスコープで複数の操作を行う | 同じ `scope_ref` で監査イベントを照会でき、生のスコープキーは保存されない |

### 検証

- PostgreSQL の管理状態は Drizzle で操作し、Testcontainers の実 PostgreSQL に対して、並行確保、通知の消失・重複・遅延、TTL、Worker 再起動の結合テストを実行する。
- TypeScript と Rust のプロパティベーステストで、任意の操作列に対して計上と状態の不変条件を確認する。
- 同じライフサイクルシナリオを TypeScript と Rust のテストで実行し、状態と計上が一致することを確認する。
- 保持期間を過ぎた操作記録と解放済み tombstone だけが削除され、使用中の予約が削除されないことを確認する。削除はバッチ件数を超えないことも確認する。
- 操作記録の上限で新規操作が `capacity-exhausted` になり、cleanup 後に再開することを確認する。tombstone の上限では古いものから削除され、スコープ数上限を超える claim が拒否されることを確認する。
- 期限切れ処理がバッチ件数を超えず、隔離済み予約を再処理せず、並行予約・解放と競合しないことを実 PostgreSQL で確認する。
- 内部一覧のページ間で予約の重複・欠落がないことを確認する。
- Worker 停止後の照合ジョブが再起動後も `lastTargetSeq` から再開でき、開始後の遅延確保を取りこぼさないことを確認する。
- 照合ジョブの対象件数・バイト数と確認済み資源数・バイト数の上限を超える開始・追記を拒否することを確認する。
- 完了した照合ジョブだけが保持期間後に削除され、処理中のジョブが削除されないことを確認する。
- 明示的な `isolate` 通知が冪等で、隔離中の計上を維持し、解放確認後にだけ枠を返却することを確認する。
- 使用中のスコープ削除を拒否し、解放後の削除と削除後の `limit-not-configured` を確認する。
- 監査ログが拒否・重複を記録せず、HMAC の `scope_ref` で照会でき、監査書き込み失敗時に状態変更がロールバックされることを確認する。
- 予約・確保・解放・通知の並行モデルを `packages/resources/specs/ResourceLifecycle.tla` に置き、`moon run :check-models` で、計上が上限を超えないこと、計上と状態が一致すること、解放済みの状態が巻き戻らないことを検査する。

#### 要件と検証の対応

| 要件 | 主な検証 |
|---|---|
| claim の `server` スコープ、quota、保持期間、容量上限 | `packages/resources/test/memory-store-lifecycle.test.ts`、`packages/resources/test/memory-store-isolation-quota.test.ts`、`packages/resources/test/memory-store-retention.test.ts`、`packages/resources/test/integration/postgres-resource.test.ts`、`packages/resources/test/integration/postgres-retention.test.ts` |
| `expire` のバッチ処理、隔離済みの除外、TTL | メモリ・PostgreSQL の期限切れテスト、`ResourceLifecycle.tla` |
| 照合ジョブの対象固定、再起動後の再開、同一カーソルの直列化 | `packages/resources/test/memory-store-reconciliation-job.test.ts`、`packages/resources/test/integration/postgres-reconciliation-job.test.ts`、`crates/resources/tests/resource_reconciliation.rs` |
| 明示的な `isolate` と解放確認 | TS/Rust のストアテストと `packages/resources/specs/lifecycle-scenarios.json` |
| 使用中スコープの削除拒否と解放後の削除 | メモリ・PostgreSQL・Rust の quota 削除テスト |
| 監査ログの HMAC、鍵更新、同一トランザクション、保持削除、keyset ページング | `packages/resources/test/audit-options.test.ts`、`packages/resources/test/audit-scope-ref.test.ts`、`packages/resources/test/integration/postgres-audit-write.test.ts`、`packages/resources/test/integration/postgres-audit-query.test.ts`、独立 verifier |
| TypeScript と Rust の状態・計上の一致 | 共通シナリオを実行する TS/Rust の conformance テスト |
