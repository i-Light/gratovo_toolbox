import { defineConfig } from "vitest/config";

// Unit tests only. The Electron end-to-end test lives in apps/desktop/e2e and runs through Playwright.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/desktop/src/**/*.test.ts"],
    environment: "node",
  },
});
