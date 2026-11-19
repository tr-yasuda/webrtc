import { STATUS_CODES } from "node:http";

import type { FastifyReply } from "fastify";

export function sendProblem(reply: FastifyReply, status: number): void {
  reply
    .status(status)
    .type("application/problem+json")
    .send({
      status,
      title: STATUS_CODES[status] ?? "Internal Server Error",
    });
}
