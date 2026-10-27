# Plan: step 8, part 1 — Signing

Branch `feat/8-signing`. Read `.router/CONTEXT.md` first. Owner's choices (2026-10-27): build this part before step 7 part 1; the full signing scope; Decline drafts a kind no through the comms engine, which waits for approval.

## Goal

A creator who replied with numbers can be checked against the audience rule and signed, declined kindly or parked, from the creator's record and from Close › Roster, on live data.

**Acceptance**
1. Saving a reply's rate and countries (or typing them in the media kit) moves a `replied` creator to `kit` by itself, and the move syncs.
2. The record's Overview shows an Audience card: the numbers (from the typed kit or the replies), a link to the kit file, an editor, and the four-row check with its verdict.
3. A `kit` creator who passes shows **Sign at $rate**; one who fails shows **Decline kindly** and **Park for 90 days**; one with missing numbers shows **Ask for what's missing**. Sign has Ctrl Z and a toast Undo; Decline and Ask have a toast Undo. Nothing sends: the decline and the ask are drafts that wait for a person.
4. Close shows in the live rail with one tab, Roster: "Waiting for an audience check" and "Signed creators" (rate, median views, audience). The other Close tabs stay hidden in live mode.
5. The Reach board shows its Media kit and Signed lanes on live data.
6. The comms engine gets the creator's kit (`mediaKit` in the facts), with the rate marked agreed once signed.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; one new Electron smoke test (`e2e/close-roster.spec.ts`); the existing Electron tests still pass (`pnpm verify`).

