# Context: plan step 8 part 1, Signing

Recon as of 2026-10-27, branch `feat/8-signing`. Repo root: `E:/IMA work/Code/gratovo_toolbox`. Paths below are repo-relative. `.router/PROGRESS.md` is untouched.

## 1. Commands

Root `package.json` scripts:
- `pnpm lint` = `eslint .` + `prettier --check .` + ruff check + ruff format --check (services/pipeline).
- `pnpm typecheck` = `tsc -b` + `pyright` (services/pipeline).
- `pnpm test` = `vitest run` + `@gratovo/gemini-extension test` + `pytest` (services/pipeline).
- `pnpm test:e2e` = `pnpm --filter @gratovo/desktop test:e2e` = `install-electron && electron-vite build && playwright test` (apps/desktop/package.json). Windows only.
- `pnpm verify` = `node tooling/verify.ts` (the PR gate).
- One vitest file (from root): `pnpm vitest run apps/desktop/src/main/sync/intents.test.ts`
- One Playwright spec: `pnpm --filter @gratovo/desktop build` then `pnpm --filter @gratovo/desktop exec playwright test reach-board.spec.ts` (config: `apps/desktop/playwright.config.ts`, testDir `./e2e`, workers 1, 30 s timeout).
- One pytest file: `uv run --directory services/pipeline pytest tests/test_comms_live_case.py -q`
- Typecheck only TS: `pnpm typecheck` (tsc -b); the desktop app builds via `pnpm build`.

## 2. Data path for a creator

**Types** (`packages/core/src/data/types.ts`, 487 lines):
- `creatorStages` L23 (new, shortlisted, contact, emailed, replied, kit, audience, signed, rejected, parked, never).
- `rejectReasons` L44 (ai, views, posting, audience).
- `Creator` L180: the frame row (stage, email, contactName, rejectReason, rejectedAt, neverReason, archiveDueAt). No engagement, no kit, no provided_data.
- `CreatorState` L215: every channel_state row for the catalog. Has `engagement` (from `manual_engagement_rate`), `legacyPipelineStage`, `hasAppStage`. No media_kit or provided_data.
- `Frame` L302: `creators`, `brands`, `deals`, `log`, `reach` (ReachData). Built by `DataSource.frame()`.
- `DataWrite` union L329: `creator.stage` L353 (`id, stage, handle, name, reason?`), `creator.notes` L368 (`base`, direct-through, not undoable, not in frame), `creator.contact` (D31), `reply.fact` L438 (`messageId, key`), `draft.*`, `log.*`, `conflict.resolve`.
- `DataSource` L441: `frame()`, `creatorStates()`, `creatorNotes(id)`, `write(writes)`, `readSetting`, `outreach`.

**Renderer to main write**:
- Renderer diffs the store to writes: `apps/desktop/src/renderer/lib/persist.ts` `diffData()` L191. Creator diff L~220-265 emits `creator.contact` then `creator.stage` (only when stage/contact fields change). Fields diffed are the Creator fields only, so a new Creator field must be added to this list.
- Notes and other direct writes bypass the diff: `renderer/record/creator-notes.tsx` calls `window.gratovo.invoke("data:write", {writes:[...]})` directly (`writeNotes`). Copy this for a kit editor.
- Batching: `persist.ts` L11 (max writes per call, IPC limit), `sendNext` L388, `installPersistence` L426.
- IPC schema (zod): `packages/ipc/src/data.ts`. `creator.stage` ~L243, `creator.notes` L251, `reply.fact` L321. A new write needs a zod entry here too (strictObject).
- Main handler: `apps/desktop/src/main/handlers.ts` L157 `"data:write"`: calls `source.write(writes)`, then `reach.afterWrite(writes)`, `onCreatorsWritten` when `changesCatalog`.
- Source: `apps/desktop/src/main/data/sqlite-source.ts`. `apply(write)` switch L161-~230: `creator.stage` L186 to `writeCreatorStage`, `creator.notes` L189, `creator.contact` L192, `reply.fact` L213 to `writeReplyFact`. `write()` runs `applyAll` in one transaction; `onWrite` hook calls intents (L73-74, L254-260).

