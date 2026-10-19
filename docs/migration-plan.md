# Migration plan: from gratovo_code to gratovo_toolbox

Written 2026-10-19. This is a living document. Each step updates the status table and [handoff.md](handoff.md) in the same commit that finishes the work.

## 1. The goal

Replace the Flutter app (old repository `gratovo_code`) with a new desktop app that works the way the approved Workbench prototype shows: Electron, React and TypeScript on the desktop; the Python pipeline kept and cleaned; the same Supabase backend. The migration is done when:

1. every row of the [parity checklist](product/parity-checklist.md) is ticked or carries the owner's reason;
2. the team has moved to the new app and the old one is read-only;
3. this repository holds nothing the new app doesn't need (`legacy/` deleted, docs merged where that is clearer).

**Why rebuild rather than refactor:** the old app's lag comes from its frame (screens rebuilding on every sync tick and log line), its navigation spreads one job over several screens, and 102 of the 127 framework tasks are buried, partial or missing (one more sits outside the app). The prototype fixes the experience. The owner chose to rebuild it in the new stack instead of patching the old one. See [decisions/0002-stack.md](decisions/0002-stack.md).

## 2. Where things stand

| Date | Done |
|---|---|
| 2026-10-14 to 10-18 | The communications workflow (course-mined playbook, comms engine, checks) and the decisions build: the owner's answers to the workflow map, built into the old app and reviewed. All of it was committed in the old repo as `43596b8`. |
| 2026-10-18 | The workflow map: every framework task scored against the old app, 12 decisions and 34 house choices answered by the owner. A copy is in [product/workflow-map.html](product/workflow-map.html). |
| 2026-10-19 | The UX plan, made visual: the Workbench prototype (Today, Find, Reach, Close, Deliver, Insights, Toolbox, Team, Settings, prototype mode, comment tool, the Plan page). An independent review found 27 issues; all were fixed and covered by regression tests. Published at https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn (version 3). The source is in [design/workbench-prototype/](../design/workbench-prototype/README.md). |
| 2026-10-19 | The old repo committed (`43596b8`, not pushed) and a full physical copy made at `E:\IMA work\Code\gratovo_code backup 2026-10-19`. This repository was created empty and filled with the plan, the prototype, the product record, the project skills and a read-only `legacy/` copy of the old source (secrets excluded). |

## 3. Ground rules for the whole migration

1. **The old app keeps working until cutover.** The team uses it every day. Until step 11:
   - every Supabase change is additive (new tables and columns, never a rename or drop the old app relies on);
   - the new app keeps its own local data folder and only *imports* the old local database.
2. **The prototype is the specification.** When the prototype and a written description disagree, the prototype wins unless the owner said otherwise. Its Plan page and design notes (`js/plan.js`) say why each part exists.
3. **The parity checklist is the definition of done.** Step 10 walks it row by row, and nothing is waved through.
4. **`legacy/` is read-only.** Read it, port from it, never build or edit it. It is deleted in step 11.
5. **Security first.** No secret in git, ever. The Electron hardening in [SECURITY.md](../SECURITY.md) is part of the foundation, not a later polish.
6. **Small, verified steps.** Each step lands as one or more pull requests with green CI, and the owner checks the result in prototype mode before the next step starts.
7. **Cleanup is last.** Nothing is deleted from `legacy/` or merged in the docs before step 10 passes. This is the owner's explicit wish.

## 4. Owner actions

