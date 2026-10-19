# Pipeline

The Python side of the desktop app: YouTube search and enrichment, R2 storage, Gmail and the comms engine. Step 3e ports it from `legacy/pipeline/` piece by piece.

- Environment: `uv sync --directory services/pipeline` (Python 3.12 or newer, pinned in `uv.lock`).
- Checks: `uv run --directory services/pipeline ruff check .`, `pyright`, `pytest`. From the repository root, `pnpm lint`, `pnpm typecheck` and `pnpm test` run them all.
- Configuration and secrets arrive from the app at launch. Never read a `.env` file here.
