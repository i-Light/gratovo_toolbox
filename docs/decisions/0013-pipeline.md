# 0013. The Python pipeline

- **Date:** 2026-10-21
- **Status:** accepted for step 3e-1 (search on this computer). Step 3e-3 (the rest of the old pipeline) builds on it. Step 3e-2 (sharing through R2) moved to the team phase, step T, on 2026-10-21 (owner: solo first); its design here still stands. It records the pipeline decisions of the plan (`.router/PLAN.md`, D1 to D12), with the changes the build made, and the owner's answer of 2026-10-21 that proxies, AWS gateway rotation and parallel search stay.

## Context

The old app ran its scraper as `python -u search.py` and read plain-text lines from it. It read its secrets from a `.env` file in the repository's `data/` folder, and its settings from several JSON files. The old pipeline (`legacy/pipeline/`) is about 35,000 lines of Python, with tests for each part.

Step 3e ports that code into `services/pipeline/`, and the new app runs it as a child process. Three things had to change. The secrets could no longer come from a file. The messages had to follow one schema that both TypeScript and Python check. The network had to be limited to the hosts a search needs, because Python makes its own requests and main's allowlist (ADR 0011) can't see them.

Step 3e-1 covers the search: discovery, the channel and video reads, the auto-clean gate, the store, progress, results, stop and resume.

## Decision

1. **One process per job.** Main starts `<python> -I -u -m gratovo_pipeline` in `services/pipeline`, with the repository's `.venv` in development. The environment is bare: only `SystemRoot`, `PATH`, `TEMP` and `TMP`, nothing from the user's shell. `-I` ignores every `PYTHON*` variable, so the entry point sets UTF-8 for its streams itself. The plan listed `PYTHONUTF8` and `PYTHONIOENCODING` as well; they were dropped for that reason. The packaged runtime comes in step 3h, so until then a packaged app has no Python, and a search reports `no_python`.
   *Why:* a child that inherits the user's environment can pick up a key, a proxy or another Python. Fixed arguments and a bare environment leave nothing to pick up. One process per job keeps a crash in one search away from the app.
2. **One search at a time,** as the old app ran them.
3. **The protocol, version 1.** Main sends `start` and `stop` on stdin. A line from the pipeline is at most 64 KiB; the start line may be up to 1 MiB, as 500 keywords and the secret URLs can pass 64 KiB. The pipeline sends `ready`, `run`, `keyword`, `channel`, `log` and `end` on stdout, one JSON object per line. The zod schemas in `apps/desktop/src/main/pipeline/protocol.ts` are the source. `services/pipeline/src/gratovo_pipeline/protocol.schema.json` is written from them, and a Vitest snapshot fails when the committed file is out of date. Python's protocol module mirrors the schema, and a pytest test checks every message the tests capture against the same file.
   Main checks every line it reads. A line that isn't JSON or fails the schema is logged (its first 200 characters) and ignored. Three bad lines in a row end the job as `failed` (`protocol`).
   `end` is always the last line. The exit code is 0 after an `end`. Any other exit is a `crash`.
   *Why:* the page and the pipeline must agree on every field, and a bad line must not be trusted just because it arrived.
4. **Secrets only in the start message.** The YouTube key, the proxy URLs and the gateway URLs go in `start.secrets`, and nowhere else: not in argv, not in the environment, not in a file. The key comes from `account.teamKeys.youtubeKey()` (ADR 0011 §11). The proxies and gateways are kept in the secret store as `pipeline.proxies` and `pipeline.gateways` (JSON lists). Their editor is step 9, so until then they are empty unless a test sets them.
   The Data API key goes in the `X-Goog-Api-Key` header, never in a URL. The opener follows no redirects and ignores proxy settings.
   Before a log line reaches the page or a file, main blanks the job's secrets out of it: the key, each proxy and gateway URL, the URL without its scheme, and any login in it. The pipeline keeps the same rule. Its logs give a status and a path, or an error's kind, never a URL. A gateway's refusal is logged by status and path only, and a library error by kind only.
   *Why:* logs are read by people and kept on disk. A URL can carry a login, and a header doesn't end up in a log the way a URL does.
5. **The pipeline's own network rule.** Main's allowlist (ADR 0011 §3) doesn't see Python's requests, so `net.check_url` checks each one first. It allows only:
   - HTTPS;
   - `www.youtube.com` and `youtube.com`;
   - `www.googleapis.com` and `youtube.googleapis.com`;
   - AWS gateway hosts, `<id>.execute-api.<region>.amazonaws.com`;
   - the configured proxies.

   A URL with a login in it is refused. The error names the host, never the URL. Every scrape attempt and every API call goes through the check. The tests fake every transport, and a socket guard in `conftest.py` fails any test that reaches the network.
   *Why:* a bug, or a page the pipeline reads, can't turn the pipeline into a general HTTP client.
6. **`pipeline.db` is owned by Python.** It holds the scraped tables, the search runs, and the sync columns that sharing through R2 needs (step T1, formerly 3e-2), so it needs no migration. Its schema is version 1, kept in `PRAGMA user_version`. A file from a newer version is refused, and the job ends as `crash`. It uses WAL with a busy timeout. Python is the only writer. Main opens it read-only to show results.
   Example data and live data live in separate folders: `<userData>/example-pipeline/` and `<userData>/pipeline/`. They never mix.
   The file is per machine and is kept on sign-out, because team data isn't one account's.
   *Why:* one writer keeps the file simple. Separate folders keep demo channels out of the real list.
