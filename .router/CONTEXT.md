# CONTEXT: plan P3 (Find, Reach and frame additions)

Worktree root: `E:\IMA work\Code\gratovo_toolbox\.claude\worktrees\p3` (branch `feat/p3-find-reach-frame`). Paths below are repo-relative unless absolute. `~` = line not grepped, approximate. Renderer = `apps/desktop/src/renderer`.

## 1. Commands, strings, live gate

- Lint: `pnpm lint` (root) = `eslint . && prettier --check . && ruff check && ruff format --check` (services/pipeline). Desktop package has no lint script.
- Typecheck: `pnpm typecheck` (root) = `tsc -b && uv run --directory services/pipeline pyright`.
- Unit: `pnpm test` = `vitest run` + gemini ext + pytest. Root `vitest.config.ts` includes `apps/*/src/**/*.test.{ts,tsx}`.
- One vitest file: `pnpm exec vitest run apps/desktop/src/renderer/find/triage.test.tsx` (from root).
- Gate for a PR: `pnpm verify` (`tooling/verify.ts`); `pnpm verify --status`.
- E2E: `pnpm --filter @gratovo/desktop test:e2e` = `install-electron && electron-vite build && playwright test`. Config `apps/desktop/playwright.config.ts`, specs `apps/desktop/e2e/*.spec.ts` (e.g. `find-flow.spec.ts`, `find-contacts.spec.ts`, `close-roster.spec.ts`, `accessibility.spec.ts`). Single spec: append `-- e2e/<name>.spec.ts` (inferred from the script; not run).
- Desktop scripts: `build`, `dev`, `preview`, `test:e2e` only (`apps/desktop/package.json`).
- Strings: ONE file `apps/desktop/src/renderer/strings.ts` (~4,800 lines), exported as `strings`. Grouped by screen/part namespace: `shortcuts` :191, `palette` :160, `peek` :1174, `findSearch` :1205, `findTriage` :1404, `findGallery` :1471, `findRuns` :1655, `screens` :1685 (rail names, tabs), `actions` :1762, `insights` :1879, `findActions` :3681, `toolbox` :3702, `findContacts` :3816, `creatorRecord` :3865, `brandRecord` :4075, `dealRecord` :4123, `record` :4173, `reach` :4206 (`reach.board`, `reach.replies`, `reach.sequences`, `reach.mailboxes`...), `time` :4827. Plurals/variants are functions (`tally(s, r)`).
- Live gate `apps/desktop/src/renderer/lib/wired.ts`:
  - `liveWired` (~L17-34): find `["search","triage","gallery","contacts"]`; reach `["board","sequences","inbox","mailboxes"]`; close `["roster"]`; insights, toolbox `["archive","never","scheduled","log"]`; record `[]`; settings list. Missing screen (today, deliver, team) is hidden on live.
  - `liveHiddenParts` (~L43-49): `insights.deals`, `insights.funnel.brands`, `insights.overview.revenue`, `insights.goal.money`, `record.deals`.
  - Checks: `isPartShown` :54, `isScreenShown` :68, `isTabShown` :73, `shownTabs` ~84, `firstShownTab` ~99, `defaultRoute` ~108.
  - Screen uses it: `reach/reach-screen.tsx:82-84` (`shownTabs`, falls back when tab not shown); `app/rail.tsx:105`; `lib/store.ts:392-399` (`go()` falls back); `app/global-keys.ts:82`; `insights/insights-host.tsx` (isPartShown). Parts of a tab: call `isPartShown("<part>", source)`; new part must be added to `liveHiddenParts`.
- Guard test: `renderer/no-drift.test.ts`: only listed files may read prototype mode.

## 2. Review new (triage)

