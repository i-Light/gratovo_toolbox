# Progress: step 3c (the app shell)

Started 2026-10-19, after #5 (the owner's answers) merged. `CONTEXT.md` is the scout's read of the prototype; `PLAN.md` is the plan for the first of three pull requests (3c-1, the frame).

## Done (3c-1)

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | scout | 715814b | `.router/CONTEXT.md` |
| Plan | lead | b76cc3c | `.router/PLAN.md`, decisions D1 to D11 |
| T0 deps | lead | b76cc3c, fd07705 | immer, fonts, React for ui, Testing Library, happy-dom; `@gratovo/core` linked into the app |
| T3 shared CSS | N | 30ee2b8 | base, controls, motion, fonts; parity helper; no deviations |
| T1 core runtime | N | 8b45a45 | store, history, key stack; 69 tests |
| T2 ui package | N | 5ad34f1 | icons (checked against core.js), Icon, Btn, IconBtn, Kbd, Avatar (`avatar-view.tsx`), Empty, PageHead; lead added `role="img"` to Avatar |
| ADR 0009 | lead | c37abf3 | architecture doc points to it; versions table updated |
| T4 renderer lib | N | 7e9ac93 | routes, prefs, store (`appStore()`, `resetAppStore`, `installHashSync`), keys, format, strings |
| T5 frame | N | 65694ed | rail, top bar, problems bar, placeholder, global keys, frame.css (no deviations). Lead: removed Electron's default menu (`Menu.setApplicationMenu(null)`), F12 opens dev tools in unpackaged runs |

Looked at (lead): `scratchpad/shots/app-*.png` against `scratchpad/ref/proto-*.png`, light and dark, 1440 and 400 px. Same rail and top bar; differences are the intended ones (no "The plan", no design-notes button, placeholder content). The scripts `scratchpad/proto-ref.cjs` and `scratchpad/app-shots.cjs` aren't committed; a later session rewrites them from this description if needed.

## Next

- T6 (running): component tests and the Electron tests (`frame.spec.ts`, fixture and smoke/security updates, no-menu check).
- T7: full checks, Windows CI by workflow_dispatch, review agent, hand-off and plan status, pull request, merge.

## Notes for 3c-2

- `mod+z` is not a plain key, so the key stack runs the app's undo even inside a text field (the prototype does the same). Let fields keep their own undo: skip the app's undo and redo while typing.
- The prototype's account menu replaces the account button's interim action (it opens Settings › Profile for now).
- The `.cmdk` button, the jobs button and the bell have no action yet; the palette and trays wire them.
- The screenshot script's one console error is the browser's `/favicon.ico` 404 from its test server, not the app.
