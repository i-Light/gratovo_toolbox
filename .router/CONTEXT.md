# Recon for step 3e (the Python pipeline)

Written 2026-10-21 on branch `feat/3e-pipeline`, from `main` at c66858c (3d-2b merged as #12). Read-only; no source changed. Replaces 3d-2b's recon (in git history at c66858c). No `.env*`, `settings.local.json` or `aws_gateways.json` was opened; no key value was read.

## 1. Where things stand

- `services/pipeline/` is 3a's empty project: `pyproject.toml` (Python 3.14, uv_build, ruff 0.17.1 with E W F I N UP B S C4 SIM PTH PT RET RUF, pyright 1.1.414 **strict**, pytest 9.1.1 `strict = true`), `uv.lock`, `src/`, `tests/`, a README with the rules (src layout, strict pyright, no network in tests, never read `.env`). No dependencies yet.
- Root scripts already include it: `pnpm lint` (ruff check + format check), `pnpm typecheck` (pyright), `pnpm test` (pytest), all through `uv run --directory services/pipeline`.
- CI (`.github/workflows/ci.yml`, "Checks (Windows)", windows-2025): `astral-sh/setup-uv` with the lockfile as cache key, then install, lint, typecheck, unit (pytest included), e2e. So `services/pipeline/.venv` exists before the Electron tests run. A uv.lock that doesn't match `pyproject.toml` fails the run. OSV scans `services/pipeline/uv.lock`; CodeQL covers Python.
- Main has **no child-process code yet** (no `child_process`, `spawn` or `utilityProcess` anywhere in `apps/desktop/src`).
- The YouTube key: `account.teamKeys.youtubeKey()` (`main/account/team-keys.ts`, from Vault through `team_youtube_key()`, kept in memory at most an hour, ADR 0011 §11). "Its first user is the pipeline (3e), which gets it on stdin."
- R2: the `r2-access` Edge Function (`supabase/functions/r2-access/index.ts`, rules in `_shared/r2-rules.ts`) takes `{ requests: [...] }`, at most 50, each `{op: get|head|put|delete, key}` or `{op: list, prefix, continuationToken?}`, and returns 15-minute signed links. Keys: `channels/<id>.json.zst` and `catalog/<worker>/<name>.jsonl.zst`. A member may **put only under `catalog/<their user id>/`**, and catalog objects can't be deleted. So the new app's catalog worker is the user id, not the hostname. Not yet checked on production: a call with a real member's token, and whether R2 accepts a presigned list (ADR 0011, carried into 3e).
- The local DB (`main/db/migrations/0001-initial.ts`) has `channels (channel_id, name)` (the scraped name, "lives in R2 until 3e"), `local_settings (key, value)`, `_meta`. The frame's creators come from `channel_state`; nothing feeds `channels` yet.
- Renderer: Find is a placeholder screen (`renderer/app/placeholder-screen.tsx`) with tabs `search` and `triage` (`strings.screens.find.tabs`). `mateRunSchema` (a teammate's run) is already in `packages/ipc/src/data.ts`.
- IPC: zod 4.6.7 in `packages/ipc` (channels in `channels.ts`, events in `events.ts`, `appEventNames` in `bridge.ts`); each channel needs entries in the full `Handlers` objects in the ipc tests and in `main/handlers.ts`.

## 2. The legacy pipeline (`legacy/pipeline/`, about 35,000 lines)

| Part | Lines | Goes to |
|---|---|---|
| `search.py` (entry, argparse, run loop, run log tee) | 691 | 3e-1 (as the search job) |
| `gratovo/config.py` (`.env`, `settings.json`, `run_config.json`, `keywords.json`, gateways, Gmail accounts) | 619 | 3e-1 (rewritten: config from the start message) |
| `gratovo/store.py` (SQLite: keywords, channels, channel_keywords, videos, channel_archive, sync_state, _applied_segments, news_*, archive_keyword_pending, runs, video_transcripts) | 2257 | 3e-1 search tables; sync helpers 3e-2; news 3e-3 |
| `gratovo/pipeline.py` (discovery, YouTube fetch, auto-clean gate, sponsorship, found emails, catch-up backfill, manual refetch) | 1197 | 3e-1 |
| `gratovo/scrapetube/` (vendored; curl_cffi TLS impersonation) + `proxy_pool.py` (direct, proxies, AWS gateways; cooldown, min gap) | 908 + 472 | 3e-1 |
| `gratovo/parallel.py`, `run_control.py` (stop flag, `RunAborted`, worker id) | 168 + ~80 | 3e-1 |
| `gratovo/found_emails.py` | 128 | 3e-1 |
| `gratovo/r2.py` (boto3 + zstd), `gratovo/sync.py` (objects + catalog log) | 183 + 927 | 3e-2 (boto3 replaced by signed links) |
| `gratovo/gmail.py`, `mailbox.py` | 754 + 739 | 3e-3 |
| `gratovo/feeds.py`, `tools/news.py` | 263 + 253 | 3e-3 |
| `comms/` (engine, playbook, checks, coach, pool, …) | ~5,000 | 3e-3, with `legacy/data/comms/` (3.8 MB) |
| `gemini_bridge/` (daemon, actions, skills, gems, firefox_*, window_guard) | ~5,500 | 3e-3 |
| `tools/` (enrich, import_handles, email_send, email_library, video_stats, transcript, get_subtitles, aws_gateway_setup, …) | ~4,000 | 3e-3 (the ones still called) |
| `gemini_extension/` | JS | step 6 (plan §7) |

**How the old app drove it** (`legacy/lib/core/native/scraper_process_io*.dart`): `python -u search.py` for a run, reading **plain-text lines** (`[keyword i/n] started: X`, `[sync-io] shared=K of=N`, `[route] use aws=…`, `[catchup] done=…`) through `search_progress_parser.dart`; SIGINT to stop; flags `--refetch`, `--catch-up-videos`, `--pull-only`, `--push-only`, `--archive-ids`, `--unarchive-ids`, `--status`; `tools/enrich.py --apply --only backfill --handle --months`; `tools/news.py --refresh`; `tools/video_stats.py --video --json`; `tools/email_send.py … --json`; `run_gemini_daemon.py daemon --port --data-dir` (JSON lines, `gemini_bridge/DAEMON.md`, `PROTOCOL.md`).

**What a run reads** (`config.py`): secrets from `data/.env` (`YOUTUBE_API_KEY`, the four R2 values, AWS IAM keys, Supabase service key, Google OAuth, `WORKER_NAME`); `settings.json` (shape `{"key": {"value": x}}` or `{"range": [a, b]}`); `run_config.json` (the app's Start button: `sort_by`, `results_type`, `countries`, `handle_limit`, `auto_clean`); `keywords.json` (the list); `aws_gateways.json` (gateway invoke URLs, written by `tools/aws_gateway_setup.py`). Routing through gateways needs **only their URLs**; the AWS keys are used only by the setup tool (boto3).

**The owner's committed settings** (`legacy/data/settings.json`, no secrets): `normal_pacing` and `fast_pacing` delay ranges, `catchup_videos_delay` [0.8, 2.0], `channel_sweep_break` [40, 100] every 30, `handles_to_search_limit` 200, `backfill_batch_size` 25, `auto_clean` {enabled, min 50,000, max 2,000,000 subscribers, below_min sweep, above_max delay, label inactive}, `proxies` {enabled false, include_direct true, list []}, `parallel_search` {enabled false, max_workers 4}. `run_config.json`: sort `upload_date`, results `video`, countries AU CA GB IE NZ US, handle_limit 200.

**Dependencies** (`requirements.txt`): google-api-python-client 2.140.0 (YouTube Data API: `channels.list`, `videos.list` only), curl_cffi ≥ 0.16, requests and typing_extensions (gateway tool), google-auth-oauthlib and google-auth-httplib2 (Gmail), python-dotenv, boto3 (R2 and the gateway tool), zstandard, websockets (bridge).

**Retired by the decisions build** (`tests/test_old_drafting_removed.py`): the Gemini actions `draft_email`, `qa_email`, `lint_email`, `draft_reply`, `parse_draft`, `draft_rules`, `outreach_knobs`, `outreach_preview`. Kept: `generate_keywords`, `classify_channel`, `gem_*`, `skills_*`/`skill_*`, `comms_propose`, `comms_check`.

**On hold, don't build** (owner-rules): `search-1` (only the latest 15 videos per channel are fetched: keep that limit as it is), `first-1`, `mail-1`, `mail-2`.

## 3. Old tests, by pull request

- **3e-1:** test_archive, test_auto_clean_gate, test_config_pacing, test_country_filter, test_found_emails, test_parallel, test_proxy_pool, test_run_reconcile, test_scrapetube_gateway_routing, test_scrapetube_request, test_sponsorship, test_video_backfill.
- **3e-2:** test_r2_sync (980 lines, an in-memory fake bucket).
- **3e-3:** test_comms_* (19), test_gemini_* and test_gems, test_keywords_batch, test_bridge_browser_admission, test_firefox_*, test_window_guard, test_run_gemini_daemon, test_old_drafting_removed, test_mailbox, test_email_send_no_auto_send, test_email_library_verdicts, test_feeds, test_video_stats, test_transcript_timed. `test_build_addon` goes with the extension (step 6).

## 4. The spec (prototype `design/workbench-prototype/js/find.js`)

Find › Search is a grid: **Keywords** (count and done; Gemini suggestions; per keyword: status, "found · kept" with a yield bar, Start here, Redo, Remove; a textarea "Paste keywords, one per line. Duplicates are skipped." with Add), and a column of **Live run** (headline "Searching "<kw>"" / "Finished · everything found is saved" / "Paused at keyword N · everything found is saved" / "Stopped at keyword N…"; a meter of keywords searched; mini stats starting with channels found; a `role="log"` run log; Start the search / Pause / Resume at keyword N / Try again; hint "Pausing finishes the keyword in progress first." and "Runs on this computer. You can leave this page; the tray keeps count."), **Rules** (countries, min median, min uploads, channels per keyword, archive days; Edit rules) and **Mate** (a teammate's run). Then a Runs history table. Triage is its own tab (step 5).
