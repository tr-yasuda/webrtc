import { test } from "vitest";

test("ビルド済みの domain パッケージを読み込める", async () => {
  await import("@webrtc/domain");
});
