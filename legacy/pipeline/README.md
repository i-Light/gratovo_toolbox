# The sourcing pipeline

Finds YouTube channels for a list of keywords, stores them locally, and shares
them with the team through Cloudflare R2.

```
pipeline/
  search.py                    the entry point
  requirements.txt
  gratovo/
    config.py                  paths, .env, settings.json, run_config.json
    store.py                   the local SQLite store (also the app's database)
    r2.py                      the Cloudflare R2 client (boto3 + zstd)
    sync.py                    sharing through R2: objects + the catalog log
    pipeline.py                discovery + YouTube fetching
    gmail.py                   the outreach mailbox: send, label, read replies
    mailbox.py                 what the mailbox has to remember (mailbox.db)
    scrapetube/                vendored scraper (no API quota cost)
  tools/
    enrich.py                  fills gaps and retries failed fetches
    import_handles.py          imports a list of handles as if a keyword found them
    news.py                    fetches the industry feeds for the News page (local)
    email_send.py              sends approved outreach, notices replies
  tests/
    test_r2_sync.py            the sharing contract between two machines (no network)
    test_feeds.py              RSS/Atom parser tests (no network)
    test_mailbox.py            the mailbox state and reply detection
../data/                       .env, .env.local, settings.json, keywords.json
  database/                    gratovo.db, mailbox.db, email_library.db
                               (gitignored: per-machine working copies)
  migration/                   the one-time export for the move to R2
  reset_manifest.json          "this build invalidates these local files" — read
                               it before changing any schema below (see next note)
```

### Changing a database schema

Every teammate already has `gratovo.db` / `mailbox.db` / `email_library.db` on
their machine, and the app never overwrites them. So decide what your change is:

* **Additive** — a new `CREATE TABLE IF NOT EXISTS`, a guarded `ALTER TABLE ...
  ADD COLUMN` (`gratovo/store.py:init_db` has the idiom), a new index. This
  self-heals; ship it and nothing else.
* **Breaking** — a column retyped or renamed, a table restructured, rows that
  must be recomputed, or a rewrite of the bundled `email_library.db` contents.
  An old file would be left wrong. Add one action to `data/reset_manifest.json`
  naming the file (e.g. `database/gratovo.db`); on the next launch every
  teammate's app moves their stale copy into `data/database/_needs_merge/` and
  the fresh one — re-pulled from R2 and Supabase — takes its place. Full notes
  are in that file and in `lib/core/native/pipeline_reset.dart`.

`gratovo.db` is shared with the Flutter app: the pipeline owns the scraped
tables (`channels`, `videos`, `keywords`, `channel_keywords`,
`channel_archive`, `runs`, `news_*`) and the app owns its own (`channel_state`,
`deals`, `outreach_*`, `activity_log`, …) in the same file. Neither side
touches the other's tables, and both open the file in WAL mode with a busy
timeout. The Supabase schema (`backend/schema.sql`) holds only the app's
typed-in tables and is never held by a client.

## Running it

```
pip install -r requirements.txt          # only needed to run searches
python search.py                         # process the queued keywords
python search.py --status                # where is everything pointing?
python search.py --refetch @somechannel  # refresh one channel now
python search.py --push-only             # share local results, no searching
python search.py --pull-only             # apply the catalog + download objects
python search.py --pull-blobs            # download only the objects already known missing
python search.py --archive-ids ids.json  # archive channels (the app's sweep uses this)
python search.py --unarchive-ids ids.json
python search.py --no-sync               # stay local even if configured
```

Start with `--status`. It prints the resolved data folder, whether the YouTube
key is set, and whether the R2 bucket is reachable — which is the answer to
almost every "why isn't this working" question, and it needs nothing installed.

## What a search will not fetch twice

A keyword run decides what it is going to skip at the *handle* level — the
moment `discover_handles` returns, before a single detail is fetched. Two
kinds of channel are dropped there:

| | |
|---|---|
| **already in the database** | the `channels` table already holds it |
| **archived** | `channel_archive` holds a tombstone for it |

The cut is made at that exact point because discovery is the last thing in a
run that is free. Everything after it costs: `get_channels_data` and
`get_videos_data` spend YouTube API quota, and `get_recent_video_ids` spends a
scrape plus the pacing delay that goes with it, which is most of a run's wall
clock. A channel dropped here costs nothing at all; the same channel dropped
two functions later has already been paid for.

