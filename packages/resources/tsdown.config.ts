import { defineConfig } from "tsdown";

export default defineConfig({
  platform: "node",
  target: "es2022",
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
