import { test, expect } from "vitest";

import { readPort } from "../src/config.js";
import { createApp } from "../src/server.js";

test("GET /healthz は 200 と ok を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/healthz" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.json()).toEqual({ status: "ok" });
});

test("POST /healthz は 405 を返す", async () => {
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

test("未知のパスは 404 を返す", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/unknown" });

  expect(response.statusCode).toBe(404);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 404, title: "Not Found" });
});

test("予期しない失敗は 500 を返す", async () => {
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
  expect(readPort({})).toBe(8080);
  expect(readPort({ PORT: "9" })).toBe(9);
  expect(() => readPort({ PORT: "invalid" })).toThrow();
  expect(() => readPort({ PORT: "" })).toThrow();
});
