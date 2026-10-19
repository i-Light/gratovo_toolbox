> Build notes from 2026-10-19, kept for history. They were written when the prototype lived in a scratch folder named `wb/`; that folder is now `design/workbench-prototype/`, and `../shots_wb/` means any folder you choose for screenshots. The current state is in [../README.md](../README.md) and [docs/handoff.md](../../../docs/handoff.md).

# Workbench prototype — context for builders

Root: this folder (`wb/`). A clickable UX prototype of an influencer-marketing agency app ("Gratovo Workbench"). Example data only. No build step.

## Stack
- React 18 UMD + htm (`W.html`) loaded by `index.html`; plain ES5-style JS files, each an IIFE that attaches to the global `W`.
- Load order (index.html): core → data → engine → ui → records → today → find → reach → close → deliver → more → plan → app.
- `W.html` is htm bound to a React `h` that maps `class`→`className` and `for`→`htmlFor`. Write `class=`. Components: `html\`<${W.Btn} kind="pri">Go</${W.Btn}>\``. Lists need `key=`.
- Hooks: `W.useState`, `W.useEffect`, `W.useRef`, `W.useLayoutEffect`, `W.Fragment`. **Call hooks unconditionally, before any early return.**

## Commands
- Syntax: `node --check js/<file>.js`
- Smoke (loads page, visits each tab of the screens, prints console errors): `python test/smoke.py <screen> [--shots ../shots_wb/<screen>]` (run from `wb/`). Screenshots are 1440×900. Add `--dark` for the dark theme, `--wide 400` for phone width.

## Files (read, don't edit unless you own them)
- `index.html` — all CSS (tokens + components). Read it to learn the classes. Do NOT edit; add screen-specific CSS with `W.css(\`...\`)` at the top of your own file, using the tokens only (`var(--panel)`, `var(--line)`, `var(--find)` …), never literal colours except inside drawn thumbnails.
- `js/core.js` — store, undo, navigation, keyboard, toasts, menus, helpers (`W.fmtK`, `W.money`, `W.fmtDate`, `W.fmtDay`, `W.dueText`, `W.ago`, `W.dur`, `W.plural`, `W.cx`, `W.by`, `W.sum`, `W.clamp`, `W.hash`), icons (`W.Icon n="name"`; names in `W.ICONS`).
- `js/data.js` — example data and constants (`W.DEAL_FLOW`, `W.CREATOR_STEPS`, `W.STAGE_INDEX`, `W.STAGE_LABEL`, `W.BRAND_STEPS`, `W.REJECT_REASONS`, `W.COUNTRY`).
- `js/engine.js` — lookups, scoring (`W.fit`, `W.gold`, `W.audience`, `W.match`, `W.priceFor`, `W.bestBrandFor`), `W.nextFor(ref)`, `W.items(scope)` (Today queue), `W.phaseCounts`, and every action `W.A.*`.
- `js/ui.js` — primitives: `Btn, IconBtn, Kbd, Tag, Av, CAv, BAv, Due, Meter, Steps, Tabs, Seg, Empty, Callout, Field, Stat, PageHead, Section, Countries, Fit, FitParts, Thumb, Vid, Owner, Timeline` and menu item builders `W.snoozeItems`, `W.handItems`, `W.eventsFor`.
- `js/records.js` — shared work surfaces: `DraftCard, Thread, AiRead, ContactBlock, AudienceCheck, DealSteps, DealChecklist, NextDeal, Money, Ladder, TriageCard, Triage, Qualify, PitchPicker, NextCard, Record`.
- `js/today.js` — the reference screen. Copy its patterns (PageHead, cards, lists, keyboard, empty states).
- `js/app.js` — shell; `W.SCREENS` (names, icons, hues, tabs per screen), peek panel, palette, menus, toasts.

## Conventions
- Screens register `W.screens.<name> = function(){ var st = W.useApp(); ... return html\`<div class="page">…</div>\`; }`. Read data with `W.D()` / `st.data`, UI state with `W.U()` / `st.ui`.
- Current tab: `W.U().route.tab`; switch with `W.setTab(k)`; navigate with `W.go(screen, tab, extra)`.
- Change business data ONLY through `W.act(label, fn, {ref, toast})` (undoable, logged, gives feedback) or existing `W.A.*`. Screen-only state (filters, selection, open panels) goes through `W.ui(fn)` under a namespace for your screen, e.g. `W.U().find`. Initialise it lazily.
- Open a record beside the list: `W.peek("creator"|"brand"|"deal", id, idsInOrder)`.
- Every list row/card that represents a record opens the peek on click. Every action gives feedback (toast with what happened, where it went, Undo).
- Words: plain English, active voice, controls name their action. No emoji. No eyebrow/kicker labels above headings. No colored side-borders on cards. Elevation is either a border or a shadow, not both.
- Motion: no animation on keyboard-triggered changes; 150–250 ms ease-out for the rest; nothing scales from 0.
- Phone width (400px) must not scroll sideways: wrap rows, `min-width:0` on flex/grid children, tables inside `.tw` (scrolls).

