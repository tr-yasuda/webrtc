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

const healthResponseSchema = z.object({ status: z.literal("ok") });
const healthResponse = { status: "ok" } as const;

const problems = {
  404: { status: 404, title: "Not Found" },
  405: { status: 405, title: "Method Not Allowed" },
  500: { status: 500, title: "Internal Server Error" },
} as const;

type ProblemStatus = keyof typeof problems;

export const app = Fastify({ logger: false, exposeHeadRoutes: false });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(swagger, {
  openapi: {
    info: {
      title: "Signaling Server",
      description: "Signaling サーバーの HTTP API",
      version: "0.1.0",
    },
  },
  transform: jsonSchemaTransform,
});

await app.register(swaggerUi, { routePrefix: "/docs" });

app.withTypeProvider<ZodTypeProvider>().route({
  method: "GET",
  url: "/healthz",
  schema: {
    description: "Signaling サーバーが HTTP リクエストを受け付けられることを確認する。",
    tags: ["health"],
    response: { 200: healthResponseSchema },
  },
  handler: async () => healthResponse,
});

app.setNotFoundHandler((request, reply) => {
  const status: ProblemStatus =
    request.url.split("?")[0] === "/healthz" && request.method !== "GET" ? 405 : 404;

  if (status === 405) {
    reply.header("Allow", "GET");
  }

  reply.status(status).type("application/problem+json").send(problems[status]);
});

app.setErrorHandler((error: FastifyError, _request, reply) => {
  const status: ProblemStatus =
    error.statusCode === 404 || error.statusCode === 405 ? error.statusCode : 500;
  reply.status(status).type("application/problem+json").send(problems[status]);
});