- `find/triage.tsx`: `pageSize` 40 (L20); `reviewResults(run)` L30; `useReview()` L49-60 (filter `stages:["new"]`, sort `"triage"`, `facets:false`); `useReviewCount()` ~L65; `Triage({review})` L77+; `decide(kind)` ~L113 (`shortlist([item])` / `reject([item], kind)` from `lib/find-actions.ts`, L118/L136); keys block ~L143-177: `s` shortlist, `r` toggle reason row, `"1".."4"` reject with `rejectReasons[0..3]`, `arrowright`/`j` next, `arrowleft`/`k` prev, `o` open (`openRecord`, with `ensureCreators`), `escape`. Keys `{active: item !== undefined}`.
- `find/triage-card.tsx`: `rejectReasons` L14 (`["ai","views","posting","audience"]`, order = keys 1-4); `TriageItem = CatalogItem & {fit: Fit}` (~L26); `TriageCardProps` ~L36-50; `before = item.emailedBefore`, `who`, `when` ~L86-90; reasons row `rejectReasons.map` ~L243; "Never contact" form ~L290+ (`neverReason`, max 200 chars). `data-ui="find.triage.card"`.
- Hint/keys text: `strings.findTriage.keysHint` = "J is next, K is previous." (strings.ts ~1421). Shortcut sheet group "Reviewing finds" = strings.ts:221-227 (S, R, 1–4, →/←, **Enter** "Open the channel").
  - MISMATCH: sheet says Enter opens; code opens on `o` (triage.tsx ~L165). Sheet says R "Reject with the chosen reason"; code `r` only opens the reason row. Fix one or the other.
- Emailed-before line ALREADY EXISTS: triage-card.tsx callout `role="note"` `before === null ? null : ...` (~L120-127), text `strings.findTriage.emailedBefore(who, when)` (strings.ts ~1458) + `emailedBeforeNote`. Source: `main/find/catalog.ts:306-320` `emailedBefore(state)`, legacy stage counts only when `!state.hasAppStage`.

### Every place the reject reasons are enumerated or validated
- Core source of truth: `packages/core/src/data/types.ts:48` `rejectReasons = ["ai","views","posting","audience"]`; `:50` `RejectReason` type; `:247`, `:286` `rejectReason` fields; `:397` `reason?: RejectReason`.
- Re-exported to find/data/insights: `packages/core/src/data/index.ts` (re-export).
- IPC zod: `packages/ipc/src/data.ts:20` import, `:194` `z.enum(rejectReasons).nullable()`, `:254` `reason: z.exactOptional(z.enum(rejectReasons))` (creator.stage write). `packages/ipc/src/find.ts:10` import, `:301` `rejectReason: z.enum(rejectReasons).nullable()`. `packages/ipc/src/insights.ts:91` `z.enum([...rejectReasons, "unknown"])`.
- Core insights: `packages/core/src/insights/types.ts` lines 88, 89, 126, 188, 423, 588, 595, 608, 883 (`RejectReason | "unknown"`); `insights/search.ts:31` (`type Reason`).
- Main, reads: `apps/desktop/src/main/data/repositories/creator-reads.ts:248` (from `creator.reject` activity line, `reject_detail`), `:277-279` `reasonFrom()` validates against `rejectReasons`. `repositories/insights.ts:230-233` `reasonIn()` same. `main/find/catalog.ts:453, 499` `rejectReason`. `main/insights/inputs.ts:85,112`; `main/insights/service.ts:90`.
- Main, writes: `repositories/creator-writes.ts:156` (`reason?: RejectReason`); `:188` `write.reason === "posting" ? "inactive" : "irrelevant"` (archive tag). Activity log detail stores the reason as text (`detail: "views"`, or JSON `{"text","reason"}`).
- Supabase: NO enum or CHECK for reasons. Only `vetting_status` check (`supabase/migrations/20261020120000_baseline.sql:123`). Reason lives in activity detail text.
- Python `services/pipeline`: no reference to reject reasons (grep empty).
- Legacy mapping: `packages/core/src/data/legacy-mapping.ts` maps stages only (`rejected` → `vettingStatus: "rejected"`, ~L63); no reason mapping. `legacy/` Flutter has `"posting"` in `legacy/lib/features/search/application/auto_clean_controller.dart` (reference only, do not touch).
- Renderer labels (all `strings.ts`):
  - `findActions.reasons` :3689-3694 ("Not about AI tools", "Too few views", "Not posting enough", …). Used by `toolbox/archive-tool.tsx:80-82`, `record/creator-blocks.tsx:152-154`, `record/creator-next.tsx:105`, tests.
  - `insights.reasons` :2729 and :1973 (lowercase variants), `:2736 reasonsLower`, `:3015-3035` `reasons` / `reasonWhy` / `reasonShort` (`posting`, `audience` keys).
  - Do not confuse with FIT parts `posting`/`audience` (`strings.ts:1464-1465`, `core/find/types.ts:188-194 FitPart.key`), a different enum.
