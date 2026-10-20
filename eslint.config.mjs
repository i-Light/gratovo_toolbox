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

  {
    // The main process reaches the internet only through net/network.ts, which checks every
    // address against an allowlist. Node's own network calls don't pass through the session's
    // request filter, so this rule is what keeps them in one place.
    files: ["apps/desktop/src/main/**/*.ts"],
    ignores: ["apps/desktop/src/main/net/network.ts", "apps/desktop/src/main/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["fetch", "WebSocket", "XMLHttpRequest", "EventSource"].map((name) => ({
          name,
          message: "Use net/network.ts: it is the only code that may reach the network.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["fetch", "WebSocket", "XMLHttpRequest", "EventSource"].map((property) => ({
          object: "globalThis",
          property,
          message: "Use net/network.ts: it is the only code that may reach the network.",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...[
              "node:http",
              "node:https",
              "node:http2",
              "node:net",
              "node:tls",
              "node:dgram",
              "http",
              "https",
              "http2",
              "net",
              "tls",
              "dgram",
              "undici",
            ].map((name) => ({
              name,
              message: "Use net/network.ts: it is the only code that may reach the network.",
            })),
            {
              name: "electron",
              importNames: ["net"],
              message: "Use net/network.ts: it is the only code that may reach the network.",
            },
          ],
        },
      ],
    },
  },
);
