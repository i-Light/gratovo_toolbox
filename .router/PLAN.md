# Plan: step 3a, toolchain and repository skeleton

The planning session builds the pieces itself: each is small and depends on the one before, so spawning agents would cost more than the edits. An independent reviewer agent checks the diff at the end. Every task's done-check is run for real.

## Goal

A clean clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm test` green (which includes `uv run pytest`), the Electron smoke test passes (`xvfb-run` on Linux), and CI is green on Ubuntu and Windows.

## Non-goals (later steps)

- The IPC bridge and preload, the CSP for a custom protocol, fuses, `safeStorage`, audit, CodeQL, Dependabot (3b).
- The frame, fonts, components, store, keyboard system (3c). Data layer and Supabase migrations (3d). The pipeline port (3e). Packaging (3h).
- Branch protection: the owner sets it in GitHub.

## Acceptance

1. `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` pass on a fresh clone of the branch.
2. `pnpm test:e2e` passes: the built app opens, shows the frame, the tokens apply in light and dark, and the page has no Node.
3. The pre-commit hook formats and lints staged files and runs gitleaks; a planted fake secret is blocked.
4. CI (`.github/workflows/ci.yml`) is green on Ubuntu and Windows, plus the secret scan.
5. Versions recorded in `docs/architecture.md#versions`; the plan's status table, `docs/handoff.md`, `README.md` and the Commands section of `CLAUDE.md` updated.

## Decisions

- **Node 24.22.0** (`.nvmrc`), `engines.node` `^24.22.0`. It is the LTS line and the exact Node inside Electron 44.9.0.
- **pnpm 12.14.0.** Its settings live in `pnpm-workspace.yaml` (`saveExact`, `engineStrict`), because pnpm 12 ignores them in `.npmrc`. No `.npmrc` is written: an ignored file would mislead.
- **TypeScript 6.0.3** and **ESLint 10.13.0** (see the holds in ADR 0007).
- **Project references:** a solution-style root `tsconfig.json`; `pnpm typecheck` runs `tsc -b`. Packages export their TypeScript source (no build step); electron-vite and Vitest compile it.
- **`packages/core` enforces "no I/O" in its tsconfig:** `lib` without DOM and no Node types. Its tests are a separate project that may use Node.
- **Root scripts cover both languages:** `lint` = ESLint + Prettier + ruff; `typecheck` = `tsc -b` + pyright; `test` = Vitest + pytest. `test:e2e` builds the app and runs Playwright (needs a display, so it is separate).
- **Hooks:** lefthook runs lint-staged (Prettier and ESLint on staged JS/TS, ruff on staged Python) and `gitleaks git --staged`. If gitleaks is missing the hook fails and says how to install it.
- **Prettier** formats code and config, not Markdown (the docs are prose) and not `legacy/`, `design/`, `.claude/`.
- **The tokens and `DEAL_FLOW` are tested against the prototype itself**, so drift in either direction fails a test while the prototype is the spec.
- **CSP:** a meta tag written per mode by a small Vite plugin: strict for the built app, relaxed only for the dev server (Vite injects inline styles and a websocket). 3b moves the app to a custom protocol.
- **CI:** actions pinned by commit SHA; `permissions: contents: read`; gitleaks built with `go install` at a pinned version (verified by the Go checksum database), so no licence or unverified download.

## Contracts

- `@gratovo/core`: `DEAL_FLOW: readonly DealStep[]`; `DealStep = { key: DealStepKey; name: string; items: readonly string[]; ordered?: true; lockedUntilPaid?: true; note?: string }`; `DealStepKey` is the union of the 10 keys.
- `@gratovo/ui`: `./tokens.css` (package export). No JS.
- `@gratovo/ipc`: `channels` map `{ "app:ping": { request, response } }` of zod schemas; `Channel`, `ChannelRequest<C>`, `ChannelResponse<C>` types; `parseRequest(channel: string, input: unknown): ParseResult` returning `{ ok: true, channel, value } | { ok: false, reason }`.
- Desktop window: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`; `app.enableSandbox()`; `setWindowOpenHandler` denies; `will-navigate` blocks other origins; permission request and check handlers deny everything.

## Tasks

| id | title | files | done_check |
|---|---|---|---|
| T1 | Root workspace and pins | `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `tsconfig.json`, `.prettierrc.json`, `.prettierignore`, `.gitignore` | `pnpm install` works; versions exact |
| T2 | `packages/core` DEAL_FLOW | `packages/core/**` | Vitest passes; equals the prototype's `W.DEAL_FLOW` |
| T3 | `packages/ui` tokens | `packages/ui/**` | Vitest compares every token block with `index.html` |
| T4 | `packages/ipc` | `packages/ipc/**` | Vitest: ping accepted, extra keys and unknown channels refused |
| T5 | `apps/desktop` shell | `apps/desktop/**` | `electron-vite build`; Playwright smoke under `xvfb-run` |
| T6 | Lint, format, test config | `eslint.config.mjs`, `vitest.config.ts` | `pnpm lint`, `pnpm typecheck`, `pnpm test`; a planted a11y error is reported |
| T7 | Python project | `services/pipeline/**`, `services/gemini-extension/README.md`, `supabase/README.md` | `uv run pytest`, ruff, pyright strict pass |
| T8 | Hooks | `lefthook.yml`, `.lintstagedrc.json`, `.gitleaksignore` | a staged fake key is blocked; a badly formatted file is fixed |
| T9 | CI | `.github/workflows/ci.yml` | green on the pull request, both systems |
| T10 | Docs | `docs/architecture.md`, `docs/decisions/0007-toolchain-pins.md`, `docs/migration-plan.md`, `docs/handoff.md`, `README.md`, `CLAUDE.md` | match what was pinned |

Order: T1, then T2 to T4 and T7, then T5, T6, T8, T9, T10. Then a fresh-clone run of the whole check list, the reviewer agent, fixes, and the pull request.