7. **The Data API over the standard library.** The YouTube Data API is called with `urllib.request`, for two calls only: `channels.list` and `videos.list`, 50 IDs a call. The Google client library is not used. It would be the largest dependency in the project for two calls. curl_cffi stays, for the scraper's TLS impersonation, which is why the scraper is vendored.
   Failures map to codes. Quota problems end the run as `quota`. A refused key (invalid, expired, restricted, or the API off) ends it as `no_youtube_key`. Server errors, rate limits and network errors are retried twice, then end as `network`, or as `quota` for rate limits. Any other refusal fails only that batch.
   *Why:* fewer packages to pin, package and type. The plan named `blocked` for a refused key. It was changed to `no_youtube_key`, because `blocked` stays with the scraper's own refusals, and the owner needs to be told which key to fix.
8. **Stop.** `{"type":"stop"}` on stdin sets the run's stop flag. The waits are cut at once. The run keeps what it has read: it saves, stamps and announces it. The keyword in progress is not marked done, so a resume repeats it cheaply. Stop with nothing running does nothing.
   Main asks for a stop and kills the job 30 s later if it hasn't ended. On app quit it asks, closes stdin and kills after 5 s. Closing stdin also stops the run.
   *Why:* a person who presses Stop expects it to stop, and must not lose what was already found.
9. **Resume.** Each keyword is saved as it ends. The job's `end.at` is the first keyword that isn't done, and a resume starts there.
10. **Failures by code.** A failed run ends with one of these codes: `blocked`, `quota`, `network`, `no_youtube_key` or `crash`. Its `end` may also name `bad_start`, when the start line fails its check. The keyword the failure happened in is marked `failed` before the end is sent. Keywords a stop cut short are not marked. Anything unexpected is `crash`. It names the error's kind only, and the traceback on stderr has frames but no message. Python's message text is never shown to the person. The page maps codes to its own words.
11. **Logs.** Each job's stderr and log events go to `<userData>/logs/pipeline-<stamp>.log`, newest 40 kept. Each line is blanked of the job's secrets (decision 4). A test checks that a fake key never shows up in a log line or an event.
12. **Defaults are the owner's.** `config.py` holds the owner's committed settings from `legacy/data/settings.json` and `run_config.json`: pacing, the auto-clean rule (50,000 to 2,000,000 subscribers), 200 channels a keyword, the countries AU, CA, GB, IE, NZ and US, and sort by upload date. The app sends the rules it knows and the settings it can change, and everything else stays at the default. The pipeline reads no file for its configuration. The old `.env`, `settings.json`, `run_config.json` and `keywords.json` are not read.
13. **The example source.** `source: "example"` replaces discovery and the channel and video reads with an offline fixture: 30 made-up AI creators over six AI keywords, with realistic subscriber counts, so auto-clean keeps, sweeps and delays some of them. It writes to the example `pipeline.db`. It pauses 0.15 s per channel read, so a person or the end-to-end test can press Stop during a run. The plan had asked for no delays. Tests set the pause to zero. Every example name is about AI.
14. **The queue and the rules live in `find.json`,** beside `pipeline.db` in the same data folder, and not in `local_settings`. The data source has no settings API, so main had no way to write `local_settings` through it. Main writes `find.json` atomically, and each data folder keeps its own queue. This changes the plan's D12, which put them in `local_settings`. Per-keyword found and kept counts are saved into the queue entry as each keyword ends.
15. **The results.** Main reads the kept channels from `pipeline.db`, newest first, up to 100, keeping only those the run's rules keep (in the countries, not in a band auto-clean acts on), since the backlog also reads channels the rules held back. The frame's creator list is unchanged in 3e-1. Found channels join it in step 5, and names arrive with 3e-2's pull.
16. **What waits.** Step T1 (R2 sharing, formerly 3e-2) has the pipeline ask main for signed links, and main asks `r2-access` with the member's token (the outline in `.router/PLAN.md`). Step 3e-3 ports the rest of the old pipeline: the comms engine, the Gemini bridge, Gmail and the mailbox, news, and the tools still called. Each gets its own decision record when it lands. On hold, and not built (owner rules): `search-1`, `first-1`, `mail-1` and `mail-2`. The search still fetches only the latest 15 videos per channel.

## Alternatives considered

- **Secrets in environment variables or a file:** a child inherits the environment, and a file is one more copy on disk. The start message is read once and kept in memory.
- **`google-api-python-client`:** the old dependency. It brings a large tree for two calls.
- **`local_settings` for the queue:** the data source has no settings API. See decision 14.
- **Main's allowlist for the pipeline's requests too:** main can't see Python's requests, so the pipeline checks its own.
- **No pause on example data:** the run would finish before a person or a test could press Stop.

## Consequences

- A search runs only on a computer with Python 3.14 and the repository's `.venv` (from `uv sync`). A packaged build has no Python until step 3h.
- Proxy and gateway URLs can't be set from the app until step 9. Until then, routing is direct.
- Parallel search is on only when its setting is on, and it is off by default, as in the old app.
- A change to the protocol means changing `protocol.ts`, the schema file and the Python mirror together. The tests fail until all three match.
