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
| **5c** | Contacts (the email finder with source and confidence, Confirm address with the name, Confirm all 90%+), Gemini keyword ideas | Find › Contacts |
| **5d** | Toolbox › Archive (countdown, sweep, Bring back), Never-contact, Activity log | Toolbox |
| **5e** | The consolidated Find flow suite (Playwright), ADR 0017, docs, status table | – |

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
| { kind: "creator.notes"; id: string; base: string; notes: string; handle: string; name: string }   // base: the text the edit started from ("" = none), ≤ 50000
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

## The rest of step 5: three more pull requests (lead, after 5b)

5c, 5d and 5e replace the old "5c" and "5d" outline: one pull request for contacts, keyword ideas and Toolbox would have been the largest yet, so Toolbox gets its own. The sub-step table above reads: 5c contacts and keyword ideas, 5d Toolbox, 5e the flow suite and ADR 0017.

## 5c: contacts, the email finder and keyword ideas

**Decisions, 5c**
- **D27. Where an address came from.** Python records, per found address, `{email, source: "about"|"video", videos: n, business: bool}` in a new column `channels.found_email_sources` (JSON), `pipeline.db` schema version 3 (additive `ALTER TABLE`; `found_emails` stays as it is). `business` is true when a business word ("business", "inquiries", "enquiries", "collab", "sponsor", "partnership", "brand deals") sits within 40 characters before the address. Imported old rows have no sources: their addresses read as `{source:"about", videos:0, business:false}`.
- **D28. Confidence** (core, pure, `emailConfidence(found)`): About with a business word 0.95; About 0.9; video descriptions in 3 or more videos 0.8; in 1 or 2 videos 0.6. Free-mail domains (gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, proton.me, protonmail.com) take 0.05 off. Shown as "95% sure". Sorted most sure first.
- **D29. Catalog items carry their addresses:** `emails: FoundEmail[]` (at most 10, most sure first), replacing the `foundEmails` count (the count is `emails.length`).
- **D30. The finder after a shortlist (live only).** After a shortlist, main queues a store-lane `refetch {handles}` with no auto-clean for the shortlisted creators with no confirmed address (at most 50 handles a job; more → several jobs; a running search → it waits behind it). The tray shows "Finding emails for <n> channels", then "<k> emails found". Refetch re-reads the About text and the latest videos, so the addresses and their sources refresh. Example data never refetches (refetch has no offline source): the addresses the search read are used as they are, and the tray says nothing.
- **D31. Confirm an address.** Undoable (`act`). The creator gains `contactName: string | null`. Confirming sets `email`, `emailConfirmed: true`, `contactName`, and moves `shortlisted` → `contact`. The persister writes `creator.contact {id, email, confirmed, contactName, source, confidence, handle, name}` when `email`, `emailConfirmed` or `contactName` change (and `creator.stage` for the stage). Main stores it as the primary contact `{method:"email", value, label: contactName, primary:true, confirmed, source, confidence}`, other contacts kept (R3: the old primary stays with `primary:false`; entries with the new address fold into the new primary, which keeps an existing label when the name is empty; an unconfirmed address on undo may be any old value up to 1,000 characters), and enqueues `channel.edit contacts` with the stored JSON as base. Undo writes the previous contact back the same way. An address typed by hand is allowed (checked as an address; source `"typed"`, confidence null).
- **D32. Find › Contacts.** Creators at `shortlisted`, those still being looked up last (prototype find.js l.419-432). Each card: the channel, "N addresses found" with each address, where it came from and how sure; a name field ("Who reads this inbox?", optional, used in the greeting later); Confirm per address; "Type another address". "Confirm all 90%+ (n)" confirms the best address of each card whose best is at least 0.9, in one act, names left empty. Empty state as the prototype. The record's "Confirm an address" (D23) opens the same contact block in the peek.
- **D33. Gemini keyword ideas** are D15: `find:ideas {count 1..20}` → `{ok:true, keywords, dropped}` or `{ok:false, problem:"bridge_off"|"busy"|"failed"}`. The topic is built in main from the five best keywords by kept ratio (at least 3 found) and the agency niche ("AI tools and AI news on YouTube"); the queue's keywords go as the bridge's `avoid` list ("already searched, don't repeat"), not `exclusions`, which would forbid the very topics the request is built from (lead, R3). One request at a time (`busy`). The Keywords card's "Suggest with Gemini" shows the prototype's inline picker (find.js l.130-140). Example data: a stand-in in main returns 8 fixed AI keywords after 0.9 s and never calls the bridge.

