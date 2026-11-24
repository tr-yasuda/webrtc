import { test } from "vitest";

test("ビルド済みの resources パッケージを読み込める", async () => {
  await import("@webrtc/resources");
});
