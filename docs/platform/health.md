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

## API ドキュメント

Signaling サーバーは Zod Type Provider と Swagger を組み合わせて API ドキュメントを生成する。

| パス | メソッド | 形式 |
| --- | --- | --- |
| `/docs` | `GET` | Swagger UI |
| `/docs/json` | `GET` | OpenAPI 3.0 JSON |

`GET /healthz` の応答形式は Zod で定義し、OpenAPI ドキュメントに反映する。

## エラーレスポンス

エラーレスポンスは[共通の HTTP エラーレスポンス](http-errors.md)に従う。

## 起動設定

| 環境変数 | 既定値 |
| --- | --- |
| `PORT` | `18081` |
| `HOST` | `localhost` |

ポートには `0` 以上 `65535` 以下の整数を指定する。無効な値を指定した場合は起動に失敗する。`HOST` には listen するホスト名またはアドレスを指定する。

## 受け入れ条件

- `GET /healthz` が `200` と `{"status":"ok"}` を返す。
- `HEAD` を含む GET 以外のリクエストが `405` と `Allow: GET` を返す。
- 未知のパスが `404` を返す。
- 予期しない失敗が `500` を返す。
- `PORT` と `HOST` の設定どおりに起動する。
- `GET /docs` が Swagger UI を返す。
- `GET /docs/json` が `GET /healthz` を含む OpenAPI 3.0 JSON を返す。