**Sync queue** (`apps/desktop/src/main/sync/intents.ts`, `recordIntent()` L~102):
- `queueEdit(id, label, field, base, next)` L~153 enqueues kind `channel.edit`, payload `{channelId, field, base, next, label}`, target `channel_state`.
- `creator.stage` case L224: base = stored `creator_stage` before applyLocal; queues `creator_stage` edit, then `channel_tags` edit if tags moved.
- `creator.notes` L~252; `creator.contact` L~269 (queues `contacts`).
- `reply.fact` case L288-~315: reads `provided_data` before and after applyLocal, queues one `provided_data` edit with base (null when never set, via `parseValue`). It does NOT queue `creator_stage`; an automatic stage move must be added here.
- Uploader allowlist `apps/desktop/src/main/sync/uploader.ts` L~84-96 `editableFields`: already has `media_kit`, `provided_data`, `creator_stage`, `creator_gender`. Good: a kit save needs no server change for the column (check the RPC `apply_channel_edit` migration `supabase/migrations/20261022090100_creator_stage_edit.sql`).
- Mirror of server columns: `apps/desktop/src/main/sync/mirror-tables.ts` L35-51 (`jsonColumns` includes `provided_data`, `media_kit`).

**Repositories** (`apps/desktop/src/main/data/repositories/`):
- `creators.ts` (663 lines): `writeCreatorStage(db, write, now)` L162 (sets stage; tags follow rejected); `setCreatorStage` L80; `writeCreatorNotes` L253; `listCreators(db)` L310 (frame rows, SQL reads `channel_state` columns: vetting_status, pipeline_stage, creator_stage, contacts, archive_due_at, name); `creatorStates(db)` L352 (adds `manual_engagement_rate`).
- `outreach.ts` (992 lines): `writeReplyFact(db, write)` L569 merges `providedFact()` (L553: `{rate}`, `{countries}`, `{age}`) into `provided_data`, marks `facts_saved`. Runs inside the same transaction, so an automatic stage move can go here.
- Read path: `storedFields()` L422 builds the Creator's stage and reject fields. Nothing reads `media_kit` or `provided_data` into a Creator or CreatorState.

**Reads reaching the renderer**: `manual_engagement_rate` reaches the renderer only through the Find catalog (`apps/desktop/src/main/find/catalog.ts` L314, L351 to `engagement`, shown in `renderer/find/compare.tsx` L91). `media_kit` and `provided_data` reach nothing in the renderer. The only trace is a string label (`renderer/strings.ts` L1138-1140, `main/strings.ts` L43-45).
- Comms engine facts: `apps/desktop/src/main/reach/facts.ts` builds `creators[id] = {pipelineStage, mediaKit: null, creatorGender: null}` (~L80-95). `mediaKit` is always null today, so the engine never sees a kit. Filling it here is the cheapest way to give the pipeline the kit.

## 3. Example data and the contract suite

- `packages/core/src/data/example.ts` (910 lines): `exampleSeed(now, scenario)` L119, `exampleFrame(now)` L153, `creators` const L315 (c1 "Prompt Lab" and c2 "Neural Notes" are `signed`; ids c1 to cN; every creator object lists fields explicitly, so a new Creator field needs each entry). `ExampleSeed` interface L50. No media_kit or provided_data in the seed.
- `packages/core/src/data/example-scenarios.ts` (86 lines): `firstSeed`, and the other scenario variants built from the base seed.
- The example DB is written by `apps/desktop/src/main/data/example-source.ts` (channel_state rows, L~31 table list). `exampleSeedVersion = 7` (example.ts L35): bump it if the seed's shape changes (check the reseed rule before bumping).
- Shared contract suite: `apps/desktop/src/main/data/data-source-contract.ts` (1750 lines), `describeDataSourceContract(name, source, makeSource)` L102. Run by `example-source.test.ts` and `live-source.test.ts`. A new write or read is tested here once for both sources. Existing manual_engagement_rate case at L1315. `reply.fact` cases near L1713.
- Repository unit tests sit beside the files: `repositories/creators-brands.test.ts`, `repositories/outreach.test.ts` (provided_data merge tests ~L870-900), `sync/intents.test.ts` (reply.fact L~800-840), `sync/mirror-tables.test.ts`.

## 4. Local SQLite migrations

- Folder `apps/desktop/src/main/db/migrations/`: `0001-initial.ts` to `0005-comments.ts`, index `index.ts` (array in order, "Add new ones at the end"). Next file: `0006-<name>.ts`, exporting a `Migration` with a `sql` string (see `0005-comments.ts`).
- `channel_state` locally ALREADY has `provided_data` (0001 L27), `manual_engagement_rate` (L34), `media_kit` (L37), `creator_stage` (L~40, "no Supabase column yet" comment is stale: the 2026-10-22 migration added it). No migration is needed for the kit or the facts.
- Migration tests: `apps/desktop/src/main/db/migrate.test.ts`.
- Supabase: new tables need grants (`supabase/README.md`). No new table is needed for this part.

