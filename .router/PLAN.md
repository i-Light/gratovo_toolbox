# Plan: step 3a, toolchain and repository skeleton

Tiers are recorded for the plan. The planning session builds the small pieces itself, since spawning costs more than the edits. Each task ends with its done-check, which is run for real.

## Goal
A clean clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm test` and `uv run pytest` green, with the Electron smoke test passing under xvfb on Linux. CI workflow written (runs on Ubuntu and Windows); CI green is checked after push, if GitHub access is available.

## Non-goals
- No security baseline beyond the window settings (3b), no real IPC channels beyond one example, no data layer (3d), no app frame (3c), no packaging (3h).
- No Supabase migrations yet (3d). `supabase/` gets a README only.
- No branch protection (owner setting).

## Acceptance (from migration-plan §6 3a)
1. pnpm install, lint, typecheck, test, and uv run pytest all pass.
2. Electron smoke test passes (xvfb-run on Linux).
3. Versions recorded in docs/architecture.md#versions.

## Decisions
- pnpm workspace over apps/* and packages/*. Python project lives in services/pipeline as its own uv project.
- Root `test` runs Vitest, then the Electron e2e, then pytest. On Linux, run `xvfb-run -a pnpm test`.
- Prettier ignores design/, legacy/, .router/, .claude/ and docs/ (hand-written prose kept as is; the rest is formatted).
- Lint: ESLint flat config at root (typescript-eslint strict-type-checked, react-hooks, jsx-a11y). Python lint through ruff, run from the root lint script.
- Hooks: lefthook with lint-staged (prettier + eslint on staged JS/TS, ruff on staged Python) and a gitleaks check that runs only if gitleaks is installed locally; CI always runs gitleaks.
- Vitest 5 config via `test.projects` in one root vitest.config.ts.

## Contracts
- `@gratovo/core`: export `DEAL_FLOW: readonly DealStep[]`, `DealStep = {key, name, items: readonly string[], ordered?: boolean, lockedUntilPaid?: boolean, note?: string}`.
- `@gratovo/ui`: `src/tokens.css` only; exports the file path via package exports `./tokens.css`.
- `@gratovo/ipc`: `ChannelSchemas` with one entry `app:ping` (input `{}` , output `{ok: true, version: string}`), and `parseChannel(channel, input)`.
- Electron: main creates BrowserWindow with `{contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true, preload}`; `will-navigate` and `setWindowOpenHandler` deny; permission handler denies all.

## Tasks
| id | title | tier | depends_on | files | done_check |
|---|---|---|---|---|---|
| T1 | Root workspace and pins | E | - | package.json, pnpm-workspace.yaml, .npmrc, .nvmrc, .python-version, .prettierrc.json, .prettierignore, eslint.config.mjs, tsconfig.base.json, tsconfig.json, vitest.config.ts | `pnpm install` succeeds; `pnpm -v` matches packageManager |
| T2 | packages/core DEAL_FLOW | E | T1 | packages/core/{package.json,tsconfig.json,src/index.ts,src/deal-flow.ts,src/deal-flow.test.ts} | `pnpm --filter @gratovo/core test` and typecheck pass; values equal data.js lines 8-19 |
| T3 | packages/ui tokens | N | T1 | packages/ui/{package.json,tsconfig.json,src/tokens.css,src/tokens.test.ts} | test parses tokens.css: light :root, dark block under prefers-color-scheme, [data-theme=dark] block, density, size, motion blocks present; values match index.html |
| T4 | packages/ipc zod | E | T1 | packages/ipc/{package.json,tsconfig.json,src/index.ts,src/channels.ts,src/channels.test.ts} | tests: ping accepts {}, rejects unknown channel, rejects extra input |
| T5 | apps/desktop shell and smoke | N | T1-T4 | apps/desktop/{package.json,electron.vite.config.ts,tsconfig.node.json,tsconfig.web.json,playwright.config.ts,index.html,src/main/index.ts,src/main/window.ts,src/preload/index.ts,src/renderer/main.tsx,src/renderer/app.tsx,src/renderer/app.test.tsx,e2e/smoke.spec.ts,resources/.gitkeep} | `pnpm --filter @gratovo/desktop build` then `xvfb-run -a pnpm --filter @gratovo/desktop test:e2e` passes |
| T6 | Quality tooling | E | T1 | eslint.config.mjs (done in T1), lefthook.yml, .lintstagedrc.json, scripts/hooks? | `pnpm lint` passes; lefthook install works; gitleaks hook skips with message if absent |
| T7 | services/pipeline | E | - | services/pipeline/{pyproject.toml,src/gratovo_pipeline/__init__.py,tests/test_placeholder.py,README.md}, services/gemini-extension/README.md, supabase/README.md | `uv run --project services/pipeline pytest`, ruff check, pyright pass |
| T8 | CI | N | T1-T7 | .github/workflows/ci.yml | file parses (actionlint if available); cannot run here, so CI green is checked on push |
| T9 | Docs and handoff | E | T1-T8 | docs/architecture.md (Versions), docs/migration-plan.md (status), docs/handoff.md, README.md if needed | docs match what was pinned |

## Build order
T1 first. Then T2, T3, T4, T7 (independent). Then T5. Then T6 (needs the config from T1). Then T8. Then T9, and the final verification run.

## Review
After the build, run the full check list on a fresh clone of the branch, then a fresh-eyes review of the diff (a reviewer agent or a careful self-read), and fix findings.
