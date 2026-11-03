# Workflow real-use findings

Written 2026-10-31 by a session that ran the pipeline end to end on the owner's real data: find, filter, shortlist, find emails, draft 50 first emails through Gemini. No email was sent and no mailbox was read. This is a log of what was hard, risky or missing, in the order it came up. It is not a plan; the owner decides what becomes a step.

## How the run was driven

- The app has no command line. The session drove the built app with Playwright's Electron launcher, pointed at the real data folder (`GRATOVO_USER_DATA`), and called the same IPC channels the screens call (`find:add`, `find:start`, `find:query`, `data:write`, `gemini:start`, ...). It worked, but only because the e2e fixtures show the way. A supported "run headless" or "scripted" entry would make long unattended runs a documented thing instead of a trick.
- Only one process can own the data folder (SQLite plus the single-instance rule), so the owner's own app, `pnpm dev` and the session cannot overlap. The session needed the owner to close the app first.
- Another session was running `pnpm verify` at the same time and rebuilding `apps/desktop/out`. A build into the same `out` while a test run reads it is a risk; the session built once when no e2e step was running.

## Setup findings

- **Firefox was not installed** on this PC, and the bridge needs it. Nothing in Settings says so before you press Start; the failure shows as a bridge problem.
- **The Gemini login lived in the old app's profile.** The new app keeps its own managed Firefox profile in `<data folder>\gemini-profile`, so the Gemini sign-in made in the old app (`%LOCALAPPDATA%\Gratovo IMA ToolBox\gemini-profile`) was not seen. The session copied that profile (without caches or lock files) into the new folder and the bridge connected on the first try (add-on 0.4.0). An "import the old Gemini profile" button, or a clear first-run "sign in to Gemini here" step, would save a manual copy.
- **The `profileMode: existing` option** (use the person's everyday Firefox profile) exists in the Python bridge but nothing in the app sets it, so it cannot be reached.
- **The course folder was not set** (Settings › Connections). The path that works is `...\course scraping toolkit\course content` for the course and `...\video transcripts\parakeet` for the videos. The names are not obvious: the "Learning" folder holds several look-alike folders. A hint in the setting would help.

- **A minimized Gemini window stalls the page.** The bridge minimizes the Firefox window it opens (`window_guard`). On this PC the Gemini tab then never finished loading ("Waiting for lh3.google.com", no sidebar), and the first draft timed out after 300 s with no answer. Restoring the window let the page load at once (signed in, Argon, Chat). The throttling prefs in the managed profile don't cover a minimized window. Either keep the window open behind others, or have the bridge restore it before a send.
- **The app can't draft without a confirmed address.** The drafter only drafts for a creator at Contact with a confirmed address (`drafter.ts`, `due`). When the owner wanted drafts first and addresses later, the session had to call the comms engine through its own bridge and keep the drafts in a file. A "draft now, address later" path, with the address gate moved to Send, would fit how the owner worked here.
- **Keyword ideas and channel classification don't ask for thinking high.** `actions._send` calls `gemini.send` without `thinking`, so those two actions run at whatever level the page shows (it resets to the lowest on each new tab). The drafting engine does pass `thinking="high"` and refuses to go on when the add-on can't confirm it. The owner's rule is high on every send.
- **The email lookup is slow and finds little** on these channels: about 10 s a channel, direct from this PC (no proxies or gateways set), and 1 address for 36 AI creators after the first minutes. The owner stopped it to draft first.

## Data findings

- The live catalog held 2,002 channels, only one with a found email, and roughly 110 clearly AI channels that were active and clean. The rest came from broad keywords (AI in games, AI in courts, general news channels). Keyword breadth outran niche focus.
- The catalog has `creator_gender` in `channel_state`, but it was empty for 15,407 of 15,409 rows. There is nothing in Find to filter by creator gender, and nothing for values (music, gambling, dating, alcohol). The session screened by keyword lists and by hand.
- Some stored titles and descriptions carry U+FFFD replacement characters (for example "Sam Altman :?AGI in 2026?"). It looks like an encoding loss on the way in (import or scrape), not a display issue.
- Windows consoles: Python scripts that print channel titles crash on cp1252. `PYTHONIOENCODING` doesn't help under `python -I` (isolated mode ignores it); reconfigure stdout or write to a UTF-8 file.

## Drafting findings

36 AI creators were shortlisted and drafted through the comms engine (`action.comms_propose`, kind `first`), with no address and no follow-ups. The drafts are in `E:\IMA work\Gratovo drafts 2026-10-31.md`, outside the repository. First pass: 33 drafted (8 ready, 25 needing a person), 3 failed. After two retries: 35 drafted (9 ready, 26 needing a person). @t3dotgg was never drafted.

- **Speed.** About 10 to 11 minutes a creator by the wall clock, with thinking confirmed High on every send. The engine's own timer says a median of 337 s. The rest is the bridge's pacing: each proposal opened 3 to 4 fresh Gemini chats, with 60 s between sends. 50 drafts is a full working day for one Gemini account.
- **Failures, and a bridge bug behind them.** 3 of 36 failed: one "response to complete" timeout at 240 s with an empty answer (`partial: ""`), then the next two creators got no answer at all within 840 s. The window showed that Gemini had finished the timed-out answer: the full JSON was on the page. The add-on never read it. After that miss the bridge stops: it sends nothing more, and the run just sits there. It happened twice, both times on @t3dotgg. On the third try the bridge sat silent for about 6 minutes before its first send for @t3dotgg (low CPU, no event). The session stopped it there, just as the send began. That creator's case seems slow to build, and the 240 s answer limit may simply be too short for its larger prompt. A progress event while the case is built would make "slow" and "stuck" look different. Two fixes: when a send times out, read the page once more before giving up; then reset the tab, or restart the bridge, so the next creator isn't stuck. In the app's drafter this would look like Reach hanging with no error.
- **The first name is the main gap.** 25 of 33 came back as needing a person, nearly all because the creator's first name isn't known. The greeting then falls back to the channel name ("Hey The Calum Johnson Show,"), which reads as a mass email. Find a first name before drafting (the About page, or "I'm ..." in the latest video's description or transcript). That would make most of these ready.
- **The closing lines repeat even with the anti-template check.** The engine got the last 20 bodies as `recentOutbound`. The hooks and subjects are all different, but the ask and the agency line repeat: "would you be open to" is in 8 of 33 drafts, "are you open to working with brands" in 7, "we are onboarding YouTube creators" in 6, and "we find brand sponsorships for YouTube creators" in 4. The check seems to compare whole bodies. It should also compare the last two sentences on their own.
- **The hook is the latest video, even when it's off the niche.** @DwarkeshPatel got a Robert Caro hook, @ShowItBetter an architecture-portfolio hook, a phone reviewer an iPhone-against-Galaxy hook. For an AI-niche agency the hook should be the latest AI video, and it should say why the brands are AI brands.
- **Length is steady:** 63 to 72 words, one ask, no links, signed "Mustafa".

## Why so few of the tens of thousands of found channels are relevant

The owner asked this directly. The numbers, from `pipeline.db` on 2026-10-31:

| | Channels |
|---|---|
| Found by searches (sum over 1,390 done keywords) | about 81,000 |
| Archived (tombstones) | 91,365: 59,115 "inactive", 32,308 "irrelevant", 17 "haramStuff" |
| Archived with under 10K subscribers | 68,173 |
| Live in the catalog | 2,002 |
| Live and clearly AI creators (3+ of their latest 12 titles about AI) | about 100 |
| Of those, active, not haram, English, and not a woman (by visible cues) | about 35 to 45 |

The first reading is below; the tests after it corrected the order. The biggest leak is not the search but what happens after it (causes 3, 5, 6 and 7).

1. **The search finds videos, not channels, and sorts them by upload date.** The rules are `resultsType: video` and `sortBy: upload_date`, with 200 handles per keyword. YouTube then returns the newest videos that loosely match any of the words, from any channel. A history channel (@heimlershistory) came in through "skeleton-of-thought prompting technique", a Canada living channel through "beginner's guide to AI in personal finance". Upload-date order throws away YouTube's own relevance ranking, which is the one thing that keeps a long query on topic.
2. **The keywords are long, topic-style sentences** (Gemini keyword ideas: "Bing Image Creator hidden settings most people miss", "robot dog security patrol use case", "AI generated movie trailer breakdown"). Those topics are covered once by big general channels (news, tech reviews, finance, gaming), not by AI creators. The keyword that kept the most live channels (69) kept zero AI creators. Across 1,036 keywords that kept anything, the best one kept 6 AI creators.
3. **Nothing checks relevance before a channel is kept.** Auto-clean keeps any channel in the 50K to 2M band. Relevance only comes later, by hand in Review new. So the catalog fills with off-niche channels, and Review new becomes the filter. The bridge already has a channel classification action (`action.classify_channel`), but the search doesn't use it.
4. **The manual sources were the good ones.** Of the live channels, `__manual_refetch__` gave 17 AI creators out of 18 and `imported_handles` 13 out of 29. Hand-picked handles beat keyword search by an order of magnitude.
5. **Bulk archiving in September took good creators out** (see the tests below for the size of it). 10,733 channels inside the 50K to 2M band are archived as "inactive", nearly all on 2026-09-05 and 09-06, 8,474 of them decided on another machine ("remote") and synced in. None of them had their uploads read (`videos_last_30` and `latest_upload_at` are empty), yet 5,987 have a 30-day median of 5,000 views or more. "inactive" is simply the auto-clean label, so these were swept by a rule or a person, not for being inactive. Real AI creators are among them: @ai-foundations (364K subscribers, 30K median), @tef-AI (139K, 72K median), @AI.Uncovered (243K, 11K median), @n8n-io. 1,281 in-band channels are "irrelevant", among them @Chase-H-AI (169K, 55K median) and @perplexity-ai. Another 32K "irrelevant" were labelled 2026-09-08 to 09-14, mostly remote.

6. **The keyword generator and the subscriber floor work against each other.** The Gemini skill (`services/pipeline/data/gemini-skills/keyword generator skill.md`) asks for long-tail phrases of 4 to 9 words "to surface smaller and more specialised channels, not the big established ones". Auto-clean then sweeps every channel under 50K subscribers: 78,218 of the 91,365 archived (68,173 under 10K). What survives the floor is mostly the big general channels that made one video on the topic, which is the opposite of what the skill was for.
7. **Bulk Clean archived by numbers alone.** The old app's Bulk Clean tool (`legacy/lib/features/archive/presentation/widgets/bulk_clean_dialog.dart`) tags every channel inside a subscriber and average-views range as rejected. It never looks at the topic, so AI creators inside a swept range went with everything else. The September batches fit this shape.

### Tested on 2026-10-31: the search is not the main leak

The owner asked for the fixes to be tested, not just proposed. A scratch harness (outside the repository, read-only toward the app's data) ran six search strategies against live YouTube with the pipeline's own scraper and pacing, 6 keywords each, 20 results per keyword. Each channel found was judged by its latest 12 titles (an AI creator when 3 or more are about AI).

| Strategy | Channels judged | AI creators | Rate |
|---|---|---|---|
| S1 video results, newest first, long keywords (the current rules) | 102 | 59 | 58% |
| S2 video results, relevance, long keywords | 98 | 59 | 60% |
| S3 video results, relevance, short creator keywords | 68 | 54 | 79% |
| S4 channel results, relevance, short creator keywords | 117 | 88 | 75% |
| S5 channel results, relevance, long keywords | 109 | 54 | 50% |
| S6 video results, newest first, short creator keywords | 69 | 54 | 78% |

Short keywords lift the rate from about 58% to about 77%, and channel results give the most distinct channels per request (119 unique of 120 against about 70 of 117 for short video searches). But even the current rules find mostly AI creators. The catalog's 5% comes from what happens after the search.

**Where the AI creators went.** Of the 233 AI creators the harness found, 157 (67%) were already in `channel_archive`, only 8 (3%) were live, and 68 were new. Of the 151 non-AI channels it found, 22 (15%) were live. **The pipeline keeps a non-AI channel five times as often as an AI creator.** Of the 157 archived AI creators, 93 sit inside the 50K to 2M band and 89 of those had a 30-day median above zero, so neither the size rule nor real inactivity explains them. They were archived in bulk batches (for example 2026-09-24 21:36, 32 of them, inside one batch of 7,563 channels of every size from 0 to 133M subscribers; 2026-09-05 20:08; 2026-09-06 23:59), mostly decided on another machine (`source = remote`) and labelled "inactive". Examples: @higgsfieldai (410K subscribers, 180K median, archived "irrelevant"), @helena-liu (286K, 65K median), @productivedude (170K, 24K median), @ibmtechnology (1.78M).

The archive doesn't keep enough to say who ran each batch or with which ranges (`country` and `name` are empty on almost every tombstone), but the batch shapes are those of Bulk Clean and the "archive due" sweep, not of the per-keyword gate.

### More tests: what each fix is worth

**New creators per request.** Counting only AI creators inside a band and not already in `pipeline.db` (live or archived), the searches found almost nothing new: 0 for S1, S2 and S5, 1 for S3 and S6, 8 for S4 (channel results, short keywords) at a 10K floor, about 7 per 100 requests at best. The catalog already holds most of what search can find; more searching mostly re-finds the archive.

**The subscriber floor.** Of the 229 AI creators found with a readable subscriber count: 90 under 10K, 14 at 10K to 25K, 12 at 25K to 50K, 22 at 50K to 100K, 52 at 100K to 500K, 29 at 500K to 2M, 10 over 2M. The 50K to 2M band keeps 103 (45%); a 10K floor would keep 129 (+25%).

**Growing from known creators (S7).** The Channels tab (featured channels) of 10 known AI creators: 7 list none, the other 3 gave 25 channels, 12 of them AI creators (48%). Worse than search, and most creators don't fill the tab. Dropped.

**Re-judging the archive (S8): the method that works.** A random sample of 150 archived channels inside the band with a 30-day median of 2,000 or more (a population of 8,313) was read once each: 46 of 147 (31%) are AI creators by the 3-of-12 rule. That is about 2,600 AI creators sitting in the archive, against about 100 live, at one page read each (about 31 per 100 requests, against at most 7 new ones per 100 requests for the best search).

**How good the title check is.** Each of the 46 "AI" verdicts was read by hand:
- With 5 or more AI titles of the last 12: about 25 of 28 right (around 90%). The misses were a lo-fi music channel ("Chill Coding Session"), a company channel and a gadget reviewer.
- With 3 or 4: about half right. Real small creators sit next to false matches such as a pool cleaner called "Sora", a geopolitics channel and a trading channel.
- So two tiers work: 5 or more is "AI creator", 3 or 4 is "check by hand". It costs no extra request in the pipeline, because the uploads read (`LiveSweep.recent_video_ids`) already loads the same channel page that carries the titles.
- It is not a values filter. The music channel passed, so the music and haram check has to run beside it, as a word list plus a person.

**What would fix it, in order of payoff** (proposals for the owner; nothing in the app was changed):
1. **Recover the archive with the gate.** Read the archived channels inside the band, best median first, and bring back those with 5 or more AI titles (3 or 4 to a "check" list). The session ran this, read-only, over the best 2,000 by median; the list is in the session's report to the owner.
2. **Put the same gate in the search**, right after the uploads read: keep a channel only with 5 or more AI titles, send 3 or 4 to Review new with a "check" tag, archive the rest as "irrelevant" with the titles kept on the tombstone so a later rule change can re-judge them.
3. **Stop bulk archiving by numbers alone.** Bulk Clean and the "archive due" sweep should skip a channel the gate calls AI, or at least show how many AI creators a range would take.
4. **Lower the floor to 10K and keep it for the gate to judge:** 25% more AI creators. Small AI creators are cheaper to sponsor; whether they are worth a deal is the owner's call.
5. **Short creator keywords, channel results.** About 77% AI against 58%, and the most distinct channels per request. Change the Gemini keyword skill to ask for 2 to 4 word creator-style keywords.
6. **The country rule drops channels with no country set** (`search/keyword.py`, `_in_countries`): their uploads are never read, so they are never kept. Many creators leave the country empty. Treat "no country" as unknown and let the gate decide.

**The recovery, run once.** The gate was applied, read-only, to the 2,000 archived channels inside the band with the best 30-day median (2,000 page reads, about an hour, no block):

| Verdict | Clean | With a music or haram word, or mostly non-Latin titles |
|---|---|---|
| AI creator (5+ AI titles of 12) | 244 | 43 |
| Check by hand (3 or 4) | 128 | 16 |
| Not AI | 1,538 | |
| Couldn't read | 31 | |

Of the 244, 232 were archived as "inactive" (126 decided here, 106 on another machine). Among them: @nateherk (962K subscribers, 149K median), @theAIsearch (723K), @atefataya (716K, MCP and agents), @danny_why (202K, Claude Code), @RobertMilesAI, @aiConvoYT, @Green-Code, @andrejkarpathy. That is more than twice the AI creators in the whole live catalog, from 2,000 reads. The list is outside the repository (it names channels, not people's data, but it is working data): `E:\IMA work\Gratovo archived AI creators 2026-10-31.csv`. It still needs the owner's own filters: it holds company channels (@anthropic-ai, @googledeepmind, @mondaydotcom), Spanish-language channels, and creators whose gender titles don't show. Nothing was brought back in the app.

A fresh search on 2026-10-31 with 44 creator-style AI keywords (for example "claude code tutorial", "n8n ai agent tutorial") found 83 channels and kept 2 before it was stopped: most matches were already in the archive.
