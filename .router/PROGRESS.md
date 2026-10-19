# Progress: step 3c (the app shell)

Started 2026-10-19, after #5 (the owner's answers) merged. `CONTEXT.md` is the scout's read of the prototype. **3c-1 (the frame) merged as #6** (82d310e). `PLAN.md` now holds the plan for 3c-2 (the overlays); the 3c-1 plan is in git history (3056c06).

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

Then T6 (tests, b847b1c), the review agent's findings and the first Windows run's failures (3056c06), and #6 merged with every check green.

## 3c-2 (the overlays)

- Plan: `.router/PLAN.md` (decisions E1 to E8).
- Next: P1 and P2 in parallel; then P3, P4; then P5.

## Notes for 3c-2

- `mod+z` is not a plain key, so the key stack runs the app's undo even inside a text field (the prototype does the same). Let fields keep their own undo: skip the app's undo and redo while typing.
- The prototype's account menu replaces the account button's interim action (it opens Settings › Profile for now).
- The `.cmdk` button, the jobs button and the bell have no action yet; the palette and trays wire them.
- The screenshot script's one console error is the browser's `/favicon.ico` 404 from its test server, not the app.
