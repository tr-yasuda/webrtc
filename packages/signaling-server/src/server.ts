import { STATUS_CODES } from "node:http";

import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

function problemTitle(status: number): string {
  return STATUS_CODES[status] ?? "Internal Server Error";
}

export function parsePort(raw: string | undefined, defaultPort: number): number {
  if (raw === undefined) {
    return defaultPort;
  }

  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 0 || port > 65535) {
    throw new Error("port must be a number between 0 and 65535");
  }

  return port;
}

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false, exposeHeadRoutes: false });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.setNotFoundHandler((request, reply) => {
    if (request.url === "/healthz" && request.method !== "GET") {
      reply
        .status(405)
        .header("Allow", "GET")
        .type("application/problem+json")
        .send({ status: 405, title: problemTitle(405) });
      return;
    }

    reply
      .status(404)
      .type("application/problem+json")
      .send({ status: 404, title: problemTitle(404) });
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply
      .status(status)
      .type("application/problem+json")
      .send({ status, title: problemTitle(status) });
  });

  return app;
}