| # | Action | Blocks |
|---|---|---|
| A1 | **Rotate the leaked keys** listed in [SECURITY.md](../SECURITY.md#known-exposure-in-the-old-repository-action-for-the-owner): GitHub token, R2 keys, YouTube key, and any Supabase service-role or AWS keys still active. | Step 3d, before the new app talks to R2 or YouTube |
| A2 | **Create the empty private GitHub repository `gratovo_toolbox`** (no README, no license), or tell a local session to do it with your credentials. Then push this repository to it. Cloud sessions can only see GitHub. | Every cloud session |
| A3 | **Paste `legacy/backend/schema.sql` into Supabase before 2026-10-30.** After that date, new tables need explicit grants. Also set the agency sender name in the old app. These are carried over from the decisions build. | The old app's newest features |
| A4 | ~~Confirm or change the stack in [decisions/0002-stack.md](decisions/0002-stack.md).~~ **Done 2026-10-19:** confirmed (§9 Q8). | — |
| A5 | ~~Answer the open questions in §9.~~ **Done 2026-10-19.** | — |
| A6 | ~~Decide how team keys reach members (Q11) and where releases are published (Q12).~~ **Done 2026-10-19** (keys by server function; no code signing; installer location defaults to a private R2 bucket). | — |

## 5. Status

| Step | What | Status |
|---|---|---|
| 0 | Fresh repository | Done 2026-10-19 |
| 1 | Agree the design | Prototype approved for building. The open questions in §9 were answered 2026-10-19 |
| 2 | Choose the stack and record the decisions | Done as ADRs 0001 to 0006; the owner confirmed the stack (§9 Q8) |
| 3 | Foundation | **In progress.** 3a (toolchain and skeleton) and 3b (security baseline) done 2026-10-19. 3c in three parts: 3c-1 (the frame) and 3c-2 (the overlays) done 2026-10-19; 3c-3 (settings and checks) in progress (planned; 2 of 5 tasks built) |
| 4 | Today | Not started |
| 5 | Find | Not started |
| 6 | Reach | Not started |
| 7 | Close | Not started |
| 8 | Deliver | Not started |
| 9 | Insights, Toolbox, Team, Settings, and the data import | Not started |
| 10 | Check it 100% | Not started |
| 11 | Cutover, then clean up | Not started |

## 6. The steps

Each step lists: the goal, the work, what it takes from `legacy/`, and the acceptance checks that close it.

### Step 0. Fresh repository (done)

A clean history: no secrets and no build output. It holds docs, the design reference, project skills, and a read-only copy of the old source. The decision record is [decisions/0001-fresh-repository.md](decisions/0001-fresh-repository.md).

### Step 1. Agree the design

**Goal:** the owner is happy with the prototype as the spec.
**Work:** the owner reviews the prototype in its published form. With prototype mode on, they leave comments on anything, and the comments are saved with the artifact. A session reads them with the `ArtifactData` tool (collection `comments`) or from a pasted export ("Copy open for Claude"). It then changes the prototype or the plan, and republishes.
**Acceptance:** no open comments that change scope; the questions in §9 that block step 3 are answered.

### Step 2. Stack and decisions

**Goal:** the big choices are written down before code.
**Done:** ADRs for the fresh repo, the stack, secrets, prototype mode, the legacy folder, and local-first data. See [decisions/](decisions/).
**Confirmed** by the owner on 2026-10-19 (A4, §9 Q8).

### Step 3. Foundation

The longest step. It builds everything the screens stand on, so every later step is mostly UI and domain logic. It splits into sub-steps, each its own pull request.

**3a. Toolchain and repository skeleton**
- A pnpm workspace with the layout from [architecture.md](architecture.md#repository-layout): `apps/desktop`, `packages/core`, `packages/ui`, `services/pipeline`, `services/gemini-extension`, `supabase/`.
- TypeScript strict everywhere; ESLint (typescript-eslint, React hooks, jsx-a11y); Prettier; Vitest; Playwright for Electron.
- Python: `uv`, `pyproject.toml`, ruff (lint and format), pyright, pytest.
- Pre-commit hooks (lefthook or simple-git-hooks): format, lint and gitleaks on staged files.
- Pin every version through the lockfiles. Use the current stable Electron, React and TypeScript at the time this step starts, and record them in `architecture.md`.
- *Acceptance:* `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `uv run pytest` all pass on a clean clone, on Windows and in CI.

**3b. Security baseline**
- The Electron settings in [SECURITY.md](../SECURITY.md#desktop-app-hardening-applies-from-step-3): context isolation, sandbox, CSP, the typed IPC bridge with zod validation, navigation and permission guards, fuses.
- A `secrets` module in the main process on top of `safeStorage`: get, set, delete and list key names. The renderer never sees a secret value.
- CI: gitleaks, `pnpm audit` / OSV, CodeQL for JS/TS and Python, Dependabot.
- *Acceptance:* a test proves the renderer cannot reach Node or any IPC channel outside the allowlist; gitleaks and audit pass in CI.

**3c. App shell (from the prototype)**
- Port the design tokens from `design/workbench-prototype/index.html`: colours for light and dark, the phase hues, type (Readex Pro and IBM Plex Mono), spacing, radii, easing curves and density. They become CSS custom properties in `packages/ui`.
- The frame: rail (with live counts, collapse, and the account button), top bar (back and forward, crumbs, Ctrl K, jobs, bell, save state), peek panel, toasts with Undo, menus, tooltips, the shortcut sheet, the problems bar.
- Keyboard system: a key stack with barriers, single-letter keys off while typing, and a setting to turn them off. No animation after a key press.
- Store pattern: actions with undo snapshots, UI-only state, background jobs that survive undo (as `W.act`, `W.ui` and `W.bg` do in the prototype's `core.js`).
- Settings shell: the sections and the search from the prototype's `settings.js`. Real contents arrive with the features they control.
- Accessibility: all of it works by keyboard, focus is visible, roles are correct, and contrast passes in both themes.
- *Acceptance:* the frame matches the prototype at 1440 px and at 400 px in light and dark (screenshot comparison); Playwright tests for palette, peek, undo, menus, Esc order and key barriers; no layout shift or animation on keyboard actions.

**3d. Data layer**
- A local SQLite database in the app's own data folder (better-sqlite3 in the main process, or in a utility process if profiling says so). Forward-only SQL migrations, and repositories with typed queries.
- One `DataSource` interface with two implementations:
  - **live:** local SQLite plus the Supabase sync engine;
  - **example:** an in-memory or temp-file copy seeded from fixtures ported from the prototype's `data.js`.
  The UI never knows which one it is using.
- Port the sync engine from `legacy/lib/core/sync/`: pull by `updated_at` cursor with tombstones, the outbox, compare-and-set edits, conflicts. The design is in `legacy/PROJECT_STRUCTURE.md` §3.1 and §9.
- Supabase: move `legacy/backend/schema.sql` into `supabase/migrations/` as a baseline migration that matches production exactly. Every later change is a new, additive migration. Port the SQL tests from `legacy/backend/tests/` to run in CI with Docker.
- Team keys served after sign-in by a server function (the owner's answer, §9 Q11). Never in the installer or the repository.
- *Acceptance:* repository tests on a temp database; sync tests against a local Supabase (CLI); the old app still works against the same Supabase project after the migrations run.

**3e. Python pipeline, ported and cleaned**
- Copy `legacy/pipeline/` into `services/pipeline/` piece by piece, keeping only what the new app calls:
  - `search.py` and the `gratovo` package (store, pipeline, r2, sync, feeds, gmail and mailbox, vendored scrapetube);
  - the tools still in use;
  - `comms/` (the comms engine, playbook, checks);
  - `gemini_bridge/`;
  - the tests.
  Drop what the decisions build already retired.
- Package it as a proper project: `pyproject.toml`, a `src/` layout, ruff, pyright, and pytest with no network.
- Replace raw `.env` reading with config passed by the app at launch, with secrets handed over from `safeStorage`.
- The app talks to the pipeline over stdin and stdout JSON lines, as the old app does. The message types are written down as a schema shared with TypeScript (JSON Schema or zod generating types). The protocol docs are in `legacy/pipeline/gemini_bridge/DAEMON.md` and `PROTOCOL.md`.
- Bring the course data the comms engine needs (`legacy/data/comms/`) into `services/pipeline/data/`.
- *Acceptance:* all ported pytest suites pass; the app starts a search, streams progress and shows results, using the example data source in tests and the live one by hand.

**3f. Prototype mode and the comment tool**
- Built as in the prototype (`proto.js`, `comments.js`): an owner-only switch in Settings, off by default, and invisible when off.
  - When on, the live data is set aside and an example copy is used.
  - Scenarios: a normal Monday, the first day, a week later, something broke.
  - See the app as a teammate.
  - The comment tool: press C, click anything, write. Pins anchor to stable `data-ui` ids that components carry.
- In this mode the outbound adapters are stand-ins: Gmail send, Gemini, YouTube and R2 writes do nothing real.
- Comments are kept in a `comments` table in the local database and exported to `docs/feedback/comments.json` on demand, so any session can read and act on them (the owner's answer, §9 Q9).
- *Acceptance:* the prototype's `proto_flow.py` and `review_fixes.py` checks, rewritten as Playwright tests against the real app, all pass. With the mode off there is no trace (an automated check).

**3g. Continuous integration**
- GitHub Actions: lint, typecheck, unit tests, Electron end-to-end tests and pytest on Windows (the only system the app supports); gitleaks, the audit and CodeQL on Linux runners, since they only read files. All of these run from 3b; the SQL tests remain. The SQL tests use Supabase's local stack in Docker, which needs Linux containers that GitHub's Windows runners don't offer: decide in 3d where they run. That tests the backend, not the app on Linux.
- Branch protection on `main`: pull requests only, CI green.
- *Acceptance:* a pull request with a failing test cannot merge.

**3h. Packaging spike**
- electron-builder NSIS installer for Windows; the Python runtime bundled with python-build-standalone via uv. The target machines have no Python.
- Auto-update with electron-updater from a private location (default: a private R2 bucket, URLs handed out by the server function). Builds are unsigned by the owner's choice (§9 Q12); the updater is configured to accept them.
- No code signing (§9 Q12): the app is for the owner and a few trusted members. Document the first-run Windows warning for them.
- *Acceptance:* an installer built in CI installs on a clean Windows machine, runs a search on example data, and updates itself to a newer test build.

### Step 4. Today

**Goal:** a full day of outreach worked from Today alone.
**Work:** port the next-action engine (`items()` in the prototype's `engine.js`) into `packages/core` with unit tests: buckets, money first, owners, snoozes, quick wins, roles. Then build the queue, the day band (budget, mailboxes, done today), the work panel for each item kind, focus mode, wrap-up, the first-day screen, hand-off and snooze.
**Legacy:** `legacy/lib/features/my_day/` (the old aggregator) for the data each item needs.
**Acceptance:** parity checklist rows for the *daily* step plus every Today row in §2 and §3; the prototype's Today flows pass as Playwright tests.

### Step 5. Find

**Goal:** from a keyword to a confirmed contact without leaving Find.
**Work:**
- the search console (keywords, rules, live panel, runs, a teammate's run);
- triage (S, R and 1–4 keys);
- the gallery (facets, saved views, compare, bulk actions);
- contacts (the email finder in the background, sources and confidence, confirm).
**Legacy:** `legacy/lib/features/search/`, `influencers/`, `archive/`; `legacy/pipeline/gratovo/pipeline.py`, `tools/enrich.py`, `found_emails.py`.
**Acceptance:** the *search*, *qualify* and *contacts* rows of the parity checklist; `find_flow.py` as Playwright tests.

### Step 6. Reach

**Goal:** every send, follow-up and reply from one card.
**Work:**
- the draft card (gates, rewrite, send later, mailbox picker);
- mailboxes (limits, warm-up, health);
- sequences;
- the replies inbox, where the app reads replies by default and a small, quiet paste box covers failures (the owner's choice);
- the Gemini bridge and the comms engine wired to drafts.
Nothing is sent without approval.
**Legacy:** `legacy/lib/features/outreach/`, `legacy/pipeline/comms/`, `gemini_bridge/`, `gemini_extension/`, `tools/email_send.py`, `gratovo/mailbox.py`.
**Acceptance:** the *cold*, *followups*, *replies*, *mediakit* and *mail* rows; the tests prove no automatic send.

### Step 7. Close

**Goal:** a creator signed and pitched with no side spreadsheets.
**Work:** the audience check, the roster, the brands board (qualify), match, the pitch picker, the negotiation ladder, and contracts (creator signs first).
**Legacy:** `legacy/lib/features/brands/`, `deals/` (terms, contracts).
**Acceptance:** the *audience*, *sign*, *brands*, *pitch*, *negotiate* and *contracts* rows.

### Step 8. Deliver

**Goal:** a deal from contract to the next pitch inside the app.
**Work:** the deal board and the 10-step checklists; the brief and draft review; pre-live checks; the go-live email; invoices (Net 30) with aging; payouts locked until the brand pays; the 30-day report; the next deal.
**Legacy:** `legacy/lib/features/deals/` (30-day report, video stats), `legacy/pipeline/tools/video_stats.py`.
**Acceptance:** the *brief*, *prelive*, *golive*, *invoice*, *report*, *payout* and *nextdeal* rows.

### Step 9. Insights, Toolbox, Team, Settings, and the data import

**Work:**
- Insights with drill-downs; Toolbox (calculator, archive, never-contact, scheduled, log); Team (load, roles, hand-offs, rebalance); every Settings section with real effect.
- The old app's capabilities outside the framework (parity checklist §6): decide each one with the owner, then port it or drop it.
- **Data import:** on first run the new app imports the old local database (`gratovo.db`) after a backup. A dry run reports what moves.
**Acceptance:** the *teamops* rows and §6 of the parity checklist; an import rehearsal on a copy of a real `gratovo.db` with a written report.

### Step 10. Check it 100%

**Goal:** prove nothing was lost.
**Work:**
- walk the parity checklist row by row in the real app, ticking each with how it was checked;
- an independent review pass (a fresh reviewer agent);
- a security review (`claude-security` scan and `sentry-security-review`);
- a performance check against the speed rules (opens in under 2 s, every click under 100 ms).
**Acceptance:** every row ticked or carrying the owner's reason; no open Important findings.

### Step 11. Cutover, then clean up (last)

**Work, in this order:**
1. **Cutover:** a date with the team. Install the new app on every machine, import local data, and turn the old app read-only (an update with a banner). Supabase migrations that remove what only the old app used run only after this.
2. **Clean up this repository** (the owner's request of 2026-10-19):
   - delete `legacy/`;
   - remove anything unused or awkward;
   - merge docs where one file reads better than several;
   - list everything removed in the pull request.
   The old repo's stale files (for example `migrate_v2.sql` and `.env.example`) were never copied, so they need no removal here.
3. **Archive the old repository** on GitHub (read-only). Keep the physical backup copy.

## 7. What comes over from the old repository

| Old path | Action | Step |
|---|---|---|
| `lib/` (Flutter app) | Reference only. Behaviour is ported screen by screen, never the code. | 3c to 9 |
| `test/` | Reference for behaviour and edge cases worth keeping. | 3 to 9 |
| `pipeline/` | Ported into `services/pipeline/`, cleaned (pyproject, src layout, typed). | 3e |
| `pipeline/gemini_extension/` | Ported into `services/gemini-extension/`, later moved to TypeScript. | 6 |
| `backend/schema.sql`, `backend/tests/` | A baseline migration and the SQL tests in `supabase/`. | 3d |
| `backend/SETUP.md` | Rewritten as `docs/setup.md` for the new stack. | 3d |
| `backend/migrate_v2.sql` | Not carried over (one-off, already applied). | – |
| `data/comms/` (playbook, skill, tests) | Moved with the pipeline. | 3e |
| `data/settings.json`, `keywords.json`, `all_keywords.txt`, `run_config.json`, `reset_manifest.json` | Pipeline config, reviewed and moved. | 3e |
| `data/gemini skills/` | Moved if the keyword and classifier prompts still need them. | 3e |
| `data/.env` | **Never.** Rotate its keys (A1). | – |
| `assets/` (fonts, logo) | Logo and icons into `apps/desktop/resources`. Fonts are already chosen in the prototype. | 3c |
| `scripts/` (build, version, installer) | Replaced by electron-builder and release workflows. The versioning rule is reused. | 3h |
| `.github/workflows/` | Replaced by new CI. | 3g |
| `docs/plans/*` | Reference. Their decisions are in `product/` and this plan. | – |
| `android/`, `ios/`, `web/`, `windows/` | Not copied (generated Flutter runners). | – |

## 8. Risks

| Risk | How it's handled |
|---|---|
| The old app breaks because Supabase changed under it | Additive-only migrations until cutover; the old app is tested against the migrated schema in step 3d. |
| Data loss at import | Backup first, dry-run report, import into the new app's own folder; the old database is never modified. |
| Secrets leak again | gitleaks before commit and in CI; secrets only in `safeStorage` or server-side; the renderer never sees them. |
| Gemini account blocks | The owner's pacing rules are built into the bridge (3 tabs, 60 s gap, refusal toast means pause). |
| Scope creep | The parity checklist is the scope. New ideas go to the owner as comments in prototype mode, not into the current step. |
| The cloud session lacks context | `CLAUDE.md`, `handoff.md` and the step's `.router/` state are committed at the end of every working session. |
| Electron performance | The speed rules from the plan, checked in step 10: one query per screen, the frame doesn't re-render on sync ticks, screens you leave stop work, database off the UI thread. |

## 9. Open questions

From the prototype's Plan page, plus new ones from today. Each one names the step that needs the answer.

All twelve were answered by the owner on 2026-10-19. The consequences are written into the steps they affect.

| # | Question | Answer | Step |
|---|---|---|---|
| 1 | Should VAs see money (invoices, payouts, margins)? | **No.** As in the prototype: money screens and amounts are hidden for VAs, and brand work that needs prices routes to the owner. | 4 |
| 2 | One 4-hour budget for everyone, or per person? | **Per person.** Each team member has their own daily hours. Default 4, set by the owner in Settings. | 4 |
| 3 | Which emails need a second pair of eyes? | **Nothing is sent without approval.** Approve-all stays the rule for every email, so no price or new-VA threshold is needed. | 6 |
| 4 | When do Instagram and TikTok come in? | **Not in this migration.** Email only. Social channels become a separate project after cutover. | 5 |
| 5 | Invoices: sent from the app, or tracked only? | **Made in an accounting tool and only tracked here.** The app records status and amounts and links to the invoice. It does not generate PDFs. | 8 |
| 6 | Contracts: files in the app, or an e-signature service? | **A link to an e-signature service.** The app tracks status and links to the signed document. | 7 |
| 7 | Reply reading: which mailboxes, how long kept? | **Connected mailboxes only; keep everything.** No retention purge. The rule "never read the connected mailbox" for sessions still holds ([owner-rules.md](product/owner-rules.md)). | 6 |
| 8 | Confirm the stack | **Accepted** (A4): Electron, React and TypeScript. | 3 |
| 9 | Prototype comments: file or team database? | **A file in the repository** (`docs/feedback/comments.json`, exported on demand) so any session can read it. | 3f |
| 10 | Prototype mode: owner only, or also VA training? | **Owner only.** | 3f |
| 11 | Team keys (YouTube, R2) | **Served after sign-in from a server function.** Never in the installer or the repository. | 3d |
| 12 | Releases and code signing | **No code signing.** The app is for the owner and a few trusted members, so no certificate is bought. Windows will warn on first install, and members click through it. Updates still work unsigned. Where installers live was not chosen: the default is a private R2 bucket, handed out through the same server function as the team keys (builder's call, change it if you prefer). | 3h |

