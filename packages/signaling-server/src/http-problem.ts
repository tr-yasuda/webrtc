import type { FastifyReply } from "fastify";

const problemTitles = {
  405: "Method Not Allowed",
  404: "Not Found",
  500: "Internal Server Error",
} as const;

export type ProblemStatus = keyof typeof problemTitles;

export function sendProblem(reply: FastifyReply, status: ProblemStatus): void {
  reply.status(status).type("application/problem+json").send({
    status,
    title: problemTitles[status],
  });
}
