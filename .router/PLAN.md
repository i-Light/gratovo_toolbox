# Plan: step 3c-3, settings and checks

The last of three pull requests for step 3c (3c-1, the frame, merged as #6; 3c-2, the overlays, as #7; their plans are in git history at 3056c06 and 7d50f77). Read `.router/CONTEXT.md` §3 and §10 first, and the prototype's `design/workbench-prototype/js/settings.js` (all of it) with its CSS (index.html l.222-226, 564-594) and `js/ui.js` l.18-20 and 52-56. The prototype is the spec; where this plan and the prototype differ, a decision below says why.

## Goal

The Settings screen works as in the prototype: its sections in two groups, the search, saved-in-place confirmation, and the rows whose features exist today (your name; theme, density, text size, motion, sidebar; single-letter keys; what reaches the bell). The other sections are there, saying which step brings their rows. Then step 3c's own checks: no accessibility violations (axe, WCAG 2.2 A and AA) in light and dark, and the whole shell looked at next to the prototype.

### Non-goals

Prototype mode and its section (3f). The rows of Your day (step 4; per §9 Q2 the owner sets each person's hours), Search rules (5), Writing rules (6), Agency facts (7), Team and money and Connections (9). Locked sections for teammates who aren't the owner (the example data's "me" is the owner until 3d brings accounts). Persisting data across restarts (3d).

### Acceptance

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; Windows CI passes.
2. Every ported CSS rule matches the prototype (`expectRulesMatchPrototype`), deviations listed with a reason.
3. Component tests: the sections and groups, the search (rows and sections, "No setting matches"), Esc clears the search, Ctrl F focuses it, choosing a result opens the section and highlights and focuses the row, saved-in-place, each working row changes what it says (prefs applied to `<html>`, the rail's name, the bell's count), the notification switches undo with Ctrl Z, the shell sections name their step, the palette's Settings rows.
4. Playwright on Windows: settings (open from the account menu, change the theme and see it applied, find "dark" in the search and land on the Theme row, set your name and see it in the rail, turn off a notification kind and see the bell's count drop) and accessibility (axe finds no WCAG 2.2 A or AA violations on the frame, each overlay and each settings section, in light and dark, at 1440 and 400 px).
5. Looked at next to the prototype, light and dark, 1440 and 400 px: every settings section, the search results, and the frame and overlays once more.

## Decisions

- **F1. Working rows are the ones whose feature exists:** Profile (your name; your role as a tag), Appearance (theme, density, text size, motion, sidebar), Keyboard (single-letter keys and the shortcut groups), Notifications (four kinds and the always-on Problems). The other sections show their head and note and an empty state saying which step brings their rows (`arrives`). Their rows aren't in the search or the palette until then.
- **F2. Your name is a device preference** (`name` in the prefs, as the prototype's `wb-name`), copied into `data.myName` at start and on change with `bg`: not undoable, as in the prototype. An empty name puts "Add your name" back. 3d moves it to the account.
- **F3. What reaches the bell is data** (`data.settings.notify`, a kind is on unless false), changed with `act` and no log line, so Ctrl Z undoes it, as in the prototype. The bell's count and the tray's list show only `notifShown` notifications; problems always show.
- **F4. The page's subtitle drops "Ctrl Z undoes them".** Device preferences aren't undoable (in the prototype either), so the sentence would be untrue; it ends at "Changes apply at once."
- **F5. Opening a setting** (from the search or the palette) goes to its section, then the section scrolls the row to the middle, replays its highlight and focuses its first control: through `ui.settingTarget`, read by the settings screen after it renders (the prototype used a 60 ms timer).
- **F6. Saved-in-place** is UI state (`ui.settingFlash`, 1700 ms), as the prototype.
- **F7. Contrast:** the light theme's `--muted` becomes `#566678` (the prototype's `#64778b` reads 3.96 to 4.26:1 on the sunk and accent-soft surfaces; the new value is at least 4.72:1 on every light surface, same hue). A listed deviation in `tokens.test.ts`. Dark passes as it is.
- **F8. Names match what you see** (WCAG 2.5.3): the expanded account button takes its name from its text (its avatar is decorative there); collapsed, it keeps "Your account: …". The bell's name says the count ("Notifications, 3 unread") while its tooltip stays "Notifications".
- **F9. axe runs in the Electron tests** through `@axe-core/playwright` (4.14.0, matching the `axe-core` already in the tree), with the WCAG 2.2 A and AA tags only. Best-practice rules (heading order, landmarks) aren't gates: the prototype's headings (h4 in trays and the sheet) stay.
- **F10. The screenshot comparison is a look, not a pixel test:** the screens behind the frame differ from the prototype until steps 4 to 9, so pixel diffs would fail on content. The lead compares with the scratchpad scripts and records what was compared in PROGRESS and the hand-off.

## Contracts

### Settings model (`apps/desktop/src/renderer/lib/settings.ts`, new)

```ts
export type SectionKey = "profile" | "appearance" | "day" | "keyboard" | "notifications" | "search" | "facts" | "writing" | "team" | "connections";
export interface SettingsSection {
  readonly key: SectionKey;
  readonly group: "you" | "agency";
  readonly icon: IconName; // user, moon, sun, keyboard, bell, scan, sliders, pen, users, gauge
  readonly owner: boolean; // the prototype's owner flag (facts, team, connections)
  readonly arrives: number | null; // the plan step that brings its rows; null when they work now
}
export const settingsSections: readonly SettingsSection[]; // the prototype's order
export type RowId = "name" | "role" | "theme" | "density" | "size" | "motion" | "rail" | "letters" | "notify";
export interface SettingsRow { readonly section: SectionKey; readonly id: RowId }
export const settingsRows: readonly SettingsRow[]; // only rows that exist now, in the prototype's order
export type NotifyKind = "reply" | "money" | "handoff" | "search";
export function notifyKind(icon: IconName): NotifyKind | "problem"; // the prototype's W.notifKind
export function notifShown(data: AppData, n: Notification): boolean; // W.notifShown
/** Rows whose label, words or section name contain the query; sections whose name, sub or words do (lower case). */
export function searchSettings(query: string): { readonly rows: readonly SettingsRow[]; readonly sections: readonly SettingsSection[] };
```

Words in `strings.ts` under `settings`: the page title and sub (F4), "Find a setting", the group names (You, Agency), each section's sub, search words and note (names stay in `screens.settings.tabs`), each row's label, words and description, the scopes (Just you, This computer, Whole team), "Saved", the notification kinds (label and line), Problems, the empty-search title and hint, and the shell section's "Arrives with step {n}" title and line.

### Data, UI state, actions

```ts
// lib/store.ts
// AppData gains: settings: { readonly notify: Readonly<Partial<Record<NotifyKind, boolean>>> } (example data: {})
// AppUi gains: settingFlash: { readonly id: RowId; readonly at: number } | null; settingTarget: RowId | null
// lib/prefs.ts: Prefs gains name: string (default "", at most 80 characters)
// lib/actions.ts
export function setMyName(name: string): void; // trims; saves the pref; bg: data.myName = name || null; flashes "name"
export function setNotify(kind: NotifyKind, on: boolean): void; // act(strings…, { log: false }); flashes "notify"
export function flashSetting(id: RowId): void; // ui.settingFlash for 1700 ms
export function openSetting(section: SectionKey, row?: RowId): void; // go("settings", section); ui.settingTarget = row ?? null
```

At start (`main.tsx` after `initPrefs`): `data.myName` from the `name` pref (with `bg`, before the first render).

### Components

- `packages/ui`: `Seg` (`div.seg[role=group][aria-label]`, buttons with `aria-pressed`; props `label`, `value`, `options: readonly { value, label, icon? }[]`, `onPick`), `Tag` (`span.tag`, props `tone?`, `icon?`, children), `Switch` (`button.switch[role=switch][aria-checked][aria-label]`, `on`, `label`, `onChange`, `disabled?`). Exported from `index.ts`, with tests.
- `apps/desktop/src/renderer/settings/` (new): `settings-screen.tsx` (PageHead with `label.set-search`, `div.set` with `nav.card.tight.set-nav[aria-label]` of `.bucket`s and `button.li` with `aria-current="page"`, the pane `div.card.set-pane` with `.tb-ic`, `h2`, note, then the section or the results), `row.tsx` (`div.set-row#set-<id>`, `.set-t` with `b`, `.set-scope`, `.set-saved[role=status]`, `p`; `.set-c`), `sections.tsx` (Profile, Appearance, Keyboard, Notifications, and the shell), `results.tsx`, `settings.css` (+ `settings-css.test.ts`). `app/app.tsx`'s Content renders the settings screen for `screen === "settings"`.
- Palette: a "Settings" group from `settingsRows` (icon = the section's, sub = the section's name, words = the row's), where the prototype puts it (app.js ~l.209); choosing one runs `openSetting`.

### Keys

The settings screen pushes `mod+f` (focus the search) while mounted. In the search, Esc clears it and leaves the field (the input's own handler, with preventDefault, so the key stack ignores it).

## Tasks

| id | title | tier | depends_on | files |
|---|---|---|---|---|
| R1 | Shared pieces: `Seg`, `Tag`, `Switch`; settings CSS; the `--muted` fix | N | — | `packages/ui/src/{seg,tag,switch}.tsx` + tests + `index.ts`; `packages/ui/src/controls.css` (`.switch`, `.bucket`, `.tb-ic` if shared) + `styles.test.ts`; `packages/ui/src/tokens.css` + `tokens.test.ts`; `apps/desktop/src/renderer/settings/settings.css` + `settings-css.test.ts` |
| R2 | Settings model, data, actions, the bell filter | N | — | `lib/settings.ts` + test, `lib/store.ts`, `lib/example-data.ts`, `lib/prefs.ts`, `lib/actions.ts` + tests, `main.tsx`, `app/top-bar.tsx` (bell count, F8), `overlays/trays.tsx` (list), `strings.ts` |
| R3 | The settings screen, its sections, the palette rows, F8's account button | N | R1, R2 | `settings/*.tsx`, `app/app.tsx`, `app/rail.tsx`, `overlays/commands.ts`, `main.tsx` (CSS import), `strings.ts`; fix tests the names change |
| R4 | Tests: component and Electron (settings, axe) | N | R3 | `settings/*.test.tsx`, `overlays/commands.test.ts`, `e2e/settings.spec.ts`, `e2e/accessibility.spec.ts` |
| R5 | Verify, look, review, docs, PR (lead) | H | R4 | `.router/*`, `docs/*` |