- Renderer UI using the list: `find/triage-card.tsx:14, 243`; `find/triage.tsx:2, 113-162` (keys fall back to literals `"ai"`, `"views"`, `"posting"`, `"audience"`); `find/bulk-bar.tsx:8, 16, 23, 61-66` (select); `find/gallery-results.tsx:1, 138` (bulk reject); `record/creator-next.tsx:6, 206`.
- Example / fixtures: `core/data/example-history.ts`, `example-history-words.ts`; `renderer/insights/test-reports*.ts`; `main/data/data-source-contract.ts:723-828` (contract tests).
- Tests with reasons: `find/triage.test.tsx:177-196`; `find/gallery-results.test.tsx:40, 413-417`; `ipc/src/data.test.ts:107-108, 234, 483`; `ipc/src/insights.test.ts`; `main/find/catalog.test.ts:106-121`; `main/reach/signing.test.ts:124` (audience reject on sign fail); `main/sync/intents.test.ts`; `main/insights/inputs.test.ts`.
- Adding a fifth reason = change `rejectReasons` (types.ts:48), `strings.findActions.reasons`, `insights` reasons (3 sets), `triage-card` keys order, `triage.tsx` fallbacks, `creator-writes.ts:188` tag mapping if needed, and tests above.

### CatalogItem (`packages/core/src/find/types.ts:69-143`)
`id, name, handle, pic, stage, emailConfirmed, email, contactName, subscribers, medianViews, uploads30, country, language, topics[3], sponsors[], emails: FoundEmail[], latestUploadAt, foundAt, run, keyword, videos: CatalogVideo[3], engagement, emailedBefore {at, who} | null, rejectReason, rejectedAt, neverReason, archiveDueAt, archivedAt, hasNumbers, uploadsRead, readFailed, trimmedAverage, viewStability, stars (1-5|null), format, botRisk`.
- Triage item = `CatalogItem & { fit: Fit }`. Detail (`find:item`) adds `fit, description, channelFacts, videos, notes, notesCut` (`packages/ipc/src/find.ts:342-356`).

### Channel facts (P1)
- `packages/core/src/find/channel-facts.ts`: `trimmedAverage` :30, `viewStability` :40 (`"volatile"` if stddev > mean/2), `starRating` :51-70 (takes `medianViews, engagement, uploads30`; engagement compared as PERCENT, `>= 4.5`).
- Computed in main: `apps/desktop/src/main/find/catalog.ts:455-468` for every catalog row (`stars` only when `uploadsRead`; `format`/`botRisk` from `state.details`). Also `:508-511` for state-only rows (stars null).
- Full `ChannelFacts` (`types.ts:43-63`: language, topics, totals, startedAt, medians, engagementRate, shortsShare, paidShare) NOT in CatalogItem. Built by `catalog.ts:158 factsOf()`, sent in `find:item` detail (`ipc/src/find.ts:327-346`), read by record: `renderer/record/creator-channel-facts.tsx:43 ChannelFactsSection` (via `creator-tabs.tsx:21`). Detail fetched with `renderer/lib/find-catalog.ts:214` (`invoke("find:item")`).
- Stars shown in record only (`record/creator-record.tsx`, `record/record-shell.tsx`); gallery card and triage card do NOT show stars, format, botRisk, viewStability.
- UNIT RISK: DB `manual_engagement_rate` is a ratio (seed `main/data/data-source-contract.ts:1340` sets `0.042`), but `fit.ts:54` (`engagement / 6`) and `starRating` (`>= 4.5`) treat it as percent. Verify units before relying on stars or engagement points.

