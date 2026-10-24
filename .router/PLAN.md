# Plan: step 5, Find

Written 2026-10-24 (lead, Opus) from `docs/migration-plan.md` §6 step 5, the prototype (`design/workbench-prototype/js/find.js`, `records.js`, `more.js`, `engine.js`) and the recon in `.router/CONTEXT.md`. Build rules for every agent: `.router/specs/rules.md`.

## Goal

From keywords to shortlisted creators with confirmed addresses, on real pipeline runs, without leaving Find. Toolbox › Archive, Never-contact and Activity log come with it.

**Acceptance (from the migration plan):** Find and Toolbox (Archive, Never-contact, Activity log) show in the live rail; the owner can run a real search, triage, confirm contacts and bring a channel back from the archive; the *search*, *qualify* and *contacts* parity rows (team rows excepted, below); one consolidated Playwright pass for Find.

**Non-goals (other steps):** a teammate's run, the overlap warning, handing keywords or creators to a teammate, owners on cards, the "Who has it" facet, the Mine filter, presence (all step T: parity rows 7 and 18). Find › Talent Managers (step 8). Instagram and TikTok (§9 Q4: not in this migration). The record's Emails and Deals tabs (steps 6 and 8). The send gate for never-contact (step 6 reads the stage this step writes). The four gaps on hold.

## Sub-steps (one pull request each, merged before the next starts)

| Sub-step | What | Turns on in live |
|---|---|---|
| **5a** | The catalog (pipeline channels joined to creators), fit score, the write path for shortlist, reject, bring back and never, Find › Review new (triage), run history with "Review results" | Find › Review new |
| **5b** | Find › Gallery (facets with counts, saved views, card sizes, table view, bulk bar, compare, thumbnail flip) and the creator peek and record (overview, fit reasons, notes, activity) | Find › Gallery, the record |
| **5c** | Contacts (the email finder with source and confidence, Confirm address with the name, Confirm all 90%+), Gemini keyword ideas, Toolbox › Archive (countdown, sweep, Bring back), Never-contact, Activity log | Find › Contacts, Toolbox |
| **5d** | The consolidated Find flow suite (Playwright), ADR 0017, docs, status table | – |

## Decisions

