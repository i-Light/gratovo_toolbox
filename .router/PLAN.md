# Plan: step 3e, the Python pipeline (three pull requests)

Read `.router/CONTEXT.md` first. Bash commands start with `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";`. **Never read `.env*`, `*.local.json` or `aws_gateways.json`**, and never read, print or handle a key value. Nothing here touches production Supabase.

**Owner's answers (2026-10-21).** Three pull requests: **3e-1** search end to end on this computer; **3e-2** sharing results through R2 with the signed links (moved to step T1 on 2026-10-21: solo first); **3e-3** the rest ported with their tests (comms engine and course data, Gemini bridge, Gmail and mailbox, the tools still called). **Proxies, AWS gateway rotation and parallel search stay** (the AWS keys, when the gateway tool needs them in 3e-3, go in the app's secret store).

## Acceptance (the plan's, for the whole step)

1. All ported pytest suites pass (each PR ports its share, §3 of CONTEXT).
2. The app starts a search, streams progress and shows results: on example data in the Electron tests, and on live data by hand (the owner, signed in, with the YouTube key from Vault).
3. Config reaches the pipeline at launch; secrets arrive on stdin, never in argv, env or files. No `.env` reading.
4. The stdin/stdout JSON-lines messages are one schema shared with TypeScript.
5. Lint, typecheck (pyright strict), unit, e2e and CI green; the comms course data is in `services/pipeline/data/` (3e-3).

**3e-1 acceptance:** 1 for its tests; 2 (start, stream, results, stop and resume); 3 and 4; lint/typecheck/test/e2e green; Find › Search looked at in dark at 1440 px.

## Decisions (3e-1)

