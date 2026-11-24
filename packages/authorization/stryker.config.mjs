export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  mutate: [
    "src/participant/**/*.ts",
    "src/project-user/**/*.ts",
    "src/management-credential/**/*.ts",
    "!src/**/index.ts",
  ],
  coverageAnalysis: "perTest",
  disableTypeChecks: true,
  inPlace: true,
  thresholds: {
    high: 100,
    low: 95,
    break: 100,
  },
  vitest: {
    configFile: "vitest.config.ts",
  },
  reporters: ["clear-text", "progress"],
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
