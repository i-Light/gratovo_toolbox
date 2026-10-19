import { defineConfig } from "@playwright/test";

// The Electron app is built first (see the test:e2e script), then driven through _electron.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
});
