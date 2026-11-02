# Step S context (the scraping upgrade)

Read with [../../docs/scraping-upgrade-plan.md](../../docs/scraping-upgrade-plan.md) (what each part does) and [../../docs/scraping-omar-analysis.md](../../docs/scraping-omar-analysis.md) (why).

## Commands (Windows, Git Bash)

- Node first on PATH: `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$PATH"`.
- Python, from `services/pipeline`: `uv run pytest tests/<file> -q`, `uv run ruff check src tests`, `uv run ruff format --check src tests`, `uv run pyright`.
- Repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest and pytest). One Vitest file: `cd apps/desktop && pnpm exec vitest run src/main/find/find-service.test.ts`.
- The gate: `pnpm verify` (about 10 min); `pnpm verify --status` on a clean tree marks the commit green.

## Pipeline (`services/pipeline/src/gratovo_pipeline`)

- `scrapetube/proxy_pool.py`: the route pool. Candidates of kind aws, proxy, direct. `_choose` picks least recently used, never twice in a row, a min gap per candidate (direct has none today), one request at a time, cooldowns on connection failure and block. Clock, sleep and rng are injectable; `tests/test_proxy_pool.py` proves the rules on a fake clock.
- `scrapetube/scrapetube.py`: `request()` retries without limit (S2 caps it), `_raise_if_blocked` and `BLOCK_MARKERS`, `get_search`, `get_channel(channel_url=...)`.
- `config.py`: `Config.from_start`. Pacing default (line ~191) and the proxies default (line ~178).
- `search/discover.py`: `channel_from_item` (handle and id from a search result; drops results without an `@` handle today), `LiveSource.find_channels` (swallows errors, returns what it has), `LiveSweep.recent_video_ids(handle)` reads `https://www.youtube.com/{handle}`.
- `search/context.py`: the `Source` and `Sweep` protocols. `Discovered` is `{handle: channel_id}` everywhere.
- `search/keyword.py`: `process_keyword` (find, partition known/archived, details, gate, uploads, `mark_keyword_done`).
- `jobs/search.py`: the search job. Keywords from `startAt`, parallel workers (`parallel.py`), `end.at` = first keyword not done.
- `youtube.py`: `YouTubeApi.channels(batch)` returns `{handle: ChannelInfo}`; `_channel_info` builds `Handle` and `Link` from the batch handle.
- `store.py`: `SCHEMA_VERSION` 4, `MIGRATIONS` dict (each step safe to run twice, columns added only when missing). `keywords` table: status pending | in_progress | done, `channels_found`, `dirty` (shared to the catalog).
- Other `recent_video_ids` callers: `search/backfill.py`, `jobs/backfill.py`, `jobs/refetch.py`; fake in `example/__init__.py` (`ExampleSweep`, by handle) and in `tests/fakes.py`.

## Desktop (`apps/desktop/src`)

- `main/find/find-service.ts`: the Find queue (`find.json`, `queueMax` 500), run start (sends every queue keyword and `startAt`), keyword messages (`message()`), `firstUndone`, `exit()`.
- `main/find/find-store.ts`: reads and writes `find.json`.
- `packages/ipc/src/find.ts`: `findStateSchema` (queue entry `{keyword, state, found, kept}`, states queued | running | done | failed), `queueIndex` max 499. `packages/ipc/src/channels.ts`: the `find:*` channels.
- `renderer/find/keywords.tsx`: the keyword list. `renderer/strings.ts`: every user-facing string.
- `main/settings/connections-store.ts`: pipeline settings defaults (`pacing` normal, `proxies.includeDirect` true).
- The app reads `pipeline.db` and never writes it (ADR 0013).
