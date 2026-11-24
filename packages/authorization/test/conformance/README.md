# 有限モデル照合

`proofs/Conformance/Enumerate.lean` が抽象入力の全有限ケースを、`proofs/Conformance/ValidationCases.lean` がvalidatorの不正入力ケースを定義し、`Main.lean` が期待結果をJSONLで出力する。`scripts/run-authorization-conformance.mjs` はvalidatorの成否と失敗理由を全件比較し、validatorが成功したケースだけ認可判断を比較する。

実行方法:

```sh
pnpm --filter @webrtc/authorization test:conformance
```

サンプリングは行わない。スクリプトは系統別のケース数、認可判断の比較件数、validator失敗件数を固定値と照合する。空のJSONL、生成途中の欠落、ケース数の変更は失敗する。期待件数を変更する場合は、有限domainまたはvalidatorケースの設計変更としてレビューする。