**Contracts, 5c**
```ts
// core: data/types.ts
type ContactSource = "about" | "video" | "typed";
interface Creator { ...;
  contactName: string | null;            // primary email contact's label (≤ 80) when it is confirmed, else null
  contactSource: ContactSource | null;   // primary email contact's stored source, null when absent
  contactConfidence: number | null;      // its stored confidence 0..1, null when absent
}
interface CreatorState { ...; contactName: string | null }
| { kind: "creator.contact"; id; email: string | null /* ≤ 254, basic shape */; confirmed: boolean;
    contactName: string | null /* ≤ 80 */; source: ContactSource | null; confidence: number | null /* 0..1 */;
    handle: string; name: string }
// The persister writes creator.contact from the Creator's email, emailConfirmed, contactName,
// contactSource and contactConfidence when any of them changes, before creator.stage.
// core: find/types.ts
interface FoundEmail { email: string; source: "about" | "video"; videos: number; business: boolean; confidence: number }
interface CatalogItem { ...; emails: FoundEmail[] /* ≤10, most sure first */; contactName: string | null } // foundEmails removed
// ipc
"find:ideas": { count: 1..20 } -> { ok: true; keywords: string[]; dropped: number } | { ok: false; problem: "bridge_off" | "busy" | "failed" }
// pipeline: schema 3, channels.found_email_sources TEXT (a JSON list as D27)
```

| id | tier | depends | files (about) | done-check |
|---|---|---|---|---|
| C3 | H | – | core types, ipc, the persister rule, main `creator.contact` repository + intent, catalog `emails` (empty until B9), `find:ideas` handler stub | `pnpm test` |
| B8 | N | C3 | Python: `found_emails.py` sources, `store.py` schema 3, `search/signals.py`, the import job's column list; tests | pytest, pyright |
| B9 | N | C3 | core `emailConfidence` + tests; the catalog reads `found_email_sources` | vitest |
| B10 | H | C3 | main: the finder queue after a shortlist (refetch jobs, the tray job), `find:ideas` with the bridge and the stand-in | vitest |
| B11 | N | C3, B9 | renderer: Contacts tab, the contact block (shared with the record), Confirm, Confirm all 90%+, typed address; the record's next step wired | vitest |
| B12 | N | C3 | renderer: keyword ideas in the Keywords card | vitest |
| W3 | N | all | wiring; live `find` gains `contacts`; rail and page subtitles; one smoke test (example: search, shortlist two in Review new, Contacts shows them, Confirm all 90%+ moves them on, the record says Contact confirmed) | Windows e2e |
| R3 | H | all | review | – |
| L3 | lead | R3 | checks, look, PR, merge | CI |

## 5d: Toolbox (Archive, Never contact, Activity log)

Detailed 2026-10-25 (lead, Opus) on `main` at f3d9883. Prototype: `more.js` l.426-607 (`TOOLS`, `ArchiveTool`, `NeverTool`, `LogTool`) and l.744-802 (`Toolbox`). Already built: the acts `bringBack`, `neverContact` and `allowAgain` (`renderer/lib/find-actions.ts`), `log:for`, the catalog, the store-lane pattern in `main/find/email-finder.ts`, and Python's `store.archive_channel_locally` (the tombstone goes in first, then the channel, its keywords and its videos are deleted) and `store.unarchive`.