## 5. Renderer store pattern

- Store: `packages/core/src/store.ts` (179 lines). `createStore`, `act(label, recipe)` (returns the recipe result, or false when it returns false), `undo()`, `redo()`, `peekUndo()`.
- Renderer wrapper: `apps/desktop/src/renderer/lib/actions.ts` L82 `act(label, recipe, {log?, logRef?, toast?})`: adds an activity log line (unless `log:false`), sets "Saving", shows a toast with Undo (`ActToast` L60). L153 `undo()`.
- Example action to copy: `apps/desktop/src/renderer/lib/find-actions.ts`: `change(items, how)` L~71 (one act, one log line per creator), `shortlist` L118, `reject(items, reason)` L135 (log action `creator.reject`, detail = reason), `bringBack` L153.
- Reach actions: `apps/desktop/src/renderer/lib/reach-actions.ts`: `sendDraft` L108, `skipDraft` L154, `saveReplyFact` (grep), `reclassifyReply` (grep), `parkCreator(creatorId, until, withUndo)` L696, `wakeCreator` L727, `parkItems` L753, `openParkMenu` L773, `sequenceCommand()` L~610 (runs `reach:*` IPC and returns skipped drafts).
- Toast: `apps/desktop/src/renderer/lib/toast.ts` L17 `toast({msg, sub?, icon?, tone?, ms?, actions?})`.
- Log actions: `packages/core/src/data/types.ts` `logActions` (creator.shortlist, creator.reject, creator.restore, creator.never, creator.allow). A new decline line may reuse `creator.reject` with a reason detail, or add an action here (and `logText` in `packages/core/src/data/log-text.ts`).
- Strings: renderer `apps/desktop/src/renderer/strings.ts` (2600+ lines; `screens` L1530, `reach.board.lanes` L2239, `creatorRecord` ~L1790-1800, `findActions`, `actions`). Main `apps/desktop/src/main/strings.ts` (conflict labels, presence). Reach main `apps/desktop/src/main/reach/strings.ts` (`reachStrings` L9, `standIn` L22, `standInReply` L39, `replyStrings` L115, `sequenceStrings` L129). Rule: one module per feature, keyed.

## 6. Reach drafter and the comms engine

**Draft kinds**: `packages/core/src/data/reach-types.ts` L8 `draftKinds = ["first","followUp","reply"]`. DB CHECK in `0004-outreach.ts` L12 and L37 (`kind IN ('first','followUp','reply')`): a new kind needs a table rebuild migration. Gemini request schema: `apps/desktop/src/main/pipeline/gemini-protocol.ts` L236 `commsKinds = ["first","reply","followUp","decision"]` (the pipeline already has `decision`); `services/pipeline/src/gratovo_pipeline/gemini/gemini.schema.json` L818, L1426 lists kinds. `commsRequest` L238-251: `kind, threadId, channelId, brandId, contactEmail, pitchChannelIds, followUpNumber, steer` (`Record<knob,string>` with `note`), `cashOffer`, `timeoutS`. No `goal` field.

**Queueing a reply draft**: `apps/desktop/src/main/reach/reply-sweep.ts` L280-345 `changeFor()`: a new reply sets stage replied (via stageWrite), skips open follow-ups, and pushes `change.newDrafts` `{kind:"reply", replyTo: message.id, mailbox, ...}` unless one is already open. Stage rejected or never: the message is stored, sequence stopped, no draft (L~232-245).