The skip is not a filter on results — the keyword still gets credit for the
channel. An already-known channel has its `channel_keywords` link recorded
(one local INSERT, no fetch), so a channel that genuinely surfaces under six
keywords still lists all six. What it does not get is any *fetching*.

`force_refetch` overrides the skip, which is the whole reason the flag exists:
`--refetch` and the app's refresh action are people deliberately asking for
current data about a channel this rule would otherwise pass over.

Refreshing stale rows is a separate job with its own budget — `enrich.py`
below — rather than something a keyword search does as a side effect of
re-finding a channel.

## Filling in the gaps: `tools/enrich.py`

`search.py` only ever fetches a channel or video it has never seen. That keeps
discovery cheap, but it also means a row written before a field was being
collected keeps its blank forever, and a row whose fetch failed at the time
stays failed forever. `enrich.py` is the deliberate second pass over exactly
those rows.

```
python tools/enrich.py                       # report only — spends no quota
python tools/enrich.py --apply               # do the work
python tools/enrich.py --apply --only videos # one job at a time
python tools/enrich.py --apply --handle @someone
python tools/enrich.py --apply --months 3    # widen the backfill window
python tools/enrich.py --apply --max-api-calls 40
```

It runs read-only unless you pass `--apply`, so the normal way to use it is to
read the report first. Three jobs, separately selectable with `--only`:

| Job | What it does |
|---|---|
| `channels` | Re-fetches channel metadata (country, subscribers, name) |
| `videos` | Re-fetches video metadata (view count, publish date, title) |
| `backfill` | Reaches further back than the 15 recent uploads discovery stores |

`backfill` is the only job that adds new rows. It is what widens the basis the
CRM calculator averages over, and it is also what the Influencer Profile
page's "pull more uploads" action runs.

### Stale vs genuinely absent

A blank field has two very different causes, and re-fetching the second kind
spends quota for nothing. For each field the tool finds the earliest fetch at
which that field was ever actually recorded — the *coverage watermark* — and
splits the blanks by it. Rows fetched before it were written when the pipeline
was not collecting the field, so a re-fetch will fill them in. Rows fetched
after it came back empty from a fetch that *was* asking, so YouTube does not
expose a value for them. Only the first group is targeted, unless you pass
`--include-absent`.

A fetch recorded as **failed** is always retried regardless, because a failure
is not evidence about what YouTube holds — it means the question was never
answered.

### The quota ceiling

`--max-api-calls` (default 100) is a hard ceiling shared across all three jobs.
The YouTube quota is a daily allowance shared with the search runs, so an
enrichment pass that quietly drains it breaks the next day's discovery. Hitting
the ceiling is a normal, resumable stopping point: everything already fetched
is already committed, and the next run continues from there, because the rows
it filled no longer match its queries.

## Industry news: `tools/news.py`

The app's News page reads stories out of the local `gratovo.db`
(`news_sources` / `news_items`); this tool is what fills them. Public feeds,
nothing to share — every machine fetches its own.

```
python tools/news.py                     # what is configured, and how fresh
python tools/news.py --refresh           # fetch every enabled feed
python tools/news.py --refresh --dry-run # fetch and parse, store nothing
python tools/news.py --add https://example.com/feed.xml --niche "creator economy"
python tools/news.py --disable https://example.com/feed.xml
python tools/news.py --remove https://example.com/feed.xml
```

The first run seeds five feeds that were each verified working. The News page
runs `--refresh` for you: automatically when its newest stored feed is over 3
hours old (opening the page is what checks), and on demand from its Refresh
button. To fetch by hand, or from a scheduled task, run the `--refresh` line
above on the pipeline machine.

`gratovo/feeds.py` parses RSS and Atom with nothing but the standard library,
because feeds in the wild are irregular in a small number of known ways and
handling them is less work than making every teammate install a package. The
irregularities it handles — and there is a test for each — are listed in that
module's docstring: two formats, four date shapes, inconsistent namespaces,
HTML inside summaries, and servers that gzip a response nobody asked them to
gzip (which is what made one of the seeded feeds fail at byte 0 with an XML
error pointing nowhere near the cause).

```
python tests/test_feeds.py               # 25 tests, no network
python tests/test_archive.py             # 16 tests, no network
```

