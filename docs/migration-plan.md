# Migration plan: from gratovo_code to gratovo_toolbox

Written 2026-10-19. This is a living document. Each step updates the status table in the same commit that finishes the work; while a step is in progress, `.router/PROGRESS.md` says where it stopped.

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
| 2026-10-21 | **Change of plan (owner): solo first.** Everything that exists only for the team waits until the app is fully functional for one person. It moves into one new step, [T](#step-t-team-work-and-packaging-after-the-app-works-for-one-person), which runs after step 9 and before the 100% check. The app keeps what 3d-2 already built (sign-in, roles, sync, presence); no more is built on it until T. |
| 2026-10-24 | **Change of plan (owner): pipeline-first.** After 3e-3b the rest of the plan is reordered along the real business pipeline, so the app is usable for real solo outreach as early as possible: live data and connections (step 4), Find (5), Reach up to reading replies (6), then Today with prototype mode and the CI gate (7), Signing and Close (8), Deliver and Insights (9). Work from the old step 9 (the data import, the Settings that run the pipeline, the Toolbox parts Find needs) moves to the stage that needs it. 3e-2 and 3h move to step T; 3f and 3g move to step 7. Nothing is dropped. Ground rules 9 and 10 are added. |
| 2026-10-19 | The old repo committed (`43596b8`, not pushed) and a full physical copy made at `E:\IMA work\Code\gratovo_code backup 2026-10-19`. This repository was created empty and filled with the plan, the prototype, the product record, the project skills and a read-only `legacy/` copy of the old source (secrets excluded). |

## 3. Ground rules for the whole migration

1. **Nobody uses the old app, and nothing keeps it working** (owner, 2026-10-20: "I don't care about the old app at all, no one is or will use it"). Until then this rule said the old app keeps working until cutover. Now:
   - a Supabase change never destroys or rewrites existing data, stays additive where that costs nothing, and anything that alters what exists gets its own decision and its own production step with the owner's go;
   - the new app keeps its own local data folder and only *imports* the old local database.
2. **The prototype is the specification.** When the prototype and a written description disagree, the prototype wins unless the owner said otherwise. Its Plan page and design notes (`js/plan.js`) say why each part exists.
3. **The parity checklist is the definition of done.** Step 10 walks it row by row, and nothing is waved through.
4. **`legacy/` is read-only.** Read it, port from it, never build or edit it. It is deleted in step 11.
5. **Security first.** No secret in git, ever. The Electron hardening in [SECURITY.md](../SECURITY.md) is part of the foundation, not a later polish.
6. **Small, verified steps.** Each step lands as one or more pull requests that passed `pnpm verify` (the local gate; GitHub Actions is manual only since 2026-10-25), and the owner checks the result in the real app before the next step starts (in prototype mode, once step 7 builds it, for screens not wired yet).
7. **Cleanup is last.** Nothing is deleted from `legacy/` or merged in the docs before step 10 passes. This is the owner's explicit wish.
8. **Solo first** (owner, 2026-10-21). The app is made fully functional for one person before any work that exists only for the team. Team work is everything about sharing with or coordinating other people: sharing results through R2, a teammate's run and overlap warnings, hand-offs, the Team screen and rebalancing, the team view of Today, "see the app as a teammate", new-VA onboarding, and updates for other members' machines. All of it is in [step T](#step-t-team-work-and-packaging-after-the-app-works-for-one-person). Data fields that carry an owner or a role stay (they cost nothing and the owner is the only person for now), and what 3d-2 built is kept as it is. When a step's work turns out to be team work, move it to T and say so here.
9. **Pipeline-first order, and no dead screens in live mode** (owner, 2026-10-24). The steps follow the business pipeline: live data, then Find, then Reach, then Today, then Close and Deliver. Each step pulls in what its stage needs from later steps (settings, Toolbox parts, the import) instead of waiting for them. In live mode, the rail, the top bar, the command palette (Ctrl K) and the tabs inside a screen show only what is fully wired to real data and real handlers. A screen or tab that a later step builds is hidden in live mode, so the owner never clicks a dead or mock element during real work. Today stays hidden until Find and Reach feed it (step 7). Once prototype mode exists (step 7), turning it on switches to `example.db` and shows the whole Workbench, unwired stages included, for review and comments.
10. **Two-tier testing** (owner, 2026-10-24). While a sub-step is built, its pull request needs the fast checks (`pnpm lint`, `pnpm typecheck`, `pnpm test`: Vitest and pytest) plus **at most one** light Electron smoke test that proves the new screen renders and completes its main IPC round trip. The full Playwright flow suite for a stage (the keyboard matrix, undo edge cases, full parity flows) runs as one batch at the end of the major step, not across every sub-PR. Tests that already exist keep running on every pull request, in `pnpm verify`.

## 4. Owner actions

| # | Action | Blocks |
|---|---|---|
| A1 | **Rotate the leaked keys** listed in [SECURITY.md](../SECURITY.md#known-exposure-in-the-old-repository-action-for-the-owner): GitHub token, R2 keys, YouTube key, and any Supabase service-role or AWS keys still active. **Deferred by the owner on 2026-10-20:** no rotation for now; the new app uses the existing keys from the old repo's `data/.env`, entered at run time (the app's secret store, Supabase function secrets), never copied into this repository. | Not blocking (deferred) |
| A2 | **Create the empty private GitHub repository `gratovo_toolbox`** (no README, no license), or tell a local session to do it with your credentials. Then push this repository to it. Cloud sessions can only see GitHub. | Every cloud session |
| A3 | ~~**Paste `legacy/backend/schema.sql` into Supabase before 2026-10-30.**~~ **Done by the owner by 2026-10-20.** After that date, new tables need explicit grants. Still open: set the agency sender name in the old app (carried over from the decisions build). | Sender name only |
| A4 | ~~Confirm or change the stack in [decisions/0002-stack.md](decisions/0002-stack.md).~~ **Done 2026-10-19:** confirmed (§9 Q8). | — |
| A5 | ~~Answer the open questions in §9.~~ **Done 2026-10-19.** | — |
| A6 | ~~Decide how team keys reach members (Q11) and where releases are published (Q12).~~ **Done 2026-10-19** (keys by server function; no code signing; installer location defaults to a private R2 bucket). | — |

## 5. Status

| Step | What | Status |
|---|---|---|
| 0 | Fresh repository | Done 2026-10-19 |
| 1 | Agree the design | Prototype approved for building. The open questions in §9 were answered 2026-10-19 |
| 2 | Choose the stack and record the decisions | Done as ADRs 0001 to 0006; the owner confirmed the stack (§9 Q8) |
| 3 | Foundation | **Done for the solo foundation** (2026-10-24): 3a, 3b, 3c, 3d-1, 3d-2a, 3d-2b, 3e-1, 3e-3a and 3e-3b. 3e-2 (R2 sharing) and 3h (installer, bundled Python, updater) moved to step T; 3f (prototype mode and the comment tool) and 3g (branch protection) moved to step 7 (owner, 2026-10-24). History: 3a (toolchain and skeleton) and 3b (security baseline) done 2026-10-19. 3c done 2026-10-20, in three parts: 3c-1 (the frame), 3c-2 (the overlays), 3c-3 (settings and checks; the app made dark only). 3d-1 (the local data layer) done 2026-10-20. 3d-2a (sign-in, roles, the network allowlist, team keys) done 2026-10-20, rolled out to production with the owner's go. 3d-2b (the sync) done 2026-10-21 (#12), its three migrations rolled out with the owner's go. 3e-1 (the pipeline's search, end to end on this computer) done 2026-10-21 (#14): ADR 0013. **3e-3 done** (the rest of the pipeline), two pull requests: **3e-3a** (the Gemini bridge and the comms engine) done 2026-10-23: ADR 0014. **3e-3b** (mail, video stats, refetch, backfill and the AWS gateways) done 2026-10-24: ADR 0015. A1 (key rotation) is deferred by the owner: use the existing keys, never in the repository |
| 4 | Live data import and operational connections | **Done 2026-10-24** ([ADR 0016](decisions/0016-live-data-and-connections.md)): the live gate, the import of the old `gratovo.db` (rehearsed on a copy of the owner's real file), Settings › Search rules, Writing rules and Connections (Gmail consent, Gemini bridge with the per-launch token, course folder, routing, AWS), the add-on in `services/gemini-extension` |
| 5 | Find (search, triage, gallery, contacts; Toolbox › Archive, Never-contact, Activity log) | **In progress**, five pull requests (plan in `.router/PLAN.md`). **5a done** 2026-10-24: the catalog (pipeline channels joined to creators, queried in main), fit with its reasons, shortlist, reject, bring back and never-contact through the sync, pictures through main, Find › Review new, the run history, searches skipping never-contact channels. **5b done** 2026-10-24: Find › Gallery (facets with counts, saved views, card sizes, table, Shift and Ctrl selection, bulk shortlist and reject, compare 2–4) and the creator record in the peek and on its page (the next step, Overview, Notes synced with a conflict check, Activity). **5c done** 2026-10-25: Find › Contacts (each found address with where it came from and how sure, Confirm, Confirm all 90%+, a typed address, the reader's name), the email lookup after a shortlist on live data (refetch jobs in the tray), `pipeline.db` version 3 with each address's source, the confirmed address stored as the primary contact through the sync, and Gemini keyword ideas in the Keywords card. **5d done** 2026-10-25: Toolbox in the live rail with three tools. **Archive**: rejected channels with the countdown (the owner's archive days) and Bring back; a sweep (at start, hourly, when Archive opens) archives for good the ones past their date, on this computer only; "Archived for good" lists every tombstone, searchable, with Bring back (live data reads the channel again). Old rejects with no date are never swept. **Never contact**: the list with each reason, add a channel from the catalog, Allow again with a confirm. **Activity log**: the whole log, by person, grouped by day, 30 at a time. **5d-2 done** 2026-10-25: archiving never makes us know less. The tombstone keeps every fact (name, country, subscribers, median, uploads, the videos we had, sponsors, addresses, and every keyword that found the channel with its time), archiving again only adds, and Bring back puts the row and its keyword links back. A failed read is never taken as zero uploads: it is retried after 1, 3, then 7 days and given up after 3. Find says "Not read yet" or "Couldn't read", never 0. `pipeline.db` version 4. **Next: 5e** (the Find flow suite, ADR 0017) |
| 6 | Reach, up to reading replies and their intent | Not started |
| 7 | Today, prototype mode (was 3f), branch protection (was 3g) | Not started |
| 8 | Creator signing and Close | Not started |
| 9 | Deliver and Insights | Not started |
| T | Team work and packaging (3e-2 R2 sharing, a teammate's run, hand-offs, the Team screen, new-VA onboarding, 3h installer and updater) | **Waits** until step 9 is done (owner, 2026-10-21 and 2026-10-24) |
| 10 | Check it 100% | Not started. Runs after T |
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

### Step 3. Foundation (done for the solo foundation)

The longest step. It builds everything the screens stand on, so every later step is mostly UI and domain logic. It splits into sub-steps, each its own pull request. Done on 2026-10-24 for one person. Of its original sub-steps, 3e-2 and 3h moved to [step T](#step-t-team-work-and-packaging-after-the-app-works-for-one-person) and 3f and 3g to [step 7](#step-7-today-prototype-mode-and-the-ci-gate) (owner, 2026-10-24).

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
- Accessibility: all of it works by keyboard, focus is visible, roles are correct, and contrast passes (in dark: the app is dark only for now, owner 2026-10-20).
- *Acceptance:* the frame matches the prototype at 1440 px in dark (the owner dropped the 400 px and light checks on 2026-10-20: Windows desktop only, dark only for now) (screenshot comparison); Playwright tests for palette, peek, undo, menus, Esc order and key barriers; no layout shift or animation on keyboard actions.

**3d. Data layer**
- A local SQLite database in the app's own data folder (Node's built-in `node:sqlite` in the main process; a utility process if profiling says so). Forward-only SQL migrations, and repositories with typed queries.
- One `DataSource` interface with two implementations:
  - **live:** local SQLite plus the Supabase sync engine;
  - **example:** `example.db`, seeded from fixtures ported from the prototype's `data.js` and kept across restarts.
  The UI never knows which one it is using.
- Port the sync engine from `legacy/lib/core/sync/`: pull by `updated_at` cursor with tombstones, the outbox, compare-and-set edits, conflicts. The design is in `legacy/PROJECT_STRUCTURE.md` §3.1 and §9.
- Supabase: move `legacy/backend/schema.sql` into `supabase/migrations/` as a baseline migration that matches production exactly. Every later change is a new, additive migration. Port the SQL tests from `legacy/backend/tests/` to run in CI with Docker.
- Team keys served after sign-in by a server function (the owner's answer, §9 Q11). Never in the installer or the repository.
- *Acceptance:* repository tests on a temp database; sync tests against a local Supabase (CLI); the old app still works against the same Supabase project after the migrations run.
- *Owner decisions (2026-10-20):* 3d is two pull requests: **3d-1**, the local database, the `DataSource` with example data, the Supabase migrations and the SQL tests; **3d-2**, sign-in, the sync engine and the team-keys function. Sign-in is **email and password**, as in the old app. The SQL tests run in a **Linux CI job with Docker** (it tests the database, not the app, so the Windows-only rule holds). Production already has `schema.sql` (A3 done); no session runs anything against production without the owner's go. SQLite is Node's built-in `node:sqlite` (checked in Electron 44: no native module to rebuild).
- *3d-1 (done 2026-10-20, [ADR 0010](decisions/0010-data-layer.md)):* the local database and migrations, the repositories, the example and live sources with one shared contract suite, `frame:load` and `data:write`, the renderer reading and writing through them (your name moved to the account), the Supabase baseline migration, and the SQL tests in a Linux CI job. The old pass 2 of the SQL tests (upgrading an old schema) is dropped with `migrate_v2.sql`. *Acceptance:* lint, typecheck, unit and Electron tests pass, including a change surviving a restart; `pnpm test:sql` and its CI job pass.
- *3d-2 (next):* email and password sign-in (session in `safeStorage`), the sync engine (pull, outbox, compare-and-set, tombstones), the main-process network allowlist, the team-keys server function, `docs/setup.md`. *Owner answers (2026-10-20) to ADR 0010's questions:* agency roles are a list per person (Owner, Scout, Outreach, Deal lead, Delivery; [owner-rules](product/owner-rules.md#who-the-app-is-for)), apart from access, with "sees money" its own switch; Supabase gains additive columns for the app's creator stage, a brand's sells and status, and a deal's flow step, while the app keeps writing the legacy fields; an undo reaches the server as a new `activity_log` line, never a delete; notification switches are per person; production runs Postgres 17.6 (the SQL tests' 17.11 is the same major). *Owner answers (2026-10-20, on the 3d-2 recon):* "sees money" hides prices in the new app now, and the database locks them when the old app retires (steps 10 and 11), because the old app reads them for every member; the YouTube key (Supabase Vault, members only) and R2 access (short-lived signed links from a server function) are both built in 3d-2; 3d-2 is two pull requests, **3d-2a** (sign-in, the session, roles and "sees money", the network allowlist, the team keys, `docs/setup.md`) and **3d-2b** (the sync: pull, outbox, compare-and-set, tombstones, conflicts, live updates and presence); migrations reach production through the Supabase MCP, with the owner's go before each change, and the owner enters the key values in Supabase themselves (no session reads or handles them). *Acceptance:* as 3d above: sync tests against a local Supabase, and the old app still works against the same project. *3d-2a done (2026-10-20,* [ADR 0011](decisions/0011-accounts-roles-team-keys.md)*):* sign-in, the waiting screen, sign-out, roles and "sees money" in `member_access`, the network allowlist, the YouTube key in Vault, the `r2-access` function, `docs/setup.md`, and a CI job running server tests on a local Supabase. Production gained the migration history, the two additive migrations, the owner as Owner and the deployed function; the owner checked the old app afterwards. *Owner answers (2026-10-20) for 3d-2b:* one pull request; `gratovo.db` stays unencrypted, with BitLocker advised; unsent changes are kept on sign-out for the same account only; the app holds the 5,000 most relevant creators until step 5's search; private Realtime channels of the app's own, with its own small presence, not the old app's channels or fields; and the old app no longer matters (ground rule 1). Money stays readable in the database until steps 10 and 11 (owner, 2026-10-21). *3d-2b done (2026-10-21,* [ADR 0012](decisions/0012-sync-engine.md)*):* the sync engine in main (keyset pull with tombstones and the horizon, a FIFO outbox of intent, compare-and-set for a creator's stage with conflicts you settle, brands and deal steps), events from main to the page, Realtime on private topics and presence, the sync state in the top bar, sign-out keeping unsent changes; three migrations applied to production.

**3e. Python pipeline, ported and cleaned**
- Copy `legacy/pipeline/` into `services/pipeline/` piece by piece, keeping only what the new app calls:
  - `search.py` and the `gratovo` package (store, pipeline, feeds, gmail and mailbox, vendored scrapetube). `r2.py` and `sync.py` (sharing results through R2) move to [step T](#step-t-team-work-and-packaging-after-the-app-works-for-one-person) (solo first, ground rule 8);
  - the tools still in use;
  - `comms/` (the comms engine, playbook, checks);
  - `gemini_bridge/`;
  - the tests.
  Drop what the decisions build already retired.
- Package it as a proper project: `pyproject.toml`, a `src/` layout, ruff, pyright, and pytest with no network.
- Replace raw `.env` reading with config passed by the app at launch, with secrets handed over from `safeStorage`.
- The app talks to the pipeline over stdin and stdout JSON lines, as the old app does. The message types are written down as a schema shared with TypeScript (JSON Schema or zod generating types). The protocol docs are in `legacy/pipeline/gemini_bridge/DAEMON.md` and `PROTOCOL.md`.
- Bring the course data the comms engine needs (`legacy/data/comms/`) into `services/pipeline/data/`.
- *Owner answers (2026-10-21) for 3e-3:* two pull requests, **3e-3a** (the Gemini bridge, the comms engine with its course data and the transcripts) and **3e-3b** (Gmail and the mailbox, video stats, refetch and backfill, the AWS gateway tool). The comms quality tools (coach, graduate bar, pairwise, scenarios, call mining, quote review, Whisper check) are ported as tools a session runs by hand. The course text for the copy check comes from a folder path in Settings on this computer; without it, that one check is skipped and the draft says so. News and the Email library wait for their parity §6 decision (step 9). The plan is in `.router/PLAN.md` while 3e-3 runs.
- *Acceptance:* all ported pytest suites pass; the app starts a search, streams progress and shows results, using the example data source in tests and the live one by hand.

**3f, 3g and 3h** were the last three sub-steps. On 2026-10-24 the owner moved them: prototype mode and the comment tool (3f) and branch protection (3g) to [step 7](#step-7-today-prototype-mode-and-the-ci-gate), and packaging (3h) to [step T](#step-t-team-work-and-packaging-after-the-app-works-for-one-person) as T5. Their full text is there. CI itself has run on every pull request since 3b.

### Step 4. Live data import and operational connections

Pulled from the old step 9 (the import, the Settings that run the pipeline) and the old step 6 (the browser add-on), owner 2026-10-24.

**Goal:** the owner's real data is in the new app, and every connection and setting that Find and Reach need works.
**Work:**
1. **The data import.** On first run, or from Settings, the app imports the owner's old local databases (`gratovo.db`, plus the pipeline's `pipeline.db` and `mailbox.db` where they exist) into its own data folder. It makes a backup first and shows a dry-run report of what moves before anything is written. The old files are never modified (ground rule 1).
2. **Settings that run the pipeline**, with real saving and real effect:
   - **Connections:** the mailboxes (connecting a Gmail mailbox, its health), the course folder for the comms copy check, the YouTube key, proxies and the AWS gateways, and the Gemini bridge's status;
   - **Search rules:** default countries, minimum median views, upload filters, the 7-day archive rule;
   - **Writing rules:** the house rules passed to drafts.
3. **The Gemini browser add-on.** Port `legacy/pipeline/gemini_extension/` into `services/gemini-extension/` and check that it connects to the 3e-3a bridge on `127.0.0.1` with the per-launch token.
4. **The live rail** (ground rule 9). In live mode, hide the screens no step has wired yet (Today, Close, Deliver, Insights, Team) everywhere they can be reached: the rail, the palette, keys and links. Show Settings, then Find and Toolbox as they come online.

**Legacy:** `legacy/lib/core/db/` and the old app's data folder for `gratovo.db`; `legacy/pipeline/gratovo/store.py` and `mailbox.py` for `pipeline.db` and `mailbox.db`; `legacy/data/settings.json` and `keywords.json`; `legacy/lib/features/settings/`; `legacy/pipeline/gemini_extension/`.
**Acceptance:** a dry run and a real import tested against a copy of a real `gratovo.db`, with a written report; the Settings sections persist and configure the pipeline and the bridge; the add-on connects to the bridge; in live mode only wired screens can be reached.

### Step 5. Find

**Goal:** from keywords to shortlisted creators with confirmed addresses, using real pipeline runs, without leaving Find.
**Work:**
1. **The search console:** paste and manage keywords, Gemini keyword ideas inline, the search rules inline, the live run panel with Start, Pause and Resume (the `search` job), the progress ring, and the run history with "Review what it found". A teammate's run and the overlap warning wait for step T.
2. **Triage:** one channel at a time (S shortlist, R reject with the 1–4 reasons), the 7-day archive toast with Undo.
3. **The gallery and the creator record:** facets with counts, saved views, the fit score with its reasons (`packages/core`), sponsor tags, multi-select bulk actions, and the peek panel and record (videos, numbers, contacts, fit reasons, notes, activity). Compare comes along if it is cheap, or later in this step. **Find › Talent Managers waits for step 8.**
4. **Contacts and the archive** (from the old step 9's Toolbox): the email finder in the background (`enrich`, `found_emails`), sources and confidence, an explicit **Confirm address** with the contact's name, plus **Toolbox › Archive** (countdown, Bring back), **Toolbox › Never-contact** and **Toolbox › Activity log**.

**Legacy:** `legacy/lib/features/search/`, `influencers/`, `archive/`; `legacy/pipeline/gratovo/pipeline.py`, `tools/enrich.py`, `found_emails.py`.
**Acceptance:** Find and Toolbox (Archive, Never-contact, Activity log) show in the live rail; the owner can run a real search, triage, confirm contacts and bring a channel back from the archive; the *search*, *qualify* and *contacts* rows of the parity checklist; one consolidated Playwright pass for Find (`find_flow.py` as Playwright tests).

### Step 6. Reach, up to reading replies

**Goal:** draft, check, approve, send, follow up, and read and classify creators' replies from one place. This is the finish line for real outreach work.
**Work:**
1. **The board and the draft card,** wired to the Gemini bridge and the comms engine (3e-3a) and `mail.send` (3e-3b): "Why this email" with the house-rule checks, the gates inline (unconfirmed address, mailbox cap, never-contact), the rewrite chips (Shorter, Warmer, More direct, New angle), the From picker with live capacity, Send later (**Toolbox › Scheduled**), and a 10-second Undo send. Nothing is sent without approval.
2. **Mailboxes:** live capacity, warm-up tags, the cap stepper, bounces and health (`mail.status`).
3. **Sequences:** the 3-touch follow-up timeline, follow-ups due, park and snooze until a date.
4. **Replies and their intent:** the app reads replies in the background (`mail.replies`), with a small, quiet "Paste a reply" box for failures (the owner's choice); the thread right above the draft; Gemini's reading of the reply and the 47-situation reclassifier; one click to save rate and audience facts to the creator; the stage moves on by itself. **The creator loop stops here:** the media kit attachment, the audience check and marking a creator signed are step 8.

**Legacy:** `legacy/lib/features/outreach/`, `legacy/pipeline/comms/`, `gemini_bridge/`, `tools/email_send.py`, `gratovo/mailbox.py`.
**Acceptance:** Reach shows in the live rail; the whole loop from a confirmed contact to a drafted cold email, an approved send, the sequence and a reply read and classified works end to end; the *cold*, *followups*, *replies* and *mail* rows; tests prove no automatic send; one consolidated Playwright pass for Reach.

### Step 7. Today, prototype mode and the CI gate

**Goal:** a full day of outreach worked from Today alone, and prototype mode so the screens not built yet can be looked at safely.
**Work:**
1. **Today** (was step 4). Port the next-action engine (`items()` in the prototype's `engine.js`) into `packages/core` with unit tests: buckets, money first, owners, snoozes, quick wins, roles. Then the queue, the day band (the 4-hour budget, mailboxes, done today), the work panel for each item kind, focus mode, wrap-up, the first-day screen and snooze, and **Settings › Your day**. In live mode Today shows only the buckets that have real work behind them (answer replies, approve emails, follow-ups due, confirm contacts, review new finds); the brand, deal and money buckets turn on in steps 8 and 9. The engine keeps owners and roles as inputs, so T adds no rework. Hand-off and the team view of Today wait for step T.
2. **Prototype mode and the comment tool** (was 3f). Built as in the prototype (`proto.js`, `comments.js`): an owner-only switch in Settings, off by default, and invisible when off.
   - When on, the live data is set aside and `example.db` is used, and **every screen shows**, including those no step has wired yet (Close, Deliver, Insights, Team, Find › Talent Managers).
   - Scenarios: a normal Monday, the first day, a week later, something broke.
   - ~~See the app as a teammate~~ (step T).
   - The comment tool: press C, click anything, write. Pins anchor to stable `data-ui` ids that components carry.
   - The outbound adapters are stand-ins: Gmail send, Gemini, YouTube and R2 writes do nothing real.
   - Comments are kept in a `comments` table in the local database and exported to `docs/feedback/comments.json` on demand, so any session can read and act on them (§9 Q9).
   - When off, no trace: only wired screens, no buttons, keys, pins, bars or network calls (an automated check).
3. **Branch protection** (was 3g): pull requests only and CI green on `main`; a pull request with a failing test cannot merge.

**Legacy:** `legacy/lib/features/my_day/` (the old aggregator) for the data each item needs.
**Acceptance:** Today shows in the live rail; the parity rows for the *daily* step plus every Today row in §2 and §3; prototype mode switches cleanly between the focused live app and the full prototype; the prototype's Today flows, `proto_flow.py` and `review_fixes.py` pass as Playwright tests against the real app.

### Step 8. Creator signing and Close

**Goal:** creators signed to the roster, brands qualified, and deals pitched, negotiated and contracted with no side spreadsheets.
**Work:**
1. **Signing and talent managers:** the media kit attachment, the audience check (US, UK, CA or AU in the top 3, buying age, 3%+ engagement, an agreed rate), the **Sign creator** stage and the roster, and **Find › Talent Managers**.
2. **Brands and pitching:** sponsors found automatically into Found brands, the brands board and qualifying, the pitch picker (1–2 creators ranked by fit, with clash warnings), the price gate, brand follow-up nudges.
3. **Negotiation and contracts:** the negotiation ladder beside the reply, offer and counter history, the exclusivity and usage checklist, contracts (the creator signs before the agency; an e-signature link, §9 Q6), plus **Toolbox › Calculator** and **Settings › Agency facts**.
4. Close shows in the live rail, and Today's brand and signing buckets turn on.

**Legacy:** `legacy/lib/features/brands/`, `deals/` (terms, contracts).
**Acceptance:** the *mediakit*, *audience*, *sign*, *brands*, *pitch*, *negotiate* and *contracts* rows.

### Step 9. Deliver and Insights

**Goal:** a deal from the brief to a Net-30 invoice, the creator's payout, the 30-day report and the next deal inside the app, and the agency's numbers in one place.
**Work:**
1. **Deliver** (was step 8): the deal board and the 10-step checklists; the brief and draft review; pre-live checks; the go-live email; invoices (Net 30) with aging; payouts locked until the brand pays; the 30-day report (`video_stats`); the next deal.
2. **Insights** (from the old step 9): the charts with drill-downs, the reverse-funnel planner, the 50-send ghosting diagnosis, channel numbers.
3. The rest of Settings that has a solo effect (**Team and money** for one person); the sections about other people (members, roles, "the whole team") wait for step T.
4. The old app's capabilities outside the framework (parity checklist §6): decide each one with the owner, then port it or drop it. News and the Email library are decided here.
5. Deliver and Insights show in the live rail, and Today's deal and money buckets turn on.

**Legacy:** `legacy/lib/features/deals/` (30-day report, video stats), `legacy/pipeline/tools/video_stats.py`.
**Acceptance:** the *brief*, *prelive*, *golive*, *invoice*, *report*, *payout* and *nextdeal* rows; the solo rows of the *teamops* group and §6 of the parity checklist (the team rows are step T's).

### Step T. Team work and packaging, after the app works for one person

Added 2026-10-21 (owner: "all steps and plans for team work should be pushed back until the app is fully functional"). Packaging (was 3h) joined it on 2026-10-24: the owner runs the app from the repository on Windows for now, and an installer and updates are only needed to reach other machines. It starts only when step 9 is done and the owner says go. Each part is its own pull request, with its own plan in `.router/` when it starts.

**Goal:** a few trusted members work in the same app, see the same truth, and don't collide.
**Parts** (the order is a first guess; the plan at T's start decides):
- **T1. Sharing results through R2** (was 3e-2). Port `sync.py` and `r2.py`; boto3 is replaced by signed links: the pipeline asks main with `{type:"r2.sign", id, requests:[…]}` (at most 50) and main answers `{type:"r2.signed", id, links:[…]}` or `{type:"r2.refused", id, reason}` after calling `r2-access` with the member's token. List results are parsed from the ListObjectsV2 XML. The catalog worker is the user id. Jobs `pull`, `push` and a share after each keyword. Checks carried from 3d-2a: a call with a real member's token, and a presigned list against the real bucket (with the owner's go). `test_r2_sync` is ported with a fake signer and an in-memory bucket. `store.py` already keeps the sync columns, so T1 needs no migration.
- **T2. In Find:** a teammate's live run, the warning before searching a keyword a teammate is running, and handing keywords to a teammate (parity rows 7 and the Find overlap row).
- **T3. In Today and Team:** hand-off with a note, owner reassignment in bulk, the team view of Today, the Team screen (load, roles, rebalance, the activity log), the Settings sections about members and roles, and presence shown on records.
- **T4. New members:** the first-week checklist and practice mode, the setup-health check for a new machine, and "see the app as a teammate" in prototype mode.
- **T5. Packaging and updates** (was 3h):
  - an electron-builder NSIS installer for Windows, with the Python runtime bundled through python-build-standalone via uv (the target machines have no Python), and Deno plus `yt-dlp-ejs` for subtitles (ADR 0014);
  - the packager applies the fuses, including `EnableEmbeddedAsarIntegrityValidation`, and ships `@supabase/realtime-js` with main (ADR 0012);
  - a release build refuses to build without the two Supabase values (ADR 0011);
  - no code signing (§9 Q12): document the first-run Windows warning for members;
  - auto-update with electron-updater from the private R2 bucket (URLs from the server function; builds unsigned, §9 Q12).
  - *Acceptance:* an installer built on the owner's PC (GitHub Actions is manual only since 2026-10-25) installs on a clean Windows machine and runs a search on example data; a clean machine updates itself to a newer test build.

**Legacy:** `legacy/pipeline/gratovo/sync.py`, `r2.py`, `legacy/lib/core/sync/` for behaviour; `legacy/scripts/` for the versioning rule; the rest comes from the prototype.
**Acceptance:** the team rows of the parity checklist (§1 rows 7, 18, 119 and 122, and the Team, Today team view, Find overlap, Settings scope and Prototype rows in §2 and §3), each ticked in the real app with two accounts; two machines share results through R2; T5's checks above.

### Step 10. Check it 100%

**Goal:** prove nothing was lost. It runs after step T, so the team rows are included.
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
| `pipeline/` | Ported into `services/pipeline/`, cleaned (pyproject, src layout, typed). `gratovo/sync.py` and `r2.py` wait for step T. | 3e, T |
| `pipeline/gemini_extension/` | Ported into `services/gemini-extension/`, later moved to TypeScript. | 4 |
| `backend/schema.sql`, `backend/tests/` | A baseline migration and the SQL tests in `supabase/`. | 3d |
| `backend/SETUP.md` | Rewritten as `docs/setup.md` for the new stack. | 3d |
| `backend/migrate_v2.sql` | Not carried over (one-off, already applied). | – |
| `data/comms/` (playbook, skill, tests) | Moved with the pipeline. | 3e |
| `data/settings.json`, `keywords.json`, `all_keywords.txt`, `run_config.json`, `reset_manifest.json` | Pipeline config, reviewed and moved; the owner's real values are imported. | 3e, 4 |
| `data/gemini skills/` | Moved if the keyword and classifier prompts still need them. | 3e |
| `data/.env` | **Never.** Rotate its keys (A1). | – |
| `assets/` (fonts, logo) | Logo and icons into `apps/desktop/resources`. Fonts are already chosen in the prototype. | 3c |
| `scripts/` (build, version, installer) | Replaced by electron-builder and release workflows. The versioning rule is reused. | T5 |
| `.github/workflows/` | Replaced by new CI. | 3b, 7 |
| `docs/plans/*` | Reference. Their decisions are in `product/` and this plan. | – |
| `android/`, `ios/`, `web/`, `windows/` | Not copied (generated Flutter runners). | – |

## 8. Risks

| Risk | How it's handled |
|---|---|
| The old app breaks because Supabase changed under it | Additive-only migrations until cutover; the old app is tested against the migrated schema in step 3d. |
| Data loss at import | Backup first, dry-run report, import into the new app's own folder; the old database is never modified. |
| Secrets leak again | gitleaks before commit and in `pnpm verify`; secrets only in `safeStorage` or server-side; the renderer never sees them. |
| Gemini account blocks | The owner's pacing rules are built into the bridge (3 tabs, 60 s gap, refusal toast means pause). |
| Scope creep | The parity checklist is the scope. New ideas go to the owner as comments in prototype mode, not into the current step. |
| The cloud session lacks context | `CLAUDE.md`, this plan's status table and the step's `.router/` state are committed at the end of every working session. |
| Electron performance | The speed rules from the plan, checked in step 10: one query per screen, the frame doesn't re-render on sync ticks, screens you leave stop work, database off the UI thread. |

## 9. Open questions

From the prototype's Plan page, plus new ones from today. Each one names the step that needs the answer.

All twelve were answered by the owner on 2026-10-19. The consequences are written into the steps they affect.

| # | Question | Answer | Step |
|---|---|---|---|
| 1 | Should VAs see money (invoices, payouts, margins)? | **No.** As in the prototype: money screens and amounts are hidden for VAs, and brand work that needs prices routes to the owner. | 7 |
| 2 | One 4-hour budget for everyone, or per person? | **Per person.** Each team member has their own daily hours. Default 4, set by the owner in Settings. | 7 |
| 3 | Which emails need a second pair of eyes? | **Nothing is sent without approval.** Approve-all stays the rule for every email, so no price or new-VA threshold is needed. | 6 |
| 4 | When do Instagram and TikTok come in? | **Not in this migration.** Email only. Social channels become a separate project after cutover. | 5 |
| 5 | Invoices: sent from the app, or tracked only? | **Made in an accounting tool and only tracked here.** The app records status and amounts and links to the invoice. It does not generate PDFs. | 9 |
| 6 | Contracts: files in the app, or an e-signature service? | **A link to an e-signature service.** The app tracks status and links to the signed document. | 8 |
| 7 | Reply reading: which mailboxes, how long kept? | **Connected mailboxes only; keep everything.** No retention purge. The rule "never read the connected mailbox" for sessions still holds ([owner-rules.md](product/owner-rules.md)). | 6 |
| 8 | Confirm the stack | **Accepted** (A4): Electron, React and TypeScript. | 3 |
| 9 | Prototype comments: file or team database? | **A file in the repository** (`docs/feedback/comments.json`, exported on demand) so any session can read it. | 7 |
| 10 | Prototype mode: owner only, or also VA training? | **Owner only.** | 7 |
| 11 | Team keys (YouTube, R2) | **Served after sign-in from a server function.** Never in the installer or the repository. | 3d |
| 12 | Releases and code signing | **No code signing.** The app is for the owner and a few trusted members, so no certificate is bought. Windows will warn on first install, and members click through it. Updates still work unsigned. Where installers live was not chosen: the default is a private R2 bucket, handed out through the same server function as the team keys (builder's call, change it if you prefer). | T5 |


## 10. Model use

Added 2026-10-21 at the owner's request, to stretch the usage limit. The rule: **the strong model decides once and writes it down, cheaper models follow what is written, and real checks decide what counts.** The `smart-task-router` skill already works this way (its tiers E, N and H are the `router-easy`, `router-normal` and `router-hard` agents). This section fits it to this project. **Where the two disagree, this section wins.**

### Which tier does what

| Tier | Model | Use it for |
|---|---|---|
| E | Haiku (`router-easy`) | Copying a pattern that already exists in this repository. Adding strings to the strings file and values to `tokens.css`. Renames, imports, index files, scaffolding. Tests written from a spec that is already settled. Updating the status table and other docs. |
| N, **the default** | Sonnet (`router-normal`) | Screens and components built to the prototype. Porting a pipeline module from `legacy/` together with its tests. Playwright tests. Fixing type, lint and test failures. Tidying code so it matches [conventions.md](conventions.md). |
| H, sparingly | Opus (`router-hard`, `router-reviewer`) | Each step's plan in `.router/PLAN.md` and its contracts: IPC channels, the preload API, the pipeline protocol, shared types. Supabase schema, migrations, grants and RLS. The sync. Security: Electron hardening, secrets, the network allowlist. Anything that touches production data. Bugs a lower tier failed on twice. The review before every pull request. |
| X | Fable | Only when the owner asks. |

### Rules

1. **Decide once, write it down.** Opus writes the step's plan with its contracts before anything is built. Lasting decisions go into this plan or an ADR in `decisions/`, so no later session works them out again.
2. **Build tasks default to N.** Drop to E only when the task copies an existing pattern and has an automatic check.
3. **Never E** for security, secrets, Supabase migrations, the sync, production data, or any task with no automatic check.
4. **Escalation (this overrides the skill):** when a task fails, retry it once at the same tier with the error added to the spec. If it fails again, move it up one tier. The next task starts back at its planned tier. Two failures at H mean the plan is wrong for that part: re-plan it, don't push harder.
5. **One part per session.** Work one part of a step (3e-1, 3e-3 and so on) per session, and start a fresh session for the next part. Long sessions cost more and drift.
6. **Leave the next session a starting point.** After each part, update the status table (§5) and `.router/PROGRESS.md` in the same commit, so the next session starts from them instead of re-reading the codebase.
7. **No agent for a trivial edit.** Starting an agent costs more than a one-line change.
8. **The main session's model is the owner's choice.** A session that plans or reviews works best on Opus. A session that only carries out an existing plan can run on Sonnet, and it still hands H tasks to `router-hard`.