**Drafting**: `apps/desktop/src/main/reach/drafter.ts` (1000+ lines): `requestFor(draft, creator, note)` L~497 (kind, channelId, contactEmail, threadId, followUpNumber, steer `{note}`); `withCorrection()` L~517 (reading.corrected adds "Read their reply as: ..."); `ask()` L~534 calls `deps.propose({request, facts})`; `draftOne()` L~590 skips a creator with stage `never` (not `rejected`, so a decline draft would still be written); example mode uses `standInReply`/`standInDraft` (`reach/strings.ts`). Rewrite path `runRewrite` L~930 uses `steer: {how, note}`. `mapProposal()` maps status to ready/needs_human/blocked.
- Facts: `apps/desktop/src/main/reach/facts.ts` `buildCommsFacts()` L41 (agency, thread, creators; `mediaKit: null`).
- Reach service: `apps/desktop/src/main/reach/reach-service.ts` (1000+ lines): `reach.park` L864 to `parkCreator(creatorId, until)` L722.
- Queue: `apps/desktop/src/main/reach/quick-queue.ts` (`createQuickQueue`, runs jobs in order, retries `running`).
- Situations: `apps/desktop/src/main/reach/situations.ts` (`createSituations`, reads `services/pipeline/data/comms/playbook/situations.json`, 72 entries; `inf.not_interested`, `inf.gives_rate`, `inf.media_kit`; no decline or ask-for-numbers entry).
- Reply reading and facts: `apps/desktop/src/main/reach/reply-sweep.ts` (`reading` dep), `packages/core/src/reach/reply-facts.ts` (`readReplyFacts`), `apps/desktop/src/main/reach/facts.test.ts`.
- Quick draft: `apps/desktop/src/main/reach/sender.ts` (send path), `apps/desktop/src/main/reach/mail-state.ts`.

**Pipeline side** (`services/pipeline/src/gratovo_pipeline/`):
- Action: `gemini/actions.py` L394 `comms_propose(gemini, params)`: builds `live_case.build_case(conn, request, facts, moments)`, then `engine.propose(gemini, case, variant="auto")`. Registered in `ACTIONS` L513.
- `comms/live_case.py`: `build_case()` L387. Goal chosen at L~470-516: `first` for influencer = `GOALS["first_influencer"]`; `followUp` = "Write our follow-up n of 3..."; otherwise `GOALS.get(kind, GOALS["reply"])` (L130: `reply`, `decision`, `first_influencer`). The stage comes from `PIPELINE_TO_STAGE` (L121) or from thread. Steer: `_steer_note()` L368 renders knobs (STEER L39: stage, channel, inmind, state, pitch, reader) and `note` as "Corrections from the person sending this (they override what you read from the case)" into `employee_note`.
- Only intent hooks: `kind` (first, reply, followUp, decision) and `steer.note`. A decline or an ask-for-numbers would be a `reply` with a steer note today. A cleaner way is an explicit `goal` in the request (schema in gemini-protocol.ts L238 plus gemini.schema.json, and `build_case` L~510 must honour it).
- Kit reading: `live_case._kit(state)` L303 reads `mediaKit` from facts. `_audience(kit)` L311 turns countries/ageBand/engagement into the case. `services/pipeline/src/gratovo_pipeline/comms/readiness.py` (`missing(kit, gender)`): gaps are "analytics" (countries and ageBand), "agreed rate" (needs `rates[].agreed === true`), "audience" (US+GB+CA share < 20%). Mirrors the app's Dart PitchReadiness (legacy).
- Tests: `services/pipeline/tests/test_comms_live_case.py`, `test_comms_actions.py`, `test_comms_engine.py` (readiness is covered in `test_comms_live_case.py`).
- Protocol test: `pnpm pipeline:schema` (`vitest run apps/desktop/src/main/pipeline/protocol-schema.test.ts --update`) regenerates the schema snapshot when the request shape changes.

## 6b. Park, and the reject write

- Park (Reach): `renderer/lib/reach-actions.ts` `parkCreator` L696 to IPC `reach:park` (`apps/desktop/src/main/handlers.ts` L286) to `reach-service.ts` `parkCreator` L722. It REQUIRES stage `emailed` and a running sequence (L728-734). A kit or replied creator cannot be parked through it. Writes `creator.stage` `parked` (L744) and a log line.
- Reject with reason: `renderer/lib/find-actions.ts` `reject()` L135 writes stage `rejected`, `rejectReason`, `rejectedAt`. Main writes the tag (`writeCreatorStage` L162: `posting` gives `inactive`, others `irrelevant`, with a 7-day due date via `setCreatorTags`). The `creator.stage` write with `reason: "audience"` is the one to use for Decline.
- Record's next step: `renderer/record/creator-next.tsx` L20 `CreatorNext`: by stage. Later stages show the stage name only ("Reach is a later step"). Sign and Decline/Park/Ask buttons go here or in a new Close panel.

## 7. Reach board, live gate, routes, Close

