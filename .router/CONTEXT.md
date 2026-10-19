# Context for step 3b (security baseline)

Repo: `/home/user/gratovo_toolbox`. pnpm 12 workspace (`apps/*`, `packages/*`, `tooling/*`):
Electron 44.9.0, React 19.3.1, TypeScript 7.0.2, Python pipeline in `services/pipeline`. Windows only.

## 1. Commands

**Before any pnpm, node or uv command, run:**

```
source /tmp/claude-0/-home-user-gratovo-toolbox/29855e89-62ab-5c2f-b270-c4126d08a3dd/scratchpad/env.sh
```
(Node 24.22.0, pnpm 12.14.0, uv 0.13.1 on PATH.)

Root `package.json` scripts:

| Script | Runs |
|---|---|
| `pnpm install` | install, plus git hooks (lefthook) |
| `pnpm lint` | `eslint .`, `prettier --check .`, `ruff check` and `ruff format --check` in `services/pipeline` |
| `pnpm typecheck` | `tsc -b` (root solution), then `pyright` in `services/pipeline` |
| `pnpm test` | `vitest run`, then `pytest` in `services/pipeline` |
| `pnpm test:e2e` | `pnpm --filter @gratovo/desktop test:e2e` (Windows / CI only) |
| `pnpm format` | `prettier --write .`, `ruff format .` |
| `pnpm dev` / `pnpm build` | desktop `dev` / `build` |

`apps/desktop/package.json` scripts:

- `dev`, `preview`: `install-electron && electron-vite dev|preview`
- `build`: `electron-vite build` (to `apps/desktop/out/`)
- `test:e2e`: `install-electron && electron-vite build && playwright test`

**Cloud containers (Linux) do not run `pnpm test:e2e`.** Electron tests run on Windows CI only.
Locally, verify with `pnpm lint`, `pnpm typecheck` and `pnpm test`. All three must pass.

## 2. Folder map (relevant areas)

- `apps/desktop/`
  - `src/main/`: Electron main process. `index.ts` (app setup, sandbox, web-contents guard),
    `window.ts` (BrowserWindow + webPreferences), `security.ts` (navigation/window-open/webview
    guards and permission denial).
  - `src/renderer/`: React UI. `main.tsx`, `app.tsx` (blank frame), `strings.ts` (all user
    strings), `index.html`, `base.css`.
  - `e2e/smoke.spec.ts`: Playwright tests that launch the built app.
  - `tsconfig.json` (solution: refs `tsconfig.node.json`, `tsconfig.web.json`, `tsconfig.e2e.json`),
    `electron.vite.config.ts` (renderer CSP plugin), `playwright.config.ts`.
  - `out/`, `.tsbuild/`, `test-results/` are generated. No `src/preload/` yet.
- `packages/ipc/`: IPC contract. `src/channels.ts` (zod schemas per channel, `parseRequest`,
  `isChannel`), `src/index.ts` (re-exports). Tests: `src/channels.test.ts`.
  Tsconfigs: `tsconfig.json` (solution), `tsconfig.lib.json` (no Node/DOM types, `types: []`),
  `tsconfig.test.json`. Exports `./src/index.ts`. Depends on `zod`.
- `packages/core/`: pure domain logic, no I/O (`src/deal-flow.ts`). Tsconfigs: lib and test split.
- `packages/ui/`: design tokens (`src/tokens.css`, exported as `@gratovo/ui/tokens.css`) and
  `src/tokens.test.ts`. Single `tsconfig.json` (no lib/test split). Shared components come in 3c.
- `tooling/eslint-config/`: `@gratovo/eslint-config` package (`index.js`). Exports the
  typescript-eslint, react-hooks, jsx-a11y and globals plugins. Pinned to TypeScript 6 on purpose.
- `.github/workflows/ci.yml`: job `checks` (Windows 2025: install with `--frozen-lockfile`, lint,
  typecheck, `pnpm test`, `pnpm test:e2e`, upload e2e results on failure) and job `secrets`
  (gitleaks over full history, Linux).
- `services/pipeline/`: Python 3.14, uv; `pyproject.toml` (ruff, pyright strict, pytest). Not in 3b's scope.
- Docs: `docs/conventions.md`, `docs/handoff.md`, `docs/migration-plan.md`, `SECURITY.md`.

## 3. TypeScript setup

`tsconfig.base.json` (every project extends it):

- ES2025 target and lib, `module: preserve`, `moduleResolution: bundler`, `verbatimModuleSyntax`,
  `isolatedModules`, `types: []` (each project opts in).
- Strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `skipLibCheck`.
- `composite: true`, `emitDeclarationOnly: true`, `outDir: ${configDir}/.tsbuild`.

Project references:

- Root `tsconfig.json` is a solution (`files: []`) referencing `tsconfig.tools.json`
  (`vitest.config.ts`, types node), `packages/core`, `packages/ipc`, `packages/ui`, `apps/desktop`.
