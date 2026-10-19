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

| Task | Tier | Commit | Note |
|---|---|---|---|
| P2 overlay CSS, dialog wrapper | N | 45630aa, b62d18b | `overlays.css` rule for rule, `ModalLayer` (E1) |
| P1 state, records, actions | N | 5839b5c | routes `record`, example records, `actions.ts` |
| P3 overlays and wiring | N | (this commit) | palette, sheet, menus, tooltip, trays, peek, record page, toasts; lead review below |

Lead review of P3 (looked at `scratchpad/shots/p3/*` next to the prototype, light and dark, 1440 and 400 px):
- A modal `<dialog>` sits in the browser's top layer, so toasts, menus and the tooltip (z-index 85 to 99 in the prototype, above its scrim at 80) drew under it and were inert. New `overlays/floating.tsx`: one container they render into, which `ModalLayer` moves into the newest open dialog (no remount). Checked: a toast shown with the palette open is on top in Chromium, as in the prototype.
- The prototype's 52 px palette search row shrank while the list was long (flex column with a capped height), so the input jumped as typing shortened the list. `.pal > .pal-in { flex-shrink: 0 }`, a listed deviation.
- The prototype's menus (z-index 85) opened under the narrow drawer (86): the account menu was invisible at 400 px. `.menu[role="menu"] { z-index: 87 }`, a listed deviation.
- The sheet takes focus itself (`ModalLayer focusSelf`): with the native dialog, focus went to its Close button (a ring the prototype didn't show), or at 400 px to the scrolling panel (a ring round the whole sheet). `dialog.layer:focus-visible { outline: none }`, an E1 deviation.
- Playwright's `Shift+/` sends `/` (opens the palette, in the prototype too); a real `?` is `page.keyboard.press("?")`.

| P4 tests | N | (this commit) | component tests for every overlay (445 Vitest in all), `e2e/overlays.spec.ts` (9 Electron tests) |

Lead review of P4: Playwright's `getByText(…, { exact: true })` compares an element's whole text, children included, so "Undone" (with its sub line) never matched; toasts are now found by role and the words they contain. The Tab test now checks that focus never lands behind the palette (past its last control Chromium may leave focus on the page). Starting the app in the e2e fixture has its own 60 s limit: on main after #6, a busy runner took over 30 s to start the app (the re-run passed).

P5, lead:
- Review agent (13 findings, none critical or high), all handled:
  - Fixed: toasts kept their animation place when the floating container moves (`onFloatingMoved`; checked in Chromium: the life bar goes on at 37 %, 54 %, 68 % across the palette opening and closing, where it restarted before); Tab and Shift+Tab close a menu, whose items leave the Tab order; "Go to" rows open the first tab; each tray has its own Esc layer, so switching trays puts it on top; `go` keeps the menu and peek when the route doesn't change, and back and forward keep the peek when they can't move (as the prototype); the selected palette row scrolls into view; palette rows sit in `role="group"`s named by their headings; `Avatar decorative` where the name is written beside it; the account menu is named and its button has `aria-expanded`; the peek and trays give focus back when closed with focus inside (`lib/focus.ts`); the record summary shows its kind and unused strings are gone; the rail no longer re-renders on a theme change.
  - Recorded instead (ADR 0009, decisions 18 and 20): the empty palette's first five actions; the tooltip's warm-up counting from the last tip hiding.
- First Windows run of the overlay e2e tests (run 39321168249): 32 of 33 passed. The account menu's first item never took focus: it was focused while the menu was still `visibility: hidden` for measuring (the prototype too; happy-dom doesn't check). Now focused once the menu is placed; checked in Chromium (open, ArrowDown, Tab, Esc).

- Merged as #7 (31df1c5), every check green. The branch took `main` back in with a merge commit (no force-push).

## 3c-3 (settings and checks)

- Plan: `.router/PLAN.md` (decisions F1 to F10); recon in `.router/CONTEXT.md` §10.
- Measured before planning (axe 4.14.0 in Chromium against the built renderer, light and dark, 1440 and 400 px, frame and every overlay): WCAG failures are the light theme's `--muted` on sunk and accent-soft surfaces (3.96 to 4.26:1) and label-in-name on the account button and the bell; best-practice notes only otherwise (heading order, one region). Script: `scratchpad/axe-check.cjs`.
- `@axe-core/playwright` 4.14.0 added to the desktop app's dev dependencies (published 2026-10-15).

| Task | Tier | Commit | Note |
|---|---|---|---|
| Plan | lead | 62f6f72 | `.router/PLAN.md` (F1 to F10), recon `.router/CONTEXT.md` §10, the axe dependency |
| R1 shared pieces | N | da9ceb1 | `Seg`, `Tag`, `Switch` in `packages/ui`; `IconBtn` `tip`; `.switch` and `.bucket` in `controls.css`; `settings/settings.css` (`.set*`, `setHl`, 900 px, `.tb-ic` from more.js as a listed deviation); light `--muted` `#566678` (F7, listed in `tokens.test.ts`) |
| R2 model and data | N | 605526c (part in da9ceb1) | `lib/settings.ts` (sections with `arrives`, rows, `notifyKind`, `notifShown`, `searchSettings`), `data.settings.notify`, `ui.settingFlash` and `settingTarget`, the `name` pref, `setMyName`, `loadMyName` (in `main.tsx` and the store's creation), `setNotify`, `flashSetting`, `openSetting`; the bell and tray filter. `strings.settings` holds every word, plus option labels, On/Off, the profile hints, `rows.role.descOwner`, `agencyNote` |
| R3 settings screen | N | not yet | brief: `.router/tasks/R3.md`. Was running when the session ended; if no R3 commit is on the branch, run it again from the brief |
| R4 tests | N | not yet | brief: `.router/tasks/R4.md` (component tests, `e2e/settings.spec.ts`, `e2e/accessibility.spec.ts` with `setLegacyMode(true)`) |
| R5 lead | H | not yet | see below |

Notes for whoever continues 3c-3:
- da9ceb1 (R1) also picked up R2's `strings.ts`, `prefs.ts` and two test files: R2's agent staged them while the lead committed. That commit alone doesn't typecheck; 605526c completes it. Don't commit while a build agent is still writing files.
- The helper scripts (screenshots of app and prototype, axe in Chromium) are in `.router/scripts.md`.
- R5, the lead's part: run R3 and R4 (check each: lint, typecheck, test, build; read the code); look at every settings section and the search next to the prototype (1440 light and dark, 400 light) and the frame and overlays once more; run the axe script with the WCAG tags (expect clean in light and dark); run Windows CI by workflow_dispatch before the PR (new Electron tests often find something on their first run); a review agent on the diff `origin/main..HEAD` against PLAN.md; ADR 0009 additions for F1 to F10 (and the architecture versions table: `@axe-core/playwright` 4.14.0); the hand-off, the plan's status ("3c done") and PROGRESS in the last commit; open the PR, drive it green, squash-merge it; then restart the branch from `main` with a merge commit (no force-push).

## Notes for 3c-2

- `mod+z` is not a plain key, so the key stack runs the app's undo even inside a text field (the prototype does the same). Let fields keep their own undo: skip the app's undo and redo while typing.
- The prototype's account menu replaces the account button's interim action (it opens Settings › Profile for now).
- The `.cmdk` button, the jobs button and the bell have no action yet; the palette and trays wire them.
- The screenshot script's one console error is the browser's `/favicon.ico` 404 from its test server, not the app.
