# Signaling サーバー

Signaling サーバーの開発用起動手順。

## 開発

`.env.example` をコピーして `.env` を作成し、必要に応じて `PORT` を変更する。

```sh
cp .env.example .env
```

`tsx watch` で開発サーバーを起動する。`.env` の環境変数が適用され、ソースコードの変更時に再起動する。

```sh
pnpm dev
```

ヘルスエンドポイントを確認する。

```sh
curl "http://127.0.0.1:${PORT}/healthz"
```

Swagger UI と OpenAPI JSON を確認する。

```sh
curl "http://127.0.0.1:${PORT}/docs"
curl "http://127.0.0.1:${PORT}/docs/json"
```

`.env` はローカル設定として Git 管理対象外にする。環境変数の雛形を変更するときは `.env.example` を更新する。
