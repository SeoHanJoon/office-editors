import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// `pnpm e2e:record`는 RECORD=1로 실행되어 영상을 저장소 루트의 recordings/에 남긴다.
const record = process.env.RECORD === "1";
const port = 3000;

export default defineConfig({
  testDir: "./e2e",
  outputDir: record
    ? path.resolve(import.meta.dirname, "../../recordings")
    : "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    video: record ? "on" : "off",
    // 녹화 영상은 사람이 보고 흐름을 이해해야 하므로 동작 사이를 천천히 진행한다.
    launchOptions: record ? { slowMo: 500 } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
