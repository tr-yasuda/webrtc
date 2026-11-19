import { test, expect } from "vitest";

import { app } from "../src/server.js";

app.get("/internal-error", async () => {
  throw new Error("internal error");
});

test("GET /healthz は 200 と ok を返す", async () => {
  const response = await app.inject({ method: "GET", url: "/healthz" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.json()).toEqual({ status: "ok" });
});

test("POST /healthz は 405 を返す", async () => {
  const response = await app.inject({ method: "POST", url: "/healthz" });

  expect(response.statusCode).toBe(405);
  expect(response.headers["allow"]).toBe("GET");
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 405, title: "Method Not Allowed" });
});

test("HEAD /healthz も GET 以外として 405 を返す", async () => {
  const response = await app.inject({ method: "HEAD", url: "/healthz" });

  expect(response.statusCode).toBe(405);
  expect(response.headers["allow"]).toBe("GET");
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.body).toBe("");
});

test("未知のパスは 404 を返す", async () => {
  const response = await app.inject({ method: "GET", url: "/unknown" });

  expect(response.statusCode).toBe(404);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 404, title: "Not Found" });
});

test("予期しない失敗は 500 を返す", async () => {
  const response = await app.inject({ method: "GET", url: "/internal-error" });

  expect(response.statusCode).toBe(500);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toEqual({ status: 500, title: "Internal Server Error" });
});

test("Swagger UI と OpenAPI ドキュメントを提供する", async () => {
  const uiResponse = await app.inject({ method: "GET", url: "/docs" });
  const openApiResponse = await app.inject({ method: "GET", url: "/docs/json" });

  expect(uiResponse.statusCode).toBe(200);
  expect(uiResponse.headers["content-type"]).toContain("text/html");
  expect(openApiResponse.statusCode).toBe(200);
  expect(openApiResponse.headers["content-type"]).toContain("application/json");
  expect(openApiResponse.json()).toMatchObject({
    openapi: "3.0.3",
    info: { title: "Signaling Server", version: "0.1.0" },
    paths: { "/healthz": expect.anything() },
  });
});
