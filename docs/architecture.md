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
                 │   └── Gemini bridge daemon (Python, 127.0.0.1) ◄── browser    │
                 │                                                      extension ──────┼──► Gemini web
                 └───────────────────────────────────────────────────────────────────────┘
```

- **Main process (Node, TypeScript):** owns everything privileged. That covers the local database, sync, secrets, the pipeline and bridge processes, files, notifications and updates. It exposes one narrow, typed API.
- **Preload:** bridges that API into the renderer with `contextBridge`. It adds nothing else.
- **Renderer (React, TypeScript):** the UI only. Sandboxed, with no Node and no network except through IPC. It holds UI state and caches query results.
- **Python pipeline:** the work that is better in Python, kept from the old app. It covers YouTube search and enrichment, R2 storage, Gmail, and the comms engine (playbook, drafting checks). Each run is a child process the main process supervises. The comms engine (`comms/`) checks each drafted message against the playbook; a person runs its quality tools by hand.
- **Gemini bridge:** a Python daemon plus a browser extension that drives the signed-in Gemini web app. Main starts one bridge process at most, on 127.0.0.1. Prompts live in the pipeline, never in the UI. Decisions in [ADR 0014](decisions/0014-gemini-bridge-and-comms.md). The browser add-on lives in `services/gemini-extension` (step 4). Each bridge start makes a random token, which the Firefox build of the add-on carries and the bridge checks. Chrome and Edge load the folder unpacked and have no token: the origin check and browser admission guard them. Decisions in [ADR 0016](decisions/0016-live-data-and-connections.md).
- **Supabase:** shared, typed-in data (creators' notes and stages, brands, deals, outreach, team), auth and realtime presence. Row-level security on every table.
- **Cloudflare R2:** scraped channel data, one object per channel plus a catalog. It is reached only through short-lived access the server grants (owner's answer: §9 Q11).

## Local-first data

The app reads and writes a local SQLite database first, so every click answers at once and the app works offline. A sync engine moves changes to Supabase and pulls others' changes. This is the model the old app proved (`legacy/PROJECT_STRUCTURE.md` §1 and §9), ported to TypeScript:

- **Pull:** each mirrored table is pulled by an `updated_at` cursor with keyset paging; deletes arrive as tombstones.
- **Push:** every user action writes the local row and an outbox entry in one transaction. The engine drains the outbox and edits use compare-and-set. A refused edit becomes a conflict the user resolves.
- **Realtime:** one channel broadcasts "these tables changed" and carries presence (who is online, who is looking at what).
- **Nothing derived is stored on the server.** Counts, rollups and Today are computed locally.

**Built in 3d-1** ([decisions/0010-data-layer.md](decisions/0010-data-layer.md)): the database is Node's built-in `node:sqlite` in the main process, with forward-only migrations (`apps/desktop/src/main/db/`) and one repository per table (`apps/desktop/src/main/data/repositories/`). The renderer loads everything the frame shows with one call (`frame:load`) before its first render, and a persister turns each change to the store's data, undo and redo included, into a batch for `data:write`. The contract (types, `DataSource`, the write kinds, the mapping to the old app's fields) is in `@gratovo/core/data`. The pull, the outbox and realtime come with 3d-2b.

**Built in 3d-2a** ([decisions/0011-accounts-roles-team-keys.md](decisions/0011-accounts-roles-team-keys.md)): email and password sign-in in the main process (`apps/desktop/src/main/supabase/`, plain `fetch` through the one network module, `main/net/network.ts`), the refresh token kept in the secret store, and the account (`main/account/`): unconfigured (example data), signed out, waiting for access, or signed in on `gratovo.db`, which belongs to one account and is deleted on sign-out. Until 3d-2b's pull, a team refresh reads `profiles` and `member_access`, and a rename PATCHes your own profile.

**Built in 3d-2b** ([decisions/0012-sync-engine.md](decisions/0012-sync-engine.md)): the sync engine in `apps/desktop/src/main/sync/`, one pass at a time. It drains a first-in, first-out outbox of intent (each write and its outbox row in one transaction; a creator's stage through `apply_channel_edit`'s compare-and-set, conflicts you settle), re-fetches what the server refused or contested, reads profiles, roles, your switches and your open conflicts whole, then keyset-pulls creators, brands, deals and the log (by the server's receive time) with tombstones and the purge horizon. Nothing unsent is overwritten. Main tells the page about changes over one event channel (`frame:changed`, `sync:status`, `presence:changed`), and the page adopts them without writing them back or losing Undo. Realtime runs on two private topics of the app's own (`toolbox:sync`, `toolbox:team`) through `@supabase/realtime-js` behind the network allowlist; the 20 s catch-up carries on without it. Sign-out keeps unsent changes for the same account.

**Built in 3e-3b** ([decisions/0015-pipeline-mail-and-jobs.md](decisions/0015-pipeline-mail-and-jobs.md)): the pipeline runs its jobs in two lanes. The store lane (`search`, `refetch`, `backfill`) writes `pipeline.db`, so only one runs at a time. The quick lane (`mail.status`, `mail.send`, `mail.replies`, `mail.ack`, `mail.cancel`, `video_stats`, `gateways.deploy`, `gateways.destroy`, `gateways.test`) writes `mailbox.db` and the AWS calls, one at a time. Both lanes stop on quit. A job that answers in `result` sends it once, before `end`; a sweep's replies come one line each. Each job gets only the hosts it needs. The secrets for mail and AWS stay in main's secret store and arrive only in the start message.

**Built in 3e-1** ([decisions/0013-pipeline.md](decisions/0013-pipeline.md)): a search runs as a child process. Main's supervisor (`apps/desktop/src/main/pipeline/`) starts one `python -I -u -m gratovo_pipeline` job at a time, with a bare environment, and talks to it in JSON lines on stdin and stdout. The line schemas are zod in main, checked on every line, and mirrored in Python. The find service (`main/find/`) keeps the queue and the rules in `find.json` beside `pipeline.db`, and reads the kept channels from `pipeline.db` read-only. Secrets (the YouTube key, the proxy and gateway URLs) arrive only in the start message. Every request the pipeline makes goes through its own host check (`net.check_url`: HTTPS, YouTube, Google's API, AWS gateway hosts, the configured proxies), because main's allowlist can't see those requests.

### One data source switch: live or example

All reads and writes go through a `DataSource` interface. The **live** implementation is SQLite plus sync. The **example** implementation is `example.db`, seeded from fixtures and kept across restarts (so changes behave like real data), with stand-in adapters for Gmail, Gemini, YouTube and R2, so nothing leaves the machine. Prototype mode chooses between them at runtime. The UI code is the same in both, so what the owner sees in prototype mode *is* the app. See [decisions/0004-prototype-mode.md](decisions/0004-prototype-mode.md).

## Domain core

`packages/core` holds the pure TypeScript domain: entities (creator, brand, deal, draft, thread, mailbox, run, member), the deal flow and its checklists, and the money rules (Net 30, payout locked until the brand pays). It also holds:

- **Fit scoring with reasons**, so nobody has to trust a bare number;
- **the Today next-action engine:** buckets in money-first order, owners, snoozes and roles.

The core has no I/O, so it is unit-tested exhaustively. The prototype's `engine.js` is the reference implementation.

## UI

- **Design tokens:** CSS custom properties, ported from the prototype's `index.html`. Light and dark, phase hues, status colours used only for status, Readex Pro and IBM Plex Mono, density, and two easing curves (`--ease-out`, `--ease-drawer`).
- **Components:** `packages/ui` holds (or will hold, as step 3c goes on) the button, icon button, tag, avatar, menu, tooltip, toast, tabs, segmented control, meter, steps, empty state, callout, field and switch, ported from the prototype with its roles. No primitives library: the key stack owns Escape and outside clicks, and modal layers use the native `<dialog>` ([decisions/0009](decisions/0009-app-shell.md)). The overlays (palette, shortcut sheet, menus, tooltip, trays, peek, toasts) are in `apps/desktop/src/renderer/overlays/`.
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
├── tooling/
│   └── eslint-config/        the lint plugins, on TypeScript 6 (see decision 0007)
├── services/
│   ├── pipeline/             Python: src/gratovo_pipeline/ (search, gemini/ bridge, comms/ engine, transcripts), tests/, pyproject.toml; see ADRs 0013 to 0015
│   └── gemini-extension/     the browser extension
├── supabase/
│   ├── migrations/           ordered SQL migrations, additive until cutover
│   └── tests/                SQL and RLS tests (Docker in CI)
├── design/                   the prototype and explorations (design reference)
├── docs/                     this documentation
├── legacy/                   read-only copy of the old app (deleted in step 11)
└── .github/workflows/        CI and releases
```

