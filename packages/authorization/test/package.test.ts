import { test } from "vitest";

test("ビルド済みの authorization パッケージを読み込める", async () => {
  await import("@webrtc/authorization");
});
