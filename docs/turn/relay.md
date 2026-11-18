# TURN の中継状態とデータ転送

取得済み Allocation 上の Permission・Channel Binding と、双方向転送・帯域制限を定める。認証・所有者・資格情報の期限切れと失効・Allocation の終了条件は [Allocation 仕様](allocation.md)に従う。通信先には [中継先の許可](destinations.md)も適用する。

共通の前提・用語・利用場面は [共通仕様](../platform/overview.md) に従う。
DTLS の条件は [共通 DTLS 仕様](../dtls/association.md)に従う。
管理状態の件数・総量・寿命は、[共通の資源管理](../platform/resources.md#資源管理)に従う。

## 中継

TURN サーバーは、端末から SFU へ直接到達できない場合に、端末と SFU の通信を中継する。
メディアや DataChannel の本文を復号せずに転送する。

[RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html)に従い、クライアントと TURN サーバー間では、UDP、TCP、TLS-over-TCP、DTLS-over-UDP に対応する。
TURN サーバーと通信相手の間は UDP とする。

| クライアントと TURN 間 | TURN と通信相手の間 |
|---|---|
| UDP | UDP |
| TCP | UDP |
| TLS-over-TCP | UDP |
| DTLS-over-UDP | UDP |

クライアント側で TCP / TLS-over-TCP を使う場合も、通信相手への中継は UDP で行う。
通信相手との間で TCP 接続を確立する TCP Allocation（RFC 6062）は、今回の対象外とする。
[RFC 8656 §3.1](https://www.rfc-editor.org/rfc/rfc8656.html#section-3.1)に従う。

| 処理 | 内容 |
|---|---|
| CreatePermission | 通信相手の IP アドレスに対する Permission を作成・更新する |
| ChannelBind | TURN チャネル番号と通信相手の IP アドレス・ポートを対応付ける |
| Send Indication | クライアントから TURN サーバーへ渡したデータを、通信相手へ送信する |
| Data Indication | 通信相手から TURN サーバーが受信したデータを、クライアントへ渡す |
| ChannelData | Channel Binding を使用して、クライアントと通信相手の間で双方向にデータを転送する |

Permission は通信相手の IP アドレス単位、Channel Binding は通信相手の IP アドレス・ポートとの対応として管理する。
両者を同じ状態として扱わない。

## 利用認証

クライアントの認証には、STUN の長期資格情報方式を使用する。
Allocate、Refresh、CreatePermission、ChannelBind の各 Request に、この方式の認証を適用する。
[RFC 8656 §5](https://www.rfc-editor.org/rfc/rfc8656.html#section-5)に従う。

Send Indication / Data Indication と ChannelData に、Request と同じ長期資格情報方式の認証を要求しない。
データ転送では、対応する Allocation、Permission、必要な Channel Binding、および中継先の利用許可を確認する。
これらのデータ転送だけで、新しい Permission の作成や更新を行わない。
[RFC 8656 §3.3–3.4、§5](https://www.rfc-editor.org/rfc/rfc8656.html#section-3.3)に従う。

## 認証後の資源上限

認証済みの利用者にも、中継資源と処理量の上限を適用する。
上限は設定可能とし、少なくとも次を対象にする。

| 対象 | 制限する内容 |
|---|---|
| Permission | 同時に保持する数 |
| Channel Binding | 同時に保持する数 |
| 中継ポート | 使用中・予約中のポート数 |
| 中継帯域 | クライアントから通信相手、および通信相手からクライアントへの転送量 |
| 制御処理 | Allocate、Refresh、CreatePermission、ChannelBind などの処理量 |
| 内部資源 | 接続、処理待ち要求、タイマー、管理表、受信・送信バッファの件数と総メモリ量 |

Allocation 内の上限、参加端末・利用者ごとの合計上限、TURN サーバー全体の上限を、対象資源に応じて適用する。
Allocation 数だけを制限して、各 Allocation 内の状態を無制限に保持しない。

複数の Worker で処理する場合も、同じ上限の適用範囲に属する資源を合計する。
Worker ごとの上限だけを根拠に、利用者・サーバー全体の上限を保証したとは扱わない。
Worker をまたいで予約・確保・解放が並行する場合も、全体の上限を超えないことを保証する。
具体的な実装方式は限定せず、[共通の資源管理](../platform/resources.md#資源管理)の予約・計上・照合・回収の条件を適用する。

資源の予約・確保・解放・照合は、共通の資源管理に従う。
並列要求でも上限を超えないよう、予約済み・解放待ち・結果不明の枠も計上する。

Permission や Channel Binding の更新では、新規作成と既存状態の更新を区別する。
同じ状態の更新や Request の再送によって、不要な資源確保や件数の二重計上を行わない。
更新と再送にも、制御処理の上限を適用する。

一つの Request が複数の資源を必要とする場合は、必要な枠を確認してから処理する。
部分的な確保後に失敗した場合も、確認できていない資源を解放済みとして扱わない。

認証済み Request が資源上限によって実行できない場合は、メソッドと原因に応じたエラーを返す。

| 条件 | 応答 |
|---|---|
| CreatePermission / ChannelBind を容量不足で実行できない場合 | 508（Insufficient Capacity） |

エラー処理は [RFC 8656 §7.2、§10.2、§12.2](https://www.rfc-editor.org/rfc/rfc8656.html#section-7.2)に従う。
応答自体にも、処理量と送信量の制限を適用する。

中継帯域には、方向ごとの上限を適用する。
計測点、計上するバイトの範囲、計測期間、許容する一時的な超過量を明示する。
Send Indication / Data Indication と ChannelData のどちらを使っても、帯域制限を回避できないようにする。

帯域上限を超える転送データは破棄する。
制限を守るためにデータを無制限にキューへ蓄積しない。
キューを使用する場合は、件数・総バイト数・保持時間を制限する。
[RFC 8656 §5](https://www.rfc-editor.org/rfc/rfc8656.html#section-5)に従う。

中継データの帯域制限と、制御応答・TLS / DTLS 処理を含むサーバー全体の資源制限を分けて管理する。
中継帯域の上限だけで、ネットワーク使用量や暗号処理量の総量を保証したとは扱わない。

## 有効期限と解放条件

TURN 資格情報の有効期限、Allocation の有効期限、Permission の有効期限、Channel Binding の有効期限を別に管理する。
一つの更新を、ほかのすべての期限の更新として扱わない。

TURN の状態の寿命と更新は、次に従う。

| 状態 | 寿命と更新 |
|---|---|
| Permission | 寿命は300秒とする。CreatePermission または ChannelBind によって作成・更新する |
| Channel Binding | 寿命は600秒とする。同じ対応に対する ChannelBind によって更新する |

Allocation・Permission・Channel Binding の寿命と更新は [RFC 8656 §6–9、§12](https://www.rfc-editor.org/rfc/rfc8656.html#section-6)に従う。
Allocation の最大寿命を含む設定は、RFC の条件を満たす範囲で定める。

データの送受信だけで、Allocation、Permission、Channel Binding の期限を更新しない。
Refresh で Permission や Channel Binding の期限を更新せず、CreatePermission で Channel Binding の期限を更新しない。

期限切れ後の転送可否は、転送方向と Send Indication / Data Indication・ChannelData ごとの RFC の条件に従って判定する。
Permission と Channel Binding の期限切れは、それぞれに判定する。

## 自作範囲・既存実装の利用

TURN のプロトコル処理と中継処理は Rust で実装する。
Rust の実行方式は、Wasm、Native Addon、独立 Worker を選択肢として残し、この節では固定しない。
Rust で実装しても、独立プロセスでの実行は必須としない。
C-Plane / D-Plane の論理的な責務の分離と、Rust の実行方式は区別し、実行プロセスの分離を必須としない。

| 自作する部分 | 内容 |
|---|---|
| データの中継 | クライアント側トランスポートと通信相手側の UDP 間の転送、接続上のメッセージ境界の処理 |

これらの処理は自作し、完成済みの TURN サーバーや TURN プロトコル実装には委ねない。

STUN 形式のメッセージには、[STUN サーバー](../stun/messages.md#自作範囲既存実装の利用)で自作する共通の読み書き・検証処理を利用する。
ChannelData は STUN メッセージと区別して処理する。
認証順序、再送、状態変更などの TURN 固有の条件は、TURN 側で適用する。

ソケット入出力、非同期実行、タイマー、バッファ管理には、Rust の標準ライブラリや汎用ライブラリを利用できる。

TLS / DTLS ライブラリの内部状態・バッファ・タイマーも、全体の資源管理に含める。
ライブラリ自身の制限または組み込み側の制御によって、本仕様の上限を保証する。
DTLS の利用条件は、[共通 DTLS 仕様](../dtls/association.md#既存実装の利用条件)に従う。

採用する既存実装のバージョン、設定、依存する機能を記録する。
機能への対応だけで採用を判断せず、実際の組み込み構成で相互接続性、資源上限、障害時の動作を確認する。
セキュリティ修正を追跡し、更新できる構成とする。

実装と検証には、[実装・検証の共通方針](../platform/verification.md#実装検証の共通方針)を適用する。
TURN 固有の検証対象と確認する結果は、「受け入れ条件」で定める。

## セキュリティ

認証、Allocation の所有者確認、期限切れ・失効、認証後の資源上限は、[Allocation 仕様](allocation.md)に従う。
認証に成功したことだけで、任意の中継先や無制限の資源利用を許可しない。

STUN 形式のメッセージには、共通の解析・検証と RFC の処理順序を適用する。
ChannelData は別の形式として、TURN チャネル番号、長さ、パディング、対応する Allocation と Channel Binding を検証する。
不正な入力で範囲外アクセスや過大な資源確保を発生させない。

Permission は IP アドレス単位で管理する。
CreatePermission では対象 IP アドレスの許可を確認し、属性のポート値を Permission の制限として扱わない。
ポートを含む制限は、ChannelBind と実際のデータ転送で確認する。

Send Indication と ChannelData のどちらでも、中継先の制限を回避できないようにする。
通信相手から受信するデータにも、転送方向に応じた Permission・Channel Binding の条件と、用途ごとに許可された通信先との対応を適用する。
Permission が存在する IP アドレスでも、プラットフォームの許可対象外のポートや用途へ転送しない。

TLS / DTLS 接続では、サーバーが接続先に対応する適切な証明書を提示する。
証明書の信頼・有効性・接続先名は、接続するクライアント側が検証する。
この検証は、WebRTC の SDP フィンガープリント照合とは別に扱う。

TLS / DTLS を使用する場合、制御応答、Data Indication、ChannelData を、対応する保護された接続または DTLS Association を通じて返す。
平文の UDP 応答や別のクライアントの接続へ切り替えない。

DTLS の到達性確認、ハンドシェイク、断片再構成、再送、送信予算は、[共通 DTLS 仕様](../dtls/association.md)に従う。
到達性確認前、認証前、認証後のそれぞれに資源上限を適用する。

TURN 接続の TLS / DTLS だけでは、通信相手までの本文の保護を保証しない。
中継する WebRTC 通信と参加端末間の本文は、WebRTC Transport および E2EE の仕様に従って保護する。

## 受け入れ条件

IPv4・IPv6 と、クライアント接続の UDP・TCP・TLS-over-TCP・DTLS-over-UDP を組み合わせ、ブラウザー用・SFU 用それぞれの許可された通信先との UDP 中継を確認する。
次の条件を、実際の組み込み構成で検証する。

| 試験対象 | 確認する結果 |
|---|---|
| 基本的な中継 | Allocate、Refresh、CreatePermission、ChannelBind を処理できる。Send Indication はクライアントから通信相手へ、Data Indication は逆方向へ転送し、ChannelData は Channel Binding を使って双方向に転送する |
| トランスポートの分離 | クライアント接続が TCP / TLS でも、通信相手への中継は UDP とする。未対応の TCP Allocation を受け入れない |
| 状態ごとの寿命 | Allocation、Permission、Channel Binding の期限を独立に管理する。Refresh、CreatePermission、ChannelBind が更新する対象を区別し、データ転送だけでは期限を延長しない |
| Permission と転送条件 | Permission を IP 単位で扱い、属性のポート値を Permission の制限にしない。Permission と Channel Binding の期限が異なる場合も、各転送方向・方式の RFC の条件に従って判定する |
| Request の再送 | UDP / DTLS-over-UDP の同一トランザクションの再送で、RFC に従う状態・応答の整合性を維持する。Allocation の重複作成や、Permission・Channel Binding の二重計上を起こさず、処理量・応答帯域制限も回避できない |
| Worker 間の並行処理 | 複数 Worker で予約・確保・解放が並行しても、利用者・参加端末・サーバー全体の上限を超えない。空き枠1に対する同時要求を含めて確認する |
| 容量不足の応答 | Allocation 上限は 486、容量不足による Allocate / CreatePermission / ChannelBind の失敗は条件に従って 508 を返す。応答にも処理量・送信量の制限を適用する |
| 方向別の帯域制限 | 両方向で設定した上限を守る。Send Indication / Data Indication と ChannelData で制限を回避できず、超過データを破棄する。キューを無制限に増やさない |
| 不正入力と内部資源 | 不正な属性長、ChannelData の長さ・番号・パディング、分割受信、大量の接続や低速送信でも、範囲外アクセスや資源上限超過を起こさない |
| 結果不明と回収 | 確保・解放の通知消失、重複、遅延、管理記録の喪失でも、過少計上や二重返却を起こさない。隔離資源は所有関係と解放を確認して回収し、古い通知で再利用後の資源を変更しない |
| TLS / DTLS | 制御応答・Data Indication・ChannelData を、対応する保護された接続または DTLS Association で返す。平文への切り替えや別クライアントへの混入を起こさず、共通 DTLS の受け入れ条件を満たす |
| 機密情報と通知 | Allocation にパスワードを平文保存しない。資格情報・認証鍵・本文をログへ出力しない。更新・経路準備の必要性、失敗・転送停止の理由を Browser SDK から通知する |

| 検証方法 | 重点対象 |
|---|---|
| Fuzzing | STUN / ChannelData の解析、長さ・境界・パディング、不正な認証属性、接続上の分割・連続入力 |

対象ブラウザーの対応状況に応じて相互接続を確認する。
ブラウザーが利用しないトランスポートや条件は、検証用クライアントで確認し、その範囲を区別する。

試験結果には、実行方式、サーバー・ブラウザー・ライブラリのバージョン、通信条件、資格情報方式、期限、資源上限、帯域の計数条件、検証範囲と観測結果を記録する。
具体的な制限値は本節では固定しない。

TURN 全体の検証方法と形式検証の評価条件は、[Allocation 仕様の共通検証条件](allocation.md#共通の検証方法と結果の記録)に従う。