## Outreach email: `tools/email_send.py`

Sends the outreach a person approves in the app, and notices when somebody
answers. It never sends by itself (owner decision, 2026-10-18).

```
python tools/email_send.py --status              # which mailbox, and what is queued
python tools/email_send.py --authorize --save    # connect a mailbox (opens a browser)
python tools/email_send.py --run-due             # sweep for replies; sends nothing
python tools/email_send.py --check-replies       # the same sweep
python tools/email_send.py --pending             # what is queued (no network)
python tools/email_send.py --cancel --conversation <thread id>
python tools/email_send.py --test-send           # prove the mailbox works
```

Start with `--status`, for the same reason `search.py --status` is the first
thing to run: it prints which account is connected, what it owes, and — when
something is wrong — why, in the terms it actually presents as.

### Connecting a mailbox

Once per machine, and again every seven days until the OAuth app leaves
Testing mode:

```
cd pipeline
python tools/email_send.py --authorize --save
```

That opens a browser, asks you to sign in **as the address outreach should be
sent from**, and writes three values to `data/.env.local` — which is gitignored
precisely because `data/.env` is not, and a refresh token is a live credential
for a mailbox that sends mail as a person.

> While the Google Cloud project is in **Testing** mode, a refresh token issued
> to a test user **expires after seven days**. Re-run the command above, or
> publish the OAuth app to Production. `--status` reports the lapse in those
> words rather than as `invalid_grant`, which is a genuinely baffling thing to
> be told on a Monday morning.

### Why a real mailbox and not a mail service

A cold email to a creator has to arrive in a personal inbox, be replyable in
the ordinary way, and leave a thread the sender can open in Gmail and read like
any other conversation. A transactional sender does none of that, and lands in
Promotions besides. Everything the pipeline sends is labelled (`OUTREACH_GMAIL_LABEL`,
default "Gratovo Outreach"), which is what keeps "what has this sent" a filter
rather than a memory exercise inside a personal inbox.

### Follow-ups are sent by a person

Nothing is queued behind a send any more. A follow-up is a message like any
other: the app reminds the team when one is due (the thread's Follow-ups card
and the Comms queue), a person approves it, and it goes out through `--send`.
Older builds queued follow-ups as rows in `data/database/mailbox.db`; the next
`--run-due` cancels any still pending there and never sends them.
`tests/test_email_send_no_auto_send.py` is what keeps it that way.

### Running the reply check on a schedule

`--run-due` (or `--check-replies`) only looks for replies, so it is safe to run
unattended. The app runs it every few minutes while it is open (see
`lib/features/outreach/application/outreach_inbox_controller.dart`); on a
machine where the app is often closed, a scheduled run every 15 minutes keeps
the reply check current:

```
python tools/email_send.py --run-due
```

### What the app does with what it finds

`--run-due` reports replies as JSON; the app applies them. Recording the reply
on the thread, moving the thread to `replied`, clearing the human follow-up
reminders for that channel, and — **on the first reply only** — moving the
channel to `interested`. Answering at all is the signal that a creator has
self-selected out of the cold pile; a second reply says nothing new about the
stage, which is why the tool reports `isFirstReply` rather than leaving the app
to infer it from a message count a teammate may have written.

Replies are handed over until the app says it recorded them (`--ack`). An app
that dies halfway through applying one sees it again on the next sweep rather
than dropping it on the floor. `--ack-now` acknowledges in the same call, for a
scheduled run with no app behind it.

### `data/database/mailbox.db`

Per-mailbox state on the machine that sends, and it stays there — unlike
`gratovo.db`, none of it is pushed to Supabase. A Gmail thread id is meaningful
only inside the one account that holds it: hand it to a teammate signed into a
different mailbox and it names nothing. Same for the RFC Message-ID a follow-up
has to quote, and for the OAuth grant that produced both.

```
python tests/test_mailbox.py             # 31 tests, no network
```

## Gemini in the browser: `gemini_bridge/` + `gemini_extension/`

The app's AI features (search keywords, the Comms queue's drafting through
`action.comms_propose` / `action.comms_check`, later channel classification) run on the team's **signed-in Gemini web app**, not on
an API key. A browser extension (`gemini_extension/`, load unpacked in Chrome
or Edge) drives the Gemini tab; a Python package (`gemini_bridge/`) is the
WebSocket server the extension dials, and the only thing the app talks to.

