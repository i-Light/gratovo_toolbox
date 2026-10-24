# Progress: step 5 (Find)

Started 2026-10-24. The plan is `.router/PLAN.md` (decisions D1 to D18, contracts, tasks), the recon `.router/CONTEXT.md`, the agent rules `.router/specs/rules.md`. Step 5 is four pull requests: 5a, 5b, 5c, 5d.

**5a done:** PR #20, merged 2026-10-24 as 835a404.

**Now: 5b** (the gallery and the creator record) on branch `feat/5b-find-gallery-record` from `main` at 835a404. Plan: PLAN.md "5b" (D19 to D26).

## Tasks, 5b

| id | tier | state | note |
|---|---|---|---|
| C2 | H | done | views in `find.views`, `logFor`/`linesFor`, notes write + outbox (`''` is null, as the server), conflict values cut; lead: notes up to 50,000 with `notesCut` |
| G1 | N | done | `Gallery`, facets, chips, saved views, toolbar, `useGalleryPages` (one page at a time, facets on offset 0), 7 prefs; Found by lists runs with kept > 0 |
| P1 | N | done | `renderer/record/creator-*`, `RecordBody` in record-summary; `record: []` already shows the record in live; falls back to the summary when the catalog lacks a creator |
| G2 | N | running | cards, table, selection, bulk bar, compare |
| W2 | N | todo | wiring, live gate, smoke test |
| R2 | H | todo | review |
| L2 | lead | todo | checks, PR, merge |



## Tasks, 5a

| id | tier | state | note |
|---|---|---|---|
| C1 | H | done | contracts (21c081d). `emptyFacets`; country a loose string ≤10; ipc filter schema typed `ZodType<FindFilter, FindFilter>` (lead) |
| B1 | N | done | `fitOf`, `isGold`, `hasSignal`, `passes`, `sortItems`, `facetCounts`, `queryCatalog`, words in `find/words.ts`; lead reworded the audience note ("Channel country: IN, …") |
| B2 | N | done | `createCatalog`, `readRuns(dbPath, items, limit, now)`; test fixture `catalog-fixture.ts`; 3,000×15 + 16,000 build timed |
| B3 | H | done | stage write creates the row; reject tags + local due; log ref/action/detail to the server; `creatorStates()`; keep-mine on a tags conflict restores tags |
| B4 | H | done | `createImageService`, `createImageNetwork`, `answerAppRequest`; lead: cache file names by the id in hex (Windows ignores case), dev CSP allows app://gratovo pictures |
| B5 | N | done | `useCatalogQuery`/`useCatalogItem`/`useRuns`, `ensureCreators`, the five acts; lead: persister writes records before log lines (B3's naming point) |
| B6 | N | done | Review new, triage card, runs table, Thumb, fit chip, a FindTabs strip; run filter is a module store in triage.tsx (no route option); Kept removed |
| B7 | N | done | skip split off in `process_keyword`, carried on the `Search` context |
| W1 | N | done | catalog, pictures, skip wired; `find.folder()`, `onPipelineChanged`, `onCreatorsWritten`; rail `subLive` |
| T1 | N | done | `e2e/find-triage.spec.ts`; `find-search.spec.ts` moved onto the runs table |
| R1 | H | done | review: 1 blocker, 4 important, 11 minor, all fixed (R1a main/core, R1b renderer). Lead: a paused search is recorded `stopped` and shows as a pause; CodeQL file race in the picture cache; old e2e specs on the new write shape |
| L1 | lead | done | PR #20, CI green, merged |

## Notes for 5b and later

- The run filter for "Review results" on an older run is a module store in `renderer/find/triage.tsx` (no route option); 5b sends older runs to the gallery and can move it to the route.
- Reject toast says "It leaves Review new; Undo brings it back." 5c changes it to the archive wording when Toolbox › Archive arrives.
- Promo codes ("Use code X") show as sponsors: the ported detector does that on purpose (old behaviour).
- The heavy-owner catalog timing test can exceed its bound when the whole suite runs in parallel on a busy machine; it is skipped in CI.
