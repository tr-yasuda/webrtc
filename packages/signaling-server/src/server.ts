import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyError } from "fastify";
import { z } from "zod/v4";

import { sendProblem } from "./http-problem.js";

const healthResponseSchema = z.object({ status: z.literal("ok") });
const healthResponse = { status: "ok" } as const;

export const app = Fastify({
  logger: false,
  exposeHeadRoutes: false,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(swagger, {
  openapi: {
    info: {
      title: "Signaling Server",
      description: "Signaling サーバーの HTTP API。",
      version: "0.1.0",
    },
  },
  transform: jsonSchemaTransform,
});

await app.register(swaggerUi, { routePrefix: "/docs" });

app.get(
  "/healthz",
  {
    schema: {
      description: "Signaling サーバーが HTTP リクエストを受け付けられることを確認する。",
      tags: ["health"],
      response: { 200: healthResponseSchema },
    },
  },
  async () => healthResponse,
);

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