```
python -m gemini_bridge serve                 # is the extension connected? prints events
python -m gemini_bridge status                # the tab: account, model, generating, elements found
python -m gemini_bridge diag                  # every element: what was tried, how it used to be
                                              # found, ranked candidates, numbered suggestions
python -m gemini_bridge heal sendButton --pick 0   # apply a suggestion as a persisted override
python -m gemini_bridge account "khaled"      # switch /u/N/ until the account matches
python -m gemini_bridge models                # the model menu
python -m gemini_bridge ask "Reply with exactly: pong"
python -m gemini_bridge keywords "kids science experiments" --count 50
python -m gemini_bridge daemon                # what the app runs (JSON lines on stdin/stdout)
```

The three documents beside the code are the reference:

- `gemini_bridge/PROTOCOL.md` — extension ↔ Python: methods, error codes, the
  self-healing locator engine and the diagnostics object.
- `gemini_bridge/DAEMON.md` — app ↔ daemon: `bridge.*` and `action.*` methods
  and what the app implements in Dart.
- `gemini_bridge/CONTEXT.md` — why it is built this way, what is done, what is
  left, and how to calibrate it on a live page.

Two rules that keep it reliable. Selectors are **never derived from the live
DOM** — the builtin strategies are an ordered list per element (`data-test-id`
→ aria-label → icon → stable CSS → text → a heuristic function), and when none
matches the answer says which were tried, how the element used to be found,
and what on the page looks like it now, so a fix is one `heal` away. And the
prompts live in `gemini_bridge/actions.py`, next to the skill files in
`data/gemini skills/`, so the app never composes one.

```
python -m pytest tests/test_gemini_*.py      # ~50 tests, no network, no browser
cd gemini_extension/test && npm install && npm test     # 37 jsdom tests
```

## Local first, shared second

Every result is written to `data/database/gratovo.db` **before** anything is
sent anywhere. A run with no connection produces exactly the same data; it
just is not shared until the next share. Nothing here fails because the
bucket is down — you get a message, and `--push-only` catches up later.

Shares happen after *every keyword*, not only at the end, so a teammate's
influencer list fills in while your run is still going, and an interrupted run
has already shared everything up to the last keyword.

## How sharing works: one object per channel, plus a log

Everything scraped goes to one private R2 bucket (`R2_*` in `data/.env`).
Nothing scraped goes to Supabase any more — at the scale this pipeline is
meant to reach, rows there cost storage, egress on every pull and a realtime
message on every change. R2 charges nothing for egress.

**`channels/<channel_id>.json.zst`** — the channel's scraped details and every
stored video, zstd-compressed, uploaded once the channel's video pass has
finished (`videos_fetched_at` is stamped) and re-uploaded whenever that stamp
moves. The object's `fetched-at` metadata is its version: a `HEAD` before
every upload skips the `PUT` if the bucket already holds a version at least
as new. A channel with no finished video pass never gets an object — partial
data is not shared.