**Decisions, 5d**
- **D34. Toolbox is a screen with route tabs.** Its tools are the route's tabs: `archive` "Archive", `never` "Never contact", `log` "Activity log" (strings `screens.toolbox.tabs`), so the URL, the palette, G then X and the live gate work as they do for Find. Live: `liveWired.toolbox = ["archive", "never", "log"]`. The page draws the prototype's two columns: the tool list (groups "Tools" and "History", each row with its icon, name, one-line description and a count) and the open tool's pane (icon, name, the long description, a divider, the tool). Only built tools are listed, on live and example data alike: the price calculator, Scheduled emails and Notifications come with their steps (8, 6, 7), and the "Moved" group and the Settings link are not drawn. J and K step through the tools (letters switch, never while typing). Counts: Archive is the countdown list's total, Never contact its total, Activity log the lines since local midnight ("Changes today"). They come from `toolbox:counts`, read again on each `find:catalog` and whenever the frame's newest log line changes.
- **D35. When a channel is archived for good.** Pure in core: `archiveDate({archiveDueAt, rejectedAt}, archiveDays)` = `archiveDueAt + (archiveDays − 7)` days (D6); with no due date, `rejectedAt + archiveDays` days; with neither (an old app's reject that never got a tag), null. A null date is never swept: the list says "No archive date" and Bring back still works (the old app never archived these either).
- **D36. The countdown list** (`toolbox:list {list:"archive"}`): creators at `rejected` that aren't archived for good yet (`archivedAt` null), soonest date first (null last, then by name). Each row as the prototype: picture, name, handle, the reason (`rejectReason` words, else "Rejected"), how long ago (`rejectedAt`), "archived for good in N days" or "archived today" with a meter (days left of `archiveDays`, warn at ≤ 1), and Bring back (the `bringBack` act, undoable). Clicking a row opens the peek over the list. Empty state as the prototype. Below it, **"Archived for good"** (`toolbox:archived`): every tombstone in `channel_archive` (from the 7-day sweep, the search rules and the import), newest first, 50 a page with "Show more", and a search box matching handle or name. Each row: handle (the name when known), the label (`rejected` reads "Rejected"; any other label is shown as written, since it is the search rules' label), when, subscribers, and Bring back.
- **D37. The sweep.** Main's archive service (`main/find/archive-service.ts`) picks the creators at `rejected` with `archivedAt` null whose `archiveDate` has passed, and runs the store-lane job `archive.sweep {channels:[{channelId, handle}]}` (at most 2,000 a job; more means several jobs). Python tombstones each one with label `rejected` through `archive_channel_locally`, which deletes its pipeline rows as the search rules' sweep does. A channel with no pipeline row still gets a tombstone, so searches skip it and the sweep never picks it again. The `channel_state` row stays `rejected` (history kept, nothing goes to the server). It runs once after the first catalog build, hourly, and on `toolbox:sweep` (the Archive tool calls it when it opens), on live and example data (it is local). When the lane is busy it waits behind a search, the import or the finder, trying again every 5 s, and it gives way when Start is pressed (`yieldLane`, as the finder does). One sweep at a time; a request while one runs or waits is folded into it.
- **D38. Bring back from "Archived for good"** (`toolbox:restore {ids ≤ 50}`). When the creator is at `rejected`, the page first runs the `bringBack` act (an undoable stage change). Then main runs `archive.restore {channelIds}` on the store lane: Python deletes those tombstones and answers with each one's handle. It waits for the finder or a sweep to finish (up to 60 s) but not for a search: during a search the answer is `{ok:false, problem:"busy"}` and the toast says to try again when it pauses or ends. On live data main then refetches the restored handles in the background (no auto-clean, at most 50 a job; the refetch gives way to a search as the finder's does), so their numbers come back and they show in Review new. Example data has no refetch: the channel returns when a search finds it again, and the toast says so. A tombstone with no handle can't be refetched and gets the same words as example data. The record's "Bring back" (`creator-next.tsx`) does the same when the item is archived for good.
- **D39. Never contact.** `toolbox:list {list:"never"}`: creators at `never`, newest first by `rejectedAt` (null last, then by name). Each row: picture, name, the reason the person wrote (`neverReason`, else "No reason saved") · how long ago, a "Never" tag, and "Allow again", which turns in place into "Yes, allow emails" (primary) and "Keep blocked" (ghost); yes runs `allowAgain`. "Add a channel": a search box over the catalog (`find:query` with `q`, every stage but `never`, sort `fit`, limit 8) showing name, handle and stage, where picking one fills it in; a reason field ("Why (optional), for example: asked us to stop", at most 500); and Never contact, which runs `neverContact(item, reason || "Owner chose never contact")`. A creator's `neverReason` is the `detail` of its newest visible `creator.never` line while its stage is `never`, else null (read where `rejectReason` is read). The acts set it: `neverContact` to the text; `allowAgain`, `bringBack` and `reject` to null.
- **D40. Activity log** (`log:page`). The whole local `activity_log`, newest first, hidden and mapped exactly as `newestLog` does (undo markers, the money rule for a member without money), 30 a page; "Show more" loads the next 30 after the last line (`before` = its `{at, id}`). Person chips: "Everyone" with the total, then each person who has lines (`people`: the member id, else the old app's name; the name from `profiles`, else the line's `actor_name`; at most 50, most lines first; you read "You"). Grouped by local day ("Today", "Yesterday", else the date) with "N changes". Each line: avatar, text, who · time, and the creator's name when it has a `ref`. Such a line is a button that opens the creator's peek (the catalog item, as the gallery does). The first page is read again when the frame's newest line changes, so a change shows at once.
- **D41. The reject toast** reads "<reason>. Bring it back from Toolbox › Archive before it is archived for good." (`strings.toasts.rejectSub`). No other copy changes.

