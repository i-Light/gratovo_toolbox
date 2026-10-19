# 0002. Electron, React and TypeScript for the desktop app; Python and Supabase stay

- **Date:** recommended 2026-10-18; recorded 2026-10-19
- **Status:** accepted. The owner asked to migrate "to the new languages". The owner can still change it: migration plan, action A4.

## Context

The Flutter app lags on the team's machines and its structure fights the new UX. The owner asked whether to switch. The 2026-10-18 analysis found that the lag comes from how the app was built, not from Flutter itself:

- the frame rebuilds on presence and sync ticks;
- screens rebuild on every log flush;
- there is one query per row;
- a new Python process starts for each mail check.

A rewrite in any stack fixes those only if the rules are followed. The parity checklist §4 lists them.

The owner then chose to rebuild around the Workbench prototype, which is written in web technology (React).

## Decision

- **Desktop app:** Electron, React and TypeScript, built with electron-vite and packaged with electron-builder (NSIS) for Windows.
- **Pipeline:** Python stays. It is cleaned and packaged, with the runtime bundled.
- **Backend:** Supabase stays, the same project. R2 stays for scraped data.
- **Tooling:** pnpm workspaces, Vitest, Playwright, ESLint, Prettier, `uv`, ruff, pyright and pytest.

## Why this stack

- The prototype *is* React. Its components, tokens, store pattern and engine port almost directly, so the approved design isn't re-imagined in another toolkit.
- The UX the owner wants depends on the web platform's strengths. It is dense, keyboard-first and accessible, with text-heavy layouts, fine motion control and mature component libraries.
- The ecosystem is the largest available for testing (Playwright), accessibility tooling and hiring help later.
- Electron gives full control of the local machine, which the pipeline, the database and Gmail OAuth need.

## Alternatives considered

- **Tauri with React:** a smaller install and memory footprint. But the backend is Rust, so the main-process work (database, sync, process supervision) would be Rust, a second new language. Revisit if memory use becomes a real problem.
- **Stay on Flutter and fix the frame:** the cheapest path to less lag, but it doesn't bring the prototype's design over, and the owner chose to rebuild.
- **A web app only:** the pipeline, the local database and the Gemini bridge need the local machine.

## Consequences

- Install size is about 100 MB or more; memory use is higher than Flutter's. This is acceptable for a desktop tool on team machines.
- Security needs care in Electron (renderer isolation, IPC validation). It is built into step 3b.
