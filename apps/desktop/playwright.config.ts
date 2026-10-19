import { defineConfig } from "@playwright/test";

const ci = process.env["CI"] !== undefined;

// Tests launch the built app (run `electron-vite build` first; `pnpm test:e2e` does).
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  workers: 1,
  forbidOnly: ci,
  reporter: ci ? [["list"], ["github"]] : "list",
});
