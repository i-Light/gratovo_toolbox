# 0022. Insights without deals and money (P8a)

- **Date:** 2026-10-28 (built 2026-10-28 and 10-29)
- **Status:** accepted. Builds [product/insights-design.md](../product/insights-design.md) for plan step P, part P8a. P8b adds Money, Funnel › Brands and the deal and money parts after P1.

## Context

The owner split Insights in two on 2026-10-28. **P8a** comes first, before P1: everything that doesn't need deals or money, its six-month example history at the real scale (about 162,000 channels found, 150,200 archived, 10,200 waiting, 2,000 live), and Search live on real data. When asked, the owner chose to put every tab with real data live (Overview, Funnel, Emails, Search, Goal), with Money hidden.

## Decision

1. **Facts in core, words in the strings file.** `packages/core/src/insights/` turns an `InsightsInputs` snapshot into a typed `InsightsReport` per tab: pure functions with their own tests. The report holds numbers and keys (verdicts, alert kinds, diagnoses, summary parts), never words. `renderer/insights/words/` picks each sentence from `strings.insights`, so every user-facing word stays in one file.
2. **One read per tab, in main.** `insights:read {tab, period}`. Main (`main/insights/inputs.ts`) reads both databases in one pass: live and waiting channels from the catalog's snapshot (so fit and the "not read" states match Find), the local facts through the data source's `insights` store, and the archive as SQL totals (`main/insights/pipeline-facts.ts`) cached by `pipeline.db`'s size and time, so 150,000 tombstones are counted once. Warm reads take 0.2 to 0.6 s per tab on the full example.
3. **A number and its list always agree.** `insights:list {drill, period, offset}` returns the records behind a number from `drillIds`, which uses the same predicates as the count; a test per drill kind checks it. A creator counted from its history whose record is gone is listed by id, marked as such. The archive part of Found and Passed is too big to list: their sheet says so and opens Toolbox › Archive.
4. **Stage times are recorded by the database.** Migration 0007 adds `stage_events`, written by two triggers on `channel_state` (a new row with a stage; a stage that changes), so the app, the sync's upserts and the import all record a change as it lands. The migration fills it backwards from the log and the messages where the time is known (skipping lines an undo hides and lines whose time can't be read). Rows written in bulk, an example seed or the first full pull into an empty copy, would all carry the moment of the write, so both put the log's and the messages' times on them afterwards (`restampStageEventsSql`). Its index covers channel and stage, which keeps the backfill under a second on a large log. `catalog_weeks` holds the weekly live, waiting and archive totals, written by the archive sweep; weeks before P8a aren't known, except the archive's, which comes from the tombstones. Both tables are local only; nothing new is synced.
5. **The goal targets creators to sign a month** in P8a (`local_settings` `insights.goal`, default 4), worked back to first emails, channels to review and channels to find a working day with your own 90-day rates, the course figure or a marked guess. P8b puts the money lines on top. Hidden alerts are `insights.hidden`.
6. **The example history is one TypeScript generator** (`exampleHistory(anchor, scenario)` in `packages/core/src/data/example-history.ts`), seeded so it is the same every time. Prototype mode loads it into each fresh copy: main writes the local rows (`main/insights/example-history.ts`), and a new pipeline job, `example.load`, writes the catalog and the tombstones into the prototype's `pipeline.db`, because Python owns that schema. The job runs on example data only and reads a plain file name inside its own folder. The plain example copy the Electron tests use has no history. Turning prototype mode on takes about 8 s with it.
7. **The example's archive days are 90.** With the default 7, 10,200 channels waiting would need about 1,400 rejects a day. With 90, every number in the mockups agrees: 18,800 rejected by a person = 10,200 waiting + 8,600 archived, and no person saw 94% of the archive. So the To be archived view says about 570 leave this week, not 10,200.

## Consequences

- Search, the Overview without money, the creator Funnel, Emails and the Goal show on live data now.
- The frame's creator read looked up each creator's reject line in a computed list of all of them: 16 s with 5,000 creators and 19,000 reject lines. It now uses the log's entity index (0.1 s), which helps any large catalog, not only the example.
- A keyword's last run can't tell how many channels it met that were already live (the pipeline doesn't record it), so "worn out" reads the archived share only.
- The archive search box on Search › Archive opens Toolbox › Archive; carrying the typed words there is left for later.