### Fit
- `packages/core/src/find/fit.ts`: `uploadsUnread` :31; `fitOf(item): Fit` :86 (5 parts: median, posting, audience, engagement, sponsored; each `{key, points, of, note}`); `fitScore` :130 (sort only); `isGold` :141 (views ≥ 40% subs, 3-20 uploads, median ≥ 40K).
- Component: `renderer/find/fit-chip.tsx`: `fitTip(fit)` :14; `FitChip({fit})` :28 (button + popover list of parts). Used in triage-card and gallery.

## 3. Gallery

- Signals: `findSignals = ["gold","sponsored","email","confirmed","fresh"]` (`core/find/types.ts:203`). `FindFilter` :208-221 (`stages, signals, countries, languages, minMedian, maxMedian, minUploads, runs, q`). `emptyFindFilter` :224.
- Filter logic: `core/find/filter.ts`: `hasSignal` :27-40 (switch on signal); `passes(item, filter, skip?)` :54 (signals check :62); `sortItems` :99; `facetCounts` :141 (signal counts :163-167); `queryCatalog` :201.
- Chips: `renderer/find/gallery-chips.tsx` `activeChips(f, runLabels)` :26; signal chips loop :40-48 (`text.signals[signal]`, remove via `patchGalleryFilter`). Chip labels `strings.findGallery.signals` (strings.ts ~1499-1505).
- Facets UI: `renderer/find/gallery-facets.tsx:129` `findSignals.map(...)` into `Opt` (gold has a tip).
- Renderer state: `renderer/lib/find-gallery-state.ts`: `useGalleryFilter` :45, `setGalleryFilter` :64, `patchGalleryFilter` :68, `filterIsActive` :94, `useGalleryPages(filter, sort)` :190 (`galleryPageSize = 120`). `toggleIn` :89. Shows toggle `ShowToggle` :26 ("pics"|"latest"|"signals"). Remote: `renderer/lib/find-catalog.ts` `useCatalogQuery`.
- IPC: `packages/ipc/src/find.ts:360-372` `findFilterSchema` (`z.strictObject`: unknown key REJECTS; adding a filter field needs this, plus `FindFilter`, `filter.ts` passes/facets, chips and facets UI).
- Where filtering runs: MAIN. `apps/desktop/src/main/handlers.ts:228` `"find:query": (request) => catalog.query(request)` → `main/find/catalog.ts:594` `query({filter, sort, offset, limit, facets})` → `queryCatalog(rows, ...)` (core filter.ts:201) over rows built in catalog.ts.
- Can a signal use star rating, view stability or format? Not today. Values exist on every `CatalogItem` (`stars`, `viewStability`, `format`, `botRisk`, `main/find/catalog.ts:455-468`), so main can filter them. To add: new `FindFilter` fields (or new `Signal`s, which are cheap: `findSignals` → schema, facets, chips and strings all follow), and a `hasSignal` case. Star/viewStability as signal = boolean ("Five stars", "Stable views"). Format needs a `Facets` shape (Record per format) and a facet UI. Null values (`stars` null when unread) must be "not match".

## 4. Reach › Replies

- `renderer/reach/replies.tsx`: `stateClass` :25; `ReplyRow` :34 (`data-ui="reach.reply"` :60; `ago(item.at)` :72); `ReplyDetail` :84; header `reach.inbox.head` :107; thread card `reach.reply.thread` :120; `Replies()` :190 (keys :211); queue `reach.inbox.queue` :275; work pane `reach.inbox.work` :291. Reading UI in `record/reading.tsx`.
- Core `packages/core/src/reach/replies.ts`: `ReplyState` :10 = `"writing"|"draft"|"your_move"|"answered"|"bounced"|"closed"`; `ReplyItem` :12-18 `{creator, thread, draft, state, at}`; `replyItems(creators, threads, drafts)` :50 (newest first; skips threads without `lastIn`); `stateOf` (closed for stage never/rejected; bounced if `lastIn.bounce`); `repliesToAnswer` :75 (draft or your_move).
- Data (`packages/core/src/data/reach-types.ts`):
  - `ThreadSummary` :203-212 `{creator, count, lastOutAt, lastIn, answered, ...}`.
  - `ThreadLastIn` :190-198 `{id, at, reading: ReplyReading|null, preview, bounce}`.
  - `ReplyReading` :178-187 `{replyType: string|null, label, summary, side: string, corrected: boolean, facts: ReplyFact[]}`.
  - `ReplyFact` :163-171: `{key:"rate", rate, saved}` | `{key:"countries", countries[{code,share}], saved}` | `{key:"age", band, saved}`. `replyFactKeys` :173.
  - `ThreadMessage` :299-317 (`direction "in"|"out"`, `reading`, `source`, `bodyCut`).
