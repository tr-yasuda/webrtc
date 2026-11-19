import { readPort } from "./config.js";
import { app } from "./server.js";

const port = readPort(process.env);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

await app.listen({ port, host: "0.0.0.0" });