Step 3a created the workspace, the three packages, the desktop app (a blank, hardened window), the pipeline project, placeholders for `services/gemini-extension/` (filled in step 4) and `supabase/`, the hooks and CI. Step 3b added `src/preload/` (the IPC bridge) and `apps/desktop/scripts/` (the release fuses). `resources/` comes with the frame in 3c, and the migrations in 3d.

TypeScript projects use references: the root `tsconfig.json` lists every project, and `pnpm typecheck` runs TypeScript 7's `tsc -b`. The linter runs on TypeScript 6 from `tooling/eslint-config`, because typescript-eslint doesn't support 7 yet ([decisions/0007](decisions/0007-toolchain-pins.md)). Packages export their TypeScript source and have no build step; electron-vite and Vitest compile them. `packages/core` is type-checked without Node or DOM types, so code that does I/O there fails the typecheck.

## Security model

The policy is [SECURITY.md](../SECURITY.md). In code:

1. **Renderer isolation:** `contextIsolation`, `sandbox`, no Node integration, a strict CSP (meta tag and header), the page served from `app://gratovo/`, no remote content, blocked navigation (`will-navigate`, `will-frame-navigate`, `will-redirect`) and `window.open`, links opened in the browser only through an allowlist, and a deny-all permission handler.
2. **IPC:** every channel is declared in `packages/ipc` with a zod schema for input and output. The page has one function, `window.gratovo.invoke`, over one Electron channel. The main process accepts calls only from the app page's top frame, validates the request and the handler's response, and rejects anything else. No channel accepts a file path or URL without checking it against an allowlist.
3. **Secrets:** a main-process `secrets` module over `safeStorage`. The renderer can ask whether a secret is set; it can never read one. Python processes get the secrets they need through their stdin at launch, never through the command line or environment of a long-lived shell.
4. **Local services:** the Gemini bridge daemon binds `127.0.0.1` and refuses any web page. The Firefox build of the add-on must also show a random per-launch token; Chrome and Edge, which load the add-on unpacked, cannot carry one, so the origin check and browser admission guard them ([ADR 0016](decisions/0016-live-data-and-connections.md)).
5. **Supabase:** row-level security on every table. Access (`profiles.role`: unauthorized, basic, full) is enforced in policies; `basic` and `full` are identical in the database today. Agency roles (Owner, Scout, Outreach, Deal lead, Delivery) and "sees money" live in `member_access`, which only an Owner can change, through a function. Money is hidden in the new app only (the main process sends no price to a member who may not see it); the database locks it when the old app retires (steps 10 and 11). The main process talks only to the project's Supabase host. The service-role key never ships, and the app refuses a secret key. See [decisions/0011-accounts-roles-team-keys.md](decisions/0011-accounts-roles-team-keys.md). The sync sends only the signed-in member's own outbox rows. Live updates use private channels that only authorized members can join (policies on `realtime.messages`), with public access off; they carry no row data, only "something changed" and presence.
6. **Supply chain:** the lockfile is committed; Dependabot, OSV-Scanner, CodeQL and gitleaks run in CI; release builds are fused (`apps/desktop/scripts/release-fuses.ts`) but not code-signed, by the owner's choice (§9 Q12).

