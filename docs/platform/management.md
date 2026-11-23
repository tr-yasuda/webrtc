# Management サーバー・管理 API

## 前提

- Management サーバーは TypeScript で実装し、Cloud Run で配備する。
- Signaling サーバーは TypeScript で実装し、Cloud Run で配備する。
- TURN・SFU の公開サーバーは TypeScript host として実装する。Rust は host から呼び出すプロトコル処理・SFU 中核の Worker とし、Rust をサーバー公開プロセスとしては使用しない。
- Management サーバーは Fastify を使用する。Management API は HTTPS の通常 API 要求だけを扱い、WebSocket を提供しない。
- Management UI のログインには IDaaS の OpenID Connect を利用し、パスワード認証を自前実装しない。
- 顧客アプリケーションの利用者認証は顧客側が行う。参加 JWT は顧客アプリサーバーが署名し、Signaling が検証する。
- 初期構成では Cloud SQL for PostgreSQL の 1 インスタンス・1 database に `management` schema と `signaling` schema を置く。データアクセスには Prisma を使用する。
- `management` schema と `signaling` schema は別々の DB role でアクセスする。cross-schema の外部キー・JOIN・直接参照を設けない。TURN と SFU は DB に接続しない。

## 用語

| 用語 | 意味 |
|---|---|
| Project | 顧客アプリケーション・鍵・利用量・監査を束ねるテナント境界 |
| Account | Management UI にログインする管理主体。複数 Project に所属できる |
| ProjectUser | Project 内の権限ロールを持つ Account と Project の関係 |
| ExternalUser | 顧客アプリケーションが参加 JWT の `sub` で指定する通話利用者の識別子。PaaS の Account とは別物 |
| Application | Project に属し、顧客アプリサーバーが参加 JWT に署名するための鍵を保有する顧客アプリケーション |
| ApplicationSigningKey | Application が参加 JWT に HS256 署名を行うための鍵。複数保有・ローテーション・失効を管理する |
| ManagementApiCredential | Management API 専用の顧客サーバー用認証情報 |
| Management API | Management UI と顧客サーバーが利用する公開管理 API |
| Signaling 状態 | Room・Participant（Member）・Publication・Subscription・Session・SFU 割り当て・失効・資源計上の正本 |

Project・Account・ProjectUser・Application・ApplicationSigningKey・ManagementApiCredential・Room・Participant・ParticipantDevice に対応する共通型と ID 形式は、[共通ドメイン型と ID 契約](domain.md)に従う。`Member` は `Participant` の別名として使う。

## ProjectUser の権限ロール

ProjectUser は初期提供で次の 4 ロールを持つ。

| ロール | 許可する操作 |
|---|---|
| Owner | Project の全操作。Project 削除、Owner を含む ProjectUser 権限管理、Application・ApplicationSigningKey・Management API credential の管理、Room / Session 操作、利用量と監査の閲覧 |
| Admin | Project 設定と ProjectUser 管理。ただし Project 削除と Owner 権限管理は不可。Application・ApplicationSigningKey・Management API credential の管理、Room / Session 操作、利用量と監査の閲覧 |
| Operator | Project・Room・Session・Participant・利用量の閲覧。Room の設定変更と削除、Participant / Session 単位の強制切断。ProjectUser・Application・鍵・監査の管理・閲覧は不可 |
| Auditor | Project・Room・Session・Participant・利用量・監査の読み取りのみ |

Project は最低 1 人の Owner を持つ。Admin は自分またはほかの Admin・Operator・Auditor に権限を付与できるが、Owner を付与・変更できない。Owner の除外・ロール変更は、操作完了後も Project が有効な Owner を持つ場合だけ許可する。Owner がいなくなる操作は拒否し、一部だけ適用した状態を作らない。権限を失った ProjectUser には、その後の API・通知・監査取得を拒否する。

## データの所有権

| Schema | 正本 | 操作できるサーバー |
|---|---|---|
| `management` | Project, Account, ProjectUser, Application, ApplicationSigningKey, Management API credential, 管理コマンド状態, 監査ログ | Management |
| `signaling` | Room, Member, Publication, Subscription, Session, 失効, SFU 割り当て, 入退出・kick・資源計上イベント | Signaling |

Management は Signaling 状態を直接更新しない。Signaling も `management` schema へ接続しない。TURN と SFU は DB 接続を持たず、Signaling から受け取った検証済みの指示・権限・期限に基づいて動作する。

