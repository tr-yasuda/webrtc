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
    low: 0,
    break: 0,
  },
  vitest: {
    configFile: "vitest.config.ts",
  },
  reporters: ["clear-text", "json"],
  jsonReporter: {
    fileName: "reports/mutation.json",
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  concurrency: 1,
};
