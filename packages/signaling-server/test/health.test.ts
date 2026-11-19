import { test, expect } from "vitest";

import { createApp, parsePort } from "../src/server.js";

test("GET /healthz はヘルス状態を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/healthz" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.json()).toEqual({ status: "ok" });
});

test("GET 以外の /healthz は RFC 9457 の 405 を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "POST", url: "/healthz" });

  expect(response.statusCode).toBe(405);
  expect(response.headers["allow"]).toBe("GET");
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 405, title: "Method Not Allowed" });
});

test("HEAD /healthz も GET 以外として 405 を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "HEAD", url: "/healthz" });

  expect(response.statusCode).toBe(405);
  expect(response.headers["allow"]).toBe("GET");
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.body).toBe("");
});

test("未実装パスは RFC 9457 の 404 を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/unknown" });

  expect(response.statusCode).toBe(404);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 404, title: "Not Found" });
});

test("予期しない失敗は RFC 9457 の 500 を返す", async () => {
  const app = createApp();
  app.get("/internal-error", async () => {
    throw new Error("internal error");
  });
  const response = await app.inject({ method: "GET", url: "/internal-error" });

  expect(response.statusCode).toBe(500);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 500, title: "Internal Server Error" });
});

test("ポート設定は既定値と明示値を解釈する", () => {
  expect(parsePort(undefined, 8080)).toBe(8080);
  expect(parsePort("9", 8080)).toBe(9);
  expect(() => parsePort("invalid", 8080)).toThrow();
});
