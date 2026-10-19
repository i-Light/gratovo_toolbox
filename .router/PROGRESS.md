# Progress: step 3c (the app shell)

Started 2026-10-19, after #5 (the owner's answers) merged. `CONTEXT.md` is the scout's read of the prototype's frame, runtime, settings shell, CSS and tests; read it before planning.

## Done

- Recon: `.router/CONTEXT.md` (366 lines). Its section 9 lists points to settle in the plan.

## Next

1. Write `.router/PLAN.md` (goal, decisions, contracts, tasks with tiers and done-checks), then build.

## Leanings so far (confirm in PLAN.md)

- **Split 3c into a few pull requests** so each stays reviewable, for example: (a) fonts, icons, base CSS, frame layout (rail, top bar, content), hash routing; (b) key stack, palette, shortcut sheet, menus, tooltips; (c) store with undo, toasts, peek, problems bar, jobs, save state; (d) settings shell and account menu.
- **Fonts** as local files, latin only: `@fontsource-variable/readex-pro` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0 (400, 500, 600). The CSP allows `font-src 'self'` only.
- **Component tests:** `@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.8, `happy-dom` 21.0.3.
- **Routing:** hash routes (`#/today`); see ADR 0008. Back and forward as in the prototype's history.
- **Store:** small custom store on `useSyncExternalStore`; the pure parts (undo snapshots, key stack with barriers) in `packages/core` with unit tests. Components subscribe to slices, so the frame doesn't re-render on every change (the prototype's App does; the plan's speed rules forbid it).
- **Frame data** (rail counts, problems, jobs, save state, account name) from a typed example provider until 3d's DataSource replaces it.
- **Looking at it:** build the renderer and open it in the container's Chromium with a stubbed `window.gratovo`, next to the prototype, in light and dark at 1440 px and 400 px. The Electron tests run on Windows CI.
