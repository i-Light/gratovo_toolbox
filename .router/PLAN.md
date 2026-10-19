# Plan: step 3c (the app shell), first pull request "3c-1: the frame"

Read `.router/CONTEXT.md` first: it is the map of the prototype (file and line numbers). The prototype in `design/workbench-prototype/` is the spec; when this plan and the prototype disagree on look or behaviour, the prototype wins unless a decision below says otherwise.

## Split

Step 3c ships as three pull requests, each green on its own:

| PR | Holds |
|---|---|
| **3c-1 the frame** (this plan) | Runtime in `packages/core` (store with undo, navigation history, key stack). `packages/ui`: fonts, icons, base and control CSS, the first components. The frame: rail, top bar, problems bar, content placeholder, narrow drawer, hash routes, device preferences, global keys (back, forward, `[`, `G` then a letter, `Ctrl ,`). |
| 3c-2 overlays | Command palette, shortcut sheet, menus (account menu), tooltips, trays (jobs, notifications), peek, toasts with Undo and Redo, save state, job ticks. Playwright: palette, peek, undo, menus, Esc order, key barriers, no animation after keys. |
| 3c-3 settings and checks | Settings shell (sections, search, appearance and keyboard rows working), screenshot comparison with the prototype, accessibility checks (axe), ADR 0009 final, hand-off, plan status "3c done". |

## Goal of 3c-1

The app opens on the real frame instead of a blank page: the rail with the example counts, the top bar, the content area showing "still being built" for each screen, working navigation by mouse and keyboard, routes in the URL hash, and light and dark themes, at 1440 px and 400 px.

### Non-goals (later PRs or steps)

Palette, menus, tooltips, trays, peek, toasts, undo toasts (3c-2). Settings content (3c-3). Real screens (steps 4 to 9). The Today engine (step 4). The data layer (3d). Prototype controls, view-as bar, comment layer (3f). The window and installer icon (3h). Not ported at all: the prototype's "The plan" rail item and the "Why is this here?" design-notes button and layer (review tools for the prototype; the plan's 3c list leaves them out; ADR 0009 records it).

### Acceptance for 3c-1

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; Windows CI (lint, typecheck, unit, e2e) passes.
2. Unit tests cover the store (act, ui, bg, undo, redo, limits, no-op), history (push, dedupe, truncate, cap, back, forward) and the key stack (names, typing rule, letters off, barriers, fall-through, order, go-prefix).
3. Every ported CSS rule matches the prototype's rule with the same selector (a test like `tokens.test.ts`), except deviations listed in the test with a reason. The icon set matches the prototype's `core.js` (a test).
4. Readex Pro and IBM Plex Mono load from the app's own files (e2e: `document.fonts` reports them loaded), with no network.
5. Component tests (Vitest + happy-dom): rail (counts, current item, click navigates, remembers the last tab per screen), top bar (back and forward enabled only when possible, crumbs), keys (Alt+Left and Alt+Right, `G` then a letter, `[`, `Ctrl ,`, plain keys ignored while typing, all single-character keys ignored when letters are off), hash (boot from hash, hash follows the route, bad hash falls back to Today).
6. Playwright on Windows: the frame opens on Today with `#/today`; rail click, back and forward, `G` then `R`, `Ctrl ,`; `[` collapses the rail and it stays collapsed after a reload; at 400 px the menu button opens the drawer and Esc closes it; right after a key press `<html>` has `data-input="kbd"` (no animation).
7. Looked at in the container's Chromium next to the prototype's screenshots (`scratchpad/ref/proto-*.png`), light and dark, 1440 and 400 px: same layout, type, colours, spacing for the rail and top bar.

## Decisions

