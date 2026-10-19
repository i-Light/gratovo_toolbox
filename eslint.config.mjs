// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.strict],
  },
);
