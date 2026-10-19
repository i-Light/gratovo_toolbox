// @ts-check
// The plugins come from @gratovo/eslint-config, which gives typescript-eslint TypeScript 6
// while the rest of the repository uses TypeScript 7 (docs/decisions/0007-toolchain-pins.md).
import { globals, js, jsxA11y, reactHooks, tseslint } from "@gratovo/eslint-config";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    // Frozen or reference material: never linted.
    "legacy/",
    "design/",
    "docs/",
    ".claude/",
    // Python is linted by ruff.
    "services/",
    // Build and test output.
    "**/out/",
    "**/dist/",
    "**/.tsbuild/",
    "**/test-results/",
    "**/playwright-report/",
    "**/coverage/",
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    // Plain JavaScript, such as this file: linted without type information.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.strict],
  },
);
