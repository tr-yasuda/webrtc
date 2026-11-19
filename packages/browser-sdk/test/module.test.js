import { test } from "vitest";

test("ビルド済みの Browser SDK をパッケージとして読み込める", async () => {
  await import("@webrtc/browser-sdk");
});