- Board: `packages/core/src/reach/board.ts`. `boardLaneKeys` L9 (todraft, waiting, seq, replied, kit, signed). `liveBoardLanes` L14 = ["todraft","waiting","seq","replied"]. `laneOf()` L65: stage kit or audience to `kit`, signed to `signed`. `boardLanes()` L112 chooses `input.source === "example" ? boardLaneKeys : liveBoardLanes` at L142. Making kit and signed live means changing L14 (and the tests in `board.test.ts`). `audience` lands in the kit lane.
- Renderer board: `apps/desktop/src/renderer/reach/board.tsx` (73 lines), `board-card.tsx` (131 lines). Lane titles in `strings.ts` L2239-2246 (kit: "Media kit in", "Check audience, then sign"; signed: "Ready to pitch to brands").
- Live gate: `apps/desktop/src/renderer/lib/wired.ts`. `liveWired` L~16: find, reach (board, sequences, inbox, mailboxes), toolbox, record (none), settings. There is NO `close` key, so Close is hidden live. Add `close: ["roster"]` here, then the rail, palette and hash follow (`isRouteShown`, `startRoute`).
- Routes: `apps/desktop/src/renderer/lib/routes.ts`: `ScreenKey` L8, `screens` L~60 (uses strings), `screenOrder`, `goLetters` ("c" = close), `routeFromHash`.
- Close today: `apps/desktop/src/renderer/app/app.tsx` L60-85 `Content` switch: no branch for close, so it falls to `<PlaceholderScreen screen={screen}/>` (`renderer/app/placeholder-screen.tsx`, 24 lines).
- Close tabs in strings: `renderer/strings.ts` L1546-1556: `roster, brands, match, pitch, negotiate, contracts`. Roster is the first tab.
- Tab-screen pattern to copy: `renderer/reach/reach-screen.tsx` (116 lines): `ReachTabs` (role tablist, arrow keys, `shownTabs(...)` from wired.ts, `go("reach", key)`), `PageHead`, panel with `data-ui="reach.panel"`, and fallback `PlaceholderScreen` when the tab is not shown. Toolbox has a list-plus-tool layout (`renderer/toolbox/toolbox-screen.tsx`).
- Creators list for a roster: the frame's `creators` with `stage === "signed"`; `renderer/lib/frame.ts` for the store load.

## 8. Creator record and peek

- Record page: `renderer/app/record-page.tsx`. Body: `renderer/record/creator-record.tsx` (187 lines): header, `CreatorNext`, then tabs `tabKeys = ["overview","emails","notes","activity"]` L17. Tab buttons `data-ui="record.tabs"`, panels `record.panel.<key>`. A new tab (for example "Audience" or "Media kit") adds to `tabKeys`, `strings.creatorRecord.tabs`, and a panel.
- Overview: `renderer/record/creator-overview.tsx` (186 lines), `CreatorOverview({item})`: stats `record.overview.stats`, latest videos, fit, sponsors, addresses, description. An audience-check block and the media-kit editor would sit under the stats (`data-ui="record.overview.*"`).
- Data for the record: `renderer/record/detail.ts` `CreatorDetail = ChannelResponse<"find:item">["item"]` (main `find` catalog). Live fields come from `find:item`, not the frame.
- "Save to record" for reply facts: `renderer/record/reading.tsx` `Reading()`: each `ReplyFact` chip with a button `saveReplyFact(creatorId, messageId, key)` (renderer `lib/reach-actions.ts`), `factWords()` L17.
- Notes editor (pattern for a direct-write editor with a base and a counter): `renderer/record/creator-notes.tsx` `writeNotes()` L~14.
- Draft card and gates (the approval UI for the decline draft): `renderer/record/draft-card.tsx`, `draft-states.tsx`, `draft-gates.tsx`.
- Reach replies list: `renderer/reach/replies.tsx`.

## 9. Electron e2e

