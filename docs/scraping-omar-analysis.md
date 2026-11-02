# Omar's YouTube scraper, compared with ours

Written 2026-11-02, updated the same day with the real run history. Read-only study: nothing in the app was changed.

- **Omar's code:** `.claude/temp_ima_project_omar_made_to_analyze_and_implement_whats_good_in_his_scraping_part/apps/workers/youtube_scraper/`. Below, `OMAR/` stands for that folder.
- **Ours:** `services/pipeline/src/gratovo_pipeline/`. Below, `OURS/` stands for that folder.
- **The run history:** the team's keyword and channel records synced to this PC (`%APPDATA%/Gratovo Toolbox (dev)/pipeline/pipeline.db`, read-only). They cover the September runs on all three machines.

## The short answer

The gap between 2M and under 200k channels has **two separate causes**. Fixing only the blocks would not close it.

**1. Volume: we asked YouTube for far fewer channels.** This is most of the gap, and it is arithmetic (section 0.2).

- Each of our keywords read 200 video results. That gave about 58 channels a keyword, for 1,393 keywords in total. The keyword list ran out (1,393 of 1,531 done).
- Each of Omar's keywords reads up to 1,000 video results *plus* up to 1,000 results of a "channels" search. A "channels" search returns about 20 different channels a page. A "videos" search returns about 6, because the same creators repeat. His server runs 24/7 and has searched 63,182 keywords so far, each once.
- Per keyword, ours actually found more in-range channels (about 11.5 against his 4.2). **The gap is almost entirely keyword count** (section 0.4).
- At our rate, 2M channels would take about 30,000 keywords.
- His own numbers confirm it (section 0.4). He has 3.47M channels, but 267k are in his subscriber range, against our 16k. His list has 100,459 short keywords against our 1,531 long ones, and he searches 8,416 of them a day.

**2. Reliability: our runs wore out the addresses they used, starting with your own.** That is the "half a week in, it fails more and gets stuck longer" part (section 0.3).

- With AWS rotation and one worker, the tool switches itself to the *fast* pacing.
- "This machine" stays in the rotation, with no minimum gap.
- With the default two gateways, the real pool code sends **about 48% of all requests straight from the PC**, even while both gateways are healthy. When the gateways are resting after a block, it sends nearly all of them from the PC.
- Three PCs did this for days. Then the cooldowns kept doubling, and there were no fresh addresses to rotate to.

Omar's scraper is not more reliable because its connections are better. Its connections are worse: free public proxies, most of which are dead. It is more reliable because of **what it does when something fails**:

1. **A failure stays small.** A bad proxy loses one attempt. A bad keyword is skipped and searched again next cycle. Nothing ends the whole run except a real stop.
2. **It gives up on a connection fast.** One failed scrape, and that worker throws its proxy away and takes another. It does not wait minutes for the same one to recover.
3. **It never marks a keyword done unless the keyword really finished.** A search that broke halfway is left unmarked, so it is searched again.
4. **It spreads the work over many unrelated addresses** (10 workers, each on its own proxy in its own country), each going at a modest pace.

Ours does several of these the other way round:

- One block on one connection ends the whole run, every worker included.
- A throttle makes us wait, up to 15 minutes at a time, forever, on the same pool.
- A search that breaks on page 1 can be marked done with zero channels, and is then never searched again.
- Our home IP is in the rotation by default. When the gateways cool down, all the traffic lands on it.
- AWS gateways all come from AWS's address ranges, which Google knows are datacenters. They may also be passing our home IP to YouTube in a header. That needs a test (section 6).

The fixes that matter most need no new infrastructure. In order:

1. Settings changes you can make today (section 0.5).
2. Ask for more channels per request (section 6).
3. Change the failure rules (section 6).

Paid proxies, or an always-on worker like Omar's, are the way to scale after that (sections 7 and 8).

---

## 0. What the real runs show

### 0.1 The numbers

From the synced keyword, run and channel records:

| | |
|---|---|
| Keywords searched | 1,393 of 1,531 in the list (`moustafa` 655, `DESKTOP-07S7M6T` 394, `101th_booting` 343) |
| Settings almost every keyword used | 200 video results, sorted by upload date, countries AU/CA/GB/IE/NZ/US, auto-clean below 50k subscribers |
| Channels found per keyword | 58 on average (found = new + already known) |
| Unique channels held on this PC | 93,461: 2,021 kept and 91,440 archived. About 98% were thrown away by auto-clean and the other rules. |
| Time per keyword | median 0.4–1.1 min from 13 Sep (fast pacing); 1.5–1.8 min on 4–5 Sep |
| Search runs recorded on this PC | 19, of which 15 ended "interrupted" |

The per-machine, per-day view shows the decline:

| Machine | Day | Keywords | Median min/keyword | Avg channels found | Keywords with < 10 found |
|---|---|---|---|---|---|
| moustafa | 4 Sep | 45 | 1.5 | 122 | 0% |
| moustafa | 5 Sep | 40 | 1.8 | 149 | 0% |
| 101th_booting | 9 Sep | 97 | 0.8 | 63 | 22% |
| moustafa | 13 Sep | 262 | 0.6 | 61 | 13% |
| DESKTOP-07S7M6T | 13 Sep | 247 | 1.0 | 44 | 16% |
| 101th_booting | 14 Sep | 209 | 0.8 | 37 | 10% |
| moustafa | 15 Sep | 292 | 0.4 | 37 | 16% |