- Intent values (`replyType`, situation ids): `packages/core/src/data/example-history-words.ts:427-527` `replyKinds`: `inf.interested_vague`, `inf.gives_rate`, `inf.who_are_you`, `inf.has_manager`, `inf.later`, `inf.not_interested`, `inf.media_kit`, `inf.agrees`, `any.out_of_office`, `any.bounce`. There is NO "price"/"interested" id; closest: `inf.gives_rate` (rate given) and `inf.interested_vague`. The list is fetched by `lib/reach-actions.ts:923 loadSituations()`; reclassify via `reclassifyReply`. The "not it" menu in `reading.tsx` (~L80-95) splits by `side` (brand|influencer) and `any`.
- Example seed: `packages/core/src/data/example-history.ts:1740-1765` (`addIn(t, replyType, subject)`), `example.ts:842` (`inf.gives_rate`), `:957` (`any.bounce`).
- `reading.tsx`: `factWords(fact)` :16; `Reading({...})` :37; `side` :75; `notIt` menu (~L80).

## 5. Reach › Board

- `renderer/reach/board.tsx`: `Lane({lane, now})` (~L13; `data-ui="reach.lane.<key>"`; empty action → `go("find","contacts")`); `Board()` exported; `boardLanes({creators, drafts, threads, sequences, source})` memo.
- Core `packages/core/src/reach/board.ts`: `boardLaneKeys` :9 = `["todraft","waiting","seq","replied","kit","signed"]`; `liveBoardLanes` :14 (all); `BoardItem` :16-21 `{creator, draft, thread, sequence}`; `BoardLane` :24; `BoardInput` :29-35; `isOpenDraft` :38; `openDrafts` :43; `nextStep` :58; `boardLanes(input)` :112 (one item per creator, sorted by name).
- `renderer/reach/board-card.tsx`: `BoardCard({item, lane, list, now})` :53. Click/Enter → `open()` = `peek(ref, list, {tab: lane is kit|signed ? "overview" : "emails"})` (:69-72). `O` → `openRecord(ref)` (:81-82). `J`/`K` move focus among `.kcard`. Button label `actionLabel` :15-21: `draftIt` → `draftNow(creator.id)` (reach-actions); `review`, `answer`, `check`, `writing` → `open()` (PEEK, not record page). Card data-ui `reach.card`.
- Owner field: NONE. `Creator` (`core/data/types.ts:228+`) has no owner/assignee. Team roles exist (`agencyRoles` types.ts:22: owner, scout, outreach, deal_lead, delivery). Me = `frame.me` (`core/data/types.ts:344` Frame `readonly me: string`; `core/data/example.ts:68`). `renderer/lib/frame.ts:46-49` `memberOf` maps `me` → `strings.team.you`; `:73, :76` use `frame.me`. So an Everyone/Mine switch has no per-creator data to filter on; needs a new field (ipc + main + core) or to be a no-op on live.
- Signed items: lane `"signed"` in `boardLanes`; card info `reach/reach-view.ts:225`. Close roster also reads `stage === "signed"` (`close/roster.tsx:9`, `close/roster-signed.tsx:15` signedFilter).

## 6. Reach › Sequences and Mailboxes; navigation

