# Pipeline

The Python side of the app: YouTube search and enrichment, R2 storage, Gmail and the comms engine. The desktop app runs it as a child process and talks to it in JSON lines on stdin and stdout.

Step 3a set up the project. Step 3e ports the code from `legacy/pipeline/` (see the [migration plan](../../docs/migration-plan.md#step-3-foundation)). Step 3e-1 has the search: the decisions are in [ADR 0013](../../docs/decisions/0013-pipeline.md).

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
| `net.py` | The host rule: `check_url` allows HTTPS to YouTube, Google's API, AWS gateway hosts and the configured proxies. |
| `youtube.py` | The YouTube Data API (`channels.list`, `videos.list`) over `urllib`. |
| `scrapetube/` | The vendored scraper (curl_cffi) and the proxy pool (direct, proxies, gateways). |
| `search/` | One keyword: `discover`, `keyword`, `auto_clean`, `uploads`, `backfill`, `pacing`, `signals`, `context`, plus `found_emails`. |
| `jobs/search.py` | The search run: the keyword loop, stop, resume and `end`. |
| `example/` | The offline example source (`channels.json`, 30 made-up AI creators). |

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

## Rules

- `src/` layout; pyright in strict mode; pytest with no network.
- Never read `.env` files. Configuration and secrets arrive from the app at launch, on stdin, never in argv, the environment or a file.
- Every request goes through `net.check_url`.