26 keywords are marked done with **0** channels found.

### 0.2 Volume: why the totals differ so much

- **Shallow searches.** 200 video results is about 10 pages. The same creators repeat inside one search, so 200 results gave 58 channels.
- **The wrong kind of search for counting channels.** A search of type "channels" (`results_type="channel"`, which ours supports) returns distinct channels, about 20 a page, with the subscriber text included. Omar runs one of those on every keyword, up to 1,000 results deep, and **saves every channel outside his subscriber range** as a slim row (`OMAR/workflows/discovery/keyword.py:123-135`). Most channels on YouTube are small, so those slim rows are probably most of his 2M.
- **Not repeat cycles, so far.** His server *can* search the list again when it reaches the end. A third screenshot shows it hasn't yet: 63,182 of 100,459 keywords searched once, none twice, "0 cycles run". All of his 3.47M came from one pass.
- **Keywords themselves.** We searched 1,393. Each new keyword is the cheapest way to get new channels: it costs one search, not one request per channel.

So, to get many more channels from the same number of requests: search deeper on broad keywords, add a "channels" search per keyword, and generate many more keywords. Section 6 has the details.

### 0.3 Reliability: what wore the addresses out

1. **Fast pacing was on.** `OURS/config.py:191-193`: with rotation on and one worker, pacing becomes "fast" (0.5–1.5 s between search pages). The keyword times above (0.4 min for a 10-page search plus details) match fast pacing. The legacy app had the same rule.
2. **This PC carried a large share of the traffic.** "This machine" is a candidate with no minimum gap, and the gateways rest 6+ s after each use. I ran the real `ProxyPool` with a fake clock, one worker, 0.8 s per request:

   | Gateways | Fast pacing: share sent from this PC | Normal pacing: share sent from this PC |
   |---|---|---|
   | 1 | 50% | 50% |
   | 2 (the legacy default: us-east-1, eu-west-1) | **48%** | 33% |
   | 3 | 38% | 25% |
   | 4 | 25% | 20% |
   | 6 | 14% | 14% |
   | 10 | 9% | 9% |

   That is with healthy gateways. When the gateways are cooling down after a block, this PC is the only healthy candidate, and it takes **every** request with no gap. The script is outside the repository (`pool_sim.py` in the session's scratchpad). It imports `ProxyPool` unchanged.
3. **Three PCs, the same two regions.** If all three used the default regions, every machine's gateway traffic went out of the same two AWS regions. The pool's rules (one request at a time, the 6 s gap) hold only inside one process. Three PCs on the same gateways do not know about each other.
4. **The waits only grow.** A blocked route cools down for 2 min, then 4, 8 … 30 min, and the count resets only on a success. Each retry of a request waits 45 s, then 90 s … 15 min, with no limit on retries. With two gateways and one home IP all flagged, nothing new comes into the rotation, so every wait is longer than the last. That is "stuck for longer retrying." Omar's free list keeps feeding new, unflagged addresses, so his waits stay short even though many of his proxies die.
5. **Searches probably ended early without saying so.** Later keywords were faster *and* found fewer channels. The share of keywords with under 10 channels rose from 0% to 10–16%, and 26 were "done" with none. Two causes fit:
   - Niche keywords: later keywords like "computer vision automated sorting in modern recycling facilities" are long-tail and return fewer results.
   - Searches that stopped on an error after a page or two, then marked done anyway (section 5.3).

   The records alone can't separate the two. The run logs can: look for "The search stopped early". Either way, the 0-channel keywords should be searched again.

### 0.4 Omar's live numbers, compared fairly

From two screenshots of his website on 2026-11-02: the Tools page about 16 h into a cycle, and the daily summary for 1 Nov.

**His day (1 Nov):**

| | Omar, one day | Ours, all of September, 3 PCs |
|---|---|---|
| Keywords searched | 8,416 (list: 100,459; 22,730 left in this cycle) | 1,393 (list: 1,531) |
| Search results read | 3,244,093, about 385 a keyword | at most 200 a keyword |
| Machine time | 23 h 35 m on; 214 worker-hours scraping; 22 worker-hours waiting for proxies (9%) | runs mostly short; 15 of 19 on this PC interrupted |
| New channels stored | 224,831 (total now 3,473,324) | 93,461 in total |
| New channels **in the subscriber range** | 12,764 (total 267,427; his range is 25k–1M) | **16,002 in total** in the 25k–1M range |
| Channels measured (videos read) | 15,867 | 2,021 kept |
| Qualified | 512 (total 14,365) | – |
| YouTube API units | 6,133 of a 9,000 budget | – |

So the fair comparison is **267k against 16k in range (about 17×)**, not 3.47M against 93k (37×). Only 7.7% of his channels are in range. The rest are small channels saved slim from the "channels" search, as section 0.2 guessed. **His one day added about as many in-range channels as our whole September.**

**Per keyword, ours is not worse.** A third screenshot (his Keywords panel, taken a day or two before the others: 37,277 left instead of 22,730) shows 63,182 keywords searched, each once. Dividing:

| Per keyword searched | Omar (63,182 keywords) | Ours (1,393 keywords) |
|---|---|---|
| Unique channels | about 55 | about 67 |
| In-range channels | about 4.2 | about 11.5 |
| Qualified | about 0.23 | – |

Our keywords found **more** in-range channels each, not fewer. That is probably because our keywords were more specific to the niche, and we were earlier into it. His yield is also falling as his database fills: on 1 Nov it was 27 new channels a keyword, against 55 on average. **The whole 17× gap is keyword count:** 63,182 against 1,393 is 45×, partly offset by our 2.7× better yield per keyword. Expect our yield per keyword to fall the same way as we scale.

**Where his volume comes from:**

1. **Keywords: 100,459 of them, short.** The visible ones are a tool plus a topic: "Emacs MCP", "Zed model selection", "Emacs vs VS Code". Short keywords return many results (385 on average, of a 1,000 limit). Ours were long and narrow ("computer vision automated sorting in modern recycling facilities"), and the long-tail ones run out of results early.
2. **10 workers, all day.** Each worker does 30–53 keywords an hour, about 1.1–2 min a keyword. That is about the same speed per keyword as our machines on fast pacing. The difference is that his 10 run in parallel for 24 h without stopping.
3. **The quota is not the limit, even at his scale.** 6,133 units for 15,867 channels measured, with 2,867 left unused.

**What his proxies tell us about YouTube's tolerance:**

- Each worker reads roughly 30 pages a minute through one address, for hours.
- Several workers share one exit IP on different ports: `102.244.78.61` serves three workers, and `34.43.46.91` (a Google Cloud address, so a datacenter) serves two. Those IPs carry two or three times that rate and still work.
- Workers rotate 3–47 times in 16 h, so a free proxy lasts from about 20 minutes to many hours. He burns a few hundred a day, and the free list keeps supplying new ones.

This changes one conclusion. **The pace per address is probably not what broke our runs.** Our gateways and PCs got about the same pace and failed within days, while his datacenter and free addresses survive it. What differs:

- **Supply.** His burned addresses are replaced within a minute. Ours are the same two regions and three home IPs forever.
- **What we do when told no.** Ours waits, doubling each time, on the same few addresses: 2 → 30 min cooldowns, 45 s → 15 min retries. A short throttle grows into hours of being stuck. His code just takes the next proxy.
- **Something identifying us across routes.** If the gateways pass your home IP along in a header (section 5.6), then all gateway traffic from a PC counts against that one home IP. That would fit "fine for days, then everything fails at once". The leak test is now the first thing to run.

### 0.5 What to change today, settings only

1. Turn **"include this machine" off** on every PC that has gateways.
2. Deploy **more regions**, and give each PC its own regions (for example PC1: us-east-1, us-west-2, ca-central-1; PC2: eu-west-1, eu-central-1, eu-west-2; PC3: ap-southeast-2, ap-northeast-1, sa-east-1). Pick regions near the target countries for the search results' locale.
3. Use **Normal** pacing. Fast only made sense with a big pool.
4. Put the 26 zero-result keywords, and the under-10 ones from 13–15 Sep, back to pending.
5. Run the gateway leak test in section 5.6 **first**, before trusting the gateways again. Omar's numbers (section 0.4) make a leak the most likely reason the gateways failed at a pace his proxies survive.

---

## 1. What Omar's scraper is

A Python service that runs 24/7 on a Linux server with PostgreSQL (`OMAR/README.md`). It goes through a list of keywords. For each keyword it:

1. searches YouTube,
2. collects the channels,
3. gets their details from the YouTube Data API,
4. reads each channel's latest videos,
5. computes average views and engagement.

It has a small HTTP API (`OMAR/server.py`) so a website can add keywords, add a single lead, or refresh channels. It reports to Discord.

It uses three kinds of network traffic, and they are handled very differently:

| Traffic | What it is | Through a proxy? | Costs quota? |
|---|---|---|---|
| **Search pages** | `youtube.com/results?...`, then "load more" calls to `youtubei/v1/search` | yes (each worker's own proxy) | no |
| **Channel video pages** | `youtube.com/channel/UC.../videos`, then `youtubei/v1/browse` | yes | no |
| **Data API** | `googleapis.com/youtube/v3/channels` and `/videos`, 50 ids a call | no, his server's own IP (a proxy only as a last resort) | 1 unit a call |

That split is the same as ours. The difference is in how the first two are protected.

## 2. How a run flows

```
run.py / server.py
  └─ workflows/discovery/cycle.py        run_full_cycle()
       └─ parallel.py                    run_parallel_keywords()  — one thread per worker
            ├─ worker starts: wait_for_proxy()   (own proxy, its own country)
            ├─ backfill: channels saved earlier without videos
            └─ loop: claim a keyword (each keyword goes to exactly one worker)
                 └─ keyword.py           discover_and_collect()
                      ├─ scrapetube_api.search_channels_by_keyword()   search pages, up to 1,000 results
                      ├─ db: which channels are already known
                      ├─ fast_precheck_rejects()   a second search, "channels" type, reads subscriber
                      │                            counts off the page; out-of-range ones are saved
                      │                            and skipped with no API call
                      ├─ new channels   → shared channel queue → at 50: Data API channels call
                      │                     → in subscriber range? → scrape that channel's videos
                      │                     → shared video queue → at 50: Data API videos call
                      │                     → when all of a channel's videos are saved: averages
                      ├─ known channels due a refetch (1 / 7 / 30 days) → same queues
                      └─ known channels missing videos → video scrape
                 └─ keyword finished completely → mark it used
                    keyword raised an error     → NOT marked; skipped for this run, searched next run
```

Files: `OMAR/workflows/discovery/cycle.py`, `parallel.py`, `keyword.py`, `batches.py`, `queues.py`.

Two details worth noting:

- **Queues are shared by all workers** (`OMAR/workflows/discovery/queues.py`). So the Data API is always called with full batches of 50, even when each keyword only finds a few new channels. Only the very end of a run sends a partial batch.
- **A video is only saved for a channel the database already has** (`confirmed_channel_ids`, `OMAR/workflows/discovery/batches.py:63`). This stops orphan videos.

## 3. The scraping layer, piece by piece

### 3.1 The page reader (`OMAR/api/scrapetube/scrapetube.py`)

A trimmed copy of the open-source `scrapetube` library, the same one ours is based on.

- **First page:** a normal GET of the HTML page. From it, it cuts out `INNERTUBE_CONTEXT` (the client info), `innertubeApiKey` and `ytInitialData` (the first results).
- **Next pages:** POST the "continuation token" to `youtubei/v1/search` or `/browse`, the same call YouTube's own page makes when you scroll.
- **Headers:** a fixed Chrome 114 desktop User-Agent and `Accept-Language: en`. It uses plain `requests`. There is no browser fingerprint copying, so ours (with `curl_cffi` impersonation) looks more like a real browser.
- **Cookies:** `CONSENT=YES+cb` and `?ucbcb=1`, to skip the EU cookie banner. Ours does the same.
- **Timeouts:** 15 s a request through a proxy, 30 s direct (`OMAR/core/config.py:52,66`). A dead proxy is found out quickly.
- **No block detection.** It does not look for 429s or captcha pages. Any problem shows up as an exception: a timeout, a bad JSON parse, a missing key. The layer above treats every exception the same way: this attempt failed.
- **Bandwidth counter:** every response goes through `traffic.count` (`OMAR/core/traffic.py`), which estimates the compressed bytes. That is how he measured what a paid proxy plan would cost (section 7.3).

### 3.2 Retries (`OMAR/api/scrapetube_api.py`, `_run`)

The retry wraps **the whole scrape**, not one request. A search with 50 pages is one unit:

```
attempt 1..3 (SCRAPETUBE_MAX_RETRIES):
    proxy   = this worker's proxy (wait for one if it has none)
    session = this worker's session, reused while the proxy stays the same
    read every page of the search into a list
    success → return
    failure → drop the session
              tell the ProxyManager → after 1 failure (REFRESH_AFTER_FAILURES = 1) the proxy is thrown away
              and blocked for every worker for 5 min, then 10, 20 … up to 60 min
              → the next attempt starts from page 1 on a fresh proxy
    after 3 failures → raise → the keyword fails, stays unmarked, the worker takes the next keyword
```

Without a proxy (one worker on his own IP), it waits 10 s between attempts. A "single action" from the website (add one lead) runs on his own IP first. Only the last attempt goes through a proxy.

So, worst case: one keyword costs 3 attempts and is retried on the next cycle. The run goes on.

### 3.3 Workers and proxies (`OMAR/core/proxies/`, `OMAR/core/worker.py`, `OMAR/workflows/discovery/parallel.py`)

- **One worker = one country = one proxy at a time.** The default list is US, GB×3, FR, DE×2, NL, JP×2: 10 workers, the countries whose free proxies held up best. The list is a setting on his website.
- **Sticky.** A worker keeps its proxy, and the same HTTP session (cookies, the kept-open connection), for every request until that proxy fails. Every page of one search comes from the same address with the same cookies, like one person scrolling.
- **Where proxies come from:** the free ProxyScrape list (`OMAR/core/proxies/providers.py`): HTTP proxies that support HTTPS, "elite" or "anonymous", filtered by country, up to 200 a fetch.
- **Health check before use:** candidates are tested 10 at a time in parallel with `GET https://www.youtube.com/generate_204`. A proxy is kept only if it answers under 500 within 8 s (the "Slowest proxy accepted" setting). The fastest one is taken first. The others are kept as spares for the next rotation.
- **A shared memory across workers** (`_Registry`): a proxy in use by one worker is not given to another. A proxy that failed is banned for everyone for 5 min, doubled at each new failure, up to 60 min. Free lists keep returning the same dead proxies, and this keeps the workers off them.
- **Remembers good proxies:** the last proxy that worked for, say, "US1" is saved in the database and tried first on the next start.
- **No proxy in a country:** the worker waits and asks the provider again every 60 s. A worker that spends 30% or more of 3 hours waiting is moved to "worldwide" (WW): it takes the best proxies of any country, ranked by the list's uptime and speed. While stopping, a worker with no proxy borrows one from the country with the most, only to finish its keyword.
- **Country switch while running:** the website can move a worker to another country. Its search in progress restarts on page 1 through the new proxy, and that does not count as a failure.

### 3.4 Pacing (`OMAR/core/pacing.py`, defaults in `apps/common/settings_registry.json`)

Each worker sleeps separately. Every wait is random within a range:

| Wait | Omar | Ours (Normal) | Ours (Fast) |
|---|---|---|---|
| between result pages | 0.8–1.7 s | 2.5–6.0 s (search), 1.5–3.5 s (channel pages) | 0.5–1.5 / 0.3–0.8 s |
| between two channels' video lists | 0.5–1.2 s | 1.5–4.0 s | 0.3–1.0 s |
| after each keyword | 2–4 s | 4–9 s, plus a 30–70 s rest half the time | 0.5–1.5 s, plus 5–15 s 10% of the time |
| long break in a sweep | none | 40–100 s every 30 channels | same |
| per-connection minimum gap | none | 6 s per gateway or proxy (`proxy_pool.py`) | same |

Omar goes much faster per address than we do. He gets away with it because he spreads the load over 10 addresses, and because a burned address just gets replaced.

### 3.5 The Data API side (`OMAR/api/youtube_api.py`, `OMAR/core/breaker.py`, `OMAR/core/quota.py`)

This part is solid, and it is the easiest to copy:

- **Retries:** a network error, 429, 5xx or short-term rate limit is retried 3 times (2 s, 4 s, 8 s). Then one last try goes through the worker's proxy.
- **Circuit breaker:** 3 failed calls in a row, or a rejected key, "opens" the breaker. Every thread that wants the API waits. One thread checks the API with a 1-unit call after 1 min, then 2, 4 … up to 10 min. When the API answers, everything carries on by itself. No keyword fails because Google had a bad hour.
- **Quota:** `quotaExceeded` makes every thread wait until Google's reset (midnight Pacific) plus 5 min, then carry on. There is also a self-imposed daily budget (9,000 of the 10,000 units) for the keyword cycle, so manual actions always have quota left.
- **Usage counted:** every call is counted per hour in the database.

Ours ends the run on `quota`, on a refused key, and on `network` after 3 tries (`OURS/youtube.py:10-17`). For a desktop app where a person is watching, ending on quota is acceptable. Ending on a network blip is not.

### 3.6 Stopping and resuming (`OMAR/core/shutdown.py`, `OMAR/workflows/discovery/cycle.py`)

- First Ctrl+C: no new keyword starts. Each worker finishes its current keyword completely, including the videos and averages, marks it, then exits.
- Second Ctrl+C: what is queued is saved without its videos, and unfinished keywords stay unmarked.
- Next start: "backfill" scrapes the videos of saved channels that are missing them, before any new keyword. Every worker takes from that list as soon as it has a proxy.

We already have the same idea in our backlog (`search/backfill.py`, `defer_unreadable_channel`).

---

## 4. Side by side

| | Omar | Ours |
|---|---|---|
| HTTP client | `requests`, fixed Chrome 114 UA | `curl_cffi` with real Chrome TLS/HTTP2 fingerprint (better) |
| Block detection | none, every error is "failed" | 429/403, `/sorry/`, captcha text in HTML, non-JSON innertube (better) |
| Unit of retry | the whole scrape (all pages), 3 times | each single request, **forever**, backoff up to 15 min |
| Connection per request | sticky: one worker, one proxy, one session | **rotates every request**: never the same connection twice in a row, across all workers |
| After a failure | throw the proxy away now, take a fresh one, ban the old one 5→60 min | same candidate cools down 30 s→20 min (connection) or 2→30 min (block); the request waits for *any* candidate |
| Connection sources | ~10 free proxies at a time, dozens of countries, replaced endlessly | your AWS API Gateways (a few regions) + optional proxy list + **this PC (on by default)** |
| A block | that proxy is replaced, the scrape restarts | a `BlockedError` **ends the run**; in parallel mode the first failure **stops every worker** |
| A broken search (bad page, layout change) | keyword fails, stays unmarked, searched next cycle | caught in `find_channels`, returns what it had (maybe nothing), and the keyword **is marked done** |
| Channel page URL | `/channel/UC…` (the id never changes) | `/@handle` (handles change; channels without a handle are dropped at discovery) |
| Pace per address | fast | slow |
| Data API failures | retry → breaker → wait, never fails a keyword | retry 3× → **ends the run** |
| Bandwidth measured | yes | no |

What we do better and should keep: browser fingerprinting, explicit block detection, sampled pacing, the never-leak-a-secret discipline, the backlog of unreadable channels, and tests on a fake clock.

---

## 5. Why ours is less reliable, most likely causes first

These come from reading the code, not from logs of a failed run. Each comes with how to confirm it.

### 5.1 One failure ends everything

- `OURS/scrapetube/scrapetube.py:561`: innertube answers with something that isn't JSON → `BlockedError`.
- `OURS/search/discover.py:77,123`: turned into `SearchBlockedError`.
- `OURS/jobs/search.py:48`: the run ends: "YouTube stopped answering this computer."
- `OURS/parallel.py:76-80`: in parallel mode, the first failure on any worker calls `request_stop()` for all of them.

So one bad answer through one gateway stops a run that had several healthy routes. Omar's code would have swapped that one proxy and carried on.

**Confirm:** in the run history, count runs that ended `blocked`, and check whether other routes were still healthy at that moment.

### 5.2 Waiting forever looks like freezing

`OURS/scrapetube/scrapetube.py:324-402`: `request()` retries without limit. A 429 or captcha starts at 45 s, doubles, and is capped at 15 min a wait, but there is no cap on the number of waits. With only this PC and one or two gateways, a throttle can hold a run in waits for an hour. From the outside that looks like "the scraper is stuck." Omar's code fails fast (3 attempts) and moves on to the next keyword.

### 5.3 A broken search is recorded as "done, found nothing"

`OURS/search/discover.py:129-131` catches every other error ("keep what the pages already gave"). `OURS/search/keyword.py:101` then marks the keyword done. If page 1 failed to parse, for example:

- a consent or other interstitial page with no `ytInitialData`,
- a YouTube layout change,
- a `RedirectLoopError`,

then the keyword is saved as done with 0 channels and is never searched again. That is silent data loss, and it reads as "the scraper finds less than it should." Omar's keyword would stay unmarked and be searched again.

**Confirm:** look for keywords marked done with `channels_found = 0`, or far below their siblings, and for "The search stopped early" warnings in the logs.

### 5.4 This PC is in the rotation, and takes over when the gateways rest

`ProxyPool.from_routes(include_direct=True)` is the default (`OURS/config.py:178`). The direct candidate has **no minimum gap** (`proxy_pool.py:12-14`). Measured with the real pool (section 0.3): with two gateways on fast pacing, 48% of requests go direct even when nothing is blocked. When the gateways are cooling down after a throttle (2 min, then 4, 8 … 30), the pool hands every request to this PC with no gap between them. That is how your home IP gets flagged. Once it is, YouTube may slow you down in your normal browser too.

**Fix:** when at least one gateway or proxy exists, leave direct out, or use it only when every other route is cooling down, with its own gap.

### 5.5 AWS addresses are datacenter addresses

Every request through API Gateway leaves from AWS's published IP ranges. Google knows these are datacenters, not people. Omar's own README warns: "On a datacenter IP YouTube may block scraping." His transcript code says YouTube blocks datacenter IPs for transcripts. Each region has a large pool of addresses, so this is not hopeless, but:

- a few regions is a narrow spread compared with dozens of unrelated free proxies or a residential pool;
- an AWS address that gets throttled is "known AWS", so it is treated with suspicion sooner.

### 5.6 Possible leaks of the home IP through the gateway (must test)

Two ways the gateway might not hide us. **Neither is proven. Test before trusting the gateways.**

1. **Forwarding headers.** API Gateway can add the caller's real IP to the request it forwards (`X-Forwarded-For` or `Forwarded`). The open-source `requests-ip-rotator` project, which does the same trick, overrides that header on purpose for this reason. Our deploy (`OURS/jobs/gateways.py:187-237`) sets no header mapping. If YouTube sees `X-Forwarded-For: <your home IP>` on every gateway request, all our "rotation" points back to one address.
   - **Test:** deploy one gateway by hand whose backend is a header-echo service instead of YouTube (for example `https://httpbin.org/{proxy}`). Call `<gateway>/headers` and look for your home IP. Then delete the gateway.
2. **Redirects leaving the gateway.** `curl_cffi` follows redirects. If YouTube answers a gateway request with a redirect to an absolute `https://www.youtube.com/...` (or `consent.youtube.com`) address, the next hop goes **straight from this PC**, not through the gateway. `net.check_url` checks only the first URL.
   - **Test:** log the host of `response.url` for gateway requests. Any `youtube.com` host there means a hop went direct.
   - **Fix:** turn off redirect following for gateway requests and rewrite the `Location` back through the gateway, or refuse the redirect.

### 5.7 Every page goes through a different connection

`request()` takes a new lease for **every request**, and the pool refuses to use the same connection twice in a row (`proxy_pool.py:264-269`). So one search is: HTML page from gateway A, "load more" from gateway B in another region, the next from this PC, and so on, while the session carries cookies and a continuation token from the first one. A person does not jump continents between two scrolls. Omar's worker keeps one address and one session for the whole scrape.

A gateway's own outgoing IP can change between calls anyway, so full stickiness is impossible through API Gateway. Still, keeping one route for a whole keyword (one region, never mixed with direct) is the more natural pattern. It also makes failures easy to blame on the route that caused them.

### 5.8 Channels read by handle, and channels without handles lost

- `OURS/search/discover.py:69` reads uploads from `youtube.com/{handle}`. Handles change. An old handle 404s or redirects, and the channel becomes "unreadable."
- `OURS/search/discover.py:33-37` keeps a result only if `canonicalBaseUrl` contains `@`. A channel with no handle (its URL is `/channel/UC…`) is dropped.

Omar uses `browseId` (the `UC…` id) for both, and the id never changes. This one is about coverage more than blocks, but it shows up as "finds fewer channels."

### 5.9 Data API hiccups end the run

`OURS/youtube.py` turns network trouble after 3 tries into `YouTubeError("network")`, and the run ends. Omar's breaker waits it out. This is a smaller issue, but it is cheap to fix.

---

## 6. What to take from Omar, in order

**For volume (more channels per request), from section 0.2.** Section 0.4 shows that keyword count is by far the biggest lever, so **V3 comes first**. V1 and V2 add some, but our per-keyword yield is already good.

- **V1. A "channels" search per keyword**, kept as discovery: about 20 distinct channels a page, with the subscriber text already on it. Store channels outside the band slim, as Omar does, so the same small channel is never looked up twice.
- **V2. Deeper searches on broad keywords.** Raise the 200-result limit to 500–1,000 for broad keywords. Keep 200 for long-tail ones. Store each result's position (Omar's `research_index`) to see where in the results the good channels stop appearing.
- **V3. Many more keywords, and shorter ones.** Omar has 100,459. Judging by the visible ones, they are built as tool × topic ("Emacs MCP", "Zed Agent best settings"). Short keywords return hundreds of results; long sentence-like ones run dry. Our keyword generator can produce that shape: a list of AI tools and products, crossed with a list of topics (setup, vs, tutorial, best settings, local models …).
- **V4. Reading uploads through the Data API instead of pages** (worth testing). A channel's uploads list is the playlist id `UU…` (its `UC…` id with `UC` swapped for `UU`). `playlistItems.list` returns 50 videos for 1 unit. That is roughly 8,000 channels a day from one key's quota, after the video-stats calls, with **zero** page scraping. Scraped pages would then only be used for searches, which is where scraping can't be avoided (an API search costs 100 units).

**For reliability, ranked by how much each brings for the work it takes.** None of these needs new infrastructure.

1. **Make failures local.** A block or a broken page fails that attempt on that route, not the run. Parallel workers must not stop each other: a worker whose route is blocked takes another route or waits. The run ends only on a person's stop, a refused key, or (maybe) quota.
2. **Bound the retries, then fail the keyword, not the run.** For example: up to 3 attempts per page, each on a *different* route, then the keyword fails. A failed keyword is **not** marked done. It goes to the end of the list or into the next run, like Omar's `failed_ids`.
3. **"Done" means the search really finished.** `find_channels` must say whether it reached the end (no more continuation, or the limit) or stopped on an error. Only the first case marks the keyword done.
4. **Use the channel id everywhere.** Read uploads from `/channel/UC…/videos`. Keep channels whose result has no handle, and fill the handle in later from the Data API (`customUrl`), as Omar does.
5. **One route per keyword.** A worker takes one gateway or proxy for the whole keyword, including all its pages and its channel sweep. It switches only on a failure, and restarts the failed scrape from page 1 on the new route (Omar's `_run`). The pool still enforces "one worker per route" and the cooldowns.
6. **Direct last, or never.** With any other route configured, this PC is used only when everything else is cooling down, and with its own gap. Or it is off.
7. **Test and fix the two gateway leaks** (section 5.6).
8. **A circuit breaker for the Data API.** Copy `OMAR/core/breaker.py` almost as-is: wait and probe instead of ending the run on `network`.
9. **Count bandwidth.** Copy `OMAR/core/traffic.py`, adapted to `curl_cffi`. You need this number before buying any proxy plan.
10. **Add to the block markers:** "confirm you're not a bot" / "Sign in to confirm". That is YouTube's current bot wall wording on some pages.

What **not** to take:

- **Free proxy lists, at least not without deciding it on purpose.** His numbers show they work at scale (section 0.4), so this is a judgment call, not a technical one:
  - Most entries are dead at any moment, which is why he needed all that machinery: health checks, country fallbacks, "worldwide" workers, spare lists.
  - You don't know who runs them. Many open proxies are misconfigured or hijacked machines, so the traffic goes through someone else's device without their knowledge. Some are run to watch traffic. HTTPS keeps the page content private, but the proxy still sees which sites you visit.
  - Paid proxies with the same rotation rules are simpler, and their source is known. If you do use free lists, use them only for YouTube page reads, never for anything signed in or carrying a key.
- *(Corrected after reading the run data.)* The first version of this note said to skip Omar's second "channels" search per keyword. That was wrong. It is not worth it as a quota saver, because quota is not our limit. But it is the cheapest source of *new channels* there is (section 0.2). Take it as a **discovery source**: keep every channel it returns, and use its free subscriber text to decide which ones get a Data API call.
- **Plain `requests` with a fixed old UA.** Ours is better.
- **The server design** (Postgres, systemd, Discord). It is a different product shape. Our desktop app plus Supabase covers it.

---

## 7. AWS and proxies, explained

### 7.1 What "a proxy" is, in one paragraph

A proxy is another computer that makes your request for you, so YouTube sees *its* address instead of yours. You use one by giving the HTTP client a URL like `http://username:password@proxy-host:port`. Our pipeline already accepts exactly that: the proxy URLs in Settings (`secrets.proxyUrls`) go straight into the pool (`OURS/scrapetube/proxy_pool.py:122-137`). "Learning to use proxies" for this app means buying some and pasting their URLs into Settings. The rotation, cooldowns and per-request handling are already built.

The kinds, from cheapest to most trusted by YouTube:

| Kind | What it is | How YouTube sees it | Usual pricing |
|---|---|---|---|
| Free lists (Omar) | random open proxies | mixed, mostly dead | free |
| Datacenter | servers in a hosting company | "a server", flagged quickly | flat, per IP per month |
| AWS API Gateway (ours) | AWS forwards your request | "a server" (AWS ranges) | per million calls, tiny |
| ISP / static residential | IPs registered to a home internet provider, hosted in a datacenter | "a home user", stable | flat, per IP per month |
| Rotating residential | real home devices, a new IP per request or per "sticky session" | "a home user", huge pool | per GB downloaded |

Check current prices with providers before choosing. They change often.

### 7.2 Getting more out of the AWS you already have

You already have a working AWS setup: `gateways.deploy` builds one HTTP API per region that forwards everything to youtube.com (`OURS/jobs/gateways.py`). To make it count:

1. **Run the leak test first** (section 5.6). If your home IP shows in the forwarded headers, the gateways are not hiding you. Fix that before anything else: the header-mapping trick `requests-ip-rotator` uses, or a different relay.
2. **Deploy more regions.** Each region is a separate pool of AWS addresses. Ten regions spread the load ten ways. It stays cheap: HTTP APIs bill about $1 per million calls, and a 200-result search is about 10 calls.
3. **Turn "this machine" off** in the routes once gateways exist (section 5.4).
4. **Give each worker its own region for a whole keyword** (section 6, item 5). Run as many workers as regions, as we already do (`OURS/parallel.py:29-35`).

A different way to use AWS is small EC2 or Lightsail servers running a proxy program, one public IP each. That gives sticky addresses, but they are still datacenter IPs, with more to run (servers, patches, the AWS charge for public IPv4 addresses). It is not worth it over gateways for this job.

**Bottom line on AWS:** gateways are a good free-ish layer, and with the fixes above they should behave much better. They will never look like home users, though. If YouTube keeps throttling them after the fixes in section 6, the next step is paid ISP or residential proxies, not more AWS.

### 7.3 Sizing a paid plan

From Omar's measurements (`OMAR/README.md:171`), compressed sizes:

- a keyword search, up to 1,000 results: **about 4 MB**;
- reading one channel's latest videos: **about 0.3 MB**.

With our defaults (200 results a keyword, then the uploads of the new channels that pass the gate), a rough guess is about 1 MB for the search plus 0.3 MB × each channel read. A keyword that reads 60 channels is then about 19 MB, so 100 keywords is about 2 GB. On a per-GB residential plan, the channel sweep is most of the bill. On a flat ISP plan, bandwidth doesn't matter, only how many IPs you rent. Omar reached the same conclusion: "flat-price datacenter or ISP proxies fit better." Measure ours (section 6, item 9) before buying.

A sensible start: **5–10 ISP (static residential) proxies** pasted into Settings, direct off, gateways kept as extra routes, one worker per proxy, Normal pacing. Rotating residential is the fallback if the ISP IPs get flagged.

At Omar's scale, bandwidth rules out per-GB plans. 3.24M search results a day is about 160,000 result pages. On top come the "channels" searches and 15,867 channel reads. By his own per-keyword measurement, that is on the order of 15–25 GB a day. On a per-GB residential plan, that costs real money every day. Flat-price ISP or datacenter proxies (or his free list) are the only kinds that fit that volume.

---

## 8. How to scale after that

When the failure rules are local (section 6), scaling is mostly arithmetic:

- **Throughput is roughly** (number of routes) × (pages a route can safely serve per minute). The pool's 6 s minimum gap (plus jitter) holds each route to about 6–9 pages a minute. 10 routes is about 60–90 pages a minute: 6–9 searches of 200 results (about 10 pages each). The channel sweeps (at least one page per channel) usually take more pages than the searches.
- **The Data API is not the limit.** At 50 ids a call, 10,000 units is 500,000 channel or video lookups a day.
- **Watch the ratio of blocks to requests per route.** If one route's ratio climbs, slow that route, not the whole run. That is Omar's per-proxy ban, made smarter.
- **Workers ≤ routes**, always (we already enforce this). One worker per route, never two on one address.
- **Later, team work (plan step T):** several machines each running their own routes is how Omar's model scales. That waits for step T under the owner's rules.

---

## 9. File map of Omar's scraping code

| File | What it does |
|---|---|
| `OMAR/api/scrapetube/scrapetube.py` | reads YouTube pages: first HTML, then continuation POSTs |
| `OMAR/api/scrapetube_api.py` | whole-scrape retries, proxy swaps, result shaping, subscriber text parsing |
| `OMAR/api/youtube_api.py` | Data API calls: retries, proxy fallback, quota and key errors, budget |
| `OMAR/core/breaker.py` | circuit breaker for the Data API |
| `OMAR/core/quota.py` | waits for Google's daily reset |
| `OMAR/core/proxies/__init__.py` | `ProxyManager` (per worker) and `_Registry` (shared bans and in-use set) |
| `OMAR/core/proxies/providers.py` | the free ProxyScrape list, by country or worldwide |
| `OMAR/core/worker.py` | per-thread context: name, country, proxy manager, reused session |
| `OMAR/core/pacing.py` | random sleeps |
| `OMAR/core/traffic.py` | bandwidth counter |
| `OMAR/workflows/discovery/parallel.py` | worker threads, keyword claims, country switching, "go worldwide" |
| `OMAR/workflows/discovery/keyword.py` | one keyword: search, precheck, queue, refetch, backfill, report |
| `OMAR/workflows/discovery/batches.py` | flushes the shared queues to the Data API, scrapes channel videos |
| `OMAR/workflows/discovery/queues.py` | shared, thread-safe batching queues |
| `OMAR/workflows/discovery/cycle.py` | top loop, marks keywords, resets the cycle |
| `OMAR/workflows/manual.py` | single actions: add a lead, refresh channels |
| `apps/workers/daily_runner/proxies.py` | a second, simpler proxy pool for transcripts (paid list or free list) |
