# 0023. The scraping upgrade (step S)
- **Date:** 2026-11-02 (built the same day)
- **Status:** accepted. Builds [scraping-upgrade-plan.md](../scraping-upgrade-plan.md), parts S1 to S6. S7 was not built. The gateway leak test has not been run yet (see below).

## Context
The gap with Omar's scraper was mostly keyword count (about 45 times fewer keywords searched), then runs that stopped or stalled. The study is [scraping-omar-analysis.md](../scraping-omar-analysis.md). The owner asked on 2026-11-02 for the upgrade, one pull request per part, with no paid proxies for now. S1 to S5 merged as #43 to #47. S6 and S8 are in one pull request on `feat/scraping-s6`: the owner asked for S8 next, and for one round of full checks for both.

## Decision
**S1 (#43), quick fixes.**
1. **This machine last.** When any gateway or proxy is set, the direct connection is used only while every other route is cooling down, with its own minimum gap (6 s). "Also search directly" is off by default when other routes exist. A value the owner saved stays.
2. **Normal pacing** is the default. Fast stays as an explicit choice.
3. **Done means finished.** A search that stopped early keeps what it found but leaves the keyword pending. The app counts failures; the third makes the keyword `failed`, with a Retry button. The run goes on to the next keyword.
4. Channel pages are read by channel id. A result without a handle is stored, and the handle is filled in later from the API.
5. The "not a bot" page is a block marker. "Search again the weak keywords" is a one-time action in Find › Keywords.

**S2 (#44), runs that keep going.**
1. **Three attempts a page**, each on a different route. After the third, the keyword goes back to pending.
2. **One route per keyword.** A worker keeps one route for all pages of a keyword. If it fails, the worker takes another and **carries on from the same page**. The original plan said to restart from page 1. Carrying on costs fewer requests and loses nothing, so the restart was dropped.
3. **Blocks cool a route and never end a search.** One worker's failure no longer stops the others. A run ends only on Stop, a refused key, or a bug.
4. **Told waits, per reason** (routes, quota, API): "Paused, resuming at HH:MM" in the run panel. Stop works at once.
5. **The API breaker and the quota wait.** A network failure waits and tries again (1 min, doubling to 10 min). A spent quota waits until midnight Pacific plus 5 min.
6. **Continuous mode** ("Keep searching until the list is done"): the run picks up again after a quota reset by itself.
7. **Bandwidth per keyword**, stored on the run.

**S3 (#45), more from the same API calls.** `videos.list` and `channels.list` cost 1 unit a call whatever parts are asked for, so the extra parts go into the same batches of 50: no new calls, no extra units (a test on recorded answers counts them). Stored: language, topics, likes, comments, duration, captions, paid placement, channel totals and start date. Rolled up per channel: main language (with its basis), topics, engagement, Shorts share (60 s or less), paid share. The search position of each hit is kept. Find › Gallery has a Language facet, and the rules have "Main language is one of". An unknown language reads "Not known", never a guess.

**S4 (#46), the archive keep list.** The owner took the recommended list on 2026-11-02, **without tags**: video tags and a channel's own keywords are noise to the owner, so they are neither archived nor added in S3.
- **Channel, kept on the tombstone:** identity, found-via keywords (with the search position), median views, uploads in 30 days, latest upload, videos we had, brands seen, emails and their sources, label, archived at; plus description, profile picture URL, when it was last read and when its videos were read, sponsored ratio, and every S3 channel fact.
- **Channel, dropped:** banner URL, link, read failures and unreadable-until, sync bookkeeping.
- **Videos, kept:** id, published date, views, title, and the S3 numbers (likes, comments, duration, language, paid placement, topics).
- **Videos, dropped:** description, tags, thumbnail URL.
- **A guard test:** every column of `channels` and `videos` must be listed as kept or as dropped on purpose. A new column with neither fails the test.
- Archive and delete stay one transaction. Bring back restores the kept fields and merges the videos back. The size of the archive shows in Toolbox › Archive.

**S5 (#47), free proxies, gateways and tracking.**
1. **Free proxies** (off by default, Settings › Connections): the ProxyScrape list, checked against YouTube, fastest first. A failing proxy is banned for every worker (5 min, doubling to 60 min). The list is remembered and refilled. They carry page reads only: the API key never goes through a proxy, and certificates are always checked.
2. **Gateway redirects stay on the gateway.** A redirect to youtube.com is followed through the same gateway. A redirect elsewhere is refused.
3. **Workers follow the usable routes**, re-counted between keywords.
4. **Route tracking** per run and per route (`run_routes`), shown in Insights › Search › Routes: block rate, in-range channels per 100 requests, MB per keyword.
5. **The gateway leak test** is built and not run (below). AWS region rotation was not built: it only makes sense if gateways stay.

**S6, keywords at scale (branch `feat/scraping-s6`).**
1. **The queue holds 10,000 keywords** (was 500). It is paged: the app gets a summary and asks for 100 rows at a time.
2. **The generator** crosses a list of AI tools with a list of angles (Find › Keywords). The crossing is local and free. Duplicates are skipped against the queue, `pipeline.db` and the archive. Each generated keyword remembers its tool and angle (`keywords.json`).
3. **Gemini suggests new tools and angles**, one prompt per fresh chat under the owner's Gemini rules. A person accepts. Gemini does not write whole keywords for the generator.
4. **Yield ordering.** The pipeline records, per finished keyword, the new channels and the in-range ones. Before each batch, queued keywords are sorted by how well their tool and angle have yielded. Nothing is dropped: a keyword pushed back still runs, still shows, and can be retried or started by hand.
5. **Runs go in batches of 200, chained**, so the order learns every 200 keywords. Stop, a failure or a crash ends the chain.
6. **Insights › Search › Keyword yield**, by tool and by angle. A group with fewer than 5 finished keywords reads "Too few keywords yet".

## The gateway leak test
**Question:** does an AWS gateway pass this machine's address on to YouTube?

**Why it is a question.** AWS reserves `Forwarded` and `X-Forwarded-For` for HTTP APIs and sends `Forwarded: for=<client>`. FireProx reports in 2024 describe the same leak. This is the evidence we had before any test.

**The test is built.** Settings › Connections › AWS gateways › Check for leaks. It creates one gateway for a minute that forwards to a header-echo page, sends one request, reads which headers carried this machine's address, and deletes the gateway. It shows header names only, never an address.

**It has not been run.** It needs the owner's AWS keys, which live in the app. The session did not open the app on the owner's profile: that could fire approved send-later emails, and it would move `pipeline.db` to the new schema before the merge.

**Until the result: keep "Use gateways" off.** [proxies-setup.md](../proxies-setup.md) says the same.

**Result: pending.** _To fill in after the owner clicks the button: leak, clean or unclear, and the date._

**P2, if it leaks:** the owner chooses between (a) gateways only behind a free proxy, (b) a small Lambda function URL that fetches the page itself (needs a wider AWS key), or (c) dropping gateways.

## Not built: S7
The owner closed step S without S7 on 2026-11-02. The two ideas stay as ideas:
- **The channel search per keyword**: a second search with YouTube's "channels" filter, about 20 channels a page.
- **The API fallback for unreadable channels**: the latest uploads from `playlistItems.list`, 1 unit a channel, under a daily cap.

The route comparison that was to decide the channel search was not made. To pick them up: the S5 route data already exists, so run with and without the channel search and compare in-range channels per 100 requests in Insights › Search › Routes. The uploads playlist id for the fallback is already stored (S3). The acceptance checks are in the plan's S7.

## Measured
- **S4, on a copy of the dev `pipeline.db`** (91,440 tombstones): version 4 to 8 in 0.08 s. 50 channels archived (750 videos kept), 10 brought back (150 of 150 videos), nothing lost.
- **Free proxies, 2026-11-02:** 1,478 listed, 394 answered YouTube, the fastest 100 that passed the search test were kept.

## Open questions for the owner
Defaults are in force until answered.
- The stored "Also search directly" setting keeps its saved value (likely on). This machine is still used only while every other route cools down.
- One worker with many proxies is slower now: it keeps one route a keyword and waits its gap.
- With this machine as the only route, a blocked address is tried again every cooldown without end.
- Shorts are counted at 60 s or less. YouTube now allows up to 180 s.
- Each batch of 200 shows as its own run in Runs and Insights (a 4,000-keyword day shows about 20 runs).
- Yield counts only new in-range channels, not channels already known.
- The bot-wall markers are unproven until a real bot-wall page is captured.

## Consequences
- A search no longer ends on a block or a quota answer. The run panel says what it waits for and until when.
- The archive keeps what the owner wants, and a test stops a new column from being lost without notice.
- The queue is big enough for the generator. Its order follows what has produced channels, and nothing is hidden.
- **For step T:** applying a teammate's blob resets the S3 rollups. `get_unannounced_archives` should page. Sharing keyword lists and origins with teammates waits for T.
