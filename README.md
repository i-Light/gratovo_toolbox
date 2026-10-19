# Gratovo Toolbox

The internal workbench of Gratovo, an influencer-marketing agency that pairs AI YouTube creators with AI brands. One place to find creators, reach them, close deals with brands, deliver the work and get paid, with a Today list that always says what to do next.

This repository is the **rebuild**. It replaces the Flutter app in the old `gratovo_code` repository with a desktop app built on Electron, React and TypeScript, keeping the Python pipeline and the Supabase backend. It started empty on 2026-10-19 and grows step by step, following the [migration plan](docs/migration-plan.md).

## Status

**Step 3 (foundation) is in progress.** Step 3a set up the toolchain and the skeleton: the app opens a blank, hardened window with the design tokens. The screens come in steps 4 to 9.

| Folder | What it holds |
|---|---|
| [apps/desktop/](apps/desktop/README.md) | The Electron app: main process, React renderer, end-to-end tests. |
| `packages/` | Shared TypeScript: `core` (the domain, no I/O), `ui` (design tokens, later components), `ipc` (the contract between the app's processes). |
| [services/pipeline/](services/pipeline/README.md) | The Python pipeline (search, enrichment, mail, the comms engine), ported in step 3e. |
| [docs/](docs/README.md) | The migration plan, the hand-off for the next session, architecture, conventions, workflow, decisions, and the product record. |
| [design/workbench-prototype/](design/workbench-prototype/README.md) | The approved interactive prototype of the new app. It is the design reference for every screen. |
| [legacy/](legacy/ABOUT.md) | A read-only copy of the old app's source, for reference while porting. It is deleted in the last step of the plan. |
| [.claude/](.claude) | Project skills, agents and settings for Claude Code sessions. |

## Start here

- **People:** read [docs/migration-plan.md](docs/migration-plan.md), then open the prototype (`design/workbench-prototype/index.html` in a browser).
- **Claude Code sessions:** read [CLAUDE.md](CLAUDE.md), then [docs/handoff.md](docs/handoff.md). The hand-off says exactly where work stopped and what to do next.

## Set up a machine

On Windows, install the tools once:

```
winget install OpenJS.NodeJS.LTS
winget install astral-sh.uv
winget install Gitleaks.Gitleaks
corepack enable pnpm
```

Node must be 24.22.0 or a later 24.x. Then, in this folder:

```
pnpm install
pnpm dev
```

`pnpm install` also installs the git hooks. They format and lint what you commit and scan it for secrets.

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app with hot reload. |
| `pnpm lint` | ESLint, Prettier and ruff. |
| `pnpm typecheck` | TypeScript and pyright. |
| `pnpm test` | Unit tests: Vitest and pytest. |
| `pnpm test:e2e` | Builds the app and runs the Playwright tests against it. |
| `pnpm format` | Formats everything. |

## Security

Secrets never go into this repository. See [SECURITY.md](SECURITY.md).
