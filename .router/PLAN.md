# Plan: step 3c-2, the overlays

The second of three pull requests for step 3c (3c-1, the frame, merged as #6; its plan is in git history at 3056c06). Read `.router/CONTEXT.md` §1d to §1k first, and the prototype's `design/workbench-prototype/js/app.js` l.141-347 (trays, peek, palette, shortcuts, menu, toasts, tooltip, theme) and `js/core.js` l.85-124 and l.196-212 (act, undo, redo, toasts, menus). The prototype is the spec; where this plan and the prototype differ, a decision below says why.

## Goal

Everything that floats over the frame works as in the prototype: the command palette, the shortcut sheet, menus (the account menu), tooltips, the jobs and notifications trays, the peek panel and the full-page record, toasts with Undo and Redo, and the save state.

### Non-goals

Settings content and its palette rows (3c-3). Screens and real records (steps 4 to 9: the peek shows a short record summary until then). Focus mode, wrap-up and starting searches from the palette (steps 4 and 5). The hand-off note (step 4). Prototype mode controls and comments (3f). Background jobs that actually run (3e); the tray shows none of yours and the teammate's example run.

### Acceptance

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; Windows CI passes.
2. Every ported overlay CSS rule matches the prototype (`expectRulesMatchPrototype`), deviations listed with a reason.
3. Component tests: the actions layer (act logs, marks saving, offers Undo only while newest, undo and redo toasts, "Nothing to undo", toasts cap at 3 and auto-dismiss, pause on hover), palette (empty list order, search, max 14, arrows and Enter, mouse, Esc), shortcut sheet, menus (arrows, Esc, outside click, focus back to the trigger), trays (toggle, outside click, Mark all read), peek (open from the palette, Alt+Up and Alt+Down, Full page, Esc), tooltips (delay, warm, hide on key).
4. Playwright on Windows: palette (Ctrl K, type, Enter opens a record in the peek; `/` opens it), peek (Esc closes it), undo (Mark all read, Ctrl+Z brings the badge back with an "Undone" toast, Ctrl+Shift+Z redoes), menus (the account menu opens, Esc closes it and focus returns to the button), Esc order (palette over peek: Esc closes the palette and the peek stays; tray then peek), key barriers (with the palette or the sheet open, G then R doesn't move and Ctrl+Z doesn't undo), no animation on keyboard actions (the palette opened by Ctrl K has no animation).
5. Looked at next to the prototype, light and dark, 1440 and 400 px: palette, sheet, account menu, notifications tray, peek, a toast.

## Decisions

- **E1. Modal layers are a native `<dialog>` opened with `showModal()`**, made transparent and full-screen, holding the prototype's own `.scrim` and `.pal`/`.modal` markup. The page behind becomes inert and focus stays inside; the ported CSS stays rule for rule. The dialog's own Esc (`cancel`) is prevented: the key stack closes it, so Esc order has one owner. Focus returns to what had it before the dialog opened.
- **E2. Esc closes the most recently opened layer.** Each overlay pushes its own key layer while open: palette, sheet and menu as barriers; trays, peek and drawer as plain layers. So a tray opened after the peek closes first, and the peek opened after a tray closes first (the prototype closed the peek first in both cases, because its tray Esc sat in the bottom layer).
- **E3. App undo stays out of text fields.** Ctrl+Z and Ctrl+Y return `false` while typing, so the field's own undo runs (the prototype took them).
- **E4. Reading a notification uses `bg`**: it is not an undoable change, and undoing an older change must not mark it unread again. "Mark all read" is an undoable `act` with no log line, as in the prototype.
- **E5. Records until their screens arrive:** example creators, brands and deals (a subset of the prototype's `data.js`, AI channels and AI brands) give the palette its records group and the peek and record page something to show: a short summary (name, kind, the prototype's sub line) and a line saying the full record comes with its screen.
- **E6. The record page is a screen key `record`** with `record` and `from` on the route. It isn't restored from the hash after a reload (as in the prototype); the hash still shows it (`#/record/creator/c1`).
- **E7. Not ported from the palette yet:** Start focus, Wrap up the day, Resume today's search (their features come in steps 4 and 5), Show the design notes (not ported, ADR 0009), and the Settings group (3c-3).
- **E8. Menus, the palette and dialogs return focus** to the element that opened them. The prototype didn't.

## Contracts

### Routes (`lib/routes.ts`)

```ts
export type RecordKind = "creator" | "brand" | "deal";
export interface RecordRef { readonly kind: RecordKind; readonly id: string }
export type ScreenKey = /* the nine */ | "record";
export interface Route {
  readonly screen: ScreenKey;
  readonly tab: string | null;
  readonly record?: RecordRef; // only on "record"
  readonly from?: ScreenKey; // the screen the record was opened from
}
```

`screens.record`: name "Record", icon `user`, hue `var(--ink-2)`, no tabs; `screenOrder` and `goLetters` leave it out. `sameRoute` compares `record` and `from`. `routeToHash` writes `#/record/<kind>/<id>`; `routeFromHash` maps any `#/record/...` to Today.

### Data and UI state (`lib/store.ts`, `lib/example-data.ts`)

```ts
export interface Creator { readonly id: string; readonly name: string; readonly handle: string; readonly stage: CreatorStage; readonly email: string | null }
export type CreatorStage = "new" | "shortlisted" | "contact" | "emailed" | "replied" | "kit" | "audience" | "signed" | "rejected" | "parked" | "never";
export interface Brand { readonly id: string; readonly name: string; readonly sells: string; readonly status: string }
export interface Deal { readonly id: string; readonly brand: string; readonly creator: string; readonly step: number /* index into DEAL_FLOW */; readonly price: number }
export interface MateRun { readonly by: string; readonly at: number; readonly current: number; readonly total: number }
// AppData gains: creators, brands, deals, mateRun: MateRun | null

export interface ToastAction { readonly label: string; readonly kbd?: string; readonly run: () => void }
export interface Toast {
  readonly id: string; readonly msg: string; readonly sub?: string; readonly icon: IconName;
  readonly tone: "good" | "info"; readonly ms: number; readonly actions: readonly ToastAction[];
}
export type MenuItem =
  | { readonly kind: "item"; readonly label: string; readonly icon?: IconName; readonly hint?: string; readonly danger?: boolean; readonly checked?: boolean; readonly run: () => void }
  | { readonly kind: "separator" }
  | { readonly kind: "heading"; readonly label: string }
  | { readonly kind: "who"; readonly name: string; readonly sub: string; readonly color: string; readonly unnamed: boolean; readonly run: () => void };
export interface OpenMenu { readonly x: number; readonly y: number; readonly right: number; readonly top: number; readonly align: "start" | "end"; readonly items: readonly MenuItem[] }
export interface Peek { readonly record: RecordRef; readonly list: readonly string[] | null }
export interface Job { readonly id: string; readonly kind: "search" | "contacts"; readonly label: string; readonly progress: number; readonly total: number; readonly done: boolean }
// AppUi gains: palette: boolean; shortcuts: boolean; tray: "jobs" | "notifications" | null;
//   menu: OpenMenu | null; peek: Peek | null; toasts: readonly Toast[]; recent: readonly RecordRef[]; jobs: readonly Job[]
```

`go` also closes the menu and the peek (unless `go(screen, tab, { keepPeek: true })`); `back` and `forward` close the peek. Example data: creators c1 to c5 and two new finds, brands b1 to b5, deals d1 to d5 from the prototype's `data.js` (same names, stages, prices, deal steps), and its `mateRun`.

### Actions (`lib/actions.ts`, new)

```ts
export interface ActToast { readonly msg?: string; readonly sub?: string; readonly icon?: IconName; readonly tone?: "good" | "info"; readonly ms?: number; readonly go?: { readonly label?: string; readonly run: () => void }; readonly undo?: boolean }
/** W.act: records an undo step, adds a log line (unless log is false), marks saving, and shows the toast (with Undo while this change is still the newest). */
export function act<R>(label: string, recipe: (data: Draft<AppData>, ui: AppUi) => R, options?: { readonly log?: boolean; readonly toast?: ActToast }): R | false;
export function undo(): void; // "Undone" (sub: label, icon undo, Redo action, 4000 ms) or "Nothing to undo" (2500 ms)
export function redo(): void; // "Redone" (3000 ms); nothing when there is nothing to redo
export function toast(t: { readonly msg: string; readonly sub?: string; readonly icon?: IconName; readonly tone?: "good" | "info"; readonly ms?: number; readonly actions?: readonly ToastAction[] }): string; // default ms 6500; keeps the newest 3
export function dismissToast(id: string): void;
export function peek(record: RecordRef, list?: readonly string[]): void; // also puts it first in `recent` (max 8, no duplicates)
export function closePeek(): void;
export function stepPeek(by: 1 | -1): void;
export function openRecord(record: RecordRef): void; // go("record", null, { record, from }) and `recent`
export function setPalette(open: boolean): void;
export function setShortcuts(open: boolean): void;
export function toggleTray(tray: "jobs" | "notifications"): void;
export function closeTray(): void;
export function openMenu(anchor: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }, items: readonly MenuItem[], align?: "start" | "end"): void; // y = bottom + 4
export function closeMenu(): void;
export function markAllRead(): void; // act("Marked notifications read", ..., { log: false })
export function readNotification(id: string): void; // bg
export function cycleTheme(): void; // system → dark → light → system, with a 2000 ms toast
```

Saving: `act`, `undo` and `redo` set `ui.saving` for 700 ms, then `saving = false` and `savedAt = now`. Words from `strings.ts`.

### Components (`apps/desktop/src/renderer/overlays/`, new)

`modal-layer.tsx` (E1: the `<dialog>` wrapper, with `label`, `onClose`, children; pushes nothing itself), `palette.tsx`, `shortcuts.tsx`, `menu-layer.tsx`, `tooltip.tsx`, `trays.tsx`, `peek.tsx`, `record-summary.tsx` (used by the peek and the record page), `toasts.tsx`, `overlays.css` (index.html l.261-265 peek, l.389-426 overlays and tooltip, l.484 `.pal{--tx}`, l.509-511 menu extras, plus a small set of dialog-reset rules listed as deviations), `overlays-css.test.ts`. The App mounts them; the top bar's search box, jobs and bell, and the rail's account button, open them; the record page is a screen.

### Keys

Global (bottom layer) adds: `mod+k` toggles the palette, `/` opens it, `?` opens the sheet, `mod+z` undo (`shift` held: redo), `mod+y` redo — the three undo keys return false while typing (E3). Palette layer (barrier): `mod+k` and `escape` close. Sheet (barrier): `escape` and `?` close. Menu (barrier): `escape`, `arrowdown`, `arrowup`, `home`, `end`. Tray layer: `escape` closes. Peek layer: `escape`, `alt+arrowdown`, `alt+arrowup`.

## Tasks

| id | title | tier | depends_on | files |
|---|---|---|---|---|
| P1 | State, example records, actions, with tests | N | — | `lib/routes.ts`, `lib/store.ts`, `lib/example-data.ts`, `lib/actions.ts`, `lib/format.ts` (money), `strings.ts`, their tests |
| P2 | Overlay CSS, the dialog wrapper, the parity test | N | — | `overlays/overlays.css`, `overlays/overlays-css.test.ts`, `overlays/modal-layer.tsx` (+ test) |
| P3 | The overlays and their wiring | N | P1, P2 | `overlays/*.tsx`, `app/app.tsx`, `app/top-bar.tsx`, `app/rail.tsx`, `app/global-keys.ts`, `app/placeholder-screen.tsx` (record page), `main.tsx`, `strings.ts` |
| P4 | Tests: components and Electron | N | P3 | `overlays/*.test.tsx`, `app/*.test.tsx`, `e2e/*` |
| P5 | Verify, look, review, docs, PR (lead) | H | P4 | `.router/*`, `docs/*` |