**Not in this part:** brands, match, pitch, negotiate, contracts, Calculator, Settings › Agency facts (parts 2 and 3; the rule's numbers are fixed constants until Agency facts makes them editable). Today's signing bucket (Today isn't built: step 7 part 1). The roster's Live deals, Last go-live and Best next brand columns (they need deals and brands). Uploading the kit file itself: the kit is a link (parity 51 says "attached"; a link is what the old app kept).

## Decisions

- **D1. The rule** (the prototype is the spec, `engine.js` `W.audience`): four checks, each yes, no, or not known.
  - *top*: the country with the largest share leads the top 3 and is US, GB, CA or AU;
  - *age*: the age band lies within 18–44 (both ends);
  - *engagement*: 3% or more;
  - *rate*: a rate is known (never "no").
  Verdict: `pass` when all four are yes; `fail` when any is no; else `missing`. The constants live in core (`audienceRule`) until Settings › Agency facts (part 3). The pipeline's `readiness.py` (the engine's pitch readiness) is a different check and stays as it is.
- **D2. One place for the numbers.** `channel_state.media_kit` (the server's column, legacy shape `{countries:[{code,pct}], ageBand, engagement, link, rates:[{format,price,agreed?}]}`) holds what a person types. `provided_data` holds what replies gave (`{rate, countries:[{code,share}], age}`). The view merges them field by field: the typed kit wins, then the reply's fact; engagement falls back to `manual_engagement_rate` (the old app's field). `fromReply` is true when countries, age and rate come only from replies (the prototype's "these numbers come from their email" callout).
- **D3. The kit write** `creator.kit` goes straight through (like `creator.notes`, not an undo step). It replaces countries, age band, engagement, link and the `integration` rate row of `media_kit`, keeping other rate rows and unknown keys. It syncs as `channel.edit media_kit` with the stored value as base (as `reply.fact` does).
- **D4. replied → kit by itself,** in the same transaction as the `reply.fact` or `creator.kit` write, when the merged view has a rate and at least one country (`movesToKit`). It goes through the normal stage write and is queued for sync with a log line ("Media kit in for X"). Main then tells the page `frame:changed` `creators` and `log`.
- **D5. Sign** is a renderer act (stage `kit|audience → signed`, log line, Ctrl Z), like Find's shortlist. Only offered when the verdict is `pass`.
- **D6. Decline kindly** is a main command (`close:decline`), because the draft lives in main: one commit sets the stage `rejected` with reason `audience` (normal stage write: tags and the 7-day archive date follow, as a Find reject), a log line, skips the creator's open drafts, and queues a `reply` draft with goal `decline` answering their newest inbound message. Its toast Undo (`close:decline-undo`) puts the stage back, skips the decline draft unless it is approved, sending or sent, and brings back the drafts it skipped. Allowed from `replied`, `kit`, `audience`.
- **D7. Ask for what's missing** (`close:ask`): queues a `reply` draft with goal `ask_kit`, from `replied`, `kit` or `audience`, when the check has missing rows and the creator has no open draft (else `draft_open`: answer in that one). Undo is Skip on the draft (the existing `skipDraft`).
- **D8. Draft goals.** Migration 0006 adds `outreach_drafts.goal` (`NULL`, `'decline'`, `'ask_kit'`). The drafter sends `goal` and, for `ask_kit`, `missing` (computed at drafting time from the kit) with `kind: "reply"`. The pipeline's `build_case` uses a goal text for each. Example data uses stand-in texts, as every other draft there.
- **D9. Park for 90 days** reuses `reach:park`. It now also accepts a `replied`, `kit` or `audience` creator with any sequence (a reply stops it, so nothing is re-timed into sending). On waking, the stage is `wakeStage(stopped, kit)`: a sequence stopped by a reply wakes to `kit` (when the kit has rate and countries) or `replied`; anything else to `emailed` as before. A creator with no sequence (old imported mail only) can't be parked: `wrong_state`, as today.
- **D10. Money.** The frame strips `kit.rate` for a viewer who doesn't see money (as the reply's rate fact). Main's own checks use the stored value.
- **D11. Engine facts.** `buildCommsFacts` fills `creators[id].mediaKit` from the merged view in the legacy shape, the integration rate `agreed: true` when the stage is `signed`.
- **D12. Live gate.** `liveWired.close = ["roster"]`; `liveBoardLanes` becomes every lane. The board's Media kit card's action opens the creator's peek on Overview (where the check is), since Today isn't built.

## Contracts

### Core (`packages/core`)

`src/data/types.ts` (added):
```ts
/** A country and its share of the audience, in %; null when not given. */
export interface AudienceShare { readonly code: string; readonly share: number | null }
/** The most countries a kit keeps. */
export const kitCountriesMax = 5;
/** What the app knows of a creator's audience and rate (D2). */
export interface CreatorKit {
  /** Largest share first, at most kitCountriesMax. */
  readonly countries: readonly AudienceShare[];
  /** "18-34" (an en dash is read as a hyphen); null when not known. */
  readonly ageBand: string | null;
  /** In %. */
  readonly engagement: number | null;
  /** US dollars per integration; null when not known, or hidden from a viewer who doesn't see money. */
  readonly rate: number | null;
  /** https only. */
  readonly link: string | null;
  readonly fromReply: boolean;
}
// Creator gains:  readonly kit: CreatorKit | null;   (null when nothing is known)
/** What a person types into the media kit (D3). */
export interface KitInput {
  readonly countries: readonly AudienceShare[]; // ≤ kitCountriesMax, codes ISO-2 upper case, share 0–100 or null
  readonly ageBand: string | null;               // /^\d{2}-\d{2}$/, low < high
  readonly engagement: number | null;            // 0–100
  readonly rate: number | null;                  // 1–1,000,000, whole dollars
  readonly link: string | null;                  // https URL, ≤ 2000
}
// DataWrite gains:
| { readonly kind: "creator.kit"; readonly id: string; readonly kit: KitInput; readonly handle: string; readonly name: string }
```

`src/close/audience.ts` (new, exported from `src/close/index.ts` and the package's `close` entry like `reach`):
```ts
export const audienceRule = { leaders: ["US","GB","CA","AU"], minAge: 18, maxAge: 44, minEngagement: 3 } as const;
export const audienceKeys = ["top","age","engagement","rate"] as const;
export type AudienceKey = (typeof audienceKeys)[number];
export interface AudienceRow { readonly key: AudienceKey; readonly ok: boolean | null }
export interface AudienceResult {
  readonly rows: readonly AudienceRow[];          // in audienceKeys order
  readonly verdict: "pass" | "fail" | "missing";
  readonly missing: readonly AudienceKey[];       // rows with ok === null
  readonly firstFail: AudienceKey | null;
}
export function checkAudience(kit: CreatorKit | null): AudienceResult;
export function parseAgeBand(band: string): { low: number; high: number } | null;
/** D2: the merged view from the stored JSON values (any shape: unknown in, defensive). */
export function kitView(mediaKit: unknown, provided: unknown, engagement: number | null): CreatorKit | null;
/** D3: the new media_kit JSON from the stored one and the input. */
export function mergeKit(stored: unknown, input: KitInput): Record<string, unknown>;
/** D11: the legacy-shaped kit for the comms engine; null when the view is null. */
export function engineKit(kit: CreatorKit | null, signed: boolean): Record<string, unknown> | null;
export function movesToKit(stage: CreatorStage, kit: CreatorKit | null): boolean;   // D4
export function canSign(stage: CreatorStage, kit: CreatorKit | null): boolean;      // kit|audience and pass
export function wakeStage(stopped: SequenceStop | null, kit: CreatorKit | null): CreatorStage; // D9
export const signingStages: readonly CreatorStage[] = ["replied","kit","audience"]; // where Decline, Ask and kit-Park are allowed
```

`src/data/reach-types.ts`: `export const draftGoals = ["decline","ask_kit"] as const; export type DraftGoal = …;` the stored draft and the frame's draft view gain `readonly goal: DraftGoal | null`.

### IPC (`packages/ipc`)

- `data.ts`: a strict zod entry for `creator.kit` matching `KitInput` exactly (bounds above).
- New `close.ts` + `channels.ts` entries:
  - `close:decline` req `{creatorId}` → `{ok:true, draftId: string | null, before: CreatorStage, skipped: string[]}` | `{ok:false, problem: "no_data" | "not_found" | "wrong_state"}`
  - `close:decline-undo` req `{creatorId, draftId: string | null, before: CreatorStage (one of signingStages), skipped: string[] ≤ sequenceRestoreMax}` → `{ok:true}` | `{ok:false, problem}`
  - `close:ask` req `{creatorId}` → `{ok:true, draftId: string}` | `{ok:false, problem: "no_data" | "not_found" | "wrong_state" | "draft_open" | "nothing_missing"}`
- Gemini (`apps/desktop/src/main/pipeline/gemini-protocol.ts` and `services/pipeline/.../gemini/gemini.schema.json`): `action.comms_propose` request gains optional `goal: "decline_audience" | "ask_kit"` and `missing: ("countries"|"age"|"engagement"|"rate")[]` (≤ 4). Regenerate the snapshot with `pnpm pipeline:schema`.

### Main

- Migration `0006-draft-goal.ts`: `ALTER TABLE outreach_drafts ADD COLUMN goal TEXT CHECK (goal IS NULL OR goal IN ('decline','ask_kit'))`.
- `repositories/creators.ts` `listCreators` reads `media_kit`, `provided_data`, `manual_engagement_rate` and sets `kit` via `kitView`; the frame strips `kit.rate` without money (D10). New `writeCreatorKit(db, write, now)`: creates the row if needed (as the stage write does), writes `mergeKit`, then D4.
- `repositories/outreach.ts` `writeReplyFact`: after the merge, D4.
- `sync/intents.ts`: `creator.kit` queues `media_kit` (base = stored before); `reply.fact` and `creator.kit` also queue `creator_stage` when D4 moved it.
- `reach/signing.ts` (new): `createSigning(deps)` → `{decline, undoDecline, ask}`, built inside `createReachService` and exposed on it; handlers wire `close:*`. Decline/ask call `drafter.kick()` and `changed(["log","creators"])`.
- `reach-service.ts` park/wake per D9; `afterWrite(writes)` calls `changed(["creators","log"])` when a write is `creator.kit` or `reply.fact`.
- `reach/drafter.ts` `requestFor`: `goal` and `missing` from the draft (`decline` → `decline_audience`); stand-ins per goal in `reach/strings.ts`.
- `reach/facts.ts`: `mediaKit` per D11.

### Renderer

- `lib/close-actions.ts`: `sign(creatorId)`, `decline(creatorId)`, `askMissing(creatorId)`, `parkForAudience(creatorId)` (→ `parkCreator(id, now + 90 days)`), `saveKit(creatorId, input)`.
- `close/audience-check.tsx` `AudienceCheck({creator, actions?: boolean})`; `close/kit-editor.tsx` `KitEditor`; `record/creator-audience.tsx` the Overview's Audience card.
- `close/close-screen.tsx` (tabs, copy `reach/reach-screen.tsx`), `close/roster.tsx`, `close/close.css`; `app/app.tsx` routes `close`; `lib/wired.ts` `close: ["roster"]`.
- Strings: a `close` section in `renderer/strings.ts`; `data-ui` ids `close.roster.*`, `record.audience.*`.

## Tasks

| id | title | tier | depends | files | done check |
|---|---|---|---|---|---|
| C1 | Core contracts and audience logic | N | – | core `data/types.ts`, `data/reach-types.ts`, new `close/audience.ts`, `close/audience.test.ts`, `close/index.ts`, package exports | `pnpm vitest run packages/core` + `tsc -b packages/core` |
| C2 | IPC schemas | N | C1 | ipc `data.ts`, new `close.ts`, `channels.ts`, tests | `pnpm vitest run packages/ipc` |
| D1 | Data layer: kit read, kit write, auto move | N | C2 | `repositories/creators.ts`, `repositories/outreach.ts`, `sqlite-source.ts`, tests beside them, `data-source-contract.ts` | vitest on those files + contract suites |
| D2 | Sync intents for the kit and the move | H | D1 | `sync/intents.ts`, `sync/intents.test.ts` | vitest intents |
| D3 | Example data: kits on AI creators | N | D1 | `core/data/example.ts` (+ scenarios if needed), seed version | vitest example + contract |
| P1 | Pipeline goal and engine kit | N | C1 | `gemini-protocol.ts`, `gemini.schema.json`, `comms/live_case.py`, pytest, `reach/facts.ts` + test | `pnpm pipeline:schema`, pytest live_case, vitest facts |
| M1 | Draft goal: migration, store, drafter, stand-ins | N | D1, P1 | `db/migrations/0006-draft-goal.ts`, `migrations/index.ts`, outreach repo draft read/write, `reach/drafter.ts`, `reach/strings.ts`, tests | vitest migrate, outreach, drafter |
| M2 | Signing commands, park and wake | N | M1 | new `reach/signing.ts` + test, `reach/reach-service.ts`, `handlers.ts`, `stub-services.ts` if needed | vitest signing, reach-sequences, handlers |
| R1 | Renderer actions, Audience card and kit editor | N | M2 | `lib/close-actions.ts`, `close/audience-check.tsx`, `close/kit-editor.tsx`, `record/creator-audience.tsx`, `record/creator-overview.tsx`, `record/creator-next.tsx`, strings, tests | vitest renderer files |
| R2 | Close screen, Roster, live gate, board lanes | N | R1 | `close/close-screen.tsx`, `close/roster.tsx`, `close/close.css`, `app/app.tsx`, `lib/wired.ts`, `core/reach/board.ts`, `reach/board-card.tsx`, strings, tests | vitest + `pnpm typecheck` |
| E1 | Electron smoke test | N | R2 | `e2e/close-roster.spec.ts` | the spec passes after `pnpm build` |
| Z1 | Docs: ADR 0020, plan status, parity, architecture | E | E1 | docs | lint |
| RV | Review | H | all | – | findings fixed, `pnpm verify` green |

Rules for every build agent: edit only the listed files (stop and report if more must change); never run `git add`, `git stash`, `git reset`, `git checkout -- <file>` or commit; strings live in the strings modules; example data is about AI creators and AI sponsors.
