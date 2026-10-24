# Pipeline

The Python side of the app: YouTube search and enrichment, R2 storage, Gmail and the comms engine. The desktop app runs it as a child process and talks to it in JSON lines on stdin and stdout.

Step 3a set up the project. Step 3e ports the code from `legacy/pipeline/` (see the [migration plan](../../docs/migration-plan.md#step-3-foundation)). Step 3e-1 has the search: the decisions are in [ADR 0013](../../docs/decisions/0013-pipeline.md). Step 3e-3 added the Gemini bridge and the comms engine ([ADR 0014](../../docs/decisions/0014-gemini-bridge-and-comms.md)), and step 3e-3b the mail and the other jobs, in two lanes ([ADR 0015](../../docs/decisions/0015-pipeline-mail-and-jobs.md)).

## Layout

All code is in `src/gratovo_pipeline/`.

| Module | What it holds |
|---|---|
| `__main__.py` | The entry point: UTF-8 streams, `ready`, the start line, the job. |
| `protocol.py` and `protocol.schema.json` | The JSON-lines messages. The schema file is written from main's zod schemas. |
| `config.py` | The defaults (the owner's settings) and the configuration built from the start line. |
| `run_control.py` | The stop flag, set by a reader thread on stdin. |
| `parallel.py` | Parallel keyword runs (off by default, as in the old app). |
| `store.py` | `pipeline.db`: the schema (version 1), the search tables and their functions. |
| `net.py` | The host rule: `check_url` allows HTTPS to YouTube, Google's API, AWS gateway hosts and the configured proxies. `allow_job_hosts(kind)` adds the hosts a job needs (ADR 0015). |
| `youtube.py` | The YouTube Data API (`channels.list`, `videos.list`) over `urllib`. |
| `scrapetube/` | The vendored scraper (curl_cffi) and the proxy pool (direct, proxies, gateways). |
| `search/` | One keyword: `discover`, `keyword`, `auto_clean`, `uploads`, `backfill`, `pacing`, `signals`, `context`, plus `found_emails`. |
| `jobs/search.py` | The search run: the keyword loop, stop, resume and `end`. |
| `jobs/mail.py` | The mail jobs on the quick lane: `mail.status`, `mail.send`, `mail.replies`, `mail.ack` and `mail.cancel`. |
| `jobs/video_stats.py` | The video stats job: one video's view count. |
| `jobs/refetch.py` | The refetch job: a list of handles, read again and swept (the old manual refetch). |
| `jobs/backfill.py` | The backfill job: channels, videos, the backfill and `backlog` (the catch-up). |
| `jobs/import_legacy.py` | The `import.legacy` job (store lane): copies the old app's `gratovo.db` into `pipeline.db`, read-only on the old file, with a dry run and a backup (ADR 0016). |
| `jobs/gateways.py` | The gateways jobs: `gateways.deploy`, `gateways.destroy` and `gateways.test` on API Gateway v2. |
| `mail/` | Gmail over `urllib` (`gmail.py`) and `mailbox.db` (`mailbox.py`), the same tables as the old file. |
| `aws_sign.py` | AWS Signature Version 4 for the gateway calls. No boto3. |
| `example/` | The offline example source (`channels.json`, 30 made-up AI creators). |
| `gemini/` | The Gemini bridge (`python -m gratovo_pipeline.gemini`): one long-lived process on 127.0.0.1, with `daemon.py`, `server.py`, `client.py`, `actions.py` (keywords, classification, gems, skills, comms), `errors.py`, `browser/` (Firefox detect, profile, session, window guard). |
| `comms/` | The comms engine (playbook, checks, `engine.py`, `course.py`, `moments.py`), used by the app, plus the tools a person runs by hand (`coach`, `gradbar`, `pairwise`, `scenarios`, `mine_calls`, `pool`, `skill_build`, `verify`, `quote_review`, `video_check`). |
| `transcript.py` | Subtitles through yt-dlp, run as a module of this Python, on a checked video id only (ADR 0014). |
| `paths.py` | The one module that knows where `data/` and the course folders are. |
| `data/` | The comms playbook and skill (`data/comms/`) and the Gemini prompts (`data/gemini-skills/`). |

`tests/` mirrors these, with a socket guard in `conftest.py` that fails any test that reaches the network.

## Commands

Run them here, or use the root scripts (`pnpm lint`, `pnpm typecheck`, `pnpm test`), which include them.

| What | Command |
|---|---|
| Tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format | `uv run ruff format .` |
| Types | `uv run pyright` |

`uv` installs Python 3.14 and the tools on first run, at the versions in `uv.lock`.

## Run a search by hand (example data)

Send one start line on stdin. Keep stdin open: closing it stops the run. In PowerShell, from this folder:

```
echo '{"type":"start","protocol":1,"source":"example","dataDir":"C:\\Temp\\pipeline-example","worker":"example","job":{"kind":"search","keywords":["AI video tools"],"startAt":0,"rules":{"countries":[],"perKeyword":20,"sortBy":"upload_date","resultsType":"video","autoClean":{"enabled":false,"minSubscribers":50000,"maxSubscribers":2000000,"belowMin":"sweep","aboveMax":"delay","label":"inactive"}}},"settings":{},"secrets":{"youtubeKey":null,"proxyUrls":[],"gatewayUrls":[]}}' | .venv\Scripts\python.exe -I -u -m gratovo_pipeline
```

It prints `ready`, then `run`, `keyword`, `channel` and `log` lines, and ends with one `end` line and exit code 0. `dataDir` must be an absolute path; the run writes only `pipeline.db` there. The example source has no network and no key. Use a folder you can delete afterwards.

## Run the bridge by hand

The bridge is one long-lived process. Run it with a free port and temporary folders, so it can't touch the app's profile:

```
uv run python -I -u -m gratovo_pipeline.gemini --port <free port> --profile-dir <tmp> --extension-dir <tmp>
```

It prints a `listening` event. Then type one request line and press Enter:

```
{"id":"1","method":"bridge.status","params":{}}
```

Only one bridge may run at a time. Never start a second one, and never use port 8765 while the app may be running its bridge. Stop it by closing stdin (Ctrl+Z, Enter in PowerShell) or with `bridge.shutdown`. There is no extension yet (step 6), so `bridge.browser_info` reports the add-on as missing.

## Run the comms tools by hand

The comms tools measure and tune the drafting work. They are not called from the app. They need the owner's course, which is not in the repository. Give its folder with `--course-dir` (and `--video-dir` for the videos), or set `GRATOVO_COURSE_DIR` and `GRATOVO_VIDEO_DIR`. Without the course, a tool stops with one line that names the flag and the variable. For example:

```
uv run python -m gratovo_pipeline.comms.verify --course-dir <folder>
```

Decisions: [ADR 0014](../../docs/decisions/0014-gemini-bridge-and-comms.md).

## Rules

- `src/` layout; pyright in strict mode; pytest with no network.
- Never read `.env` files. Configuration and secrets arrive from the app at launch, on stdin, never in argv, the environment or a file.
- Every request goes through `net.check_url`.
- Search rules (ADR 0016): `rules.minMedianViews` and `rules.minUploads30` archive a kept channel below either bound, with the auto-clean label, after its videos are read. On a bound is kept; no videos counts as 0 only after a successful fetch.
