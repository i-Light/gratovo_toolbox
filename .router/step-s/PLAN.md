# Step S working plan

The parts and their acceptance checks are in [../../docs/scraping-upgrade-plan.md](../../docs/scraping-upgrade-plan.md). This file holds each part's decisions, contracts and tasks, written when the part starts.

## S1. Quick fixes (branch `feat/scraping-s1`)

### Decisions

- **Q1. Direct last.** In `ProxyPool._choose`, the direct candidate is an option only while every non-direct candidate is cooling down (`cooldown_until > now`). Resting (gap) or busy non-direct candidates mean wait, not direct. Direct gets its own minimum gap, `DIRECT_MIN_GAP_SECONDS = 6.0` (same as the gateways), set in `from_routes` whenever other candidates exist. A pool of direct alone keeps no gap (the pipeline's pacing governs it, as now).
- **Q2. "Include this machine" off by default when other routes exist.** Pipeline: with no `proxies` setting sent, `includeDirect` is false when a gateway or proxy is set. App: the stored default becomes `includeDirect: false`. A value the owner saved stays.
- **Q3. Pacing.** With no `pacing` setting sent, pacing is `normal`. The app already always sends it.
- **Q4. Done means finished.** `Source.find_channels` returns a `Found` named tuple: `channels: dict[str, str]` and `complete: bool` (reached the limit or the last page). A non-block error mid-search returns what it had with `complete=False`. `process_keyword` processes the channels as now, then: complete → `mark_keyword_done`; not complete → `store.mark_keyword_incomplete(conn, keyword, channels_found)` (failures + 1; status `failed` at 3 or more, else `pending`) and `KeywordResult.complete=False`. The search job then emits `keyword` with `state="failed"` and `error="The search stopped early."` and goes on to the next keyword. It isn't in `results`, so `end.at` can point at it. `mark_keyword_done` resets failures to 0.
- **Q5. A keyword state `incomplete`** (changed after review: a quota or block that ends the run must not count against the keyword it happened in). The pipeline sends `incomplete` (with found, kept, error) when a keyword's search stopped early and the run goes on; `failed` stays for the keyword in which a run-ending error happened. The app counts failures in its own queue entry: `failures` (0 to 99, default 0). On `incomplete`: failures + 1, state `failed` at `failureLimit` (3, exported from `@gratovo/ipc`), else `queued`. On `failed`: back to `queued`, no count. A user Stop is neither. The app's count decides Retry and giving up; `pipeline.db`'s count is the record.
- **Q6. A run sends only what is left.** The app builds the job from the queue entries at or after `s.at` whose state is `queued` (or `running`, left from a crash): `keywords` is that list, `startAt` 0, and a `runIndexes` array maps job index to queue index for every message. On exit the app sets `s.at = firstUndone(s)` and ignores `end.at`. `firstUndone` skips `done` and `failed` entries. `startAt(index)` and the "next keyword" pointer are unchanged.
- **Q7. Retry.** A `failed` entry shows Retry: new channel `find:retry` `{index}` sets it `queued` with failures 0, refused while a run is busy (as `find:remove`).
- **Q8. Requeue the weak keywords.** Changed after review: a keyword already queued, running or failed in the queue doesn't count, and the 0-found branch counts only keywords finished before 2026-11-03, so the action goes away once used. New channels `find:count-weak` (count only) and `find:requeue-weak` (do it). Main reads `pipeline.db` (read only): `status='done' AND (channels_found=0 OR (channels_found<10 AND completed_at >= '2026-09-13' AND completed_at < '2026-09-16'))`. Each found keyword already in the queue (case-insensitive) becomes `queued`, found/kept 0, failures 0; the rest are appended while the queue has room (500). Returns `{requeued, added, skipped}`. The keyword list shows "Search again the N weak keywords" when N > 0, with a confirm that states N.
- **Q9. Handle-less channels.** `channel_from_item` accepts a result whose byline has a channel id but no `@` handle: its handle is the channel id itself (a placeholder; `channels.handle` stays NOT NULL). Duplicates by id keep the `@` handle. `_channel_info`: when the batch handle equals the channel id and `snippet.customUrl` starts with `@`, `Handle` is the customUrl; `Link` is built from `Handle`. `save_channels` writes `info["Handle"]`.
- **Q10. Channel pages by id.** `Sweep.recent_video_ids(channel_id, *, limit)` (renamed parameter, every caller passes the id). `LiveSweep` reads `https://www.youtube.com/channel/{channel_id}`. `ExampleSweep` looks up by id.
- **Q11. Bot wall.** `BLOCK_MARKERS` gains `"sign in to confirm you're not a bot"` and `"confirm you're not a bot"` (the head is lowercased before the check).
- **Q12. Schema v5:** `keywords.failures INTEGER NOT NULL DEFAULT 0`, added only when missing. Status may now be `failed`. The sync shares keyword rows: check that a `failed` status from a teammate applies without error.

### Tasks

| id | title | tier | files | done-check |
|---|---|---|---|---|
| S1-a | Direct last, its gap, defaults Q1-Q3, markers Q11 | N | `proxy_pool.py`, `config.py`, `scrapetube.py`, `tests/test_proxy_pool.py`, `tests/test_config.py`, `tests/test_scrapetube_request.py` | pytest of those files; a fake-clock test: 2 gateways, normal and fast pacing, 0.8 s a request, 200 requests: 0 direct while a gateway is healthy; direct used when both gateways cool down |
| S1-b | Done means finished Q4, schema v5 Q12, handle-less Q9, by id Q10 | N | `search/discover.py`, `search/context.py`, `search/keyword.py`, `jobs/search.py`, `store.py`, `youtube.py`, `example/__init__.py`, the backfill and refetch callers, their tests | pytest all; new tests: first page fails → keyword pending, failures 1, run continues; third failure → `failed`; handle-less result stored, handle filled from customUrl; migration v4→v5 |
| S1-c | App side Q2, Q5-Q8 | N | `find-service.ts`, `find-store.ts`, `connections-store.ts`, `packages/ipc/src/find.ts`, `channels.ts`, preload, `keywords.tsx`, `strings.ts`, tests | Vitest of find-service and ipc; typecheck; lint; look at the keyword list at 1440 px |

## S2. Runs that keep going (branch `feat/scraping-s2`)

### Decisions

- **R1. Three attempts a page, each on a different route.** `scrapetube.request` makes at most `MAX_ATTEMPTS = 3` attempts. Each attempt acquires with `exclude=` the candidates already tried for this request, as long as the pool holds another candidate at all (one route alone: it is reused after its cooldown). A throttle, a block (`BlockedError`, now raised inside the attempt loop for innertube's non-JSON answer), a connection failure, a 5xx or another request error each cool or skip that route and go straight to the next attempt: no backoff sleep of our own (the pool's cooldowns and gaps are the wait). After the third failure `request` raises `PageFailedError(ScrapetubeError)` naming the last cause (kind and path only). The redirect-loop rule stays. `THROTTLE_BACKOFF`, `TRANSIENT_BACKOFF`, `PROXY_FAILOVER_BACKOFF`, `MAX_BACKOFF` and the unlimited loop go.
- **R2. One route per keyword (affinity, not restart).** A worker keeps the route that served its last page for every page of the keyword, the sweep included: `scrapetube.route_affinity()` is a context manager the search job opens around each keyword; inside it `acquire(prefer=candidate)` waits for that candidate (its gap, or another worker using it) while it is healthy, and takes another when it cools down. The new route then becomes the preferred one. The plan text said "restart from page 1"; continuing on the new route with the same continuation is cheaper and loses nothing, so the restart is dropped (written in ADR 0023). "Never twice in a row" applies only to requests without a preference. One worker per route stays: a preferred candidate busy with another worker is waited for only while no other healthy candidate is free; otherwise the worker takes the free one.
- **R3. A block cools the route, not the run.** `find_channels`: a `PageFailedError` (any page, first included) ends the search with `complete=False` (S1 path: `incomplete`, the keyword stays pending). `BlockedError` and `SearchBlockedError` no longer end a run. The sweep: a channel whose page fails is `ChannelUnreadableError` (deferred, as now). `parallel.run_keywords`: a worker's exception stops the other workers only when it is fatal: `RunAborted`, `YouTubeError` with code `no_youtube_key` (or `quota` when continuous mode is off), and any exception that is not a `ScrapetubeError` (a bug). The `blocked` end code stays in the protocol for older messages but the search job no longer sends it.
- **R4. Waits are told.** New pipeline message `{"type": "wait", "reason": "routes" | "quota" | "api", "until": "<ISO-8601 UTC>"}` when a wait of 30 s or more starts, and `{"type": "resume"}` when the first request after it goes out. Routes: the pool's cooldown wait (`WAIT_COOLDOWN`) reports `until` = the soonest candidate's cooldown end; one `wait` however many workers wait (a counter under a lock in `scrapetube`). App: `findRunStates` gains `waiting`; `FindState.run` gains `wait: {reason, until} | null`; the run panel's headline reads "Paused, resuming at HH:MM" (routes), "API quota spent, resuming at HH:MM" (quota), "YouTube API unreachable, checking again at HH:MM" (api). Stop works at once (every sleep is already interruptible).
- **R5. The API breaker and the quota wait** in `youtube.py`, opt-in per client (`YouTubeApi(..., wait_on_network=True, wait_on_quota=continuous)`), so other jobs keep today's behaviour. Network: after the existing retries, wait and try the same call again: 60 s, doubling to 600 s, until it answers or Stop; one breaker per client shared by the workers (one probes, the rest wait). Quota (`quotaExceeded`, `dailyLimitExceeded`): wait until the next midnight in America/Los_Angeles plus 5 min, then try again. Both send `wait`/`resume` through a sink the job sets. The clock and sleep are injectable.
- **R6. Continuous mode.** `rules.continuous: boolean` (default false) in the search rules (Find › Edit rules: "Keep searching until the list is done"). On: quota waits (R5). Off: quota ends the run with code `quota` as today. Routes and the network always wait (R4, R5). The run ends at the end of the list or on Stop.
- **R7. Bandwidth.** Every page response adds its size: the body gzipped again at level 6 when the response was compressed (`content-encoding`), else its length, plus the headers (Omar's `traffic.py`). Counted per thread for the keyword and in total. The keyword's `done`/`incomplete` log line says "… MB downloaded". `runs.bytes_downloaded INTEGER` (schema v6; S3 moves to v7) holds the total.

### Contracts

- `protocol.py`, `protocol.schema.json`, desktop `pipeline/protocol.ts`: the `wait` and `resume` messages; the search job's `rules.continuous` (optional, default false).
- `packages/ipc/src/find.ts`: `findRunStates` + `waiting`; `run.wait`; `findRulesSchema.continuous` (default false; `find.json` without it reads false).

### Tasks

| id | title | tier | files | done-check |
|---|---|---|---|---|
| S2-a | R1, R2, R3 pipeline side, R7 | N | `scrapetube.py`, `proxy_pool.py`, `search/discover.py`, `search/keyword.py`, `jobs/search.py`, `parallel.py`, `store.py`, tests | pytest; fake clock: blocked route never ends a run while another is healthy; a worker's failure doesn't stop the others; 3 attempts on 3 routes; affinity keeps one route per keyword |
| S2-b | R4 pipeline side, R5, R6 pipeline side, protocol | N (contract by H, written above) | `protocol.py`, `protocol.schema.json`, `youtube.py`, `scrapetube.py` wait sink, `config.py`, `jobs/search.py`, tests | pytest; quota pauses until the reset on the fake clock; the network breaker probes and resumes |
| S2-c | App: protocol.ts, waiting state, continuous rule, panel | N | `pipeline/protocol.ts`, `find-service.ts`, `find-store.ts`, ipc `find.ts`, the run panel, rules editor, `strings.ts`, tests | Vitest; typecheck; lint; look at 1440 px |

S2-a and S2-b both touch `scrapetube.py` and `jobs/search.py`: S2-a first, then S2-b.

### Changed after review (S2)

- R1: `exclude` is a preference, not a rule. "This machine last" is decided over every candidate; if every untried candidate is cooling, a tried healthy one is reused (never this machine while a gateway or proxy is healthy).
- R4: `resume` carries its `reason`. The search job counts waits per reason (one `wait` on the first waiter, one `resume` on the last); the app keeps one wait per reason and shows the one that ends last.
- R3/R5: backfill and refetch keep today's behaviour: their sweep (`sweep(end_on_block=True)`) ends the job when every attempt on a page was a block.
- R5: rate limits (per second, not daily) ride the network breaker whenever it is on, with reason `api`. The quota wait sleeps in chunks of a minute and re-reads the wall clock, so a PC that slept wakes on time. `tzdata` is a pipeline dependency (Windows has no tz database).
- Not built in S2: the Electron smoke test for a stubbed block (the example data has no route pool to block); the fake-clock tests cover it. The full Find flow suite in S8 covers the run states.

## S3. More from the same API calls (branch `feat/scraping-s3`)

### Decisions

- **L1. Parts.** `videos.list` part = `snippet,statistics,contentDetails,topicDetails,status,paidProductPlacementDetails`; `channels.list` part = `snippet,statistics,brandingSettings,topicDetails,contentDetails,status` (also `channel_for_handle`). Still 50 ids a call: a test on recorded answers counts the calls and units before and after (same numbers).
- **L2. Video fields** (`VideoInfo` keys, `videos` columns, all nullable): `audio_language` (`snippet.defaultAudioLanguage`), `default_language` (`snippet.defaultLanguage`), `category_id`, `live_content` (`snippet.liveBroadcastContent`), `like_count`, `comment_count` (TEXT like `view_count`; hidden = NULL), `duration_s` (INTEGER, from ISO-8601 `contentDetails.duration`; `P0D` or unparsable = NULL), `has_captions` (INTEGER 0/1 from `contentDetails.caption`), `made_for_kids` (INTEGER from `status.madeForKids`), `topics` (JSON list of the Wikipedia topic names, the last path segment of `topicDetails.topicCategories`, with `_` as spaces), `paid_placement` (INTEGER from `paidProductPlacementDetails.hasPaidProductPlacement`). Tags stay as they are on live rows (not archived, S4).
- **L3. Channel fields** (`ChannelInfo` keys, `channels` columns): `total_views`, `video_count` (INTEGER), `subscribers_hidden` (INTEGER from `statistics.hiddenSubscriberCount`), `started_at` (`snippet.publishedAt`), `default_language` (`snippet.defaultLanguage`), `topics` (JSON, as L2), `uploads_playlist` (`contentDetails.relatedPlaylists.uploads`), `made_for_kids` (INTEGER from `status.madeForKids`). `customUrl` already fills the handle (S1). The channel's keywords are not stored (owner, 2026-11-02).
- **L4. Rollups** in `compute_channel_rollups`, over the channel's stored videos (all of them, not the 30-day window; the window stays for views and uploads):
  - `main_language` + `main_language_basis` ("audio 11/12", "default 4/5", "channel"): the most common `audio_language` (its primary subtag, `en-US` → `en`) over videos that have one, if at least half of the stored videos have one; else the most common `default_language` the same way; else the channel's `default_language`; else NULL. Ties go to the language of the newest video among the tied.
  - `topic_counts` JSON `{name: n}` from video topics plus the channel's own topics (each channel topic counts once).
  - `median_likes`, `median_comments` (over videos with a count), `engagement_rate` REAL = median over videos of (likes + comments) / views, for videos with views > 0 and both counts known; NULL with fewer than 3 such videos.
  - `median_duration_s`, `shorts_share` REAL (videos with `duration_s` ≤ 60 over videos with a duration), `paid_share` REAL (videos with `paid_placement=1` over videos with the field known).
- **L5. Search position.** `channel_keywords.position INTEGER` (nullable): the 1-based position of the channel's first hit in that keyword's results. `find_channels` returns positions with `Found` (`positions: dict[str, int]` by channel id). Kept on a new link only (an existing link keeps its first position).
- **L6. Schema v7.** Every new column added only when missing (`MIGRATIONS[7]`). The new columns are local facts and are not shared (the channel blob keeps its listed columns; a test that the blob shape is unchanged).
- **L7. The language rule.** `rules.languages: string[]` (ISO 639-1, empty = off) in the Find rules and the pipeline's rules. Applied with the signal bounds, after a kept channel's uploads are read: a channel whose `main_language` is known and not in the list is archived with the rule's label, announced as swept; an unknown language is kept ("Not known", never a guess). Settings › Search rules: "Main language is one of" with a short multi-pick (English, Spanish, Portuguese, German, French, Hindi, Arabic, Indonesian, Japanese, Korean, other codes typed).
- **L8. The app.** The catalog item gains `language` (code or null) and `topics` (top 3 names). Find › Gallery gets a Language facet (codes with counts, "Not known" last) and the card shows the language and the top topic. The creator record's Channel tab shows main language with its basis ("English · 11 of 12 videos"), topics with counts, total views, video count, start date, median likes and comments, engagement rate, median duration, Shorts share and paid-placement share, each "Not known" when null.

### Tasks

| id | title | tier | files | done-check |
|---|---|---|---|---|
| S3-a | L1-L6 pipeline | N (schema H: these decisions) | `youtube.py`, `store.py`, `search/discover.py`, `search/keyword.py`, `search/context.py`, `example/__init__.py` (example values for the new fields, AI niche), tests | pytest incl. recorded-answer call/unit count, rollups, migration v6→v7, blob unchanged |
| S3-b | L7 pipeline + protocol | N | `protocol.py`, schema json, `config.py`, `search/auto_clean.py`, tests | pytest; schema snapshot test |
| S3-c | L7 app + L8 | N | ipc `find.ts`, `pipeline/protocol.ts`, `catalog.ts`, `results.ts`, gallery facet and card, record Channel tab, search rules editor, `strings.ts`, tests | Vitest; typecheck; lint; look at 1440 px |

### Changed after review (S3)

- L4/L7: a language is a two-letter ISO 639-1 code after mapping YouTube's old codes (iw→he, in→id, ji→yi); anything else (fil, yue, und, zxx) is unknown, so the language rule keeps it and the app shows "Not known".
- L4: rollups read each channel's videos once, only the columns they need.
- L8: the record shows the basis with its source ("English · audio, 11 of 12 videos"). The app's example history carries the new channel facts, so prototype mode shows them.
- To ask the owner: Shorts share counts videos of 60 s or less. YouTube allows Shorts up to 3 minutes since October 2024, and the API can't tell a Short from a short video, so 60 s undercounts and 180 s would overcount.
- For step T: a teammate's channel blob carries no S3 video fields, so applying one resets that channel's language and engagement rollups until it is read here again.

## S4. An archive that loses nothing the owner wants kept (branch `feat/scraping-s4`)

The keep list is the owner's (2026-11-02): the plan's "Recommend" column, every tag dropped.

### Decisions

- **A1. Channel facts on the tombstone.** `ARCHIVE_FACTS` grows (each a nullable `channel_archive` column, schema v8, added only when missing): `description`, `profile_picture`, `last_fetched_at`, `videos_fetched_at`, `sponsored_ratio`, and every S3 channel fact: `default_language`, `topics`, `total_views`, `video_count`, `subscribers_hidden`, `started_at`, `uploads_playlist`, `made_for_kids`, and the S3 rollups `main_language`, `main_language_basis`, `topic_counts`, `median_likes`, `median_comments`, `engagement_rate`, `median_duration_s`, `shorts_share`, `paid_share`. They go through `_row_facts`, `_merge_facts` (newer known value wins, NULL never replaces a known one; `last_fetched_at`/`videos_fetched_at` keep the later time) and `_fill_facts` as the existing facts do.
- **A2. Videos on archive: a new table `archived_videos`** (schema v8): `video_id` PK, `channel_id` NOT NULL (indexed), `title`, `published_at`, `view_count`, `like_count`, `comment_count`, `duration_s`, `audio_language`, `default_language`, `paid_placement`, `topics`, `category_id`, `live_content`, `has_captions`, `made_for_kids`, `last_fetched_at`. Archiving copies the channel's `videos` rows into it in the same transaction as the delete (`INSERT ... ON CONFLICT DO UPDATE` keeping known values over NULL: archiving again only adds). Dropped on purpose: description (emails and brands are already taken from it), tags (owner: noise), thumbnail (built from the id).
- **A3. Bring back puts them back.** `restore_channel_locally` puts every new channel fact back on the row (as fills, like today's facts; `videos_fetched_at` stays NULL and `force_refetch=1` as today, so the backlog reads it again), and moves the channel's `archived_videos` rows back into `videos` (`INSERT OR IGNORE`, `last_fetch_status='archived'`, description/tags/thumbnail NULL), deleting them from `archived_videos`. `_row_facts`' "were its uploads read" check ignores `archived` video rows, so a channel brought back and archived again before it is read keeps its tombstone's 30-day count. Rollups and `measure_archive_numbers` use the restored rows (they are real numbers).
- **A4. Teammates' tombstones** (`apply_remote_archive`): a record may carry the new channel facts and an `archived_videos` list; known values here are never replaced by NULL, missing keys are fine (an older sender), unknown keys are ignored (a newer sender). `get_unannounced_archives` adds `archive_format: 2` and the channel's archived videos to each record. Not sent anywhere until step T, the same as today.
- **A5. The guard test.** A test lists every column of `channels` and `videos` (read from `PRAGMA table_info` on a fresh store) in exactly one of two maps: `KEPT` (column → where it lives: tombstone or `archived_videos`) or `DROPPED` (column → why). A column in neither fails with a message naming it. The two maps live in `store.py` beside `ARCHIVE_FACTS` (so the code that archives and the guard read the same list).
- **A6. One transaction.** Archive = tombstone + archived videos + delete, inside the existing `_atomic` (`BEGIN IMMEDIATE`).
- **A7. Toolbox › Archive shows its size:** "39,012 channels · 74 MB" from `SUM(LENGTH(...))` over `channel_archive` and `archived_videos` columns (an estimate, read-only, in main's toolbox reader), next to the existing count.

### Tasks

| id | title | tier | files | done-check |
|---|---|---|---|---|
| S4-a | A1-A6 | H (production data path) | `store.py`, `tests/test_archive.py`, `tests/test_store_migration.py`, new guard test | pytest; archive → bring back round-trips every kept field; re-archive only adds; a v7 file migrates; an older record (no new keys) and a newer one (unknown keys) apply |
| S4-b | A7 | N | `apps/desktop/src/main/find/toolbox.ts`, the Archive view, ipc toolbox schema, `strings.ts`, tests | Vitest; typecheck; lint; look at 1440 px |

### Changed after review (S4)

- A2: the search position travels on the tombstone's `found_via` entries (lowest known per keyword) and comes back on restore; `channel_keywords` is in the guard.
- A3: Bring back merges archived videos into any existing row (known values kept), then deletes them; the tombstone's read times come back beside the row (`videos_fetched_known`, `last_fetched_known`), not as read stamps.
- A4: a teammate's record wins only when it was read later (`last_fetched_at`); an older one only fills blanks.
- Readers: a teammate's channel object never lands beside a tombstone and never deletes `archived` video rows; the backfill never stamps a channel as read from `archived` rows; the comms readers skip `archived` rows for a channel not read since it came back.
- A5: KEPT says how each channel column is kept (`fact`, or `as:<tombstone column>`), and the guard ties `fact` to ARCHIVE_FACTS.
- A7: the size has its own IPC (`toolbox:archive-size`), asked only by the Archive view, cached on the row counts and the file times; `dbstat` when available, else the estimate.
- The import copies `archived_videos`.
- For step T: page `get_unannounced_archives`; `unarchive` and `apply_catalog_unarchived` must go through restore.
