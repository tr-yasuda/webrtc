# 有限モデル照合

`proofs/Conformance/Main.lean` が抽象入力の全有限ケースと期待判定をJSONLで出力し、`scripts/run-authorization-conformance.mjs` がTypeScript実装の判定と全件比較する。

実行方法:

```sh
pnpm --filter @webrtc/authorization test:conformance
```

サンプリングは行わない。ケース数を減らす変更は、有限domainの設計変更としてレビューする。