**Contracts, 5d**
```ts
// core: data/types.ts
interface Creator { ...; neverReason: string | null }        // ≤ 500, D39
interface CreatorState { ...; neverReason: string | null }
// core: find/types.ts
interface CatalogItem { ...;
  rejectedAt: number | null;      // ms, as Creator.rejectedAt
  neverReason: string | null;     // as Creator.neverReason
  archivedAt: number | null;      // ms, channel_archive.archived_at when the channel has a tombstone, else null
}
type ToolboxList = "archive" | "never";
interface ToolboxItem extends CatalogItem { dueAt: number | null }   // archive: archiveDate(); never: null
interface ArchivedChannel {
  id: string; handle: string | null; name: string | null;   // name from the app's channels table when known
  label: string | null; archivedAt: number | null; subscribers: number | null;
  stage: CreatorStage | null;     // the creator's stage when a channel_state row exists
}
// core: find/archive.ts (pure)
function archiveDate(c: { archiveDueAt: number | null; rejectedAt: number | null }, archiveDays: number): number | null;
// ipc (zod strictObject, bounded)
"toolbox:list":     { list: ToolboxList; offset: 0..100000; limit: 1..120 } -> { version: number; total: number; items: ToolboxItem[] }
"toolbox:archived": { q: string /* ≤ 100 */; offset: 0..100000; limit: 1..100 } -> { total: number; items: ArchivedChannel[] }
"toolbox:restore":  { ids: channelId[] /* 1..50, unique */ } -> { ok: true; restored: number; refetch: boolean } | { ok: false; problem: "busy" | "no_python" }
"toolbox:sweep":    {} -> {}
"toolbox:counts":   {} -> { archive: number; never: number; archived: number; logToday: number }
"log:page": { before: { at: number; id: string } | null; limit: 1..100; who: string | null /* ≤ 100 */ }
         -> { lines: LogEntry[]; more: boolean; people: { who: string; name: string; count: number }[] /* ≤ 50 */ }
// pipeline protocol (protocol.ts, protocol.schema.json, protocol.py together), store lane
archive.sweep   { channels: { channelId: UC…; handle: string | null }[] /* 1..2000, unique ids */ } -> result { kind: "archive.sweep"; archived: number }
archive.restore { channelIds: UC…[] /* 1..2000, unique */ } -> result { kind: "archive.restore"; restored: { channelId: string; handle: string | null }[] }
```

