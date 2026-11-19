import { createApp, parsePort } from "./server.js";

const app = createApp();
const port = parsePort(process.env.SIGNALING_PORT, 8080);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

await app.listen({ port, host: "0.0.0.0" });
