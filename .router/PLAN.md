# Plan: step 7, part 2: prototype mode and the comment tool

Written 2026-10-27 by the lead (Opus). Owner's ask: "only implement step 7 prototype mode and the comment tool", and drop talent managers (done in b336c5e). Today (step 7 part 1) and branch protection (part 3) are **not** in this part.

Spec: ADR 0004, migration plan step 7 item 2, the prototype's `js/proto.js`, `js/comments.js`, `js/settings.js` (`Prototype()`), `js/app.js` (`ProtoControls`), and the `.cmt-*`, `.proto-*`, `.scn*` styles in `index.html`. Facts about the code: `.router/CONTEXT.md`.

## Goal and acceptance

1. Settings › Prototype mode (group "Owner tools") shows for the owner only, on live and example data. Off by default, and **off at every start**.
2. On: the app reloads onto `prototype.db`, a fresh example copy for the chosen scenario, and every screen shows (the live gate opens because the source is example). The live `gratovo.db` is untouched and its sync carries on in the background; Reach's queue, the reply checks and scheduled sends on live wait until prototype mode is off (as if the app were closed).
3. Off: the app reloads onto the data it had before (live, or `example.db` when unconfigured), exactly as left.
4. Scenarios: A normal Monday, First day, A week later, Something broke. Picking one reseeds `prototype.db` and reloads. The choice is kept for next time.
5. While on, nothing leaves the computer: no mail sent, no Gemini prompt or bridge start, no YouTube call, no secret written, no browser opened, no import. Enforced in main, with a test.
6. The comment tool, while on: C or the top-bar button, point, click, write (kind Fix, Idea or Question). Pins anchor to the nearest `data-ui` id with a path inside it; when the exact spot is gone, the pin falls back to the `data-ui` element, marked as moved. The list (open, done, all; everywhere, this screen), edit, mark done, reopen, delete with Undo, "Copy open for Claude", and "Export for Claude" which writes `docs/feedback/comments.json` in the repository.
7. Off means no trace: no chip, no comment button, no pins, bars, palette entries or C key, and no `comments:*` call. A unit test and the Electron smoke test check it.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; one new Electron smoke test (`e2e/prototype.spec.ts`); the existing Electron tests pass in `pnpm verify`. Looked at in dark at 1440 px.