The choices behind each of these are in [decisions/0008-security-baseline.md](decisions/0008-security-baseline.md).

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

Pinned in step 3a on 2026-10-19, at the current stable releases. Every package version is exact, and the lockfiles (`pnpm-lock.yaml`, `services/pipeline/uv.lock`) pin the rest. The reasons for the four choices that weren't simply "the latest" are in [decisions/0007-toolchain-pins.md](decisions/0007-toolchain-pins.md).

| Tool | Version | Pinned in |
|---|---|---|
| Node | 24.22.0 (LTS; the same Node Electron 44.9.0 bundles) | `.nvmrc`, `engines` |
| pnpm | 12.14.0 | `packageManager` |
| Electron | 44.9.0 (Chrome 152) | `apps/desktop` |
| electron-vite | 6.0.0 | `apps/desktop` |
| Vite | 8.3.4 | `apps/desktop` |
| React, react-dom | 19.3.1 | `apps/desktop` |
| TypeScript | 7.0.2 (the linter uses 6.0.3 through `@typescript/typescript6`) | root; `tooling/eslint-config` |
| ESLint, typescript-eslint | 10.13.0, 8.71.2 | root, `tooling/eslint-config` |
| Prettier | 3.9.10 | root |
| Vitest | 5.0.5 | root |
| Playwright | 1.64.1 | `apps/desktop` |
| @axe-core/playwright | 4.14.0 (added in 3c-3) | `apps/desktop` |
| SQLite | `node:sqlite`, SQLite 3.53.4 inside Electron 44.9.0 (added in 3d-1; no package) | built in |
| Postgres for the SQL tests | `postgres:17.11`, pinned by digest (added in 3d-1) | `supabase/tests/run.ts` |
| Supabase CLI for the server tests | 2.119.0, through `npx` locally, `supabase/setup-cli` in CI (added in 3d-2a; not a dependency) | `.github/workflows/ci.yml`, `docs/setup.md` |
| @supabase/realtime-js | 2.117.2, with `tslib` 2.8.1 and `@supabase/phoenix` 0.4.5 (added in 3d-2b; the packaged build must ship it with main) | `apps/desktop` |
| zod | 4.6.7 | `packages/ipc`, `apps/desktop` |
| immer | 11.1.21 (added in 3c) | `packages/core` |
| Fontsource Readex Pro (variable), IBM Plex Mono | 5.3.0, 5.3.0 (added in 3c) | `packages/ui` |
| Testing Library React, user-event; happy-dom | 16.3.3, 14.6.8; 21.0.3 (added in 3c) | root |
| @electron/fuses | 2.1.3 | `apps/desktop` |
| OSV-Scanner | 2.7.0 | CI (`go install`) |
| CodeQL action | 4.39.0 | CI |
| lefthook, lint-staged | 2.2.2, 17.6.0 | root |
| gitleaks | 8.30.1 | `tooling/hooks/scan-secrets.sh` (install hint), CI |
| Python | 3.14 | `services/pipeline/.python-version`, `requires-python` |
| uv | 0.13.1 or newer | `tool.uv.required-version`, CI |
| ruff, pyright, pytest | 0.17.1, 1.1.414, 9.1.1 | `services/pipeline` |