| id | tier | depends | files (about) | done-check |
|---|---|---|---|---|
| C4 | H | – | core types (`neverReason`, catalog fields, `ToolboxItem`, `ArchivedChannel`), `core/find/archive.ts` + test, ipc channels + schemas + tests, protocol jobs and results (TS, JSON schema, Python types), `laneFor`, handler stubs, fixtures and fakes | `pnpm typecheck`, `pnpm test` |
| B13 | N | C4 | `services/pipeline/.../jobs/archive.py` + the job dispatch + tests | D37, D38 Python side: sweep (tombstone with label `rejected`, a channel with no row too, idempotent), restore (deletes tombstones, returns handles; unknown ids skipped). pytest, pyright |
| B14 | N | C4 | `main/data/repositories/creators.ts` (neverReason), `main/find/catalog.ts` (`rejectedAt`, `neverReason`, `archivedAt` from `channel_archive`), `main/find/toolbox.ts` + test (list, counts, the archived reader: read-only `node:sqlite`, LIKE escaped), handlers for list, archived and counts | vitest on the files, contract suite |
| B15 | H | B13, B14 | `main/find/archive-service.ts` + test, `main/index.ts`, handlers `toolbox:sweep` and `toolbox:restore`, the `find-service` yield hook | D37, D38 main side with a fake supervisor: waits, yields to a search, chunks, folds requests, live refetch only, none on example data. vitest |
| B16 | N | C4 | `main/data/repositories/activity-log.ts` (`logPage`, the people counts, lines since a time), handler `log:page` + tests | D40 main side: paging by `(at_ms, id)`, the same hiding and money rule, people counts. vitest |
| B17 | N | B14 | `renderer/toolbox/toolbox-screen.tsx`, `toolbox-list.tsx`, `archive-tool.tsx` + tests, `lib/toolbox.ts` (hooks), `lib/wired.ts`, `app/app.tsx`, `strings.ts`, css | D34, D35 words, D36 (countdown and "Archived for good" with paging and search, Bring back both ways, the sweep call on open), D38 page side, D41. vitest; look at 1440 dark |
| B18 | N | B16, B17 | `renderer/toolbox/never-tool.tsx`, `log-tool.tsx` + tests, `lib/find-actions.ts` (`neverReason`), `record/creator-next.tsx` (bring back when archived), `strings.ts` | D39, D40 page side. vitest; look at 1440 dark |
| W4 | N | B15-B18 | `e2e/toolbox.spec.ts` | One smoke test on example data: reject one in Review new, Toolbox › Archive lists it with its countdown, Bring back takes it out, the Activity log shows both lines. Windows e2e |
| R4 | H | all | – | `router-reviewer` on the diff; findings become tasks |
| L4 | lead | R4 | – | checks, look, status table, PR, CI, merge |

## 5d-2: the archive keeps its data (owner, 2026-10-25, after 5d merged)

The owner: what found a channel and when, its subscribers and the videos we had must survive archiving, because keyword analytics needs them. In the old app the archive was flaky: data went missing, and it was never filled for channels that were deferred or archived. Gaps found by the lead on `main` at 2c2bbb9:
1. The 7-day sweep (`jobs/archive.py`) calls `archive_channel_locally` without `found_via`, so the tombstone's keyword list is empty. (The search rules' sweep passes only the one keyword in hand, not the channel's earlier ones.)
2. Restore (`store.unarchive`) deletes the tombstone and its `found_via`; refetch then files the channel under `__manual_refetch__`. The keywords that really found it are lost.
3. The tombstone keeps no name, country, uploads in 30 days, latest upload, sponsors or found addresses.
4. Deferred channels (auto-clean `delay`) wait for the backlog (`search/backfill.py`, a slice after each keyword). Unproven end to end that none stays empty for good.

