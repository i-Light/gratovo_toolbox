# 0009. How the app shell is built

- **Date:** 2026-10-19
- **Status:** accepted for 3c-1 (the frame) and 3c-2 (the overlays); 3c-3 (settings) adds to it

## Context

Step 3c ports the prototype's frame into the real app: the rail, the top bar, the bars, the keyboard system, the store with undo, and later the overlays and the settings shell. The prototype is the spec ([migration-plan.md](../migration-plan.md), ground rule 2), but its code is plain ES5 on a global `W` with no build, so the behaviour is ported, not the structure. Three things shaped the choices: the target is one browser engine (Electron's Chromium, on Windows only); the plan's speed rules say the frame must not re-render on every change, and the prototype's frame does; and the [architecture](../architecture.md#ui) asked step 3c to pick a library of accessible primitives.

## Decision

1. **No UI primitives library.** Radix, React Aria and base-ui were weighed for menus, dialogs and popovers, cmdk for the palette, and Sonner for toasts. The prototype's key stack is the spec: popups are barriers, and Esc closes the newest layer first. Each of those libraries handles Escape and outside clicks itself, so a key would close two layers or the wrong one. The components are ported from the prototype with its roles. Modal layers (3c-2) use the native `<dialog>`, which in Chromium gives focus containment and an inert background without a library.
2. **The store is built on immer**, in `packages/core`. Business data (undoable) and UI state (not undoable) are kept apart, as in the prototype's `W.act`, `W.ui` and `W.bg`. State is immutable, so an undo step keeps the previous data object instead of a deep copy of it, which is what the prototype does on every action. Changes are written as recipes that edit a draft, so screen code ports almost line for line. Immer's patches leave a way open for step 3d to turn actions into database writes.
3. **Components read slices.** `useApp(selector)` re-renders a component only when the value it selected changes. The frame no longer re-renders as a whole on every change.
4. **Global CSS with the prototype's class names**, split into files that follow its sections: shared rules in `packages/ui` (`base.css`, `controls.css`, `motion.css`), frame rules in `apps/desktop/src/renderer/app/frame.css`. A test compares every ported rule with the prototype's, as `tokens.test.ts` already does for the tokens.
5. **Fonts are local files** from the Fontsource packages (Readex Pro variable, IBM Plex Mono 400, 500 and 600), in the latin and latin-ext subsets. Our own `@font-face` rules keep the family names the tokens use. The CSP allows fonts from the app only.
6. **Routes live in the URL hash** (`#/find/triage`), written with `history.replaceState`. A `pushState` path isn't a file under `app://`, so a reload there would fail (ADR 0008). Back and forward use the app's own history list, capped at 100 entries.
7. **Device preferences** (theme, density, text size, motion, single-letter keys, collapsed rail) sit in one `localStorage` key, checked with zod when read, and are applied to `<html>` before the first render.
8. **Key rules are kept from the prototype.** Plain keys never fire while you type in a field. Turning single-letter keys off turns off every one-character key (`?`, `[`, `/`, `G` too). Esc, arrows, Enter, Ctrl and Alt keys still work. Additions for keyboard and screen-reader users: Esc closes the narrow drawer, focus moves into it and back to the Menu button, the closed drawer is inert, and collapsed rail buttons keep their names.
9. **Not ported:** the prototype's "The plan" page and its "Why is this here?" design-notes button and layer. They are review tools for the prototype, and the plan's list for 3c leaves them out. If the owner wants them in the app, they come with step 9.
10. **Example frame data until 3d.** The rail counts, the team and the notifications are a typed example constant (the prototype's numbers and people) until the data layer replaces it.

### Added in 3c-2 (the overlays)

11. **Modal layers are a native `<dialog>` opened with `showModal()`** (`overlays/modal-layer.tsx`), made invisible and full-screen, holding the prototype's own `.scrim` and `.pal` or `.modal`. The browser makes the page behind inert and keeps focus inside. The dialog's own Esc is blocked, so the key stack is the one owner of Esc. The palette focuses its input; the shortcut sheet, which you read rather than fill in, focuses the dialog itself, so no button shows a ring the user didn't ask for.
12. **Toasts, menus and the tooltip float above modals.** A modal dialog sits in the browser's top layer, above every z-index. The prototype drew these three above its dialogs, so they render into one container (`overlays/floating.tsx`) that the dialog moves inside itself while it is open. Moving it doesn't remount anything, so a toast keeps its time.
13. **Esc closes the newest layer.** Each overlay puts its own layer on the key stack while it is open: the palette, the sheet and menus as barriers (keys behind them don't fire), trays and the peek as plain layers. So a tray opened after the peek closes first. The prototype closed the peek first either way, because its tray's Esc sat in the bottom layer.
14. **Ctrl Z, Ctrl Shift Z and Ctrl Y stay out of text fields,** so a field keeps its own undo. The prototype took them everywhere.
15. **Reading one notification isn't an undoable change** (it is a background change), so undoing something older never marks it unread again. "Mark all read" is undoable and leaves no line in the activity log, as in the prototype.
16. **Records until their screens arrive (steps 4 to 9):** a few of the prototype's example creators, brands and deals (AI channels and AI brands) give the palette its records and the peek and record page something true to show. Both show a short summary and say the full record comes with its screen.
17. **The record page is a screen, `record`,** with the record and the screen it came from on the route. The rail marks that screen, and the crumbs name it. Like the prototype, a reload doesn't bring it back; it opens Today.
18. **Left out of the palette until their features exist:** Start focus, Wrap up the day, Resume today's search (steps 4 and 5) and the Settings rows (3c-3). Show the design notes is not ported (decision 9).
19. **Menus, the palette and dialogs give focus back** to what had it when they opened. The prototype didn't.
20. **Three fixes to the prototype's CSS,** each listed with its reason in `overlays-css.test.ts`: the palette's 52 px search row no longer shrinks while the list is long (the input jumped as you typed); menus sit above the narrow-width drawer (the account menu, opened from the drawer, showed under it); the invisible dialog wrapper shows no focus ring.

## Alternatives considered

- **zustand for the store:** its selector hooks are what decision 3 needs, but the undo, redo and background-job rules are the hard part and are ours either way. A small store on `useSyncExternalStore` covers it with no dependency beyond immer.
- **CSS modules:** scoped class names would make the port harder to compare with the prototype, and the screens share many classes (`.btn`, `.card`, `.li`).
- **Copying the font files into the repository:** the Fontsource packages are versioned and Dependabot keeps them current.

## Consequences

- A change to the prototype's CSS, icons or tokens fails a test until the port follows it.
- Each overlay registers its keys on the shared stack, and the Playwright tests check the Esc order and the barriers.
- The shortcut sheet lists the prototype's keys for Today and for reviewing finds. They start working when those screens arrive (steps 4 and 5).
- A new overlay that must show above a modal renders through `Floating`; one that should sit under modals (trays, the peek) doesn't.
- Step 3d decides how a store action reaches the `DataSource` (for example, immer patches turned into row writes) and how undo works for data that lives in SQLite.