- **D1. No UI primitives library** (Radix, React Aria, base-ui, cmdk, Sonner, zustand were weighed). The key stack with barriers is the spec, and each library brings its own Escape and outside-click handling that would fight its order. The target is Chromium alone, so native `<dialog>` (3c-2) gives focus containment and an inert background. Components are ported from the prototype, with ARIA roles as the prototype has them.
- **D2. Store on immer** (`immer` 11.1.21, in `packages/core`). State is immutable; an undo step keeps the previous data object (structural sharing, so no deep clone per action, unlike the prototype). Recipes mutate a draft, so screen code ports almost line for line from the prototype. Immer's patches leave a path open for 3d to turn actions into row writes.
- **D3. Slice subscriptions.** Components read the store through `useApp(selector)`. Selectors return primitives or objects already in the state; a derived array or object is memoized on its inputs (`memo` in `lib/store.ts`). The frame never re-renders as a whole on a change (the prototype's App does; the speed rules forbid it).
- **D4. Global CSS with the prototype's class names**, in files that mirror its sections. Shared rules in `packages/ui/src/*.css`, frame rules in `apps/desktop/src/renderer/app/frame.css`. A parity test compares each ported rule with the prototype's.
- **D5. Fonts** from `@fontsource-variable/readex-pro` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0 (400, 500, 600), latin and latin-ext only, through our own `@font-face` rules named "Readex Pro" and "IBM Plex Mono" so the tokens stay as in the prototype. Vite resolves `url("@fontsource-variable/readex-pro/files/....woff2")` and emits the files (checked).
- **D6. Hash routes** `#/screen` or `#/screen/tab`, written with `history.replaceState` on every route change and read once at boot. Back and forward use the app's own history list (cap 100), as the prototype does.
- **D7. Device preferences** (theme, density, text size, motion, single-letter keys, collapsed rail) in one localStorage key, `gratovo.prefs`, checked with zod on read (bad or missing values fall back to defaults), applied as `data-*` on `<html>` before the first render.
- **D8. Example frame data** (team, counts, notifications) is a typed constant until 3d's DataSource: the counts are the prototype's (Today 28, 1 h 30 min planned, Find 15, Reach 10, Close 6, Deliver 7), the team and notifications are the prototype's `data.js` ones. Problems are a selector that returns none until features add them.
- **D9. Key rules kept from the prototype:** plain keys never fire while typing (fields own arrows and Enter); "letters off" also blocks `?`, `[`, `/` and `G` (every single-character key); Esc, arrows, Enter and Ctrl or Alt keys still work. New: Esc closes the narrow drawer (the prototype has no way but the scrim).
- **D10. Strings:** every word the user sees is in `apps/desktop/src/renderer/strings.ts`. `packages/ui` components take their words as props.
- **D11. Tests:** core logic in Vitest (node). Renderer and `packages/ui` components in Vitest with happy-dom (`// @vitest-environment happy-dom` at the top of the file) and Testing Library. Electron behaviour in Playwright on Windows CI.

## Contracts

### `packages/core/src/store.ts`

```ts
import type { Draft } from "immer";

export interface UndoStep<D> {
  /** A number that grows with each recorded change, so a toast can tell whether its change is still the newest. */
  readonly id: number;
  /** What the change did, in the words a toast and the activity log show. */
  readonly label: string;
  /** The data as it was before the change. */
  readonly data: D;
  readonly at: number;
}

export interface StoreState<D, U> {
  readonly data: D; // the business: undoable
  readonly ui: U; // where you are: not undoable
}

export interface StoreOptions<D, U> {
  readonly data: D;
  readonly ui: U;
  readonly undoLimit?: number; // default 80; the oldest step drops off
  readonly now?: () => number; // default Date.now
}

export interface Store<D, U> {
  getState(): StoreState<D, U>;
  /** Listeners run after every committed change, in the order they subscribed. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Changes the data and records one undo step. Returns the recipe's result, or false when the recipe
   * returned false: then nothing changes and nothing is recorded (its draft edits are dropped).
   * A recipe that changes nothing records nothing and notifies nobody, but still returns its result.
   * Recording clears the redo list.
   */
  act<R>(label: string, recipe: (data: Draft<D>, ui: U) => R): R | false;
  /** Changes UI state only; never recorded. No change, no notification. */
  ui(recipe: (ui: Draft<U>, data: D) => void): void;
  /**
   * For background jobs: applies the recipe to the current data AND to the data in every undo and
   * redo step, so undoing an older change never removes what a job produced since.
   */
  bg(recipe: (data: Draft<D>) => void): void;
  /** Steps back one change. Returns the step undone (its label is for the toast), or undefined if there is none. */
  undo(): UndoStep<D> | undefined;
  /** Steps forward again. Returns the step redone, or undefined. */
  redo(): UndoStep<D> | undefined;
  /** The newest step Undo would take back, or undefined. */
  peekUndo(): UndoStep<D> | undefined;
  canRedo(): boolean;
}

export function createStore<D, U>(options: StoreOptions<D, U>): Store<D, U>;
```

Undo pushes `{ id, label, data: current, at: now() }` of the undone step onto redo and restores `step.data`; redo mirrors it. Ids are kept through undo and redo. Uses immer `produce`; auto-freeze stays on.

### `packages/core/src/history.ts`

```ts
export interface History<R> {
  readonly entries: readonly R[]; // never empty
  readonly index: number;
}
export const historyLimit = 100;
export function startHistory<R>(route: R): History<R>;
export function currentRoute<R>(history: History<R>): R;
/** Same object back when `same(current, route)`; otherwise drops forward entries, appends, and drops the oldest past the limit. */
export function pushRoute<R>(history: History<R>, route: R, same: (a: R, b: R) => boolean, limit?: number): History<R>;
export function stepBack<R>(history: History<R>): History<R>; // same object at the start
export function stepForward<R>(history: History<R>): History<R>; // same object at the end
export function canGoBack(history: History<unknown>): boolean;
export function canGoForward(history: History<unknown>): boolean;
```

### `packages/core/src/keys.ts`

```ts
/** The parts of a keyboard event the key system reads. A DOM KeyboardEvent has them all. */
export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * "mod+k", "alt+arrowleft", "escape", "?", "[", "space", "shift+tab". Lower case. "mod" is Ctrl or
 * Meta. Shift is named only for keys longer than one character, so Shift+/ is "?" and Shift+G is "g".
 */
export function keyName(input: KeyInput): string;

/** Return false to let the key fall through to the layer below. */
export type KeyHandler<E extends KeyInput = KeyInput> = (input: E) => boolean | void;
export type KeyMap<E extends KeyInput = KeyInput> = Readonly<Record<string, KeyHandler<E>>>;
export interface KeyLayer<E extends KeyInput = KeyInput> {
  /** Read at dispatch time, so a layer always runs its newest handlers. */
  readonly keys: () => KeyMap<E>;
  /** A barrier (a dialog, a menu) stops keys it doesn't handle from reaching the layers below it. */
  readonly barrier: boolean;
}
export interface KeyContext {
  readonly typing: boolean; // the key was pressed in a text field, select or editable element
  readonly lettersOff: boolean; // Settings > Keyboard turned single-character keys off
}
export interface KeyStack<E extends KeyInput = KeyInput> {
  /** Adds a layer on top. Returns a function that removes exactly that layer. */
  push(layer: KeyLayer<E>): () => void;
  hasBarrier(): boolean;
  /**
   * Runs the newest layer's handler for the key. True when a handler took it (the caller then prevents
   * the default and quiets animation). False, and nothing runs, when: the event was already handled
   * (defaultPrevented); it is a plain key (no mod or alt; not escape; not F1 to F24) while typing; or
   * letters are off and the name is one character. Walks layers newest first; a handler that returns
   * false falls through; a barrier layer that didn't take the key stops the walk. Map lookups use
   * own properties only (Object.hasOwn).
   */
  dispatch(input: E, context: KeyContext): boolean;
}
export function createKeyStack<E extends KeyInput = KeyInput>(): KeyStack<E>;

/** "G then a letter": the G handler arms it; the next key within the timeout is the letter. */
export interface GoPrefix {
  arm(now: number): void;
  /**
   * When armed, within the timeout, and no Ctrl, Meta or Alt is held: disarms and returns the key in
   * lower case (the caller looks it up and, if it's not a screen letter, dispatches the key as usual).
   * Otherwise returns undefined and leaves the state as it was (an expired arm is cleared).
   */
  take(input: KeyInput, now: number): string | undefined;
}
export function createGoPrefix(timeoutMs?: number): GoPrefix; // default 1200
```

The caller skips `take` while typing, while letters are off, or while a barrier is open (as the prototype's `onKey` does).

`packages/core/src/index.ts` re-exports all three modules (and `deal-flow`).

### `packages/ui`

- `package.json` exports: `"."` → `./src/index.ts`; `./tokens.css`, `./fonts.css`, `./base.css`, `./controls.css`, `./motion.css` → `./src/<name>`; `./testing/prototype-styles` → `./src/testing/prototype-styles.ts`.
- `tsconfig.json` (references only) → `tsconfig.lib.json` (lib ES2025 + DOM + DOM.Iterable, `jsx: react-jsx`, no node types, `src/**/*.ts(x)` minus tests and `src/testing/`) and `tsconfig.test.json` (node types + DOM, tests and `src/testing/`).
- `src/icons.ts`: `export const icons = {...} as const` (every entry of the prototype's `W.ICONS`, same order and strings); `export type IconName = keyof typeof icons`.
- `src/icon.tsx`: `Icon({ name, size = 16, className, title }: IconProps)`: `<svg class="ic …" viewBox="0 0 24 24" width height aria-hidden="true">`, or `role="img"` plus `<title>` when `title` is given; `"c:x,y,r"` draws a circle, `"r:x,y,w,h,rx"` a rect, anything else a path; an unknown name can't type-check.
- `src/cx.ts`: `cx(...parts: (string | false | null | undefined)[]): string` (the prototype's `W.cx`).
- `src/avatar.ts`: `hash(text)` (FNV-1a, as `W.hash`), `initials(name)` (as `W.initials`), `avatarColor(seed)` (as `W.avColor`, same ten colours).
- Components (`src/*.tsx`), each a port of `js/ui.js`, words as props:
  - `Btn({ kind?: "pri" | "ghost" | …, size?: "sm", icon?, iconClassName?, kbd?, tip?, label?, disabled?, onClick, children })`.
  - `IconBtn({ icon, label, kbd?, pressed?, badge?, disabled?, size?, className?, iconClassName?, onClick })`: `aria-label` and `data-tip` = label, `data-kbd` = kbd, `aria-pressed` only when `pressed` is given.
  - `Kbd({ children })`.
  - `Avatar({ name, color, size?: "s" | "l" | "xl", status?: "online" | "away", tip?, unnamed?, photo? })`: initials, or the user icon when `unnamed`, or the photo.
  - `Empty({ icon?, title, children?, action? })`, `PageHead({ title, sub?, hue?, right? })`.
- `src/index.ts` exports all of the above.
- CSS files, ported rule for rule from `index.html` (selectors exactly as the prototype writes them):
  - `fonts.css`: D5.
  - `base.css`: l.50-83 (reset, type, focus, selection, scrollbars, utilities, `.ic`) and `#root{height:100%}` (l.86).
  - `controls.css`: l.139-210 (buttons to callout), l.211-219 (`.li`), l.123-127 (`.iconbtn`), l.508 (`.av img`), l.512 (`.linkbtn`).
  - `motion.css`: l.478-496 (keyframes; `.pal{--tx:-50%}` waits for 3c-2).
- `src/testing/prototype-styles.ts`: `declarationsByRule`, `normalizeValue`, `normalizeSelector`, `prototypeStyles()` moved out of `tokens.test.ts` (which imports them), plus `expectRulesMatchPrototype(cssFile: URL, deviations: Record<string, string>)` that fails for any rule in the file whose selector the prototype lacks or whose declarations differ, unless the rule is in `deviations` (selector → reason).

### Renderer (`apps/desktop/src/renderer/`)

```
main.tsx            imports tokens, fonts, base, controls, motion, frame CSS; applies prefs; mounts <App/>
strings.ts          every user-facing word (shape below)
lib/routes.ts       screens, routes, hash
lib/prefs.ts        device preferences
lib/store.ts        the app store, its types, example data, useApp, memo
lib/keys.ts         the key stack instance, useKeys, quietAnimations, isTyping
app/app.tsx         <App/>: the frame and the document key listener
app/rail.tsx, app/top-bar.tsx, app/problems-bar.tsx, app/placeholder-screen.tsx, app/global-keys.ts
app/frame.css       l.85-138 frame, l.497-520 rail foot and bars, l.614-628 small screens (rules for 3c-2 and 3f parts wait)
```

`lib/routes.ts`:

```ts
export type ScreenKey = "today" | "find" | "reach" | "close" | "deliver" | "insights" | "toolbox" | "team" | "settings";
export interface Route { readonly screen: ScreenKey; readonly tab: string | null }
export interface ScreenInfo {
  readonly name: string;
  readonly sub: string | null;
  readonly icon: IconName;
  readonly hue: string; // a CSS value, e.g. "var(--find)"
  readonly tabs: readonly { readonly key: string; readonly name: string }[]; // empty when none
}
export const screens: Readonly<Record<ScreenKey, ScreenInfo>>; // names and tabs from strings.ts, icons and hues as the prototype's SCREENS
export const screenOrder: readonly ScreenKey[];
export const goLetters: Readonly<Record<string, ScreenKey>>; // t f r c d i x m s (no p: The plan isn't ported)
export function firstTab(screen: ScreenKey): string | null;
export function sameRoute(a: Route, b: Route): boolean;
export function routeToHash(route: Route): string; // "#/today", "#/find/triage"
export function routeFromHash(hash: string): Route; // unknown screen or tab → { today, null } / first tab
```

Settings tabs, until 3c-3 builds the sections: profile Profile, appearance Appearance, day Your day, keyboard Keyboard, notifications Notifications, search Search rules, facts Agency facts, writing Writing rules, team Team and money, connections Connections.

`lib/prefs.ts`:

```ts
export interface Prefs {
  readonly theme: "" | "light" | "dark"; // "" follows the system
  readonly density: "" | "compact";
  readonly size: "" | "large";
  readonly motion: "" | "reduce";
  readonly letters: "" | "off";
  readonly rail: "" | "min";
}
export const prefsKey = "gratovo.prefs";
export function readPrefs(storage: Pick<Storage, "getItem"> | null): Prefs; // zod; any problem → defaults for the bad fields
export function applyPrefs(prefs: Prefs, root: HTMLElement): void; // data-theme, data-density, data-size, data-motion; removed when ""
export function getPrefs(): Prefs;
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void; // saves (storage errors ignored), applies, notifies
export function usePref<K extends keyof Prefs>(key: K): Prefs[K]; // useSyncExternalStore
export function initPrefs(): void; // read from localStorage and apply; called once in main.tsx before render
```

`lib/store.ts`:

```ts
export interface Member { readonly id: string; readonly name: string; readonly role: string; readonly status: "online" | "away"; readonly doing: string }
export interface Notification {
  readonly id: string; readonly at: number; readonly icon: IconName; readonly text: string; readonly sub: string;
  readonly go: Route; readonly read: boolean;
}
export interface RailCounts { readonly today: number; readonly plannedMinutes: number; readonly find: number; readonly reach: number; readonly close: number; readonly deliver: number }
export interface LogEntry { readonly id: string; readonly at: number; readonly who: string; readonly text: string }
export interface AppData {
  readonly me: string; // a member id
  readonly myName: string | null; // null until set in Settings > Profile ("Add your name")
  readonly team: readonly Member[];
  readonly counts: RailCounts; // until the Today engine (step 4) computes them
  readonly notifications: readonly Notification[];
  readonly log: readonly LogEntry[];
}
export interface Problem { readonly key: string; readonly text: string; readonly sub: string; readonly action?: { readonly label: string; readonly run: () => void } }
export interface AppUi {
  readonly history: History<Route>;
  readonly railOpen: boolean; // the drawer at narrow widths
  readonly saving: boolean;
  readonly savedAt: number;
  readonly lastTab: Readonly<Partial<Record<ScreenKey, string>>>;
}
export function exampleData(now: number): AppData; // the prototype's team (u1 "You" Owner, u2 Sara, u3 Omar, u4 Lina away) and six notifications (times relative to now), counts from D8, empty log
export function createAppStore(start: Route, now?: number): Store<AppData, AppUi>;
export const appStore: Store<AppData, AppUi>; // created when the module loads, starting from location.hash
export function useApp<T>(selector: (state: StoreState<AppData, AppUi>) => T): T;
export function memo<A, T>(compute: (input: A) => T): (input: A) => T; // recomputes only when the input reference changes
export const selectRoute: (state) => Route;
export const selectProblems: (state) => readonly Problem[]; // [] (one shared empty array) until features add problems
export function go(screen: ScreenKey, tab?: string | null): void; // tab defaults to lastTab[screen] or the first tab; pushes history; closes the drawer; scrolls .content to the top
export function back(): void;
export function forward(): void;
```

`appStore` is created when the module loads, from `location.hash`; tests use `createAppStore` with their own route, or reset by a `resetAppStore(route)` helper exported for tests only (name it `resetAppStoreForTests`).

`lib/keys.ts`:

```ts
export const keyStack: KeyStack<KeyboardEvent>;
export function useKeys(keys: KeyMap<KeyboardEvent>, options?: { readonly active?: boolean; readonly barrier?: boolean }): void; // pushes a layer while active; the layer reads the newest map
export function isTyping(target: EventTarget | null): boolean; // INPUT, TEXTAREA, SELECT, contentEditable
export function quietAnimations(): void; // <html data-input="kbd"> for 400 ms (restarts the timer)
```

`app/global-keys.ts`: `useGlobalKeys()` (the bottom layer: `alt+arrowleft` back, `alt+arrowright` forward, `[` toggles the rail pref, `mod+,` settings (the current tab if already on Settings, else profile), `g` arms the go-prefix) and `useKeyListener()` (one `keydown` listener on `document`: go-prefix first, as the prototype's `onKey`; then `keyStack.dispatch`; when it returns true, `preventDefault()` and `quietAnimations()`).

`strings.ts` shape (add keys, never inline words):

```ts
export const strings = {
  appName: "Gratovo Toolbox",
  brand: { name: "Gratovo", sub: "Workbench" },
  rail: { label: "Main", pipeline: "Pipeline", workbench: "Workbench", planned: (time: string) => `${time} planned`, allClear: "All clear",
          collapse: "Collapse the sidebar", expand: "Expand the sidebar", collapseTip: "Collapse", expandTip: "Expand",
          account: (name: string) => `Your account: ${name}`, addName: "Add your name", online: "online" },
  top: { menu: "Menu", back: "Back", forward: "Forward", crumbs: "You are here", search: "Search or run a command",
         jobs: "Background jobs", jobsNone: "Background jobs: none running", notifications: "Notifications",
         saved: "Saved", saving: "Saving…", savedTip: (ago: string) => `Saved on this computer and synced ${ago}`, savingTip: "Saving to this computer, then syncing to the team" },
  keys: { ctrlK: "Ctrl K", altLeft: "Alt ←", altRight: "Alt →", rail: "[" },
  placeholder: { title: (name: string) => `${name} is still being built`, body: "This screen arrives in a later build step." },
  screens: { today: { name: "Today", sub: null, tabs: {} }, find: { name: "Find", sub: "Search, triage, contacts", tabs: { search: "Search", … } }, … },
  time: { … } // for `ago` and `duration` below
};
```

Time words: port `W.dur(min)` ("1 h 30 min", "45 min") and `W.ago(ts)` ("just now", "n min ago", "n h ago", "yesterday", "n days ago") into `lib/format.ts`, taking their words from `strings.time`.

## Contract changes made while building (these win over the text above)

- `lib/store.ts`: `appStore()` is a function (the current store), and `resetAppStoreForTests(start, now?)` replaces it in tests; the app makes its store once, when the module loads, from the URL hash. `installHashSync()` lives there too. Example data is in `lib/example-data.ts`.
- `strings.rail.online` became `roleOnline(role)`; `memberTip(name, role)` was added.
- `lib/media.ts`: `useNarrow()` (the 760 px query). The narrow drawer is inert while closed, closes when the window widens, takes focus when it opens and gives it back to the Menu button (`aria-expanded`, `aria-controls`).
- `packages/ui`: the Avatar component lives in `avatar-view.tsx` (`avatar.ts` holds the helpers) and has `role="img"`.

## Tasks

| id | title | tier | depends_on | files |
|---|---|---|---|---|
| T0 | Dependencies (done by the lead) | — | — | package.json files, pnpm-lock.yaml |
| T1 | Core runtime: store, history, keys, with tests | N | T0 | `packages/core/src/{store,history,keys}.ts`, their `.test.ts`, `index.ts` |
| T2 | `packages/ui` setup, icons, helpers, components, tests | N | T0 | `packages/ui/{package.json,tsconfig*.json}`, `src/{icons.ts,icon.tsx,cx.ts,avatar.ts,btn.tsx,icon-btn.tsx,kbd.tsx,avatar.tsx,empty.tsx,page-head.tsx,index.ts}`, tests; root `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs` (globs only) |
| T3 | Shared CSS and the parity test | N | T0 | `packages/ui/src/{fonts,base,controls,motion}.css`, `src/testing/prototype-styles.ts`, `src/tokens.test.ts`, `src/styles.test.ts` |
| T4 | Renderer lib: routes, prefs, store, keys, format, strings | N | T1, T2 | `apps/desktop/src/renderer/{strings.ts,lib/*}`, their tests, `tsconfig.web.json` |
| T5 | The frame: app, rail, top bar, problems bar, placeholder, global keys, frame CSS | N | T3, T4 | `apps/desktop/src/renderer/{main.tsx,app/*}`, delete `app.tsx` and `base.css` |
| T6 | Tests: frame component tests, e2e updates and `frame.spec.ts` | N | T5 | `apps/desktop/src/renderer/app/*.test.tsx`, `apps/desktop/e2e/*` |
| T7 | Verify, look, review, docs, PR (lead) | H | T6 | `.router/*`, `docs/*` |

Done-checks for every task: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (`source scratchpad/env.sh` first, then append `/root/.local/bin` to PATH). Each task's own check is in its prompt.
