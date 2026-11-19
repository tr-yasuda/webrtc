# Signaling サーバーの health エンドポイント

## 目的

Signaling サーバーが HTTP リクエストを受け付けられるかを機械的に確認する。この確認はプロセスの liveness 用であり、依存機能や準備完了の判定には使わない。

TURN / STUN / SFU の本体処理は TypeScript から呼び出す Rust の D-Plane 処理であり、この仕様の対象外とする。Rust を独立した HTTP サーバーとして実装しない。

## health 応答

Signaling サーバーは次の契約を提供する。

| 項目 | 値 |
| --- | --- |
| パス | `/healthz` |
| メソッド | `GET` |
| 認証 | なし |
| 成功時のステータス | `200` |
| 成功時の本文 | `{"status":"ok"}` |
| 成功時の Content-Type | `application/json` |

`HEAD` を含む GET 以外のメソッドは `405` を返す。HTTP の `HEAD` 仕様に従い、本文は送らない。

## エラーレスポンス

エラーレスポンスは RFC 9457 に従い、`Content-Type` を `application/problem+json` にする。

| 状態 | 本文 |
| --- | --- |
| `405` | `{"status":405,"title":"Method Not Allowed"}` |
| `404` | `{"status":404,"title":"Not Found"}` |
| `500` | `{"status":500,"title":"Internal Server Error"}` |

`405` には `Allow: GET` を付ける。スタックトレース、内部実装、依存情報は応答に含めない。

## 起動設定

| 環境変数 | 既定値 |
| --- | --- |
| `SIGNALING_PORT` | `8080` |

ポートには `0` 以上 `65535` 以下の整数を指定する。無効な値を指定した場合は起動に失敗する。ホストは `0.0.0.0` に固定する。

## 受け入れ条件

- `GET /healthz` が `200` と `{"status":"ok"}` を返す。
- `HEAD` を含む GET 以外のリクエストが `405` と `Allow: GET` を返す。
- 未実装パスが RFC 9457 形式の `404` を返す。
- 予期しない失敗が RFC 9457 形式の `500` を返す。
- ポート環境変数の既定値と明示値が仕様どおり解釈される。
