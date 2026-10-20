import { defineConfig } from "vitest/config";

// The server tests: they talk to a local Supabase stack (`supabase start`), so `pnpm test` does not
// run them. Run them with `pnpm test:server` (docs/setup.md). One file at a time, because they
// share the users that setup.test.ts creates.
export default defineConfig({
  test: {
    include: ["supabase/server-tests/*.test.ts"],
    exclude: ["supabase/server-tests/setup.test.ts"],
    globalSetup: ["supabase/server-tests/setup.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
