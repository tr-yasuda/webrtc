export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/**/*.ts", "!src/generated/**"],
  reporters: ["clear-text", "json"],
  jsonReporter: {
    fileName: "reports/mutation.json",
  },
  coverageAnalysis: "perTest",
  // Stryker 10.1.1 の tsconfig 前処理は TypeScript 7 の API と互換でない。
  // 型検査は別の tsc ジョブで行い、mutation では sandbox 内に tsconfig を要求しない。
  tsconfigFile: "tsconfig.stryker.json",
  thresholds: {
    high: 100,
    low: 0,
    break: 0,
  },
  concurrency: 2,
  timeoutMS: 30_000,
  tempDirName: ".stryker-tmp",
};
