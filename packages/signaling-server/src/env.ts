import { z } from "zod/v4";

const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535))
    .default(8080),
});

export const env = envSchema.parse(process.env);
