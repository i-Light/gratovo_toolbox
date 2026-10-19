# Architecture

The target design of the new app. Step 3 builds it. Anything marked *(to decide)* waits for an owner answer in the [migration plan](migration-plan.md#9-open-questions).

## The pieces

```
                 ┌──────────────────────── one Windows machine ─────────────────────────┐
                 │                                                                       │
 Supabase  ◄────►│  Electron main process ── typed IPC ──► renderer (React, sandboxed)   │
 (typed-in rows, │   │  data layer (SQLite)                    screens, design system   │
  auth, realtime)│   │  sync engine (outbox, pull)                                       │
                 │   │  secrets (safeStorage)                                            │
                 │   │  job supervisor ── stdin/stdout JSON lines ──► Python pipeline ───┼──► YouTube, R2
                 │   │                                                 search, enrich,   │
                 │   │                                                 comms engine,     │
                 │   │                                                 Gmail             │
                 │   └── Gemini bridge daemon (Python, 127.0.0.1 + token) ◄── browser    │
                 │                                                      extension ──────┼──► Gemini web
                 └───────────────────────────────────────────────────────────────────────┘
```

- **Main process (Node, TypeScript):** owns everything privileged. That covers the local database, sync, secrets, the pipeline and bridge processes, files, notifications and updates. It exposes one narrow, typed API.
- **Preload:** bridges that API into the renderer with `contextBridge`. It adds nothing else.
- **Renderer (React, TypeScript):** the UI only. Sandboxed, with no Node and no network except through IPC. It holds UI state and caches query results.
- **Python pipeline:** the work that is better in Python, kept from the old app. It covers YouTube search and enrichment, R2 storage, Gmail, and the comms engine (playbook, drafting checks). Each run is a child process the main process supervises.
- **Gemini bridge:** a Python daemon plus a browser extension that drives the signed-in Gemini web app. Prompts live in the pipeline, never in the UI.
- **Supabase:** shared, typed-in data (creators' notes and stages, brands, deals, outreach, team), auth and realtime presence. Row-level security on every table.
- **Cloudflare R2:** scraped channel data, one object per channel plus a catalog. It is reached only through short-lived access the server grants *(to decide: §9 Q11)*.

## Local-first data

The app reads and writes a local SQLite database first, so every click answers at once and the app works offline. A sync engine moves changes to Supabase and pulls others' changes. This is the model the old app proved (`legacy/PROJECT_STRUCTURE.md` §1 and §9), ported to TypeScript:

- **Pull:** each mirrored table is pulled by an `updated_at` cursor with keyset paging; deletes arrive as tombstones.
- **Push:** every user action writes the local row and an outbox entry in one transaction. The engine drains the outbox and edits use compare-and-set. A refused edit becomes a conflict the user resolves.
- **Realtime:** one channel broadcasts "these tables changed" and carries presence (who is online, who is looking at what).
- **Nothing derived is stored on the server.** Counts, rollups and Today are computed locally.

### One data source switch: live or example

All reads and writes go through a `DataSource` interface. The **live** implementation is SQLite plus sync. The **example** implementation is seeded fixtures in a throwaway database, with stand-in adapters for Gmail, Gemini, YouTube and R2, so nothing leaves the machine. Prototype mode chooses between them at runtime. The UI code is the same in both, so what the owner sees in prototype mode *is* the app. See [decisions/0004-prototype-mode.md](decisions/0004-prototype-mode.md).

## Domain core

`packages/core` holds the pure TypeScript domain: entities (creator, brand, deal, draft, thread, mailbox, run, member), the deal flow and its checklists, and the money rules (Net 30, payout locked until the brand pays). It also holds:

- **Fit scoring with reasons**, so nobody has to trust a bare number;
- **the Today next-action engine:** buckets in money-first order, owners, snoozes and roles.

The core has no I/O, so it is unit-tested exhaustively. The prototype's `engine.js` is the reference implementation.

## UI

- **Design tokens:** CSS custom properties, ported from the prototype's `index.html`. Light and dark, phase hues, status colours used only for status, Readex Pro and IBM Plex Mono, density, and two easing curves (`--ease-out`, `--ease-drawer`).
- **Components:** `packages/ui` holds the button, icon button, tag, avatar, menu, tooltip, toast, tabs, segmented control, meter, steps, empty state, callout, field and switch. Popovers, menus and dialogs use accessible primitives (Radix or React Aria; pick one in 3c with the `pick-ui-library` skill).
- **The frame:** rail, top bar, peek panel, command palette, trays, bars, toasts.
- **Screens:** Today, Find, Reach, Close, Deliver, Insights, Toolbox, Team, Settings, with record pages and peeks.
- **State:**
  - actions go through one store that keeps undo snapshots;
  - UI-only state is separate;
  - background jobs apply to the data and to the undo history, so undoing never loses a job's results;
  - data queries are cached by key and invalidated by data-change events.
- **Keyboard:** a key stack where popups are barriers; single-letter keys can be turned off; no animation right after a key press.

## Repository layout

```
gratovo_toolbox/
├── apps/
│   └── desktop/              Electron app
│       ├── src/main/         main process: windows, IPC handlers, data, sync, secrets, jobs, updates
│       ├── src/preload/      the typed bridge
│       ├── src/renderer/     React UI: app/ (frame), features/<screen>/, lib/
│       ├── resources/        icons, installer assets
│       └── e2e/              Playwright tests for Electron
├── packages/
│   ├── core/                 domain model and engines (pure TS, no I/O)
│   ├── ui/                   design tokens and components
│   └── ipc/                  IPC contract: zod schemas and the types generated from them
├── services/
│   ├── pipeline/             Python: src/gratovo_pipeline/..., tests/, pyproject.toml
│   └── gemini-extension/     the browser extension
├── supabase/
│   ├── migrations/           ordered SQL migrations, additive until cutover
│   └── tests/                SQL and RLS tests (Docker in CI)
├── design/                   the prototype and explorations (design reference)
├── docs/                     this documentation
├── legacy/                   read-only copy of the old app (deleted in step 11)
└── .github/workflows/        CI and releases
```

Only `design/`, `docs/`, `legacy/` and `.claude/` exist so far. Step 3a creates the rest.

## Security model

The policy is [SECURITY.md](../SECURITY.md). In code:

1. **Renderer isolation:** `contextIsolation`, `sandbox`, no Node integration, a strict CSP, no remote content, blocked navigation and `window.open`, and a deny-all permission handler.
2. **IPC:** every channel is declared in `packages/ipc` with a zod schema for input and output. The main process validates every call and rejects anything else. No channel accepts a file path or URL without checking it against an allowlist.
3. **Secrets:** a main-process `secrets` module over `safeStorage`. The renderer can ask whether a secret is set; it can never read one. Python processes get the secrets they need through their stdin at launch, never through the command line or environment of a long-lived shell.
4. **Local services:** the Gemini bridge daemon binds `127.0.0.1` and requires a random per-launch token from the extension.
5. **Supabase:** row-level security on every table, with roles (owner, account manager, VA) enforced in policies, not only in the UI. The service-role key never ships.
6. **Supply chain:** the lockfile is committed; Dependabot, audit, CodeQL and gitleaks run in CI; release builds are signed and fused.

## Performance rules

From the old app's lag causes (the parity checklist, §4):
- one query per screen, not one per row;
- the frame never re-renders on presence or sync ticks;
- screens you leave stop their work;
- the database is off the UI thread;
- Today draws from the local copy first and sync catches up after;
- one long-lived helper process for mail, not a process per check.

Targets: the app opens in under 2 s, and every click answers in under 100 ms.

## Versions

Recorded when step 3a pins them: Electron, Node, React, TypeScript, Vite, pnpm, Python and uv.