コスト抑制のため、初期構成では 1 database を論理分割して使う。サービス間契約は、Cloud SQL インスタンスまたは database を分離しても成立する形にする。スキーマ分離後も、Management が Signaling 状態へ直接接続・更新する構成にはしない。

## Management API

Management API は Management UI と顧客サーバーの両方が利用する公開契約とする。Management UI だけが特別な内部経路を使い、顧客サーバーと異なる契約を扱うことはない。

初期提供では、管理 UI の状態更新を HTTPS の API 再取得で行う。WebSocket・SSE による Management API のプッシュ配信は提供しない。表示の更新間隔は、[管理 UI の状態表示](../admin-ui/state.md)の後続設計で定める。

| 操作 | 内容 |
|---|---|
| Project 管理 | Project の作成・設定変更・削除。削除は Owner のみ |
| ProjectUser 管理 | Account の Project 追加・除外、ロール変更 |
| Application 管理 | Application ID の払い出し、設定変更、利用停止 |
| ApplicationSigningKey 管理 | 鍵作成・ローテーション・失効 |
| Management API credential 管理 | 顧客サーバー用 API 認証情報の払い出し・失効 |
| Room 管理 | 既存 Room の一覧・詳細・設定変更・削除。初期提供では Room 作成 API を提供しない |
| Session・Participant 管理 | 一覧・詳細・強制切断、入退出履歴の取得 |
| 利用量取得 | Project・Application・Room・ExternalUser・Session を次元にした集計の取得 |
| 監査取得 | 管理操作・鍵操作・強制切断・結果の監査記録の取得 |

Management API credential は Management API 専用とし、参加 JWT の署名鍵として流用しない。参加 JWT の署名鍵は顧客アプリサーバーが JWT に署名するためだけに使う。

Management API credential の秘密値も Cloud KMS で暗号化して保存し、作成権限のある Owner / Admin へ作成直後の応答で一度だけ返却する。ApplicationSigningKey とは別の鍵として払い出し、ローテーション・失効を管理する。通常の取得・再表示では秘密値を返さない。

Management API credential は Project に束ね、明示的に付与した操作 scope だけを許可する。初期提供で指定できる scope は、Room 管理・Session / Participant 管理・利用量取得・監査取得である。Project 削除、ProjectUser 管理、Application・ApplicationSigningKey・Management API credential の管理は顧客サーバー用 credential に許可しない。

Management は要求ごとに、credential の有効性・対象 Project の利用可否・要求対象が scope 内であることを確認する。credential は発行者の ProjectUser ロールを自動的に引き継がない。credential を作成した ProjectUser が権限を失っても、credential 自体は自動失効しない。Project の削除・利用停止と credential の失効・期限切れでは、以後の要求を拒否する。

強制切断は Participant / Session 単位のみとし、Project 全体を一括切断する操作は提供しない。強制切断を行ったときは、対象・理由・実行者・結果を監査し、Signaling の入退出履歴に kick イベントを記録する。

### Room 作成契約

Room は、未作成 Room への初回参加で `room.create` と `room.join` の両方を持つ参加 JWT があるときに作成する。参加 JWT の `room` は Project 内で一意な `Room.name` を指す。`room.create` は `room.join` を自動的に許可せず、`room.create` 単独では Room を作成も参加も確定しない。Management API による Room 作成は初期提供では行わない。既存 Room への参加には、対象 Room が存在し、失効・終了状態でないことを Signaling が確認する。

同じ `ProjectId` と `Room.name` へ複数の初回参加が並行した場合は、Room 作成・SFU 割り当て・参加登録を一意に確定する。最後の参加端末が退出したときは通信資源だけ解放し、Room と履歴は明示削除まで保持する。

### ApplicationSigningKey

Application は複数の有効な ApplicationSigningKey を持てる。参加 JWT の header には `kid` を含め、Signaling は `kid` で対応する有効鍵を選び、HS256 署名を検証する。

ApplicationSigningKey の作成時には、Zoom と同じ有効期限選択肢 `Never / 30 days / 90 days / 180 days / 1 year` を提供する。初期値は `90 days` を推奨する。`Never` は自動失効を行わないだけで、失効できないことを意味しない。どの選択肢でも手動ローテーションと失効は必ず使用できる。有効期限は新しい参加 JWT の拒否にだけ影響し、既存接続の停止には使用しない。

