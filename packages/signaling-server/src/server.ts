import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { sendProblem } from "./http-problem.js";

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false, exposeHeadRoutes: false });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.setNotFoundHandler((request, reply) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/healthz" && request.method !== "GET") {
      reply.header("Allow", "GET");
      sendProblem(reply, 405);
      return;
    }

    sendProblem(reply, 404);
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    sendProblem(reply, error.statusCode ?? 500);
  });

  return app;
}
