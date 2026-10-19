# Setting up the servers

The app is **local-first**: every machine keeps everything in one SQLite file
(`data/database/gratovo.db`) and reads and writes only that. Two servers exist
so the team can share, and neither is required for the app to work:

| | Holds | Who talks to it |
|---|---|---|
| **Cloudflare R2** (object storage) | Everything the pipeline *scrapes*: one compressed object per channel (details + videos) and an append-only catalog log of what was found, which keyword found it, and what was archived | Only the Python pipeline, with keys in `data/.env`. The app triggers it. |
| **Supabase** (Postgres) | Only what a person *typed in*: channel notes/tags/stage/contacts, deals, brands, outreach, templates, reminders, writing rules, the activity log, the scratchpad, accounts | Only the Flutter app, signed in as a person |

Nothing derived is stored on either — rollups, counts, dashboard numbers and
"what a video is worth" are computed on each machine from the local file.

**Total time: about 30 minutes.**

---

## 1. Cloudflare R2 — 10 min

1. Cloudflare dashboard → **R2 Object Storage → Create bucket**. Name it
   `gratovo`. Leave it **private**.
2. **Manage R2 API Tokens → Create API token**. Permissions: *Object Read &
   Write*, scoped to that bucket. Copy the Access Key ID, the Secret Access Key
   and your Account ID.
3. In `data/.env` on every machine that runs the pipeline:

   ```
   R2_ACCOUNT_ID=…
   R2_ACCESS_KEY_ID=…
   R2_SECRET_ACCESS_KEY=…
   R2_BUCKET=gratovo
   ```

   Without these the pipeline still runs; it just says "sync unavailable" and
   keeps everything local until they appear.

> **The free tier**: 10 GB stored, 1M writes and 10M reads a month, and egress
> is free. A channel object is a few KB, so a million channels is roughly
> 5 GB. Layout and the object formats are in `pipeline/README.md`.

## 2. Supabase — 10 min

[supabase.com](https://supabase.com) → **New project**.

| | |
|---|---|
| Name | `gratovo` |
| Database password | click Generate and **save it somewhere safe** |
| Region | **Frankfurt (eu-central-1)**, the closest free region to Egypt |

Then **Database → Extensions → `pg_cron` → enable** (optional: it runs the one
nightly job, the tombstone purge).

**SQL Editor → New query → paste all of [`schema.sql`](schema.sql) → Run.**
That is the whole database. It is safe to re-run at any time.

> **Coming from the previous version** (a project that has `channels`,
> `videos`, `keywords`, `runs` tables)? Run [`migrate_v2.sql`](migrate_v2.sql)
> **once, before** `schema.sql`. See *Migrating from the live-first version*
> below — the order matters, and there is a step to do on each machine first.

> **The free tier**: 500 MB database, 5 GB egress, 2M realtime messages a
> month. This shape uses a small fraction of each: the database holds only
> typed-in data (tens of MB for years), each machine pulls only deltas, and
> realtime carries only the scratchpad plus one short message per human
> action.

### Keys

**Project Settings → API.**

| Value | Where it goes |
|---|---|
| **Project URL** | the Flutter app (compiled in, overridable in Settings → Account → Advanced) |
| **anon / public key** | the Flutter app. On its own it grants nothing — access is decided by who is signed in |
| **service_role key** | **only** `data/.env` on your PC (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), and only for the one-time `--export-supabase` step below. Never in the app, never in git |

### Accounts

**Authentication → Users → Add user → Create new user**, tick **Auto Confirm
User**. There is no sign-up in the app by design.

Every new account starts as `unauthorized` and can read nothing. To grant
access, in the SQL Editor:

```sql
select p.id, p.display_name, u.email, p.role
from profiles p join auth.users u on u.id = p.id;

update profiles set role = 'full'  where id = 'paste-the-uuid-here';
update profiles set role = 'basic' where id = 'paste-the-uuid-here';
```

| | |
|---|---|
| `full` | everything |
| `basic` | everything, but the app hides the **Outreach page**. The data still syncs to that machine (so counts like "sent today" work); this is a UI convenience, not a data boundary |
| `unauthorized` | nothing |

## 3. Build and run

```
cd pipeline && pip install -r requirements.txt
flutter pub get
flutter run -d windows
```

On first launch the app asks the pipeline to pull the R2 catalog and every
channel object it does not have yet, then pulls the (small) Supabase tables.
From then on: a 3-hour background tick plus a catch-up whenever a teammate's
Broadcast says something changed.

---

## How the app stays fast and offline-safe

- **Every read is local.** The influencer list, a profile, the dashboard, the
  logs, news — all SQLite on this machine. No screen waits on a network.
- **Every write is local first.** An edit lands in the local file immediately
  and goes into an outbox; the sync engine uploads it when it can. Channel
  edits go through a compare-and-set (`apply_channel_edit`), so an edit made
  offline that lands on a value someone else changed meanwhile becomes a
  conflict for a person to settle rather than an overwrite.
- **Pulls are deltas.** Every copied table has `updated_at` and a tombstone on
  delete, so a machine asks "what changed since my cursor" and gets a few rows.
- **Scraped data never touches Supabase.** After each keyword the pipeline
  uploads one object per finished channel to R2 and appends one immutable
  segment to the catalog log — under its own machine name, so two machines
  never write the same key. Other machines list the log, apply the segments
  they have not seen, and download the objects they are missing. Egress is
  free, so this costs nothing at any scale.
- **Live signals are tiny.** Presence (who is editing what, who is searching)
  is in-memory and event-driven. `scratchpads` is pushed from the database.
  Everything else is one Broadcast message per human action after the upload
  succeeds — a bulk tag of 500 channels is one message, not 500 per client.

## Migrating from the live-first version

The bulk data already sits in each machine's `gratovo.db` (Supabase was pushed
*from* those files), so nothing large ever comes back down. In order:

0. **Measure**, so you can see the space come back:
   ```sql
   select relname, pg_size_pretty(pg_total_relation_size(oid))
     from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace
    order by pg_total_relation_size(oid) desc;
   ```
1. **Freeze.** Stop all searches; make sure every machine's last `search.py`
   run finished.
2. **Export the small things** (one machine, service key in `data/.env`):
   ```
   cd pipeline
   python search.py --export-supabase
   ```
   Writes `data/migration/channel_archive.jsonl`, `keywords.jsonl`,
   `channel_keywords.jsonl`. A few MB.
3. **Convert the database**: SQL Editor → paste all of `migrate_v2.sql` → Run.
   Then paste all of `schema.sql` → Run. Re-run the size query from step 0.
4. **Bootstrap R2 from the machine that ran step 2:**
   ```
   python search.py --bootstrap-r2
   ```
   Applies what is already in the catalog (nothing, the first time), then
   uploads an object for every local channel whose videos are actually
   here, and announces the rest: this machine's channels and keywords and
   the exported archive. It also reports the channels it had a video-pass
   stamp for without holding a single video — the old shared `channels`
   table carried the stamp, the videos stayed on whichever machine read
   them — and puts those back in the backlog; the machine that has the
   videos uploads them when its turn comes. Re-runnable.
5. **Build and install the new build** everywhere
   (`scripts\build_windows.ps1`). The build carries the R2 keys from this
   machine's `data\.env` (service key and worker name blanked), and the app
   adds them to each install's own `.env` on launch. The first background
   pipeline run on each machine — the background pull, or the first
   search if that comes sooner — then bootstraps it exactly as step 4 did
   here; nobody types anything, and every sync after that is a plain pull.
   On a store with thousands of channels this first sync takes minutes and
   shows its progress on the search page ("Downloading the team's channels
   (400 of 19,000)…"). Install one machine at a time and let it finish
   before the next.

## Running the SQL tests

```
cd backend/tests
./run.sh
```

Needs Docker and nothing else. Applies `schema.sql` twice on a fresh database,
then builds a database on the *previous* schema, seeds it, runs
`migrate_v2.sql` and `schema.sql`, and runs every test on both. See
[`tests/README.md`](tests/README.md).

## If something goes wrong

**"permission denied for table X"** — your account is still `unauthorized`.
Run the promote query above.

**The app shows "sync unavailable"** — `data/.env` has no `R2_*` values on
this machine, or Supabase is unreachable. The app keeps working on the local
file; sync resumes when the cause clears.

**Project paused** (7 days of no activity on the free tier) — the dashboard
shows a Restore button. Data is intact, and the app did not notice.
