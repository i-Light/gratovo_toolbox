import { defineConfig } from "vitest/config";

// Unit tests sit next to the code they test. The Electron end-to-end tests are Playwright's.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/*/src/**/*.test.{ts,tsx}",
      "supabase/functions/**/*.test.ts",
    ],
    // The checks run on the owner's PC (`pnpm verify`). With a worker per core the page tests
    // starved each other: 130-row renders that take 2 s alone hit 6 s and timed out. Half the
    // cores costs about 6 s on the whole run and leaves the slowest test near 4 s; the longer
    // limit keeps a busy machine from failing a correct test.
    maxWorkers: "50%",
    testTimeout: 10_000,
  },
});
