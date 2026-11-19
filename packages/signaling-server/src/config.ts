import { z } from "zod/v4";

const portSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(65535));

export function readPort(env: NodeJS.ProcessEnv): number {
  const result = portSchema.safeParse(env.PORT ?? "8080");
  if (!result.success) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  return result.data;
}