- `renderer/reach/sequences.tsx`: `Sequences()` :83 (`data-ui="reach.sequences"` ~L125). Filters: ONLY `Seg` with `Show = "all"|"running"|"stopped"` (state :89, Seg ~L130). No other filters. `rows = sequenceRows(creators, sequences, threads, now)`; `shown` by show. Layout: legend `reach.sequences.legend` :291; table `reach.sequences.table` :150 (`role="table"`, `sq`); row `reach.sequences.row` :207 (one row per creator; columns = days, `timelineDays(now)` 14 back + 14 ahead; `.sq-day.now` today column; weeks header). Click a row → `peek(..., ids, {tab:"emails"})` :199. Due-today count :121.
- Core `core/reach/sequence.ts`: `followUpDays = [3,7,14]` :11; `finishAfterMs` 7 days :13; `planSteps` :30; `dueSteps` :45; `stopped`/`resumed`/`parked`/`woken` :71-107.
- `renderer/reach/mailboxes.tsx`: `Mailboxes()` :275. Empty state button → `go("settings","connections")` (~L284). Header callout `data-ui="reach.mailboxes.rule"` :304 (`role="note"`, `text.ruleLead`, `ruleBody`, `rightNow(slowed)`). Grid `reach.mailboxes.grid` :313; card `reach.mailbox` :133.
- Route helpers: `renderer/lib/routes.ts` — `ScreenKey` :8-18, `Route` :35-44 (`{screen, tab, record?, from?}`), `screens` :~70-80, `screenOrder`, `goLetters` :~99-109, `firstTab`, `routeToHash` (`#/record/<kind>/<id>` for records), `routeFromHash` (never restores a record page).
- Navigate to Settings › Connections: `go("settings","connections")` (used in `app/rail.tsx:237`, `app/first-run.ts:40`, `mailboxes.tsx`). Preferred: `openSetting("connections", row?)` in `renderer/lib/actions.ts:371-376` (calls `go`, then sets `ui.settingTarget` to a row id). Section key type `SectionKey` in `lib/settings.ts:11`; `settingsSections` :36 (`connections` :46, `owner: true`); `settingsRows` :92 (connection row ids, e.g. `connMailboxes` :112, `connMailSettings` :113, `connGemini` :114). `RowId` :51.

## 7. Outreach model: creators only

- `packages/core/src/data/reach-types.ts`: `OutreachDraft` :129-159 has `creator: string` (creator id) and no brand field. `Sequence` :227-236 `creator`. `ThreadSummary.creator` :204. `ReachData` :279-295 has `drafts, sequences, threads, mailboxes, gemini, ...`, no brands. `ThreadMessage` :299 `peer`/`peerName` (email peer, not brand).
- `packages/core/src/data/outreach-store.ts`: `NewDraft.creator` :35, `NewMessage.creator` :64, `StoredMessage.creator` :86, `openDraft(creator)` :111.
- Seed: `packages/core/src/data/example-reach-more.ts` drafts/threads keyed by creator ids (`creator: id("c27")` :434, `id("c28")` :450). No brand outreach rows in seed (the word "brand" in example files is copy text only).
- Conclusion: brand outreach needs a new key (brand id) in types, outreach-store, ipc schemas and seed. Not present.

## 8. Frame: G-chord, palette, peek, record page

