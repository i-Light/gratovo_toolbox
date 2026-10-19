# Context: step 3a, toolchain and repository skeleton

Written 2026-10-19. Read `CLAUDE.md`, `docs/handoff.md` and `docs/migration-plan.md` (step 3a) first.

## What exists before 3a

- `docs/` (plan, architecture, conventions, workflow, decisions 0001 to 0006, product record), `design/workbench-prototype/` (plain JS with htm, no build; Python Playwright tests), `legacy/` (read only), `.claude/` (skills, agents, settings).
- No `package.json`, no `tsconfig`, no `apps/`, `packages/`, `services/`, `supabase/`, `.github/`.
- An earlier try at 3a (commits `5d42490`, `45c4bf3`) was reverted (`fc67b94`, `ac908b7`). Its lessons are folded in below; nothing is restored from it wholesale.

## Machine (cloud, Linux, runs as root)

- Node 22.22.0 and pnpm 10.28.0 come with the image. This session installed **Node 24.22.0** (nodejs.org, checksum checked) in `/root/.local/opt/` and **pnpm 12.14.0** for it. Source `env.sh` in the scratchpad, or put `/root/.local/opt/node-v24.22.0-linux-x64/bin` first on `PATH`.
- Python 3.13 system; uv 0.11.32 system. `uv python install 3.14` works (uv's mirror). PyPI and the npm registry are reachable.
- **gitleaks** is not in the image. Built from source: `GOTOOLCHAIN=auto GOBIN=/root/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1` (Go 1.24 is installed; `proxy.golang.org` is reachable).
- github.com release downloads and api.github.com are **blocked** (403). `git ls-remote` over HTTPS works. The Electron binary download works (its own CDN path).
- `xvfb-run` is installed. Electron refuses to start as root without `--no-sandbox`; GitHub runners are not root.

## Versions checked on 2026-10-19 (`npm view`, nodejs.org, PyPI)

- Node 24.22.0 is the active LTS (26 is not LTS yet). **Electron 44.9.0 bundles Node 24.22.0 and Chrome 152**, so the toolchain Node matches the app's Node.
- pnpm 12.14.0 (latest). **pnpm 12 ignores settings in `.npmrc`** (tested: `save-exact` was not applied). Settings go in `pnpm-workspace.yaml` (`saveExact`, `engineStrict`; tested). Build scripts need `allowBuilds`. Electron 44 has no postinstall: it downloads its binary on first use.
- electron-vite 6.0.0 (vite ^6 to ^8), Vite 8.3.4, @vitejs/plugin-react 6.1.2, React and react-dom 19.3.1, @types/react 19.3.0.
- TypeScript **6.0.3**, not 7.0.2: typescript-eslint 8.71.2 peers `typescript <6.1.0`.
- ESLint 10.13.0 with @eslint/js 10.0.1. eslint-plugin-jsx-a11y 6.10.2 still peers `eslint ^9` (a peer warning; its rules must be proven to fire). eslint-plugin-react-hooks 7.1.1 accepts ESLint 10.
- Prettier 3.9.10, Vitest 5.0.5, @playwright/test 1.64.1, zod 4.6.7, lefthook 2.2.2, lint-staged 17.6.0 (needs Node >= 22.22.1), globals 17.13.0, @types/node 24.19.2, postcss (for the token test).
- Python 3.14 (3.14.6), uv 0.13.1, ruff 0.17.1, pyright 1.1.414, pytest 9.1.1.
- Actions (SHA-pinned): checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, pnpm/action-setup v6.1.0 `ea17c68df8912ef543352723c149a84f56e3d413`, astral-sh/setup-uv v10.3.0 `1c37ad07a6a961277cf70c0d37d6f313000f5884`, setup-go v7.0.0 `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e`.

## gitleaks on the existing history

`gitleaks git` finds 5 hits in the first commit `b782af7`. All are false positives:
- `.claude/skills/playwright-best-practices/advanced/authentication-flows.md:54`: a mock token in an example (`test...`).
- `legacy/pipeline/gratovo/sync.py:104`: a docstring showing the key format (a timestamp plus a short tail).
- `legacy/test/core/config/supabase_config_test.dart:7, 68, 79`: a test fixture `shipped-anon-key-...`, not a Supabase key (those are JWTs or `sb_publishable_...`).
They go in `.gitleaksignore` by fingerprint, so anything new is still caught.

## Conventions that bind this step (docs/conventions.md)

- TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any`. Named exports. kebab-case files.
- `packages/core` is pure: no I/O (enforced by its tsconfig: no Node types, no DOM lib).
- Errors that are expected are values: `{ ok: false, reason }`.
- User-facing strings live in one module. English only.
- Python: src layout, ruff, pyright strict, pytest with no network. Never read `.env`.
- Docs are prose: Prettier does not format Markdown.

## Prototype facts for the port

- `design/workbench-prototype/js/data.js` lines 8 to 19: `W.DEAL_FLOW`, 10 steps, field `k` (ported as `key`), `ordered` on contracts with a note, `lockedUntilPaid` on pay.
- `design/workbench-prototype/index.html`: light `:root` (line 11), dark under `prefers-color-scheme` with `:root:not([data-theme="light"])` (28), `:root[data-theme="dark"]` (39), density compact (49), keyboard input (606), size large (609 and 610), motion reduce (611) and the reduced-motion media query (612).