**`catalog/<worker>/<stamp>-<seq>.jsonl.zst`** — an append-only log of what
each machine has to say: `found` (a channel, thin: no description, nothing
derived), `blob` (a newer object exists), `link` (which keyword found it),
`keyword` (a keyword's status), `archived`, `archive_link`, `unarchived`.
Every machine writes only under its own prefix, so two machines never touch
the same key and nothing needs a lock. A row that has been announced carries a
flag saying so (`channels.announced_at`, `channel_keywords.announced`,
`keywords.dirty`, `channel_archive.announced`); a failed write leaves the
flags alone and the next share says it all again.

**A pull** (`--pull-only`; the app runs it in the background) lists the
catalog, applies every segment this machine has not applied
(`_applied_segments`), then downloads the objects the segments named as newer
than what is here (`blob_version` vs `blob_applied_version`). A channel
learned from the log is never announced again by the learner, never
re-uploaded by it, and is not in its video backlog — somebody has already
read those videos. Rollups (`videos_last_30`, `median_views_last_30`,
`latest_upload_at`) are computed here, on every machine, from the videos that
arrived; they are never in an object.

A pull that finished less than `DEFAULT_PULL_MAX_AGE_SECONDS` (15 minutes)
ago is skipped; `--pull-max-age SECONDS` changes the window, `--force-pull`
always pulls, `--no-pull` never does.

`tests/test_r2_sync.py` pins the contract between two machines against an
in-memory fake of the bucket: what one writes, what the other ends up with,
and the things that must not happen (an unfinished channel getting an object,
a newer scrape being clobbered by an older object, a `found` resurrecting an
archived channel).

## What it will not overwrite

Nothing a person typed is in any object. Notes, vetting status, channel tags,
pipeline stage, contacts live in Supabase `channel_state`, written only by the
app — a scrape cannot touch them. Between machines, the newer object version
wins, which suits scraped data: two people who re-fetch the same channel
converge on the same real-world answer.

## Moving from the live-first database (one time)

```
python search.py --export-supabase     # once, from one machine with SUPABASE_* in .env
# then backend/migrate_v2.sql and backend/schema.sql in the Supabase SQL editor
python search.py --bootstrap-r2        # on every machine
```

`--export-supabase` saves `channel_archive`, `keywords` and `channel_keywords`
to `data/migration/*.jsonl` (a few MB). `--bootstrap-r2` imports those if
present, applies what other machines already put in the catalog, uploads an
object for every local channel whose videos are here, and announces
everything this machine holds. A channel stamped as read whose videos are
not here (the old shared table carried the stamp) waits for the machine that
has them rather than going into the bucket as an empty object. Re-runnable.

Every other mode of `search.py` that touches the bucket — a search, `--pull-only`,
`--push-only`, the catch-up, an archive — runs the same bootstrap first, once,
on a store that was never bootstrapped (`sync_state.__r2_bootstrapped`). That
is how an installed build's first launch joins the bucket without anybody
typing a command, and why a share can never run ahead of it: a `--push-only`
from a never-bootstrapped store would upload an object for every channel the
old shared table merely stamped, videos or not. The app launches the pipeline
from several places at once on a first start; a second lock file
(`gratovo.db.bootstrap-lock`) makes the others wait for the one that got there
first, then find it done. The wait is reported as it goes — `[step]` and
`[sync-io] shared|pulled|catalog=K of=N` lines the app turns into a progress
line — because on a store with thousands of channels it is minutes.
See `backend/SETUP.md` for the whole sequence.

Only one process announces to the catalog at a time per store: a lock file
next to `gratovo.db` (`gratovo.db.share-lock`) makes a second sharer wait for
the first, then find nothing left to say.

## Configuration

| File | What | Committed? |
|---|---|---|
| `data/.env` | YouTube key, R2 keys, your name | Yes — see below |
| `data/.env.local` | the outreach mailbox's OAuth token | **No** — gitignored |
| `data/settings.json` | shared pacing and threshold tunables | Yes |
| `data/settings.local.json` | your personal override of the above | No |
| `data/run_config.json` | written by the app's Start button, one run | No |

Later sources win, and `data/.env.local` is last — which is why the
mailbox's refresh token goes there. Copy `data/.env.example` to `data/.env`
to begin.

> `data/.env` is currently **tracked** in git, despite what this table used
> to claim. Anything genuinely secret belongs in `data/.env.local` until
> that is fixed (`git rm --cached data/.env`, then rotate the keys that
> have already been committed).

The `SUPABASE_*` values are only read by the one-time `--export-supabase`
step; leave them blank otherwise.

## Notes on quota

Discovery costs **no** YouTube API quota — `discover_handles` and
`get_recent_video_ids` scrape HTML through the vendored `scrapetube`. Only
channel and video *metadata* spends quota, and both batch 50 ids per call, so
hundreds of keywords stays cheap. The daily search limit that does bite is
YouTube's own, not the API's.

## Why this replaced `OLD/old repo code/`

The previous layout was a flat folder of scripts that imported each other by
bare name and built file paths by concatenating `"\\.env"` onto a directory.
That meant it ran only on Windows, only when launched from one specific
directory, and could not be imported from anywhere else — including by its own
tools. Configuration was assembled at import time from a dozen module-level
globals, so importing the module *was* configuring it, and nothing could be
tested without a full environment.

Now: a real package, paths resolved from the file's own location outwards,
configuration in one injectable object, and imports of the heavy YouTube
libraries deferred until a search actually starts — which is why `--status` and
`--push-only` work on a machine with nothing but Python installed.
