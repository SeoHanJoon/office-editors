import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// `pnpm bench`의 브라우저 측정. 결과가 흔들리지 않도록 한 번에 하나씩, 녹화 없이 돌린다.
export default defineConfig({
  ...base,
  testDir: "./perf",
  testMatch: "**/*.perf.ts",
  outputDir: "test-results/perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: { ...base.use, video: "off", trace: "off", launchOptions: {} },
});
