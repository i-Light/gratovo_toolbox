# Context: gratovo_toolbox, step 3a (toolchain and skeleton)

Written 2026-10-19 by the planning session. Read CLAUDE.md, docs/handoff.md and docs/migration-plan.md §6 step 3a first.

## What exists
- docs/, design/workbench-prototype/ (plain ES5 React via htm, no build; tests in test/*.py, Python Playwright), legacy/ (read only, never edit), .claude/ (skills, agents, settings).
- No package.json, no tsconfig, no apps/ or packages/ or services/ yet.
- Branch: claude/pensive-bell-7fy7xz (the designated branch). Never push to main.

## Tools on this machine (Linux, cloud)
- node 22.22.0, pnpm 10.28.0, Python 3.13.16, uv 0.11.32, xvfb-run available, Chromium in /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH set). Do not run `playwright install`.
- gitleaks: not checked yet (see T6).
- npm registry reachable through the proxy.

## Versions chosen (checked with `npm view`, 2026-10-19)
- electron 44.9.0 (released 2026-10-17), electron-vite 6.0.0, vite 8.3.4, @vitejs/plugin-react 6.1.2
- react 19.3.1, react-dom 19.3.1, @types/react 19.3.0
- typescript 6.0.3. NOT 7: typescript-eslint 8.71.2 peers `typescript <6.1.0`.
- eslint 9.x (latest 9), NOT 10: eslint-plugin-jsx-a11y 6.10.2 peers eslint `^9`.
- typescript-eslint 8.71.2, eslint-plugin-react-hooks 7.1.1, eslint-plugin-jsx-a11y 6.10.2, prettier 3.9.10
- vitest 5.0.5 (vite ^6.4 || ^7 || ^8, node ^20.19 || >=22.12), @playwright/test 1.64.1
- zod 4.6.7, lefthook 2.2.2, lint-staged 17.6.0
- Python: ruff, pyright, pytest, uv. Versions are pinned in pyproject and uv.lock.
- Node for .nvmrc: 22.22.0. Python for .python-version: 3.13.

## Conventions that bind this step (docs/conventions.md)
- TS strict + noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride. No `any`.
- Named exports, one component per file. kebab-case files, PascalCase components.
- Pure logic in packages/core (no I/O).
- Python: src layout, ruff, pyright strict on new code, pytest with no network.
- Tokens: CSS custom properties, no colour literals in components.
- Example data is about AI creators and AI brands only.

## Prototype facts for the port
- design/workbench-prototype/js/data.js lines 8-19: W.DEAL_FLOW (10 steps; "contracts" ordered; "pay" lockedUntilPaid). Port exactly.
- design/workbench-prototype/index.html: :root at line 11 (light), dark at line 27-28 (prefers-color-scheme with :root:not([data-theme=light])) and line 39 (:root[data-theme=dark]), density compact line 49, size large 609, motion reduce 611, kbd input 606.

## Security (SECURITY.md, step 3b will finish these)
- 3a must already set the secure BrowserWindow: contextIsolation true, sandbox true, nodeIntegration false, a strict CSP meta, navigation and window.open blocked. A minimal preload that exposes nothing.
- Never add secrets. Never read .env (deny rules in .claude/settings.json).

## Open owner items for 3a
- A2: the GitHub repo must exist for CI to run. Check, do not block on it.
- Branch protection (step 3g) is set by the owner.