- Key stack: `packages/core/src/keys.ts`: `createKeyStack` :79; `createGoPrefix(timeoutMs = 1200)` :136 (`arm(now)`, `take(input, now)`: expires after 1200 ms, ignores Ctrl/Meta/Alt, consumes one key, returns `key.toLowerCase()`).
- `renderer/lib/keys.ts`: `keyStack` (module singleton), `useKeys(keys, {active, barrier})` (pushes a layer; newest map), `isTyping(target)`, `quietAnimations()` (sets `data-input="kbd"` for 400 ms).
- `renderer/app/global-keys.ts`: `goPrefix = createGoPrefix()` :10; `useGlobalKeys()` :~20: `mod+k`/`/` palette, `?` shortcut sheet, `mod+z`/`mod+y` undo/redo, `alt+arrowleft/right` history, `[` rail, `mod+,` settings, `g` → `goPrefix.arm(Date.now())` (:57-59). `goScreen(letter)` via `goLetters` (routes.ts; t f r c d i x m s). `useKeyListener()` (~L70-100): on keydown, not while typing or with lettersOff or barrier, `goPrefix.take(event, now)`; if the screen is `isScreenShown` → `go(screen, firstTab(screen))`, preventDefault. Else `keyStack.dispatch`.
- Hint UI for G: NONE on screen (no pending indicator). Only the shortcut sheet rows strings.ts:197-200 ("G then T / F / R / C / D", "G then I / X / M / S"). Timeout 1200 ms.
- Palette: `renderer/overlays/palette.tsx` `Palette()` :196; `buildCommands(data, recent, query)` (commands.ts) :55. Keys `mod+k`/`escape` barrier :51. Result groups: `groupRuns` :18; heading `div.pal-g` :119-120 (`command.group`). Max 14 results (`overlays/commands.ts:35 maxResults`).
- What it searches (`overlays/commands.ts`): `actionCommands` :42 (+ prototype group :70/:79 when proto on), `goCommands` :115 (screens), `settingCommands` :134 (owner only), `recordCommands` :156 (creators, and brands/deals only if `isPartShown("record.deals")`). NOT only creators. Empty query → `recentCommands` (:194, max `maxRecentShown`), then 5 actions, then goTo. Query matches `label + sub + words`.
- Recent: `ui.recent: RecordRef[]` (`lib/store.ts:188`, init `[]` :244). `addRecent(ui, record)` in `lib/actions.ts:180-183`, `maxRecent = 8` (actions.ts:18). Called by `peek()` and `openRecord()`.
- Opening records: `renderer/lib/actions.ts` `peek(record, list?, {tab?})` :186-198 (sets `ui.peek = {record, list, tab}`); `openRecord(record)` :223-228 (`go("record", null, {record, from})`). `renderer/record/open-record.ts:5-10` `openFrom(layout, ref)` picks peek or page.
- Peek: `renderer/overlays/peek.tsx` `Peek()` :17. Keys `alt+arrowdown`/`alt+arrowup` :37-41 (`stepPeek`), Esc. Counter `text.counter(i+1, list.length)` :78, shown only when `list.length > 1` (:58). `list` comes from the caller's `peek(ref, list)` (board-card passes lane ids; sequences passes shown ids; triage passes none, uses openRecord). `stepPeek(by)` in actions.ts:209.
- Record page: `renderer/app/record-page.tsx` `RecordPage({record})`: Back button (`back()`), card `record.page.card`, body `RecordBody` (`overlays/record-summary.tsx`, layout "page"). Route: `{screen:"record", tab:null, record:{kind,id}, from}` (`routes.ts` Route :35-44). Hash `#/record/creator/<id>`. Not restored on reload.

## 9. Quick draft dock

- Design spec: `design/workbench-v6/js/ui.js:205-222` `W.QuickDraftDock`: reads `U().quickDraft` `{id, min}`; renders `W.DraftCard` for that draft; header "QuickDraft · <kind> to <name>"; buttons minimize (`min` toggle) and close (`W.closeQuickDraft`). No keys bound in the block. Mounted in `app.js:429`.
- `design/workbench-v6/js/core.js:215-229`: `W.openQuickDraft(qid | {to, kind, subject, body, why, rules})` (object form creates the draft), sets `ui.quickDraft = {id, min:false}`; when on Today it also sets `todaySel`. `W.closeQuickDraft` :229. Also reset in `core.js:115`, `engine.js:452, 523`.
- Opened by `engine.js` when the action is not on Today: first email confirm (:577-578), reclassify reply (:683-684), missing numbers request (:752-753), 14-day warmth (:780-781), brand pitch (:850-851).
- App: NOT built (no `QuickDraft` in `apps/desktop`). Today a draft is opened in the record (Emails tab, `record/draft-card.tsx`) or from board-card "Draft it" (`draftNow`). Toasts: `renderer/lib/actions.ts:61-72` `act()` toast `go?: {label, run}` (default label "View", `strings.actions.view`); `renderer/overlays/toasts.tsx`, `lib/toast.ts`.

## 10. Conventions