- **D1. The catalog is a read model in main.** `main/find/catalog.ts` joins `pipeline.db` (read-only, `node:sqlite`, as `results.ts` does) with the open data source's `channel_state`. Rows: every pipeline channel, plus every `channel_state` row whose stage is past `new` (a creator the team works on, even without local numbers). A `channel_state` row at `new` with no pipeline channel is left out: it has nothing to show until R2 sharing (step T). The catalog is built in memory and rebuilt when `pipeline.db` changes (a store-lane job's keyword or end line) or creator rows change (`data:write`, a sync pull). Rebuilds are coalesced (at most one per 500 ms). Each rebuild bumps `version` and emits `find:catalog`.
- **D2. Queries run in main, the page asks for pages.** `find:query` takes a filter, a sort and a page (at most 120 items) and returns the items, the total and the facet counts (the prototype's `passes(c, f, skip)`). `find:item` returns one creator's detail. The filter, sort and facet logic is pure, in `packages/core/src/find/`, so it is unit-tested once and main only feeds it rows. The page overlays its own creator state (stage, email, confirmed) on the items it shows, so a key press shows at once; counts catch up on the next `find:catalog`.
- **D3. Acting on a channel the frame doesn't hold.** The frame keeps its 5,000 creators (ADR 0012). Before an action touches a catalog item that isn't in `data.creators`, the page adds it with `adoptServerData` (current data and every undo step, nothing written), built from the item's stored state. Then `act` changes it as usual, so Undo and the persister work unchanged. The persister writes nothing for an added creator; a removed one is an error (no recipe removes creators).
- **D4. A creator's stage write creates the row.** `creator.stage` carries `handle` and `name`. When no `channel_state` row exists, main inserts one (handle, defaults) and the `channels` name, then enqueues the edit with base `null`. The server's `apply_channel_edit` already creates a row for a channel it has never seen.
- **D5. Reject sets the server's tag; the reason travels with the log.** The four reasons (prototype `REJECT_REASONS`): `ai` "Not about AI tools", `views` "Too few views", `posting` "Not posting enough", `audience` "Audience outside US, UK, CA or AU". On a move to `rejected` main also edits `channel_tags`: adds `inactive` for `posting`, else `irrelevant` (the server trigger then sets `archive_due_at`), and sets the local `archive_due_at` to now + 7 days, as the trigger will. A move away from `rejected` removes `irrelevant`, `inactive` and `haramStuff` and clears the local due date. The reason is in the act's log line: a log entry gains `ref` (creator id), `action` and `detail`, and the server row gets `action`, `entity_type 'channel'`, `entity_id` and `detail {reason}`. A creator's `rejectReason` and `rejectedAt` are read from its newest visible `creator.reject` or `creator.never` line.
- **D6. The archive countdown uses the owner's `archiveDays`.** The server's due date is always 7 days. The app shows `archive_due_at + (archiveDays − 7) days` (ADR 0016 D3 keeps `archiveDays` in `find.json`). A channel past its due date is archived for good by a store-lane job `archive.sweep {channelIds}` (5c): it tombstones the channel in `channel_archive` (label `rejected`) so searches skip it, and the `channel_state` row stays `rejected` (history kept). Main runs the sweep at start, hourly, and when Toolbox › Archive opens. Toolbox › Archive (5c) lists the countdown (Bring back = stage `new`) and, below, "Archived for good" from `channel_archive` (paged, searchable) with Bring back = a store-lane job `archive.restore {channelIds}` that removes the tombstone and refetches the channel. This keeps the rules card's promise ("can be brought back from Toolbox › Archive").
- **D7. Never contact.** Stage `never`, reason in the log line (`creator.never`). Hidden from Review new and from the gallery's default view. Searches skip never-contact channels: the search job gains `skip: channelId[]` (at most 20,000), which `partition_discovered` treats as known. "Allow again" sets stage `new`. Step 6's send gate reads the stage.
- **D8. Fit and gold, honest about what YouTube gives.** `packages/core/src/find/fit.ts` ports `W.fit` and `W.gold` with the five parts (median views 30, posting 15, audience 25, engagement 15, sponsored before 15). YouTube gives no audience split by country and no engagement figure, so: the audience part scores the channel's own country (25 when it is US, GB, CA or AU) and its note says so ("Channel based in the US; the audience split comes with the media kit"); engagement uses `manual_engagement_rate` when set, else 0 with "not known yet". The gallery's "In the top 3 countries" facet becomes "Channel country". Gold: median ≥ 40,000, median ≥ 40% of subscribers, 3 to 20 uploads in 30 days. Hidden subscriber counts count as unknown (gold false, the subscriber facet skips them).
- **D9. Pictures come through main.** The page has no network. Items carry picture keys: `v:<videoId>` and `c:<channelId>`. The page shows `app://gratovo/img/<key>`. Main builds the URL itself, never from page input: `https://i.ytimg.com/vi/<videoId>/mqdefault.jpg` (videoId checked `^[A-Za-z0-9_-]{11}$`), and a channel's stored `profile_picture` only when its host is `yt3.ggpht.com` or `yt3.googleusercontent.com`. It fetches through its own network instance allowing only those hosts, https, no redirects, at most 2 MB, image types only, and caches files under `<userData>/image-cache/` (oldest pruned past 4,000 files). Example data never fetches: it answers 404 and the page draws a placeholder (initials on the Find hue). The CSP is unchanged (`img-src 'self'`).
- **D10. Run history.** `find:runs` returns the newest 50 `search` runs from `pipeline.db` `runs`, each with found and kept counts. A catalog row's `run` is the run whose window holds the channel's first `channel_keywords.discovered_at`. "Review results" on the newest run opens Review new; on an older one it opens the gallery filtered to that run (5b; in 5a it opens Review new filtered to that run).
- **D11. Review new (triage).** Creators at stage `new`, not hidden; gold mines first, then fit. One channel at a time with its last 3 videos, numbers, sponsors, fit chip and the "emailed before" guard. Keys: S shortlist; R opens the reason row, then 1 to 4; 1 to 4 reject at once with that reason; ← → or J K step; O opens the record; Z undo is global. Keys honour the "letters" switch and never fire while typing. No animation on keys. The next channel shows at once and the tally counts up. Shortlist toast: "Looking for an email in the background" (the finder arrives in 5c; until then the toast says it lands in Contacts). Reject toast names the reason and the archive days, with Undo.
- **D12. "Emailed before".** Shown when the creator's legacy `pipeline_stage` is past `new`, or its stage is `emailed` or later, with who and when from the newest activity line on it when there is one. The full mail history arrives in step 6.
- **D13. The email finder (5c).** Python records each found address's source: `about` (the channel's About text) or `video` (and in how many video descriptions), in a new column `channels.found_email_sources` (JSON), `pipeline.db` schema version 2 (additive). Confidence is pure, in core: About with business words near it ("business", "inquiries", "collab", "sponsor") 0.95; About 0.9; 3+ video descriptions 0.8; 1–2 video descriptions 0.6. After a shortlist, main queues a `refetch` (store lane, at most 50 handles a job, waits behind a search) for shortlisted creators with no confirmed address; its tray says "Finding emails". Addresses are suggestions until a person confirms one (the old app's rule).
- **D14. Confirm address (5c).** `creator.contact {id, email, name, source, confidence}`: the email becomes the primary contact `{method:"email", value, label:name, primary:true, confirmed:true, source, confidence}`, other contacts kept, and the stage moves `shortlisted` → `contact` in the same act. Synced as a `channel.edit` of `contacts` with the stored JSON as base.
- **D15. Gemini keyword ideas (5c).** `find:ideas {count}`: main builds the topic from the best keywords (kept ratio) and calls the bridge's `action.generate_keywords` with `chats: 1`, once per click. It needs the bridge listening and the add-on connected, else `{ok:false, problem:"bridge_off"}` with a link to Settings › Connections. Example data: a stand-in returns fixed AI suggestions after 0.9 s and never calls Gemini. Sessions never send a real prompt; tests use fakes.
- **D16. What the page remembers.** Gallery display (view, card size, show toggles, sort) and the last filter: device prefs (`lib/prefs.ts`). Saved views: `local_settings` key `find.views` (per data source, at most 20) through `find:views` / `find:views-set`.
- **D17. The activity log (5c).** Toolbox › Activity log reads main's whole `activity_log` through `log:page {before?, limit ≤ 100, who?}`, newest first, grouped by day. A record's Activity tab uses `log:for {ref}`.
- **D18. Testing (ground rule 10).** 5a, 5b and 5c each add at most one light Electron smoke test. 5d ports `design/workbench-prototype/test/find_flow.py` items 1, 2 (with the stand-in), 3, 5 and 6 as Playwright tests, plus the triage keyboard matrix and undo edge cases. Item 4 (Insights) is step 9; item 7 (400 px) is dropped (Windows desktop only).

## Contracts (5a; C1 writes them exactly, later sub-steps extend them)

```ts
// packages/core/src/data/types.ts — changes
type RejectReason = "ai" | "views" | "posting" | "audience";
interface Creator {                     // existing fields kept
  id; name; handle; stage; email;       // email: the primary address or null
  emailConfirmed: boolean;              // the primary contact has confirmed: true
  rejectReason: RejectReason | null;    // newest creator.reject line; null otherwise
  rejectedAt: number | null;            // ms, that line's time (reject or never)
  archiveDueAt: number | null;          // ms, local channel_state.archive_due_at (server 7-day value)
}
interface LogEntry { id; at; who; text; ref: string | null; action: LogAction | null; detail: string | null }
type LogAction = "creator.shortlist" | "creator.reject" | "creator.restore" | "creator.never" | "creator.allow";
// DataWrite changes
| { kind: "creator.stage"; id; stage; handle: string; name: string; reason?: RejectReason }
| { kind: "log.add"; id; at; text; ref: string | null; action: LogAction | null; detail: string | null }

// packages/core/src/find/types.ts — new
interface CatalogVideo { id: string; title: string; views: number | null; publishedAt: number | null; pic: string | null } // pic "v:<id>"
interface CatalogItem {
  id: string; name: string; handle: string; pic: string | null;     // "c:<channelId>"
  stage: CreatorStage; emailConfirmed: boolean; email: string | null;
  subscribers: number | null; medianViews: number; uploads30: number;
  country: string | null; sponsors: string[]; foundEmails: number;  // count of found addresses
  latestUploadAt: number | null; foundAt: number | null; run: number | null; keyword: string | null;
  videos: CatalogVideo[];             // newest 3
  engagement: number | null;          // manual_engagement_rate
  emailedBefore: { at: number | null; who: string | null } | null;
  rejectReason: RejectReason | null; archiveDueAt: number | null;
  hasNumbers: boolean;                // false for a channel_state row with no pipeline channel
}
interface FitPart { key: "median" | "posting" | "audience" | "engagement" | "sponsored"; points: number; of: number; note: string }
interface Fit { score: number; parts: FitPart[] }
interface FindFilter { stages: CreatorStage[]; signals: Signal[]; countries: string[]; minMedian: number; maxMedian: number | null; minUploads: number; runs: number[]; q: string }
type Signal = "gold" | "sponsored" | "email" | "confirmed" | "fresh";
type FindSort = "fit" | "median" | "subs" | "found" | "latest" | "triage"; // triage: gold first, then fit
interface Facets { stages: Record<CreatorStage, number>; signals: Record<Signal, number>; countries: Record<string, number>; runs: Record<string, number> }
// pure: fitOf(item), isGold(item), passes(item, filter, skip?), sortItems(items, sort), facetCounts(items, filter)

// packages/ipc — new channels (zod, strictObject, every list and string bounded)
"find:query": { filter: FindFilter; sort: FindSort; offset: 0..100000; limit: 1..120 }
           -> { version: number; total: number; items: (CatalogItem & { fit: Fit })[]; facets: Facets }
"find:item":  { id } -> { item: (CatalogItem & { fit: Fit; description: string; videos: CatalogVideo[] /* up to 15 */ }) | null }
"find:runs":  {} -> { runs: { id: number; startedAt: number; finishedAt: number | null; status: string; keywords: number; found: number; kept: number; gold: number }[] }
event "find:catalog": { version: number }
// app protocol: GET app://gratovo/img/<key>, key ^(v:[A-Za-z0-9_-]{11}|c:UC[A-Za-z0-9_-]{22})$ -> image bytes or 404

// pipeline protocol (protocol.ts, protocol.schema.json, protocol.py together)
searchJob gains  skip?: string[]  // channel ids, at most 20000, each ^UC[A-Za-z0-9_-]{22}$
```

## Tasks, 5a

Tiers by the migration plan's §10. Done-checks are run by the lead, never trusted from a report.

| id | tier | depends | files (about) | spec | done-check |
|---|---|---|---|---|---|
| C1 | H | – | `packages/core/src/data/types.ts`, `packages/core/src/find/types.ts`, `packages/ipc/src/{find,data,channels,events}.ts`, `main/pipeline/protocol.ts` + schema + `protocol.py`, handler stubs | The contracts above, exactly. Stubs answer empty. Update fixtures and fakes so everything compiles. | `pnpm typecheck`, `pnpm test` |
| B1 | N | C1 | `packages/core/src/find/{fit,filter}.ts` + tests | Port `W.fit`, `W.gold`, `passes`, `SORTS`, facet counts (find.js l.62-84, engine.js l.36-48) under D8. Every branch tested. | `pnpm exec vitest run packages/core` |
| B2 | N | C1, B1 | `main/find/catalog.ts` + test, `main/find/runs.ts` + test, handlers | D1, D2, D10. Temp `pipeline.db` built with the Python schema (copy the DDL into the test from `store.py`), temp `gratovo.db` through the repositories. | vitest on the files |
| B3 | H | C1 | `main/data/repositories/{creators,activity-log}.ts`, `main/data/sqlite-source.ts`, `main/sync/intents.ts`, contract tests | D4, D5: the upsert, tags, local due date, log ref/action/detail to the server row, the creator fields read in the frame. | contract suite + sync tests |
| B4 | H | C1 | `main/find/images.ts` + test, `main/app-protocol.ts` | D9. Fake network in tests. | vitest; `pnpm typecheck` |
| B5 | N | C1 | `renderer/lib/persist.ts`, `renderer/lib/find-catalog.ts` (query hook), `renderer/lib/find-actions.ts` + tests | D2 overlay, D3 adopt, shortlist/reject/restore/never acts with toasts (D11 words in `strings.ts`). | vitest on the files |
| B6 | N | B5 | `renderer/find/triage.tsx`, `triage-card.tsx`, `runs.tsx`, `find-screen.tsx`, `lib/wired.ts`, `strings.ts`, `find.css` + tests | D11, D12, D10 table (prototype find.js l.222-252, records.js l.241-302). Live: `find: ["search","triage"]`. | vitest; screenshot at 1440 dark |
| B7 | N | C1 | `services/pipeline/.../jobs/search.py`, `search/keyword.py`, `store.py` + tests | D7 `skip`. Main fills it from never-contact creators. | pytest, pyright |
| W1 | N | B2-B7 | `main/index.ts`, `main/find/find-service.ts` | Wire the catalog to the find service and data writes; `find:catalog` events; `skip` in the start message. | `pnpm test` |
| T1 | N | W1 | `e2e/find-triage.spec.ts` | One smoke test: example search, Review new shows a channel, S shortlists and the next shows, Undo brings it back. | Windows e2e |
| R1 | H | all | – | `router-reviewer` on the diff. Findings become tasks. | – |
| L1 | lead | R1 | – | Full checks, look at it in dark at 1440, status table, PR, CI, merge. | CI green |

## 5b: the gallery and the creator record

Branch `feat/5b-find-gallery-record` from `main` after #20 merges.

**Decisions, 5b**
- **D19. Paging, not one big list.** The gallery asks for pages of 120 and loads the next page when the last card scrolls into view. "Select all" selects every item loaded so far and says how many ("Select the 240 shown"); a bulk action never touches channels the page hasn't loaded. Shift-click selects the range between two loaded cards; Ctrl-click toggles one; Ctrl A selects the loaded ones; Esc clears.
- **D20. Filters and display.** The filter is `FindFilter` (the shape step 9's Insights drill-down will write). The last filter, sort, view (gallery or table), card size (S, M, L) and the three show toggles (Pictures, Latest video, Signals) are device prefs. Saved views are `local_settings` `find.views` (D16): `{name ≤ 60, filter}`, at most 20, through `find:views` and `find:views-set`. Facets: Stage, Signals, Channel country (D8), Median views at least (Any, 25K, 45K, 80K), Uploads in 30 days (Any, 3, 5), Found by (runs). No "Who has it" (step T).
- **D21. Bulk bar.** Shortlist (new or rejected), Reject with a reason picker, Compare (2 to 4). "Give to…" waits for step T.
- **D22. Compare.** Up to 4 loaded items side by side, the prototype's rows (find.js l.323-344) with D8's honest rows: fit, subscribers, median views, uploads (Shorts flagged over 20), engagement ("not known"), channel country, sponsors. Best value per row in the good tone.
- **D23. The creator record (peek and page).** One body, `renderer/record/creator-*.tsx`, used by the peek (narrow) and the record page (wide). Tabs: **Overview** (header: avatar, name, handle with a link to the channel on YouTube, stage tag, fit chip; the one next step with its button: new → Shortlist / Reject, shortlisted → "Confirm an address" (disabled with "arrives with contacts" in 5b; 5c wires it), rejected → Bring back, never → Allow again; numbers; the latest 6 videos with thumbnails, each opening on YouTube; fit parts with notes; sponsors; found addresses count; the channel description, first 600 characters with "Show all"), **Notes** (a text box saved on blur, "Saved" flag, not undoable, like your name), **Activity** (the lines on this creator, `log:for`, newest first, with who and when). Emails and Deals tabs wait for steps 6 and 8 (hidden). Opens from cards, the table, triage (O), the palette and notifications. Alt ↑/↓ walks the list it was opened from (the existing `peek(record, list)`).
- **D24. Notes.** `creator.notes {id, notes ≤ 50,000}` (the lead raised it from 5,000 after C2: a longer note pulled from the server comes back cut with `notesCut: true` and the Notes tab shows it read-only, so a save can't drop the rest) is a write the page sends straight through `data:write` (not through the persister: notes aren't in the frame). Main stores `channel_state.notes` (creating the row as D4 does, real ids only) and enqueues `channel.edit notes` with the stored text as base. The catalog item detail (`find:item`) carries `notes`.
- **D25. Links out.** Video and channel links are `https://www.youtube.com/watch?v=<id>` and `https://www.youtube.com/channel/<id>`, built from checked ids and opened through the existing external-link allowlist.
- **D26. "Review results"** on an older run opens the gallery filtered to that run (`runs: [id]`, stages empty); the newest run still opens Review new. The run filter moves from triage's module store into the filter itself.

**Contracts, 5b**
```ts
// packages/core/src/find/types.ts
interface SavedView { name: string; filter: FindFilter }          // name 1..60, at most 20 views
// find:item detail gains: notes: string (≤ 50000), notesCut: boolean
// DataWrite gains:
| { kind: "creator.notes"; id: string; notes: string; handle: string; name: string }
// packages/ipc channels
"find:views":     {} -> { views: SavedView[] }
"find:views-set": { views: SavedView[] } -> { ok: true } | { ok: false; problem: "too_many" }
"log:for":        { ref: string; limit: 1..100 } -> { lines: LogEntry[] }               // newest first
```

| id | tier | depends | files (about) | spec | done-check |
|---|---|---|---|---|---|
| C2 | H | – | core types, ipc, `main/handlers.ts`, `main/data/repositories/{creators,activity-log}.ts`, `main/sync/intents.ts`, `main/find/catalog.ts` (notes in detail), settings read/write | Contracts 5b plus their main side: views in `local_settings`, `log:for` query (one indexed query), notes write + outbox + contract tests. | `pnpm test` |
| G1 | N | C2 | `renderer/find/gallery.tsx`, `gallery-facets.tsx`, `gallery-toolbar.tsx`, `gallery-chips.tsx`, `saved-views.tsx`, `lib/find-filter-prefs.ts` + tests | D19 paging hook use, D20: the shell, facets with counts, chips, search, sort, view and size toggles, saved views; results area renders `GalleryResults` (G2) | vitest |
| P1 | N | C2 | `renderer/record/creator-*.tsx`, `overlays/peek.tsx`, `app/record-page.tsx`, `lib/wired.ts` (record) + tests | D23, D24, D25 | vitest |
| G2 | N | G1 | `renderer/find/gallery-results.tsx`, `gallery-card.tsx`, `gallery-table.tsx`, `bulk-bar.tsx`, `compare.tsx` + tests | D19 selection, cards with hover flip (find.js l.297-322), table, D21, D22 | vitest |
| W2 | N | G2, P1 | `find-screen.tsx`, `runs.tsx`, `triage.tsx`, `lib/wired.ts`, `e2e/find-gallery.spec.ts` | live `find: ["search","triage","gallery"]`, `record: ["creator"]` (check the shape); D26; one smoke test: gallery shows the found channels, a facet narrows them, Shift-select two, Compare shows both, open one in the peek | Windows e2e |
| R2 | H | all | – | review | – |
| L2 | lead | R2 | – | checks, look at it, PR, merge | CI |

## Tasks, 5c, 5d (outline; detailed when each starts)

- **5c:** C3 contracts (`creator.contact`, `find:ideas`, `log:page`, `toolbox:archive`, `toolbox:archived`, jobs `archive.sweep`, `archive.restore`, `refetch` after shortlist, schema v2 `found_email_sources`); Python email sources; core confidence; Contacts tab and Confirm with name, Confirm all 90%+; keyword ideas inline; Toolbox screen with Archive, Never-contact, Activity log; live gate; smoke test.
- **5d:** the Find flow suite (D18), ADR 0017, architecture and parity notes, the status table, `.router/` removed.
