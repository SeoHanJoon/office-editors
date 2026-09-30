import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/는 Playwright가 실행한다.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    passWithNoTests: true,
  },
});