- Component test: copy `renderer/reach/board.test.tsx` (Reach) or `renderer/find/triage.test.tsx` (Find keys). Line 1 `// @vitest-environment happy-dom`. Imports `act, cleanup, fireEvent, render, screen, within` from `@testing-library/react`. Fixtures: `reach/reach-fixtures.ts` (`aiCreator`, `seedReach`), `lib/reach-test-bridge.ts` (`reachWith`, `stubReachBridge`, `goodMailbox`, `aiDraft`), `lib/find-test-bridge.ts` (`aiChannel`, `stubFindBridge`). `resetAppStoreForTests()` (lib/store.ts) in beforeEach/afterEach. Keys: mount `useGlobalKeys` + `useKeyListener` in a `Keys` component (triage.test.tsx:20-25) and `fireEvent.keyDown(document.body, {key})`.
- Undo: `renderer/lib/actions.ts:82` `act(label, recipe, opts)`: recipe on the data; returns false → no-op; pushes Undo toast (`actions.ts:122-128`) unless `undo: false` (:72). `undo()` :153, `redo()` :171. Core store `packages/core/src/store.ts`.
- CSS: one per screen: `find/find.css`, `reach/reach.css`, `record/record.css`, `record/emails.css`, `overlays/overlays.css`, `app/frame.css`. CSS guard tests: `app/frame-css.test.ts`, `overlays/overlays-css.test.ts`.
- `data-ui`: `<screen>.<part>[.<sub>]`: `find.triage.card`, `reach.board`, `reach.lane.<key>`, `reach.card`, `reach.replies`, `reach.inbox.queue`, `reach.sequences.table`, `reach.mailboxes.grid`, `record.page`, `record.channel.facts`.
- Strings: one `strings.ts`, namespace per screen part, plurals as functions, keep `strings.<ns>` access.
- Gate tests: `renderer/no-drift.test.ts`, `renderer/app/frame-css.test.ts`, plus `apps/desktop/e2e/accessibility.spec.ts` (axe).

## Likely files to touch

- Triage fix (keys/sheet mismatch): `renderer/find/triage.tsx`, `renderer/find/triage-card.tsx`, `renderer/overlays/shortcuts.tsx` (reads `strings.shortcuts`), `renderer/strings.ts:221-227`.
- Gallery signals / stars / format filters: `packages/core/src/find/types.ts`, `packages/core/src/find/filter.ts`, `packages/ipc/src/find.ts:360-372`, `renderer/find/gallery-chips.tsx`, `renderer/find/gallery-facets.tsx`, `renderer/lib/find-gallery-state.ts`, `apps/desktop/src/main/find/catalog.ts`, `renderer/strings.ts:1499-1505`.
- Fit parts / channel facts display: `packages/core/src/find/fit.ts`, `packages/core/src/find/channel-facts.ts`, `renderer/find/fit-chip.tsx`, `apps/desktop/src/main/find/catalog.ts:455-468`.
- Reach Replies: `renderer/reach/replies.tsx`, `packages/core/src/reach/replies.ts`, `packages/core/src/data/reach-types.ts`, `renderer/record/reading.tsx`, `renderer/lib/reach-actions.ts:923`.
- Board / Everyone-Mine: `renderer/reach/board.tsx`, `renderer/reach/board-card.tsx`, `packages/core/src/reach/board.ts`, `packages/core/src/data/types.ts` (Creator owner field if needed), `renderer/lib/frame.ts`.
- Sequences filters: `renderer/reach/sequences.tsx`, `renderer/reach/sequences.test.tsx`.
- Mailboxes / Connections link: `renderer/reach/mailboxes.tsx`, `renderer/lib/actions.ts:371`, `renderer/lib/settings.ts`.
- G-chord hint: `renderer/app/global-keys.ts`, `packages/core/src/keys.ts:136`, a new small hint component under `renderer/app/` (plus `frame.css`).
- Palette recent or brand search: `renderer/overlays/commands.ts`, `renderer/overlays/palette.tsx`, `renderer/lib/actions.ts:17-18, 180-183`.
- Peek / record page: `renderer/overlays/peek.tsx`, `renderer/app/record-page.tsx`, `renderer/record/open-record.ts`.
- Quick draft dock (new): `renderer/app/` new component + `renderer/lib/` state (no existing dock; design `design/workbench-v6/js/ui.js:205`, `core.js:215`).
- Tests to copy/extend: `renderer/find/triage.test.tsx`, `renderer/reach/board.test.tsx`, `renderer/reach/replies.test.tsx`, `renderer/reach/sequences.test.tsx`, `renderer/reach/mailboxes.test.tsx`, `renderer/find/gallery-results.test.tsx`, `packages/core/src/find/filter.test.ts`, `packages/ipc/src/find.test.ts`.
