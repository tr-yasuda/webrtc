import { env } from "./env.js";
import { app } from "./server.js";

await app.listen({ port: env.PORT, host: env.HOST });