- **D1. Layout.** `services/pipeline/src/gratovo_pipeline/`: `__main__.py` (entry, `python -I -u -m gratovo_pipeline`), `protocol.py` (TypedDicts mirroring the schema, `Emitter`, `read_start`), `protocol.schema.json` (generated, committed), `config.py`, `run_control.py`, `parallel.py`, `store.py`, `net.py` (host allowlist), `youtube.py`, `scrapetube/` (vendored, with `proxy_pool.py`), `search/` (`discover.py`, `keyword.py`, `auto_clean.py`, `signals.py`, `backfill.py`), `jobs/search.py` (the run loop from `search.py`), `example/` (offline source and its fixture). Ported tests in `services/pipeline/tests/`, one file per old file where it still makes sense, typed.
- **D2. One process per job.** Main spawns `<python> -I -u -m gratovo_pipeline` with cwd `services/pipeline` in dev (`.venv/Scripts/python.exe`, made by `uv sync`; the packaged runtime is 3h). Env is minimal (`SystemRoot`, `PATH`, `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `TEMP`/`TMP`): no secrets and nothing from the user's shell beyond those. One search at a time (as the old app).
- **D3. The scraped store is `pipeline.db`,** owned by Python (the legacy scraped tables, minus news until 3e-3; the sync columns kept so 3e-2 needs no migration; `PRAGMA user_version` migrations; WAL with a busy timeout). It lives in `<userData>/pipeline/` for live and `<userData>/example-pipeline/` for example data, so they never mix. Main opens it **read-only** to show results. It is per machine and kept on sign-out (team data, not one account's). The frame's creator list is unchanged in 3e-1: found channels join it with step 5's search (and names arrive with 3e-2's pull).
- **D4. The protocol** (version 1). Zod schemas in `apps/desktop/src/main/pipeline/protocol.ts` are the source. `pnpm --filter @gratovo/desktop pipeline:schema` writes `services/pipeline/src/gratovo_pipeline/protocol.schema.json` with `z.toJSONSchema`; a Vitest test fails when the committed file differs. Python's TypedDicts mirror it, and a pytest test validates every message the tests capture against the file (`jsonschema` as a dev dependency). Main validates every line it reads; a line that isn't valid JSON or fails the schema is logged (first 200 characters) and ignored, and three in a row end the job as `failed` (`protocol`).
- **D5. Secrets.** The YouTube key (from `account.teamKeys.youtubeKey()`), proxy URLs and gateway URLs go only in the `start` message's `secrets`. The proxies and gateways live in the secret store under `pipeline.proxies` and `pipeline.gateways` (JSON lists); the Settings section to edit them is step 9, so until then they are empty unless set by a test. The Data API key goes in the `X-Goog-Api-Key` header, never a URL, so no URL can leak it into a log.
- **D6. The pipeline's own network rule.** Python makes its own requests (main's allowlist can't see them), so `net.py` refuses any host but `www.youtube.com`, `youtube.com`, `www.googleapis.com`, `youtube.googleapis.com`, `*.execute-api.<region>.amazonaws.com` and the configured proxies. Tests run with every transport faked: a test that reaches the network fails (a socket guard in `conftest.py`).
- **D7. YouTube Data API over the standard library** (`urllib.request`, two calls: `channels.list`, `videos.list`) instead of google-api-python-client. Fewer dependencies to package and type. curl_cffi stays for scrapetube (the TLS impersonation is why it's vendored).
- **D8. Example source.** `source: "example"` swaps discovery, channel and video fetches for an offline fixture of AI creators (`example/channels.json`, about 30 channels across 6 AI keywords, with realistic subscriber counts so auto-clean keeps, sweeps and delays some), no delays, and stores into the example `pipeline.db`. The Electron tests run the real Python process on it.
- **D9. Stop.** `{"type":"stop"}` on stdin sets `run_control`'s stop flag ("pausing finishes the keyword in progress first"). If the process hasn't ended 30 s after a stop, or 5 s after app quit, main kills it. Everything is committed per keyword, so resume starts at the first unfinished keyword.
- **D10. Logs.** stderr and the run's log events go to `<userData>/logs/pipeline-<stamp>.log`, newest 40 kept. Log text never contains a secret (a test checks that a fake key never appears in a log line or event).
- **D11. Defaults** are the owner's committed `legacy/data/settings.json` and `run_config.json` (CONTEXT §2), held in Python's `config.py`. The app sends only `rules` (from Find) and `settings` overrides it knows.
- **D12. What the queue and rules live in.** Main keeps the keyword queue and the rules in `local_settings` (`find.queue`, `find.rules`) of the active data source, so example and live each have their own. Per-keyword found/kept counts are saved into the queue entry as each keyword ends.

## Contracts

### stdin (main → pipeline), one JSON object per line

```ts
type Start = {
  type: "start"; protocol: 1;
  source: "live" | "example";
  dataDir: string;            // absolute; pipeline.db and nothing else
  worker: string;             // the user id, or "example"
  job: {
    kind: "search";
    keywords: string[];       // 1..500, each 1..200 chars, trimmed, unique (case-insensitive)
    startAt: number;          // index into keywords
    rules: {
      countries: string[];    // ISO 3166 alpha-2, may be empty (no filter)
      perKeyword: number;     // 1..1000 (old handle_limit)
      sortBy: "relevance" | "upload_date" | "view_count" | "rating";
      resultsType: "video" | "channel";
      autoClean: { enabled: boolean; minSubscribers: number; maxSubscribers: number;
                   belowMin: "sweep" | "delay" | "off"; aboveMax: "sweep" | "delay" | "off"; label: string };
    };
  };
  settings: { pacing?: "normal" | "fast"; parallel?: { enabled: boolean; maxWorkers: number };
              proxies?: { enabled: boolean; includeDirect: boolean } };
  secrets: { youtubeKey: string | null; proxyUrls: string[]; gatewayUrls: string[] };
};
type Stop = { type: "stop" };
```

(The old `auto_clean` actions, `config.py:541`: `sweep` archives at once with no videos, `delay` keeps the channel and decides after its videos, `off` leaves it alone.)

### stdout (pipeline → main), one JSON object per line

```ts
type Ready   = { type: "ready"; protocol: 1; version: string };
type Run     = { type: "run"; state: "running"; total: number; startAt: number };
type Keyword = { type: "keyword"; index: number; total: number; keyword: string;
                 state: "started" | "done" | "failed"; found?: number; kept?: number; error?: string };
type Channel = { type: "channel"; keyword: string; channelId: string; handle: string | null; name: string;
                 subscribers: number | null; medianViews: number | null; country: string | null;
                 outcome: "kept" | "swept" | "delayed" };
type Log     = { type: "log"; level: "info" | "warn" | "error"; text: string };   // text ≤ 500 chars
type End     = { type: "end"; state: "done" | "stopped" | "failed"; at: number; found: number; kept: number;
                 error?: { code: "bad_start" | "no_youtube_key" | "blocked" | "quota" | "network" | "crash";
                           message: string } };
```

`end` is always the last line; the exit code is 0 after an `end`, else main treats the job as `failed` (`crash`).

### IPC (renderer ↔ main), in `packages/ipc/src/find.ts`

- `find:state` → `FindState`; `find:add {keywords: string[]}` → `{added, skipped}`; `find:remove {index}`; `find:start-at {index}`; `find:start` → `{ok: true} | {ok: false, problem: "no_keywords" | "running" | "no_youtube_key" | "no_python"}`; `find:stop`.
- Event `find:changed` (payload `FindState`), at most 4 a second.

```ts
type FindState = {
  queue: { keyword: string; state: "queued" | "running" | "done" | "failed"; found: number; kept: number }[];
  at: number;                 // next keyword to run
  rules: Rules;               // as Start.job.rules
  run: { state: "ready" | "running" | "stopping" | "paused" | "done" | "failed";
         found: number; kept: number; swept: number; error: string | null };
  log: { at: number; text: string }[];          // newest 200
  kept: { channelId: string; name: string; handle: string | null; subscribers: number | null;
          medianViews: number | null; country: string | null; keyword: string }[];  // newest 100, from pipeline.db
};
```

## Tasks (3e-1)

The lead builds; agents only where a task is large and fully specified (the owner asked for fewer agents, 2026-10-21). One commit per task or small group, staged by named paths.

| id | tier | depends | files | spec | done_check |
|---|---|---|---|---|---|
| P1 | H | – | `apps/desktop/src/main/pipeline/protocol.ts` + test, `apps/desktop/scripts/pipeline-schema.ts`, `apps/desktop/package.json` (script), `services/pipeline/src/gratovo_pipeline/protocol.schema.json` | The zod schemas above, `parseLine`, the schema writer, a test that the committed JSON is current | Vitest; the script's output equals the file |
| P2 | N | P1 | `services/pipeline/pyproject.toml`, `uv.lock`, `src/gratovo_pipeline/{__init__,__main__,protocol}.py`, `tests/conftest.py`, `tests/test_protocol.py` | Dependencies (curl_cffi, exact pins; jsonschema dev), the socket guard, `Emitter` (one line, flush, ensure_ascii false), `read_start` (refuses a bad start with `end` `bad_start`), schema validation of captured messages | `uv run pytest`, `pyright`, `ruff` |
| P3 | N | P2 | `config.py`, `tests/test_config_pacing.py`, `tests/test_country_filter.py` | The defaults of D11 and the `Config` built from `Start`; the old pacing and country tests ported | pytest |
| P4 | N | P2 | `run_control.py`, `parallel.py`, `tests/test_parallel.py` | Ported, typed; the stop flag set from a stdin reader thread | pytest |
| P5 | H | P2 | `store.py`, `tests/test_archive.py`, `tests/test_run_reconcile.py`, `tests/test_video_backfill.py` | The scraped tables (CONTEXT §2), `user_version` migrations, the functions the search uses, ported tests | pytest |
| P6 | N | P3, P4 | `net.py`, `scrapetube/`, `tests/test_proxy_pool.py`, `tests/test_scrapetube_request.py`, `tests/test_scrapetube_gateway_routing.py`, `tests/test_net.py` | Vendored scraper and pool ported and typed; every request through `net.py`'s host check | pytest |
| P7 | N | P6 | `youtube.py`, `tests/test_youtube.py` | `channels.list` and `videos.list` over urllib, key in the header, errors mapped to `quota`, `network`, `blocked` | pytest with a fake opener |
| P8 | H | P5, P7 | `search/*.py`, `tests/test_auto_clean_gate.py`, `tests/test_sponsorship.py`, `tests/test_found_emails.py` | `process_keyword` and its helpers ported, emitting `keyword`, `channel`, `log` | pytest |
| P9 | H | P8 | `jobs/search.py`, `example/`, `tests/test_search_job.py` | The run loop (startAt, parallel, stop, end), the example source (D8), a full example run through `__main__` in a subprocess | pytest; a manual `echo start | python -m gratovo_pipeline` on example |
| P10 | H | P1, P9 | `apps/desktop/src/main/pipeline/{supervisor,python-path,logs}.ts` + tests | Spawn (D2), start line, read and validate lines, stop and kill (D9), logs (D10), crash handling | Vitest with a fake child; one real-process test on example |
| P11 | N | P10 | `packages/ipc/src/find.ts` + test, `channels.ts`, `events.ts`, `bridge.ts`, `apps/desktop/src/main/find/{find-service,results}.ts` + tests, `main/handlers.ts` | Queue and rules in `local_settings` (D12), `FindState`, results read-only from `pipeline.db`, the YouTube key on start | Vitest; typecheck |
| P12 | N | P11 | `apps/desktop/src/renderer/find/*` (Keywords, Live run, Rules read-only, Kept list), `renderer/strings.ts`, the Find route | As the prototype (CONTEXT §4), dark, 1440 px; Gemini suggestions, Redo, the teammate card and rule editing are step 5 | Vitest; a screenshot |
| P13 | N | P12 | `apps/desktop/e2e/find-search.spec.ts` | Example data: add keywords, start, see a keyword finish and kept channels appear, stop, resume from the next keyword, restart the app and see the counts | `pnpm test:e2e`, `--repeat-each 3` |
| P14 | E | all | `docs/decisions/0013-pipeline.md`, `docs/architecture.md`, `SECURITY.md`, `services/pipeline/README.md`, `docs/migration-plan.md`, `.router/PROGRESS.md` | The decisions above as an ADR; the pipeline's network rule; the status table | Read through |
| L1 | lead | all | – | Full checks; Find looked at in dark at 1440 px; `router-reviewer` on the diff; fixes; Windows CI by workflow_dispatch before the PR; the owner's live search by hand | All green |

## 3e-2 outline (R2 sharing): moved to step T1 on 2026-10-21 (owner: solo first)

The outline is kept as written; it now lives in the migration plan's step T, part T1, and runs when step 9 is done.

`sync.py` and `r2.py` ported; boto3 replaced by signed links: the pipeline asks main with `{type:"r2.sign", id, requests:[…]}` (at most 50) and main answers on stdin `{type:"r2.signed", id, links:[…]} | {type:"r2.refused", id, reason}` after calling `r2-access` with the member's token. List results are parsed from the ListObjectsV2 XML. The catalog worker is the user id. Jobs `pull`, `push` and a share after each keyword; the frame's `channels` names filled from `pipeline.db`. Checks carried from 3d-2a: a call with a real member's token, and a presigned list against the real bucket (with the owner's go). test_r2_sync ported with a fake signer and an in-memory bucket.

## 3e-3 outline (the rest, ported with tests)

`comms/` and `legacy/data/comms/` → `services/pipeline/data/comms/`; `gemini_bridge/` (DAEMON.md, PROTOCOL.md as the spec; the retired actions stay out); `gmail.py`, `mailbox.py` (never sends without approval; mail-1 and mail-2 on hold); `feeds.py` and the news job; the tools still called (enrich backfill, import_handles, video_stats, transcript, email_send's commands, aws_gateway_setup with the AWS keys from the secret store); `legacy/data/gemini skills/` if the keyword and classifier prompts still need it. Their callers in the app arrive with steps 5 to 9.
