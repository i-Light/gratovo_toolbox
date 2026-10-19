# Pipeline

The Python side of the app: YouTube search and enrichment, R2 storage, Gmail and the comms engine. The desktop app runs it as a child process and talks to it in JSON lines on stdin and stdout.

Step 3a set up the project. Step 3e ports the code from `legacy/pipeline/` (see the [migration plan](../../docs/migration-plan.md#step-3-foundation)).

## Commands

Run them here, or use the root scripts (`pnpm lint`, `pnpm typecheck`, `pnpm test`), which include them.

| What | Command |
|---|---|
| Tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format | `uv run ruff format .` |
| Types | `uv run pyright` |

`uv` installs Python 3.14 and the tools on first run, at the versions in `uv.lock`.

## Rules

- `src/` layout; pyright in strict mode; pytest with no network.
- Never read `.env` files. Configuration and secrets arrive from the app at launch.
