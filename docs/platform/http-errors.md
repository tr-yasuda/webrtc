# HTTP エラーレスポンス

## 適用範囲

HTTP を公開するすべてのサーバーコンポーネントに適用する。Rust の D-Plane 処理が HTTP を直接公開しない場合は対象外とする。

## 形式

エラーレスポンスは RFC 9457 に従い、`Content-Type` を `application/problem+json` にする。

| 状態 | 本文 |
| --- | --- |
| `405` | `{"status":405,"title":"Method Not Allowed"}` |
| `404` | `{"status":404,"title":"Not Found"}` |
| `500` | `{"status":500,"title":"Internal Server Error"}` |

`405` には対象パスが受け付けるメソッドを示す `Allow` ヘッダーを付ける。スタックトレース、内部実装、依存情報は応答に含めない。
