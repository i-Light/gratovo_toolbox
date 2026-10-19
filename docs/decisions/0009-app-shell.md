# 0009. How the app shell is built

- **Date:** 2026-10-19
- **Status:** accepted for 3c-1 (the frame); 3c-2 (overlays) and 3c-3 (settings) add to it

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

## Alternatives considered

- **zustand for the store:** its selector hooks are what decision 3 needs, but the undo, redo and background-job rules are the hard part and are ours either way. A small store on `useSyncExternalStore` covers it with no dependency beyond immer.
- **CSS modules:** scoped class names would make the port harder to compare with the prototype, and the screens share many classes (`.btn`, `.card`, `.li`).
- **Copying the font files into the repository:** the Fontsource packages are versioned and Dependabot keeps them current.

## Consequences

- A change to the prototype's CSS, icons or tokens fails a test until the port follows it.
- Each overlay in 3c-2 registers its keys on the shared stack, and the Playwright tests check the Esc order and the barriers.
- Step 3d decides how a store action reaches the `DataSource` (for example, immer patches turned into row writes) and how undo works for data that lives in SQLite.
