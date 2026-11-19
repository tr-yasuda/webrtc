# WebRTC プラットフォーム仕様

参加から退出までの流れは[利用場面](platform/overview.md#利用場面)、制御と通信を担当するコンポーネントは[全体構成](platform/overview.md#全体構成)から確認できる。個々の処理の振る舞い、安全性、失敗時の扱い、受け入れ条件は、下の一覧から担当する仕様を参照する。

共通の [用語](platform/overview.md#用語)、[資源管理](platform/resources.md)、[セキュリティ条件](platform/security.md)、[実装・検証方針と性能評価](platform/verification.md)を各仕様に適用する。

## 仕様一覧

| 担当範囲 | 仕様 |
|---|---|
| 共通仕様 | [目的・提供範囲・全体構成](platform/overview.md)<br>[ルームと参加端末のライフサイクル](platform/rooms.md)<br>[共通の資源管理](platform/resources.md)<br>[共通のセキュリティ条件](platform/security.md)<br>[実装・検証方針と性能評価](platform/verification.md) |
| 依存関係・CI・配備 | [サプライチェーン対策](platform/supply-chain.md) |
| 認証・認可・資格情報 | [外部認証との連携・認可・権限の失効](auth/authorization.md)<br>[資格情報の発行・検証・更新・失効](auth/credentials.md)<br>[内部サービスの認証と権限の伝達](auth/service-auth.md) |
| STUN | [共用する STUN メッセージ処理](stun/messages.md)<br>[STUN Binding サービス](stun/binding.md) |
| TURN | [TURN Allocation の取得・維持・解放](turn/allocation.md)<br>[TURN の中継状態とデータ転送](turn/relay.md)<br>[TURN の中継先の許可](turn/destinations.md) |
| DTLS | [DTLS Association の確立・維持](dtls/association.md) |
| ICE / WebRTC Transport | [ICE による経路の確立・維持](transport/ice.md)<br>[WebRTC の暗号化通信の確立・維持](transport/secure-transport.md) |
| E2EE | [E2EE の信頼モデルと鍵状態の管理](e2ee/key-management.md)<br>[SFrame によるメディア保護](e2ee/media.md)<br>[DataChannel 本文の E2EE](e2ee/data.md) |
| Signaling | [Signaling による参加・接続確立・再接続・退出](signaling/session.md) |
| SFU | [SFU の発行・購読とメディア転送](sfu/forwarding.md)<br>[SFU の品質制御とエンコーディングの停止・再開](sfu/quality.md)<br>[SFU の配置・移行・退役](sfu/placement.md) |
| SCTP / DataChannel | [SCTP Association と DataChannel の確立・終了](datachannel/association.md)<br>[DataChannel のメッセージ配送と中継](datachannel/delivery.md) |
| Client SDK | [Browser SDK](client-sdk/browser.md)<br>[React SDK](client-sdk/react.md) |
| 管理 UI | [管理操作と結果の確認](admin-ui/operations.md)<br>[管理 UI の状態表示と情報の分離](admin-ui/state.md) |
