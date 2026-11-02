# Step S: the scraping upgrade

Planned 2026-11-02 at the owner's request, to start the same day. The study it builds on is [scraping-omar-analysis.md](scraping-omar-analysis.md). Step P pauses at P3 while this step runs.

## Goal

Find many more in-range channels per day than now, with runs that keep going on their own. Lose nothing along the way, in the archive or in a failed run.

The gap with Omar's scraper is mostly keyword count (about 45 times fewer keywords searched). The rest is runs that stopped or stalled. Our yield per keyword is already better than his.

## The owner's decisions (2026-11-02)

- **No paid proxies for now.** Free proxies and AWS gateways are mixed in one pool, and each route kind is tracked in Insights so we can see what each one gives.
- **Language and topics come from the API calls we already make.** `videos.list` and `channels.list` cost 1 unit a call whatever parts are asked for: Google dropped the per-part cost in July 2020 ([videos.list](https://developers.google.com/youtube/v3/docs/videos/list), [revision history](https://developers.google.com/youtube/data/revision_history)). So the extra parts go into the same batches of 50. There are no new calls and no extra units.
- **The archive keeps more.** The owner took the recommended list in S4, without tags: video tags and the channel's own keywords are misleading noise to the owner, so they are neither archived nor added in S3.
- **The gateway leak test may run** when S5 starts: one gateway, one request, deleted right after.
- **Channel uploads are read from the channel page, as now** (no quota). The API is only a fallback for channels whose page can't be read, under a daily cap (S7).

## Order and pull requests

One sub-step, one pull request, merged before the next starts. Each has lint, typecheck, unit tests and at most one light Electron smoke test. The full Find flow suite runs once in S8. "Tier" is the model tier from [the plan's §10](migration-plan.md#10-model-use).

| Part | What | Tier | Depends on |
|---|---|---|---|
| S1 | Quick fixes: routes, pacing, keyword "done", channel ids | N, plan H | none |
| S2 | Runs that keep going: fail fast, switch route, the breaker, continuous mode | H plan, N build | S1 |
| S3 | More from the same API calls: language, topics, engagement, paid placement, search position | N, schema H | S1 |
| S4 | An archive that loses nothing the owner wants kept | H | S3, the owner's keep list |
| S5 | Free proxies next to AWS, route tracking in Insights, the gateway leak test | H plan, N build | S2 |
| S6 | Keywords at scale: the generator and yield-based ordering | N | S1 (S3 for scoring) |
| S7 | Optional extras, each measured: the channel search, the API fallback for unreadable channels | N | S5, S6 |
| S8 | Find flow suite, ADR, architecture and parity notes | N | all |

S3 and S6 can run alongside S2 if two sessions work at once. They touch different files.

---

## S1. Quick fixes

**Work:**
1. **This machine last.** When any gateway or proxy is set, the direct connection is used only while every other route is cooling down, and with its own minimum gap. The setting "Include this machine" stays, with a default of off when other routes exist. Files: `config.py`, `scrapetube/proxy_pool.py`.
2. **Normal pacing by default.** Remove the automatic switch to Fast when rotation is on (`config.py:191`). Fast stays as an explicit choice.
3. **Done means finished.** `find_channels` returns whether the search reached its end: the limit, or no more pages. A search that stopped on an error keeps the channels it found but leaves the keyword pending, with a failure count, and the run goes on to the next keyword. After 3 failures it is marked `failed` and shown in the keyword list with a Retry button. The app's queue (`find.json`) counts the failures that decide this; `pipeline.db` counts them too, for the records. A run sends only the keywords still to do, so a keyword that failed never makes a resume search the finished ones after it again. Files: `search/discover.py`, `search/keyword.py`, `jobs/search.py`, `store.py` (a `failures` column on `keywords`, schema v5), and the app's Find service and keyword list.
4. **Channel ids, not handles.** Channel pages are read at `/channel/UC…/videos`. Search results without a handle are kept, and the handle is filled in later from the API's `customUrl`. Files: `search/discover.py`, `store.py` (allow the handle to be filled in later).
5. **Bot wall markers.** Add "Sign in to confirm you're not a bot" and "confirm you're not a bot" to the block markers (`scrapetube/scrapetube.py`).
6. **Requeue the weak keywords.** A one-time action in Find › Keywords: put back to pending every done keyword with 0 channels, or with fewer than 10 found from 13–15 Sep (about 300). It shows the count and asks before it runs. The queue holds at most 500 keywords until S6, so it adds what fits and says how many didn't.

**Acceptance:**
- The proxy pool sends no request direct while a gateway is healthy. This is tested on the fake clock with the simulation from the study (direct share 0%, not 48%).
- A search whose first page fails leaves the keyword pending.
- A video search result without a handle is stored.
- The weak keywords can be requeued from the app.

## S2. Runs that keep going

**Contract first (H):** the protocol events for "route paused", "all routes resting until HH:MM" and "Data API paused", and the run states that go with them. These go into `protocol.py`, `protocol.schema.json` and the desktop's `pipeline/protocol.ts` in the same pull request.

**Work:**
1. **Fail fast, switch route.** Each page gets at most 3 attempts, each on a different route. Then the keyword fails and goes back to pending (S1.3), and the run takes the next keyword. This replaces the unlimited retries in `scrapetube.request`.
2. **One route per keyword.** A worker keeps one route for every page of a keyword, its sweep included. If that route fails, it takes another and carries on from the same page (Omar's `_run` restarts from page 1; carrying on costs fewer requests and loses nothing). The pool's other guarantees stay as they are: one worker per route, the gap, the cooldowns.
3. **A block cools the route, not the run.** `BlockedError` cools that route and the worker carries on. Parallel workers no longer stop each other on one worker's failure (`parallel.py`). The run ends only on Stop, a refused key, or a person's choice.
4. **All routes resting** shows "Paused, resuming at HH:MM" in the run panel instead of a silent wait. Stop still works at once.
5. **The Data API breaker and the quota wait.** Port Omar's `core/breaker.py` and `core/quota.py` into `youtube.py`. A network failure means wait and probe (1 min, then doubling up to 10 min). An exhausted quota means "paused until the reset" (midnight Pacific plus 5 min), not the end of the run.
6. **Continuous mode.** A setting under Find › search rules: "Keep searching until the list is done". The run picks up again after a quota reset or a route pause by itself. It stops at the end of the keyword list, or on Stop.
7. **Bandwidth.** Count the compressed bytes of every page response, as in Omar's `traffic.py`. Show the total per keyword in the run log and store it on the run (schema v6).

**Acceptance:**
- On the fake clock: a blocked route never ends a run while another route is healthy.
- A worker's failure doesn't stop the other workers.
- A quota answer pauses the run until the reset.
- A page's attempts are capped at 3, each on a different route.
- The run panel shows the paused state with its time.
- One smoke test: a run that hits a stubbed block keeps going.

## S3. More from the same API calls (no extra units)

**Work:**
1. **Videos:** ask `videos.list` for `snippet,statistics,contentDetails,topicDetails,status,paidProductPlacementDetails`, still 50 ids a call. Store these per video:
   - `defaultAudioLanguage` and `defaultLanguage`
   - `categoryId`
   - `liveBroadcastContent`
   - likes and comments
   - duration
   - whether it has captions
   - `madeForKids`
   - topic categories
   - `hasPaidProductPlacement`
2. **Channels:** ask `channels.list` for `snippet,statistics,brandingSettings,topicDetails,contentDetails,status`. Store these per channel:
   - total views and video count
   - whether the subscriber count is hidden
   - the channel's start date
   - `defaultLanguage`
   - `customUrl` (fills the handle, S1.4)
   - topic categories
   - the uploads playlist id
   - `madeForKids`
3. **Channel rollups** in `compute_channel_rollups`, each with its basis:
   - **main language:** the most common `defaultAudioLanguage` over its stored videos, then `defaultLanguage`, then the channel's own, with its share (for example "en, 11 of 12 videos")
   - the channel's topics, with counts
   - median likes and comments
   - engagement rate
   - median duration
   - Shorts share (60 s or less)
   - the share of videos with a declared paid placement (next to the text signal `sponsored_ratio`)
4. **Search position:** keep each hit's position in the results (Omar's `research_index`) on `channel_keywords`.
5. **The app:** main language and topics on the creator record's Channel tab and on gallery cards. A Language facet in Find › Gallery. The auto-clean rule gets an optional "main language is one of …".
6. Schema v7 for `pipeline.db` (S1 takes v5, S2 v6). The new channel and video columns are local facts and are not shared until step T, the same as today.

**Acceptance:**
- Recorded API answers show the same number of calls and units before and after.
- The new fields are stored and the rollups computed, with tests on recorded answers.
- The Language facet filters the gallery.
- A channel with no language data reads "Not known", never a guess.

## S4. An archive that loses nothing the owner wants kept

**Work:**
1. The tombstone gains the fields the owner keeps from the list below. Archiving copies them, Bring back puts them back, archiving again only adds.
2. **The guard test:** every column of `channels` and `videos` must be listed either as "kept on the tombstone" or as "dropped on purpose, because …". A new column with neither fails the test. This is the guarantee against losing information later without anyone noticing.
3. Archive and delete stay one transaction (`BEGIN IMMEDIATE`, as now). The new fields are written in the same transaction as the delete.
4. The team format: the shared archive record gains the same fields. This is a versioned change to the catalog's archive record, read by older machines without error.

**What live data holds today, and what the archive keeps.** The owner accepted the "Recommend" column on 2026-11-02, with every tag dropped.

*The channel row (`channels`):*

| Field | Archive today | Recommend | Why |
|---|---|---|---|
| channel id, handle, name, country, subscribers, first seen | kept | keep | identity |
| keywords that found it, with time and search limit (`found_via`) | kept | keep | |
| median views, uploads in 30 days, latest upload, videos we had | kept (frozen) | keep | |
| brands seen, emails found and their sources | kept | keep | |
| label, archived at | kept | keep | |
| **description** (about 400 characters on average) | **lost** | **keep** | re-judging fit, brand mentions, a later email search |
| **profile picture URL** | lost | keep | small, and the archive list can show faces |
| banner URL | lost | drop | big, and fetched again on Bring back |
| link | lost | drop | built from the id |
| **when it was last read, when its videos were read** | lost | **keep** | tells how old the numbers are |
| **sponsored ratio** | lost | **keep** | |
| read failures, unreadable until | lost | drop | |
| sync bookkeeping (blob and announce stamps) | lost | drop | this machine's state |
| all new S3 channel fields (language, topics, totals, start date) | n/a | **keep** | small, and they answer "should we look at it again" |

*Its videos (`videos`), all deleted today.* Archived channels have about 12.7 videos each. About 494,000 have been deleted so far, and those can only come back by reading the channels again.

| Field | Average size | Recommend |
|---|---|---|
| video id, published date, views | about 40 bytes | **keep** |
| S3 numbers: likes, comments, duration, language, paid placement, topics | about 60 bytes | **keep** |
| title | 55 characters | **keep**: the relevance gate judges a channel by its titles |
| description | 1,600 characters | drop: emails and brands are already taken from it |
| tags | 280 characters | drop: misleading noise (owner) |
| thumbnail URL | 52 characters | drop: built from the video id |

Keeping the recommended video fields costs about 150 bytes a video, about 2 KB per archived channel. For today's 39,000 archived channels with videos that is about 75 MB, against a `pipeline.db` of 140 MB now. Descriptions would add about 800 MB, which is why I'd drop them.

*Other tables:* `channel_keywords` already lives on as `found_via` (S3 adds the search position). `video_transcripts` is not deleted on archive today and stays that way.

**Acceptance:**
- The guard test exists and passes.
- Archive, then Bring back, round-trips every kept field.
- An older machine reads a new archive record without error.
- The size of the archive is shown in Toolbox › Archive.

## S5. Free proxies next to AWS, with tracking

**Before anything else: the gateway leak test.** This is an outward-facing AWS action, so it runs only with the owner's go:
1. Deploy one gateway in one region that forwards to a header-echo service.
2. Send one request.
3. Check whether the home IP appears in `X-Forwarded-For` or `Forwarded`.
4. Delete the gateway.

Also check, in the log of a normal run, that no gateway request ends on a `youtube.com` address after a redirect. If either leak is real, fix it first:
- override the forwarding header in the gateway's integration;
- for redirects, follow them through the gateway or refuse them.

**Work:**
1. **A free proxy provider** (off by default, an explicit switch in Settings › Connections):
   - **Fetching:** the free ProxyScrape list, as JSON, HTTPS-capable, elite or anonymous.
   - **Health check:** `generate_204` in parallel, 10 at a time, within the "slowest proxy accepted" time. Fastest first; the rest kept as spares.
   - **Shared ban:** a proxy that fails is banned for every worker, starting at 5 min and doubling up to 60 min (Omar's `_Registry`, merged into our pool's cooldown).
   - **Memory and refill:** the last good proxies are remembered for the next run. The list is fetched again when fewer than N usable proxies are left.
2. **Safety rules for free proxies.** Page reads only. The YouTube API key never goes through a proxy (the API client already uses no proxy). No sign-in cookies ever go through one. Certificates are always checked, so a proxy can only see that we visit youtube.com, not what we read.
3. **AWS region rotation** (off by default, an explicit switch, with a cap on how many gateways exist at once). A gateway that stays blocked past its third cooldown is removed, and one is deployed in an unused region. This uses the existing deploy and remove jobs.
4. **Workers follow routes.** Parallel search runs one worker per usable route, up to the cap, as now. It grows when the free list refills and shrinks when routes are banned.
5. **Route tracking** stored per run and per route (a new `run_routes` table):
   - the route kind (AWS, free proxy, this machine), and its label (region or proxy host, never a secret)
   - requests, successes, blocks, connection failures
   - MB downloaded
   - keywords finished
   - channels found and in-range channels found
   - time used, time resting
6. **Insights › Search** gets a Routes section: by kind and by route, with the block rate, in-range channels per 100 requests, and MB per keyword, over the chosen period. It reads the run history on live data. Prototype mode shows example history.

**Acceptance:**
- The leak test is done and its result recorded in the ADR.
- With free proxies on, a run uses AWS and free proxies together, and banned proxies are not reused before their time.
- The API key is never sent through a proxy (a test).
- Insights shows the route numbers of real runs.

## S6. Keywords at scale

**Work:**
0. **A queue that holds thousands.** The Find queue stops at 500 keywords today (`queueMax` in the Find service, the index limit in the IPC schema). It grows to hold the generator's output, and the keyword list pages or virtualizes so a long queue stays quick.
1. **The generator.** A list of AI tools and products, crossed with a list of angles: setup, tutorial, vs, review, best settings, local models, MCP, agent mode, pricing, alternatives. The output is short keywords, deduplicated, without ones already searched. Gemini only suggests new tools and angles, one prompt per fresh chat under the owner's Gemini rules. The crossing itself is local and free. It lives in Find › Keywords: pick tools and angles, see the count, add.
2. **Ordering by yield.** Each finished keyword records in-range channels found and new channels (from S3 and S5). The queue puts first the keywords whose tool or angle has produced well, and pushes back the ones whose tool or angle keeps coming back empty. A keyword is never dropped without a person's say.
3. **Insights › Search:** yield by tool and by angle, so the owner sees which topics are worth more keywords.

**Acceptance:**
- The generator adds thousands of keywords with no duplicates.
- The queue order follows yield, with a test.
- Every keyword stays visible and can be retried.

## S7. Optional extras, each measured before it stays

1. **The channel search per keyword.** A second search with the "channels" filter. YouTube's channel results page lists about 20 channels a page, each with its name, handle, subscriber text and video count, so we learn of more channels per page than a video search gives (about 6). It costs page requests, not quota. Its subscriber numbers are rounded ("1.2K"), so they are used only to skip channels that are clearly out of range before the API call, never stored as the real number. Watch out: YouTube now sometimes puts the handle where the subscriber text used to be. Omar's parser misreads that, ours must not. **It stays only if** the route numbers from S5 show more in-range channels per 100 requests than the video search alone.
2. **The API fallback for unreadable channels.** When a channel's page can't be read after its retries, its latest uploads come from the API:
   - `playlistItems.list` on the uploads playlist from S3: 1 unit per channel, since it can't be batched across channels;
   - then the usual `videos.list`, 50 videos per unit.

   A daily cap (for example 1,000 units) keeps the quota for the main work. This guarantees that no channel stays unread for good. Reading every channel this way would cost 1 unit or more per channel, more than the daily quota at our volume, which is why page reads stay the default.

**Acceptance:**
- The channel search is off by default, and its parser reads both the old and the new layout of the subscriber and handle text (tests on recorded pages).
- Its route numbers are compared with the video search alone on real runs, and the result decides whether it stays. The comparison is written in ADR 0023.
- The API fallback never spends more than its daily cap (a test on the fake clock), and a channel read through it is stamped the same as one read from its page.
- No channel the backlog gave up on stays unread when the fallback has quota left.

## S8. Close the step

- The Find flow suite with the new run states.
- ADR 0023 (scraping upgrade) with the leak-test result and the owner's archive keep list.
- The architecture and parity notes.
- The status table.

**Acceptance:**
- The Find flow suite passes, with the paused, resting and quota states.
- ADR 0023, the architecture notes and the status table say what was built and what was measured.
- `.router/` holds no step S state.
