import { test } from "node:test";

test("the built Browser SDK is importable as a package", async () => {
  await import("@webrtc/browser-sdk");
});
