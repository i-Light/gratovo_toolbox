# Gratovo Toolbox

The internal workbench of Gratovo, an influencer-marketing agency that pairs AI YouTube creators with AI brands. One place to find creators, reach them, close deals with brands, deliver the work and get paid, with a Today list that always says what to do next.

This repository is the **rebuild**. It replaces the Flutter app in the old `gratovo_code` repository with a desktop app built on Electron, React and TypeScript, keeping the Python pipeline and the Supabase backend. It started empty on 2026-10-19 and grows step by step, following the [migration plan](docs/migration-plan.md).

## Status

**Step 3 (foundation) is in progress.** Step 3a is built: the workspace, the desktop shell, the shared packages and the pipeline project. What exists:

| Folder | What it holds |
|---|---|
| [docs/](docs/README.md) | The migration plan, the hand-off for the next session, architecture, conventions, workflow, decisions, and the product record. |
| [design/workbench-prototype/](design/workbench-prototype/README.md) | The approved interactive prototype of the new app. It is the design reference for every screen. |
| [legacy/](legacy/ABOUT.md) | A read-only copy of the old app's source, for reference while porting. It is deleted in the last step of the plan. |
| [apps/desktop/](apps/desktop) | The Electron app (React, TypeScript). A blank window for now. |
| [packages/](packages) | `core` (the domain, starting with the deal flow), `ui` (design tokens) and `ipc` (the channel schemas). |
| [services/pipeline/](services/pipeline/README.md) | The Python pipeline project. Ported in step 3e. |
| [.claude/](.claude) | Project skills, agents and settings for Claude Code sessions. |

Checks: `pnpm install`, then `pnpm lint`, `pnpm typecheck` and `pnpm test`. On Linux, run the tests as `xvfb-run -a pnpm test` (the Electron test needs a display). The Python checks run through `uv`.

## Start here

- **People:** read [docs/migration-plan.md](docs/migration-plan.md), then open the prototype (`design/workbench-prototype/index.html` in a browser).
- **Claude Code sessions:** read [CLAUDE.md](CLAUDE.md), then [docs/handoff.md](docs/handoff.md). The hand-off says exactly where work stopped and what to do next.

## Security

Secrets never go into this repository. See [SECURITY.md](SECURITY.md).
