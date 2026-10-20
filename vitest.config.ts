import { defineConfig } from "vitest/config";

// Unit tests sit next to the code they test. The Electron end-to-end tests are Playwright's.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/*/src/**/*.test.{ts,tsx}",
      "supabase/functions/**/*.test.ts",
    ],
  },
});