- Packages expose TS source directly: `"exports": { ".": "./src/index.ts" }`. No build step.
- Rule: if a project imports a workspace package, it must
  (a) list that package's tsconfig in its `references`, and
  (b) list the package in its `package.json` `devDependencies` as `"workspace:*"`.
  `apps/desktop` lists `@gratovo/ui` as `workspace:*`, but its tsconfigs don't reference it yet.
  Step 3b adding `@gratovo/ipc` to desktop needs: `"@gratovo/ipc": "workspace:*"`, plus
  `packages/ipc/tsconfig.lib.json` in `references` of `apps/desktop/tsconfig.node.json` (main)
  and `tsconfig.web.json` (renderer). `packages/ui` has no lib file: reference its `tsconfig.json`.
- Desktop per-side configs: `tsconfig.node.json` (main + electron.vite config, node types),
  `tsconfig.web.json` (renderer, DOM, `react-jsx`, `vite/client`), `tsconfig.e2e.json` (e2e).

## 4. Lint and format

`eslint.config.mjs` (flat config, `defineConfig`):

- Ignored: `legacy/`, `design/`, `docs/`, `.claude/`, `services/` (ruff), build and test output dirs.
- `js.configs.recommended` and `tseslint.configs.strictTypeChecked`, `projectService: true`.
- Plain `.js/.mjs/.cjs`: type-aware rules off, Node globals.
- `apps/desktop/src/renderer/**/*.{ts,tsx}`: `reactHooks.configs.flat.recommended` and
  `jsxA11y.flatConfigs.strict`.

Prettier (`.prettierrc.json`): `printWidth: 100`. `.prettierignore`: `legacy/`, `design/`,
`.claude/`, all `*.md`, `docs/`, `pnpm-lock.yaml`, `services/pipeline/`.

Pre-commit (lefthook): `lint-staged` plus gitleaks on staged changes.

## 5. Conventions that matter for code

From `docs/conventions.md`:

- Files: kebab-case. Named exports only. One component per file. Files under about 300 lines.
- No `any`. Use `unknown` and a zod parse at boundaries.
- Expected failures are values: `{ ok: false, reason }`, shown in plain words. Unexpected errors
  throw, are logged in main, and become a toast.
- Pure logic goes in `packages/core`. Side effects stay at edges (IPC handlers, data layer).
- User strings live in `strings.ts`. English only. Example data is AI-niche only.
- IPC channel names: `domain:verb` (`app:ping`).

Code style seen in `apps/desktop/src/main/*.ts` and `packages/ipc/src/*.ts`:

- JSDoc one-liners on exports; comments explain why.
- Import order: `node:` builtins, then packages, then relative, blank line between groups.
  `import type` for type-only imports. Env vars via `process.env["NAME"]`.
- Example to copy: `apps/desktop/src/main/security.ts`. For zod and parse results:
  `packages/ipc/src/channels.ts`.

## 6. Tests

- Vitest (`vitest.config.ts`) includes `packages/*/src/**/*.test.ts` and
  `apps/*/src/**/*.test.{ts,tsx}`. Tests sit next to the code.
- Copy from `packages/ipc/src/channels.test.ts` (`describe`/`it`, `toEqual` on `{ ok: false, reason }`)
  or `packages/core/src/deal-flow.test.ts`.
- Test tsconfigs: `packages/*/tsconfig.test.json` (types node, `src/**/*.test.ts`). Desktop main
  tests would be picked up by `tsconfig.node.json` (`src/main/**/*.ts`); renderer tests by none yet.
- Playwright: `playwright.config.ts` (`testDir: ./e2e`, `workers: 1`). Pattern in
  `e2e/smoke.spec.ts`: `_electron.launch({ executablePath, args: [appDir] })`, `app.firstWindow()`.
  Needs `electron-vite build` first. Already covers: no Node globals, sandboxed tabs, `window.open`
  refused, CSP meta tag.

## 7. Electron security already in place

- `apps/desktop/src/main/window.ts:35-44` `webPreferences`: `contextIsolation`, `sandbox`,
  `nodeIntegration: false`, `webSecurity`, `allowRunningInsecureContent: false`, `webviewTag: false`.
  No preload yet. `window.ts:12-25`: dev server URL only if not packaged, `http:`, and local host.
- `apps/desktop/src/main/index.ts:7` `app.enableSandbox()`.
  `index.ts:9` `web-contents-created` calls `guardWebContents` on every contents.
  `index.ts:14` `denyAllPermissions(session.defaultSession)` on ready. `index.ts:19` quits on
  `window-all-closed`.
- `apps/desktop/src/main/security.ts`:
  - `guardWebContents` (line 21): window-open denied (22), `will-navigate` blocks non-app URLs
    (24), `will-attach-webview` blocked (30). Its comment says the link allowlist is step 3b.
  - `denyAllPermissions` (lines 36-40): request and check handlers both refuse.
- `apps/desktop/electron.vite.config.ts:10-25` `contentSecurityPolicy(dev)`: `default-src 'none'`,
  `script-src`/`style-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`, `object-src`,
  `base-uri`, `form-action` 'none'. Dev adds `'unsafe-inline'` and `ws://localhost:*`.
- `electron.vite.config.ts:31-42` `cspMetaTag()` writes it as a meta tag in `index.html`.

Gaps for 3b (from the code): no preload or typed bridge, no link allowlist, CSP is a meta tag only
(no `onHeadersReceived`), `@gratovo/ipc` not wired into main. Electron fuses were not checked.