- Fixtures: `apps/desktop/e2e/fixtures.ts`. Exports `test` (base.extend with `errors` and `page`), `expect`, `launchApp(userData, errors, {supabase?, ready?})`, `appPage`. No Supabase = example data.
- Smoke spec pattern: `apps/desktop/e2e/reach-board.spec.ts`: import `{ strings }` from `../src/renderer/strings`, `{ expect, test } from "./fixtures"`, click the rail button by `getByRole("navigation", {name: strings.rail.label})`, use `getByRole("region"/"button"/"group", {name: ...})`, end with `expect(errors).toEqual([])`.
- Live gate spec: `apps/desktop/e2e/live-gate.spec.ts`. Fake Supabase: `apps/desktop/e2e/fake-supabase.ts` (its `editableFields` list L48-58 mirrors the uploader's, including `media_kit`).
- Reach flow suite: `reach-board.spec.ts`, `reach-flows.spec.ts`, `reach-replies.spec.ts`, `reach-sequences.spec.ts`, `reach-later.spec.ts`. Prototype: `prototype.spec.ts`.

## 10. Conventions that bite (docs/conventions.md)

- Files and folders kebab-case; components PascalCase, one per file; named exports only; keep files under about 300 lines.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`: an optional prop is `?:` with no `undefined` value. Use `...(x === null ? {} : { x })` spread, as the code does.
- No `any`; `unknown` plus zod at boundaries (IPC).
- Pure logic in `packages/core` (no I/O). Side effects at IPC handlers and the data layer.
- Expected failures are values (`{ok:false, reason}`), shown in plain words.
- Strings: one module per feature, keyed, English only.
- Copy: every action says what happened, where it went, and how to undo (toast with Undo).
- `data-ui` ids: `screen.part.thing` (e.g. `close.roster.row`).
- Tests beside files: `*.test.ts(x)`. Unit: Vitest. Component: React Testing Library. E2E: Playwright on example data.
- Example data is about AI creators and AI sponsors only.
- Owner rules: no email sends (decline and ask drafts wait for approval), no Gemini run outside the gate (one prompt per chat, 60 s apart), no light theme, no 400 px checks, no build of "on hold" gaps (search-1, first-1, mail-1, mail-2).
- Sub-step PR: lint, typecheck, unit tests, at most one new light Electron smoke test. Full Playwright suite at the end of the step.

## 11. Surprises and gaps for the plan

1. **Audience rule disagrees.** Plan step 8 says "US, UK, CA or AU in the top 3, buying age, 3%+ engagement, an agreed rate". `readiness.py` says analytics + agreed rate + US/GB/CA share >= 20% (tech). Reject reason "audience" (types.ts L44 comment) says US, UK, CA or AU. Needs a decision before the check is written.
2. **Rate shape.** The brief's `rates: [{format, price}]` has no `agreed` flag. `readiness.missing()` counts a rate only with `agreed: true`, so every creator would show "agreed rate" missing. Decide the shape (or add `agreed`) and keep both sides in step.
3. **Key names differ.** media_kit uses `countries[].pct` and `ageBand`; provided_data uses `countries[].share` (reply-facts) and `age` (`providedFact` in outreach.ts L553). The engine reads media_kit. Map them in one place (`buildCommsFacts`) or align the writes.
4. **Park is limited.** `reach-service.ts` `parkCreator` refuses unless stage is `emailed` with a running sequence. "Park 90 days" for a kit or replied creator needs a stage-only park path (or a relaxed guard).
5. **Decline and ask drafts.** `draftKinds` is first/followUp/reply, with a DB CHECK. Cheapest path: a `reply`-kind draft with `replyTo` and a steer note (no migration), with a clear `goal` in the pipeline. A real new kind needs a 0006 table-rebuild migration and the Gemini schema update. The pipeline's `decision` kind exists but is for deals. `build_case` has no explicit goal param.
6. **Kit facts never reach the engine.** `buildCommsFacts` sends `mediaKit: null` (facts.ts). Fill it from `channel_state.media_kit` to give the engine the kit.
7. **Frame has no kit.** Nothing in the frame or CreatorState carries media_kit, provided_data or a rate. A kit editor needs a new write (like `creator.notes`, direct-through) and new CreatorState fields, or a read via a new `DataSource` method (like `creatorNotes`).
8. **Auto stage move.** `intents.ts` `reply.fact` case queues only `provided_data`. The replied to kit move needs a `creator_stage` edit queued there, and the stage set in `writeReplyFact` (same transaction).
9. **Duplicate reject reasons.** `renderer/find/triage-card.tsx` L14 re-declares `rejectReasons` (core already has it). Use the core one.
10. **Stale comment.** `0001-initial.ts` L40 says creator_stage has "no Supabase column yet", but `supabase/migrations/20261022090100_creator_stage_edit.sql` exists.
11. **Example data.** Seed has no media_kit or provided_data; c1 and c2 are `signed` with no kit. A kit example needs an AI creator and an AI sponsor (owner rule).
12. **Working tree is clean**, branch `feat/8-signing`, no `.router/PLAN.md` yet.