鍵の秘密値は暗号学的に安全な乱数で生成し、HS256 に必要な長さとして最低 256 bit を確保する。作成権限のある Owner / Admin へ作成直後の応答で一度だけ返却し、通常の取得・再表示では返さない。秘密値の 32 byte 生成と padding なし base64url 表現は、[資格情報仕様](../auth/credentials.md#参加-jwt-の発行更新失効) に従う。Management は Cloud KMS で暗号化した `secret_ciphertext` を保存し、平文を DB に保存しない。Signaling は Management の内部鍵配布 API から有効鍵を取得してメモリキャッシュし、JWT 検証ごとに KMS や DB に問い合わせない。鍵を作成・失効したときは、キャッシュ無効化コマンドを Signaling へ通知する。

Signaling の鍵キャッシュ TTL は 1〜5 分程度を推奨する。この TTL は失効反映の上限の目安である。キャッシュ無効化コマンドの完了条件や、再取得失敗時の新規参加拒否条件を置き換えない。

鍵失効は新しい参加 JWT の拒否のための操作であり、既存接続の切断は別の強制切断操作とする。ローテーション中は新旧鍵を併用し、旧鍵は明示的に失効した時点で新しい JWT 検証に使わない。

## Management と Signaling の通信

Management から Signaling へ状態を変更させる操作には、Pub/Sub のコマンドバスを使用する。Management が Signaling の Cloud Run URL へ直接 HTTP で操作を送らず、Signaling DB を直接更新・ポーリングもしない。

コマンドには次を含める。

| 項目 | 用途 |
|---|---|
| `commandId` | 重複排除と結果照合 |
| `type` | 強制切断・鍵キャッシュ無効化・Room 削除・照会などの操作種別 |
| `projectId` / `applicationId` | 対象のテナントとアプリケーション |
| `target` | Session・Participant・Room・ApplicationSigningKey など操作対象 |
| `actor` | 管理操作の実行者 |
| `issuedAt` / `expiresAt` | 発行時刻とコマンドの有効期限 |

コマンドは配信方法で 2 種類に分ける。いずれも Signaling の全インスタンスがコマンドを購読し、`commandId` で重複排除する。

- 対象限定コマンド: 対象 Session・Participant・Room を持つインスタンスだけが実行する。
- 全インスタンスコマンド: 鍵キャッシュのように、全 Signaling インスタンスへ反映する必要がある。

対象限定コマンドは、対象 Session・Participant・Room を保持するインスタンスだけ実行する。実行結果は Signaling schema に正本として記録し、結果イベントを Pub/Sub で Management へ返す。Management は結果イベントで管理コマンド状態を更新する。結果イベントが期限内に届かない場合は結果不明とし、失敗や完了として扱わない。照会用コマンドで現在状態を再確認し、必要な場合のみ新しい `commandId` で操作し直す。

全インスタンスコマンドでは、対象 ApplicationSigningKey をキャッシュしている可能性がある全インスタンスが、対象 `projectId`・`applicationId`・`kid` のキャッシュを無効化する。各インスタンスは `instanceId` 付きの結果イベントを返し、Signaling schema に `commandId` ごとのインスタンス別結果を正本として記録する。Management は、コマンド発行時に購読していた全インスタンスが成功または該当キャッシュなしを期限内に報告した場合だけ反映完了とする。報告が欠けた場合は結果不明とし、期限前は同じ `commandId` で再送し、期限後は新しい `commandId` で再発行できる。反映完了または安全な再取得条件が確認できるまで、失効済み鍵を完了済みとして扱わない。

読み取り専用の Room・Session・Participant・利用量照会は、サービス間認証を行った Signaling の内部照会 API を利用できる。Management はその結果をキャッシュしても、取得時刻・対象範囲・有効期限を明示し、Signaling の正本を上書きしない。

TURN・SFU は DB に接続しないため、1 分ごとに集約した資源計上イベントをサービス間認証を行った Signaling の計上受付へ報告する。Signaling は報告元・対象・期間を確認した上で、`signaling` schema に集計を記録する。パケットごとに DB 書き込みを行わない。Signaling は TURN 分数・中継バイト、SFU 分数・パケット・バイト、DataChannel バイト数、Session 接続分数、publication / subscription 分数を集計する。初期提供では利用制限と課金を行わない。

## 障害時の挙動

| 障害 | 挙動 |
|---|---|
| Management 停止 | 既存通話は継続する。Management UI・Management API・新しい管理コマンドは失敗する。Signaling は有効鍵をキャッシュしている場合だけ、その鍵による新規参加を続けられる。未キャッシュ鍵、TTL 到達後の再取得、不明 `kid` の確認が必要な新規参加は失敗する |
| Signaling 1 インスタンス停止 | Browser SDK が再接続し、Signaling DB の状態に基づいて別インスタンスで参加端末を引き継ぐ |
| Pub/Sub 停止 | 既存通話は継続する。強制切断・鍵キャッシュ無効化・Room 削除などの管理コマンドは遅延または結果不明になる |
| Cloud SQL 停止 | 新規参加・Room 作成・権限再確認・強制切断・利用量記録は失敗する。既存 TURN・SFU は検証済み権限と再確認期限内のみ継続し、期限を超えたら対象通信を停止する |
| IDaaS 停止 | Management UI の新規ログイン・セッション更新は失敗する。既存セッションは期限と IDaaS の条件に従い、参加 JWT の検証には影響しない |
| Cloud KMS 停止 | 新しい ApplicationSigningKey の作成と Signaling への鍵配布は失敗する。Signaling がキャッシュ済みの有効鍵で検証できる範囲は継続できる |

Cloud SQL を PITR で復旧した場合は、失効済み ApplicationSigningKey・切断済み Session・退出済み Participant が復活しないことを検証する。復旧処理で失効・切断・入退出の記録が失われる場合は、該当対象を安全側として再失効・再切断できる手順を用意する。

## 検証方法

| 検証方法 | 重点対象 |
|---|---|
| TLA+ によるモデル検査 | ProjectUser 権限の遷移、Management API credential の scope 判定、Room 初回作成と並行参加、強制切断コマンドと再接続の競合、失効済み鍵・切断済み Session の復活防止 |
| Lean 4 による証明の評価 | DB schema 所有権の不変条件、ProjectUser ロールの権限包含関係、Management API credential の scope 包含関係、`commandId` の重複排除規則を数学モデルとして表現できるか |
| Property-based Testing | JWT claim・`grants`・期限の生成パターン、Management API のロール・credential scope・対象の組み合わせ、対象限定コマンドと全インスタンスコマンドの再送・結果欠落の操作列 |
| 統合試験・障害注入 | Management・Signaling・Pub/Sub・Cloud SQL・IDaaS・KMS の停止・復旧、TURN・SFU の資源計上報告、PITR 後の安全側処理 |

数学モデルでは、対象限定コマンドと全インスタンスコマンドの配送重複・欠落・順序逆転、Room 作成の並行初回参加、失効と再接続の競合を状態として表現する。実際の Cloud Run・Pub/Sub・Cloud SQL 構成での統合試験と区別して結果を記録する。

## 受け入れ条件

| 試験対象 | 確認する結果 |
|---|---|
| IDaaS ログイン | Management UI が OpenID Connect で Account を認証し、自前パスワード認証を持たない |
| ProjectUser ロール | Owner・Admin・Operator・Auditor の操作範囲を API・通知・監査取得に適用し、権限喪失後に迂回できない。Owner がいなくなる変更を拒否する |
| DB 所有権 | Management と Signaling が自分の schema だけにアクセスし、TURN・SFU が DB に接続しない |
| Room 作成 | `room.create`・`room.join` 権限付き JWT の初回参加だけが未作成 Room を作成し、並行初回参加で Room・SFU 割り当てを重複させない |
| 管理 API | Management UI と顧客サーバーが同じ Management API 契約を使い、API credential と JWT 署名鍵を流用しない。要求ごとに credential・Project・scope を再評価し、scope 外と Project 停止後の要求を拒否する |
| 強制切断 | Participant / Session 単位だけ切断し、Project 全体一括切断を提供しない。kick の監査と入退出履歴を記録する |
| コマンドバス | `commandId` で重複を排除する。対象限定コマンドは対象を持つ Signaling だけ実行し、全インスタンスコマンドは全 Signaling インスタンスが反映結果を報告する。結果不明を完了・失敗と扱わない |
| ApplicationSigningKey | HS256・`kid`・失効・ローテーションを検証し、秘密値の再表示と平文保存を行わない |
| 利用量 | 1 分単位の Session・publication・subscription・TURN・SFU・DataChannel 計上を集計し、欠測をゼロとして扱わない |
| 障害時 | Management・Signaling・Pub/Sub・Cloud SQL・IDaaS・KMS の各停止で、上の表に定めた挙動と停止条件を守る |
| 復旧 | PITR 後に失効鍵・切断済み Session・退出済み Participant が復活せず、必要な再失効・再切断ができる |