**Decisions, 5d-2**
- **D42. One rule: archiving never makes us know less.** The tombstone keeps every fact the channel row and its links hold that a later step reads: name, handle, subscribers, country, first seen, every keyword that found it with its `discovered_at` (from `channel_keywords`, merged with any `found_via` passed in, deduped by keyword, earliest time kept), uploads in 30 days, latest upload, median views with its basis, the number of videos we had, sponsors seen, found addresses and their sources. `pipeline.db` schema version 4 adds the missing columns to `channel_archive` (additive `ALTER TABLE`, nullable: `name`, `country`, `videos_last_30`, `latest_upload_at`, `seen_brands`, `found_emails`, `found_email_sources`). One helper builds the tombstone for every path that archives (the 7-day sweep, the rules' sweep, refetch's sweep, the import), so no path can forget a field. A null means "never known", never "zero".
- **D43. Archiving again never says less.** When a channel already has a tombstone (a re-sweep, a re-find, another path), each fact merges: keywords are a union, numbers keep the larger video count with its median (as `merge_archive_numbers`), text facts keep the known value over null. Nothing is overwritten with null or with a smaller count. ("Smaller" is about the videos we had, `videos_found_count`; uploads in 30 days is a window, so a fresher read may be smaller and wins.)
- **D44. Bring back puts the facts back.** `archive.restore` recreates, in one transaction, the `channels` row from the tombstone (handle, name, subscribers, country, first seen, uploads in 30 days, latest upload, median, sponsors, addresses; `videos_fetched_at` null and `force_refetch` 1 so the next read refreshes it and the backlog picks it up), the `channel_keywords` rows from `found_via` with their original times, then deletes the tombstone. The catalog shows the channel at once on live and example data, with its last known numbers. On live data the refetch still runs to refresh it; its `__manual_refetch__` link is not counted as a keyword that found the channel (keyword analytics and the catalog's "found by" skip that keyword).
- **D45. Deferred channels get filled.** The backlog must reach every channel still missing its uploads, deferred ones included, until it is read or archived; and a channel with no uploads read shows "not read yet" in Find, never 0 views. Proven by tests (a delayed channel is a backlog candidate, is read on the next keyword's slice, and leaves the backlog once read). Any gap found is fixed here.
- **D46. "Archived for good" shows what is kept:** name (else handle), country, subscribers, median views, uploads in 30 days, and the keywords that found it (up to 3, "+N more"); unknowns read "not known".

**Contracts, 5d-2**
```ts
// core: find/types.ts — ArchivedChannel gains (all from the tombstone; null = never known)
country: string | null; medianViews: number | null; uploads30: number | null;
latestUploadAt: number | null; videos: number | null;          // videos we had when it was archived
keywords: { keyword: string; at: number | null }[];             // ≤ 50, earliest first, __manual_refetch__ left out
```
Pipeline: schema 4 (above). Python helper in `store.py`: `archive_channel_locally` builds the full tombstone itself from the channel row and links (callers may pass extra `found_via`), and merges into an existing one (D43); `restore_channel_locally(conn, channel_id)` does D44 and returns the handle. `jobs/archive.py` uses both. Main's readers (`catalog.ts`, `runs.ts`, `toolbox.ts`) tolerate a schema-3 file (missing columns read null).

| id | tier | depends | files (about) | done-check |
|---|---|---|---|---|
| A1 | H | – | `store.py` (schema 4, the tombstone helper, merge, restore), `jobs/archive.py`, `search/auto_clean.py` and `jobs/refetch.py` callers, `import_legacy.py` if it writes tombstones, tests | D42–D44: every archive path keeps every fact; re-archive never says less; restore brings the row and links back; a schema-3 file migrates; legacy flakiness cases from `legacy/lib/features/archive/` and `legacy/pipeline/gratovo/store.py` turned into tests. pytest, pyright |
| A2 | N | A1 | `search/backfill.py`, `store.py` backlog queries, tests | D45: tests prove deferred channels are filled; fix any gap | pytest |
| A3 | N | A1 | core `ArchivedChannel` fields and `CatalogItem.uploadsRead`, ipc schemas, `main/find/toolbox.ts` and other readers (tolerate schema 3, skip `__manual_refetch__`), tests | D44 main side | vitest |
| A4 | N | A3 | renderer: Find shows "Not read yet" where `uploadsRead` is false (card, table, triage, record, compare; fit notes in core), the Archived-for-good rows (D46), restore words now that a channel shows at once | D45 page side, D46 | vitest; look at 1440 dark |
| R5 | H | all | – | review of the diff against D42–D46 | – |
| F1 | H | R5 | `store.py`, `jobs/backfill.py`, `search/keyword.py`, `search/discover.py`, `jobs/import_legacy.py`, `jobs/refetch.py`, tests | R5 findings 1–9, Python side: the median with its basis and a known 0 uploads survive bring back then archive again; read failures counted (`channels.read_failures`), back-off 1, 3, 7 days, out of the backlog after 3 (`READ_GIVE_UP`); a pause after every failed read; the import merges an old tombstone into an existing one; tombstone read inside the transaction; `force_refetch` on bring back over an existing unread row; `__manual_refetch__` never written into a tombstone; backfill keeps the ids read before a later page failed. pytest, pyright |
| F2 | N | F1 contract | core `CatalogItem.readFailed`, ipc schema, `catalog.ts` (tolerant read of `read_failures`), `toolbox.ts` (`keywordsTotal`), `ArchivedChannel.keywordsTotal`, Find pages, strings, tests incl. `results.ts` skipping the refetch keyword | "Couldn't read" where "Not read yet" shows once a channel gave up; "+N more" counts every keyword. vitest; look at 1440 dark |
| L5 | lead | R5 | – | checks, e2e, status table, PR, CI, merge | CI |

## 5e: the flow suite and the record of decisions (outline)

The Find flow suite (D18), ADR 0017 (step 5's decisions), architecture and parity notes, the status table, `.router/` removed.