Non-goals: Today and its engine (part 1), see-the-app-as-a-teammate (step T), the problems-bar feed (Today's work), a Find catalog in scenarios (the example pipeline starts empty until a search, as it does today), packaged-build export (step T5).

## Decisions

- **D1. A third file, `prototype.db`,** not `example.db`. Off must restore what was open exactly, and that is `example.db` itself when the app is unconfigured. Its pipeline folder is `prototype-pipeline`, emptied at every turn-on and scenario pick.
- **D2. A wrapper, not a new account state.** `withPrototype(account, proto)` overrides `source()` and `findContext()` while on; everything else goes to the real account. It sits inside `withSourceChecks`, so the source watch sees the switch and runs `onSourceChanged` (catalog, Reach, Gemini) as for a sign-in. If the base source goes away (sign-out, access lost), prototype mode turns itself off.
- **D3. Prototype is mode `"example"`.** `findContext()` gives `{ mode: "example", workerId: "prototype", folder: "prototype-pipeline" }`. Every existing stand-in branch (`mode === "example"`) applies; no new mode exists for code to forget. `findContext` gains `folder` for all three cases, and the find service and `pipelineFolder` in `index.ts` read it instead of deriving it from `mode`.
- **D4. A switch reloads the window,** as a sign-in does. Toasts, undo history and UI state go with the reload, so an Undo can never reach across.
- **D5. Owner check in main:** the base source's frame, `team.find(m => m.id === me)?.owner === true`. The page's check is only for showing the section.
- **D6. Refused while on (main):** every channel that writes a secret, opens a browser or external window, starts the Gemini bridge, sends mail or runs a live mail job, or imports. `handlers.ts` wraps them: while on, they throw `prototypeRefused` (the page sees a failed call and shows the section's usual failure). `account.setPresence` does nothing while on. The list is a constant with a test that names each channel.
- **D7. Comments live in `prototype.db`, table `comments`** (migration 0005, so every database gets the empty table). The reseed's `dataTables` doesn't list it, so scenario picks and turn-ons keep comments. Main stores; the page never touches the file.
- **D8. Export** writes `<repo>/docs/feedback/comments.json` (found like `findExtensionDir`: unpackaged only; packaged answers `no_repo`). Shape below. It overwrites the file.
- **D9. Scenarios are seed variants in `packages/core`** (`exampleSeed(now, scenario)`):
  - `normal`: today's seed.
  - `later`: today's seed built at `now - 7 days`, so everything is a week late.
  - `first`: only `me` (profile and access), no creators, brands, deals, notifications, drafts, messages or sequences, counts all 0, one mailbox `outreach1@gratovo.example` with cap 10 and warm-up from today, no `reach.mailboxes` flags.
  - `broke`: today's seed, plus `health: { signedOut: ["<the first mailbox's address>"], geminiOffline: true }` and three alert notifications first (today's search stopped on YouTube's daily limit → Find › Search; the Gemini bridge stopped answering → Settings › Connections; the mailbox is signed out → Reach › Mailboxes).
  - The seed writes `health` to `local_settings` key `example.health` when it has any. Main reads it only when `mode === "example"`: Reach's mail state shows those mailboxes signed out (not connected), and the drafter's `state()` answers `gemini: "off"` instead of `"ready"` when `geminiOffline`, and fills no drafts.
- **D10. No persistence of "on".** Main starts off. The scenario is kept in `prototype.db`'s `_meta` (`prototype_scenario`), default `normal`.
- **D11. The page's prototype state** is a small store (`renderer/lib/prototype.ts`, the `use-connections.ts` pattern): `prototype:status` once at start; comments read only while on. The comment layer, the top-bar controls and the palette entries render only while on. The confirming toast after a switch comes from `sessionStorage` key `gratovo.proto.toast`, set before the switch and read once after the reload.
- **D12. `data-ui` ids** (`screen.part.thing`, conventions.md) on the frame and every screen's main parts, so pins anchor. A pin's anchor: `ui` = the nearest `[data-ui]` ancestor-or-self, `path` = the `:nth-of-type` path from it to the element, `text` = the first 60 characters of its text, `tag`, `label`, and `rx`/`ry` (0..1) where it was clicked. Locate: the exact path whose text still matches; else the first element with that tag and text inside the `ui` element; else the `ui` element itself, marked moved.

## Contracts

### `packages/core/src/data/example.ts`

```ts
export const scenarios = ["normal", "first", "later", "broke"] as const;
export type Scenario = (typeof scenarios)[number];
/** What is broken in an example copy (the "Something broke" scenario); empty otherwise. */
export interface ExampleHealth {
  /** Mailbox addresses shown as signed out of Gmail. */
  readonly signedOut: readonly string[];
  /** Drafting acts as if the Gemini bridge is off. */
  readonly geminiOffline: boolean;
}
export interface ExampleSeed { /* as now, plus: */ readonly health: ExampleHealth | null; }
export function exampleSeed(now: number, scenario?: Scenario): ExampleSeed; // default "normal"
```

### `apps/desktop/src/main/data/example-source.ts`

```ts
export interface ExampleOptions {
  /** Seed again even if the stored seed is current (a turn-on, a scenario pick). */
  readonly fresh?: boolean;
  readonly scenario?: Scenario; // default "normal"
}
export function openExampleSource(path: string, now?: () => number, options?: ExampleOptions): DataSource;
export const exampleHealthKey = "example.health";
/** The open example copy's health, `{ signedOut: [], geminiOffline: false }` when none. */
export function readExampleHealth(source: DataSource): ExampleHealth;
```

### Migration `0005-comments.ts`

```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','done')),
  done_at INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('fix','idea','question')),
  body TEXT NOT NULL,
  scenario TEXT NOT NULL,
  place TEXT NOT NULL,   -- JSON: CommentPlace
  anchor TEXT NOT NULL,  -- JSON: CommentAnchor
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX comments_at ON comments (at);
```

### `packages/ipc/src/prototype.ts` (exported from the package index)

```ts
export const scenarioKeys = ["normal", "first", "later", "broke"] as const; // equals core's `scenarios`
export interface PrototypeStatus {
  /** The switch may be shown: the person is the owner, or prototype mode is on. */
  readonly available: boolean;
  readonly on: boolean;
  readonly scenario: Scenario;
}
export const commentKinds = ["fix", "idea", "question"] as const;
export interface CommentRef { readonly kind: string /* 1..20 */; readonly id: string /* 1..200 */ }
export interface CommentPlace {
  /** On the rail or top bar: shown everywhere. */
  readonly global: boolean;
  readonly screen: string | null; // 1..40
  readonly tab: string | null;    // 1..40
  readonly record: CommentRef | null;
  readonly peek: CommentRef | null;
}
export interface CommentAnchor {
  readonly ui: string | null; // 1..120, [a-z0-9.-]
  readonly path: string;      // 0..1000
  readonly tag: string;       // 1..20, [a-z0-9]
  readonly text: string;      // 0..60
  readonly label: string;     // 1..200
  readonly rx: number;        // 0..1
  readonly ry: number;        // 0..1
}
export interface Comment {
  readonly id: string;        // /^c[a-z0-9]{6,24}$/
  readonly at: number;        // ms, int >= 0
  readonly status: "open" | "done";
  readonly doneAt: number | null;
  readonly kind: (typeof commentKinds)[number];
  readonly text: string;      // 1..4000, trimmed
  readonly scenario: Scenario;
  readonly place: CommentPlace;
  readonly anchor: CommentAnchor;
}
export const commentsMax = 2000;
export type CommentNew = Omit<Comment, "id" | "at" | "status" | "doneAt" | "scenario">;
export type CommentPatch = { readonly id: string; readonly text?: string; readonly status?: "open" | "done" };
export type CommentsExportResult =
  | { readonly ok: true; readonly path: "docs/feedback/comments.json"; readonly count: number }
  | { readonly ok: false; readonly problem: "no_repo" | "failed" };
```

Channels (`channels.ts`), all strict objects:

| Channel | Request | Response |
|---|---|---|
| `prototype:status` | `{}` | `PrototypeStatus` |
| `prototype:set` | `{ on: boolean }` | `PrototypeStatus` (then main reloads the windows) |
| `prototype:scenario` | `{ scenario }` | `PrototypeStatus` (then reloads) |
| `comments:list` | `{}` | `{ comments: Comment[] }` oldest first |
| `comments:add` | `CommentNew` | `Comment` (main sets id, at, status open, the current scenario) |
| `comments:update` | `CommentPatch` | `Comment` (status done sets `doneAt`, open clears it) |
| `comments:delete` | `{ id }` | `{ comment: Comment \| null }` (the deleted one, for Undo) |
| `comments:restore` | `{ comment: Comment }` | `Comment` |
| `comments:export` | `{}` | `CommentsExportResult` |

`comments:*` throw when prototype mode is off, and `comments:add`/`restore` throw at `commentsMax`.

### Export file `docs/feedback/comments.json`

```json
{ "exportedAt": "<ISO>", "open": 3, "done": 1,
  "comments": [ { "number": 1, "where": "Reach › Board", "...Comment fields" : "" } ] }
```
`number` is the comment's place in the oldest-first list (as the pins show). `where` is built in main from the place's keys: `"everywhere"` when global, else `screen › tab`, plus `› record kind:id` and `› peek kind:id` when set (`"reach › board"`). Comments are ordered open first, then done, each oldest first. The page's "Copy open for Claude" gives the friendly text with screen names.

### Main: `apps/desktop/src/main/prototype/`

```ts
// prototype.ts
export interface PrototypeDeps {
  userData: string;
  now: () => number;
  /** The base account (unwrapped): its source decides who is the owner. */
  base: Pick<Account, "source">;
  /** Reloads the windows after the answer; the caller also runs the source watch. */
  reloadWindow: () => void;
}
export interface Prototype {
  status(): Promise<PrototypeStatus>;
  set(on: boolean): Promise<PrototypeStatus>;
  setScenario(scenario: Scenario): Promise<PrototypeStatus>;
  isOn(): boolean;
  /** The prototype copy while on, else null. */
  source(): DataSource | null;
  readonly comments: {
    list(): Comment[];
    add(c: CommentNew): Comment;
    update(p: CommentPatch): Comment;
    remove(id: string): Comment | null;
    restore(c: Comment): Comment;
    exportTo(repoRoot: string | null): CommentsExportResult;
  };
  close(): void;
}
export const prototypeFile = "prototype.db";
export const prototypeFolder = "prototype-pipeline";
export function createPrototype(deps: PrototypeDeps): Prototype;
// wrap.ts
export function withPrototype(account: Account, proto: Prototype): Account;
// refused.ts
export const refusedWhileOn: ReadonlySet<Channel>;
```

## Tasks

| id | title | tier | depends | files |
|---|---|---|---|---|
| C1 | Contracts: ipc `prototype.ts`, channels, core `Scenario`/`ExampleHealth` types, migration 0005, `findContext().folder` | H (lead) | – | packages/ipc/src/prototype.ts, channels.ts, index.ts; packages/core/src/data/example.ts (types only); main/db/migrations/0005-comments.ts, index.ts |
| S1 | Seed scenarios in core + tests | N | C1 | packages/core/src/data/example.ts, example.test.ts |
| U1 | `data-ui` ids across the frame and screens | N | C1 | renderer/app/*, find/*, reach/*, toolbox/*, record/*, settings/* (attributes only) |
| M1 | `openExampleSource` options, `readExampleHealth`, the prototype module and comments repository + tests | H | S1 | main/data/example-source.ts (+test), main/prototype/prototype.ts, comments.ts (+tests) |
| M2 | Wiring: `withPrototype`, `refusedWhileOn`, `findContext.folder` users, handlers, stub services, index.ts, presence | H | M1 | main/prototype/wrap.ts, refused.ts (+tests), main/handlers.ts, services.ts, stub-services.ts, index.ts, find/find-service.ts, account/account.ts |
| M3 | Health in example mode: mail state and drafter | N | M1 | main/reach/mail-state.ts, drafter.ts (+tests) |
| R1 | Page state, Settings › Prototype mode, top-bar controls, palette entries, gate entry, strings | N | M2, U1 | renderer/lib/prototype.ts, settings/prototype-section.tsx, lib/settings.ts, lib/wired.ts, app/top-bar.tsx, overlays/commands.ts, strings.ts, prototype/prototype.css |
| R2 | The comment layer: picker, composer, pins, card, list, copy and export | N | R1 | renderer/prototype/*.tsx, prototype.css, strings.ts, app/app.tsx |
| T1 | Tests: "off leaves no trace" unit test; `e2e/prototype.spec.ts` | N | R2 | renderer/prototype/*.test.tsx, apps/desktop/e2e/prototype.spec.ts |
| D1 | Docs: ADR 0019, plan status, architecture, conventions, `docs/feedback/README.md` | E | T1 | docs/… |
| V1 | Review: router-reviewer + sentry-security-review on the diff; fixes | H | D1 | – |

Every task's done-check: `pnpm lint`, `pnpm typecheck`, and the Vitest files it touched (`pnpm exec vitest run <files>`). T1 adds `pnpm --filter @gratovo/desktop exec playwright test e2e/prototype.spec.ts` after `pnpm build`.
