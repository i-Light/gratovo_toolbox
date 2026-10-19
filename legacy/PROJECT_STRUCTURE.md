# Gratovo IMA ToolBox — Project Structure

A map of the repository for anyone (human or model) who needs to find their
way around without reading everything. It describes what is there now; the
history is in `git log` and [CHANGELOG.md](CHANGELOG.md).

## 1. What this is

The internal tool of a small YouTube influencer-marketing brokerage. The work,
end to end: **search for channels → filter and shortlist → outreach by email →
research a channel → negotiate and close a deal → follow up.** One team,
everyone does every step.

Two programs, one repository:

- **The Flutter app** (`lib/`) — the UI. Windows desktop is the primary target;
  the web build compiles and is used for a read-only preview (no pipeline).
- **The Python pipeline** (`pipeline/`) — the scraper. The app launches it on
  the same machine and streams its output; the app never scrapes anything
  itself.

Both read and write **one local SQLite file**, `data/database/gratovo.db`.
The app works fully offline. Two servers exist so the team can share, and
neither is needed for the app to run:

| | Holds | Who talks to it |
|---|---|---|
| **Cloudflare R2** | Everything *scraped*: one compressed object per channel plus an append-only catalog of what was found and archived | The pipeline only (`pipeline/gratovo/r2.py`, `sync.py`); the app asks it to run |
| **Supabase** (Postgres) | Everything *typed in*: channel notes/tags/stage/contacts, brands, deals, outreach, templates, reminders, activity log, scratchpad, accounts | The app only (`lib/core/sync/`), signed in as a person |

Nothing derived is stored on either server; every rollup, count and dashboard
number is computed from the local file on each machine.

## 2. Repository layout

```
gratovo_code/
├── lib/                    the Flutter app                          (§3)
├── test/                   its tests, mirroring lib/                (§4)
├── pipeline/               the Python scraper + tools               (§5)
├── backend/                Supabase schema, migration, SQL tests    (§6)
├── data/                   the pipeline's data folder               (§7)
├── scripts/                build, version and installer scripts     (§8)
├── .github/workflows/      ci.yml (tests) and release.yml (installer)
├── windows/ web/ android/ ios/   platform runners (generated; windows/ has the icon)
├── assets/                 fonts, logo, launcher icon
├── build_windows.bat       double-click → scripts/build_windows.ps1
├── pubspec.yaml            version: lives here, bumped by scripts/auto_version.ps1
├── l10n.yaml               flutter gen-l10n config (ARB → lib/l10n/gen/)
├── analysis_options.yaml   lints; CI runs `flutter analyze --fatal-infos`
├── README.md               how to run, test and export the app
└── CHANGELOG.md            what each release changed
```

## 3. The app — `lib/`

```
lib/
├── main.dart          boot: crash log → time zones → notifications → seed data/
│                      → Supabase (if configured) → open the sync engine → runApp
├── app.dart           MaterialApp.router, theme, locale, toast overlay
├── routing/           app_routes.dart (every path literal), app_router.dart,
│                      app_redirect.dart (the one sign-in/access rule, pure)
├── l10n/              app_en.arb, app_ar.arb → gen/ (committed; CI checks it is current)
├── core/              things every feature uses                        (§3.1)
├── data/              models, repository interfaces, implementations   (§3.2)
└── features/          one folder per screen: application/ + presentation/  (§3.3)
```

Conventions that hold everywhere:

- **Riverpod 3, hand-written.** `Notifier`/`AsyncNotifier` subclasses and
  `NotifierProvider`s, no codegen. Feature state lives in
  `features/<x>/application/*_controller.dart`; entity lookups in
  `data/providers/entity_providers.dart`.
- **`io` / `stub` pairs.** Anything that needs `dart:io` is three files:
  `foo.dart` (a conditional export), `foo_io.dart` (the real thing) and
  `foo_stub.dart` (the web build; every class and method mirrored, answering
  empty). Callers import `foo.dart` only. `scraper_process`, `local_db`,
  `local_pipeline_db`, `pipeline_bridge`, `sync_engine`, `image_store`,
  `update_installer`, `github_env`, `all_keywords_export` all follow this.
- **Every user-visible string is an ARB key.** Arabic (RTL) and English,
  switchable at runtime.
- **Theme tokens, not color literals.** `core/theme/app_theme.dart` and
  `core/constants/app_colors.dart`; dark ships, light is wired. The only
  `Color(0x…)` outside those two are a member's color choices on
  `TeamMember` and the dhikr overlay's confetti.
- **Desktop gating** goes through `core/capabilities/` (`capabilitiesProvider`,
  `DesktopOnly`), never `Platform.isX` in feature code.

### 3.1 `lib/core/`

| Folder | What |
|---|---|
| `sync/` | The Supabase sync engine. `sync_engine.dart` (conditional export) → `mirror_engine_io.dart` runs the loop: `mirror_puller.dart` pulls the typed-in tables by `updated_at` cursor with tombstones (table specs in `mirror_tables.dart`, keyset paging in `mirror_keyset.dart`), `mirror_uploader.dart` drains `_outbox` (`channel.edit` compare-and-set, `row.upsert/delete`, `conflict.*`, `archive.*`). `mirror_schema.dart` declares the app-owned tables and the `influencer_channels` view (`channels ⋈ channel_state`) — forward-only migrations. `pipeline_bridge.dart` is the interface the engine uses to ask the pipeline to pull/archive; `core/native/pipeline_bridge_io.dart` implements it. `sync_diagnostics.dart`, `manual_sync_report.dart`, `sync_log_file_io.dart` are what Settings → Account shows. |
| `native/` | Launching and feeding the pipeline. `scraper_process.dart` exports `scraper_process_io.dart`, one library in four parts: `ScraperProcess` (find the interpreter and `pipeline/`, start search/backfill/re-enrich/catch-up/news/push/pull/archive, stream stdout), `PipelineDataDir` (create and seed `data/`, apply `reset_manifest.json` quarantines — see `pipeline_reset.dart`), `PipelineSettings` (`settings.json`, `settings.local.json`, `aws_gateways.json`, `skip_wait.signal`) and `GmailBridge` (`tools/email_send.py`; wire types in `gmail_protocol.dart`). `gemini_bridge.dart` (`_io`/`_stub`, types in `gemini_bridge_types.dart`, wire types in `gemini_protocol.dart`) starts `python -m gemini_bridge daemon` the same way and drives the signed-in Gemini web app through the browser extension — see `pipeline/gemini_bridge/DAEMON.md`. `local_pipeline_db*` reads the pipeline's tables; `env_merge.dart` merges a shipped `.env` into the user's; `pending_merge_boot.dart` is the "your old database was moved aside" state. |
| `local_db/` | Opening `gratovo.db` (WAL, busy timeout) via `sqlite3`; the one connection both `data/repositories/mirror/` and the sync engine use. |
| `update/` | In-app updater: `github_release_source.dart` finds the latest release, `update_plan.dart` decides whether it applies, `update_installer_io.dart` downloads and runs the Inno Setup installer, `update_sync_gate.dart` waits for the outbox to drain first. |
| `github/` | The GitHub token used by the updater and release download (`shared_release_token.dart` is the read-only token every install shares; `github_auth.dart` a personal one). |
| `aws/` | `aws_identity_check.dart` — SigV4 `GetCallerIdentity`, used by Settings to validate an API Gateway key pair. |
| `ai/` | `AiProvider` interface, `AnthropicApiProvider`, the deterministic `TemplateFillAiProvider`, and `apply_template_tokens.dart`. Keys stored via `data/repositories/secure/`. |
| `presence/` | The one Realtime channel `gratovo:live`: presence (who is online, who is searching what), the `editing_target` broadcast, and `live_data_service.dart` which turns "these tables changed" broadcasts into `data_change_bus` events. |
| `events/` | `DataChangeBus` — `ref.bumpData({DataDomain.x})` is how a mutation tells every screen to refresh; `refresh_when_visible.dart` defers it for hidden pages. |
| `notifications/` | Windows local notifications for due follow-ups (`notification_reconciler.dart` keeps them in step with the reminders table). |
| `toast/` | The in-app toast overlay and the notification centre behind the bell; also `dhikr_reminder_overlay.dart`. |
| `time/` | Time-zone database, display zone setting, `InstantFormatter` (every date the UI shows goes through it). |
| `theme/`, `localization/`, `status/`, `capabilities/`, `logging/` | Theme + fonts + logo, locale provider, the deal-stage / contact-method labels and colors, platform gating, `ActivityLogger` (what goes into `activity_log`) and `crash_log.dart`. |
| `images/` | Channel avatar cache on disk with a tagged cleanup. |
| `widgets/`, `utils/`, `scroll/`, `constants/`, `config/`, `supabase/` | Shared widgets (`NotesCard`, `StatusBadge`, `CollapsibleCard`, date pickers), number/timecode formatting, `trimmedOrNull` (blank text is absent text), responsive breakpoints, smooth wheel scrolling, colors and countries, the compiled-in Supabase URL/anon key (`supabase_config.dart`, overridable from Settings), and the client provider with a request timeout. |

### 3.2 `lib/data/`

- `models/` — plain Dart classes, hand-written `fromRow`/`toJson`. The ones
  worth knowing: `Influencer` (a row of the `influencer_channels` view),
  `Deal` (the pipeline stage lives here, not on the influencer — one channel
  can be engaged many times), `OutreachThread`/`OutreachMessage`,
  `EditConflict`, `ChannelRun` (a backfill or re-enrich in progress),
  `SearchRun`, `ArchivedChannel`.
- `repositories/*.dart` — abstract interfaces, one per entity, and
  `repository_providers.dart` which picks an implementation.
- `repositories/mirror/` — the real ones: read and write `gratovo.db` and
  queue outbox rows. `local_archive.dart` is the archive sweep (runs before
  every drain; refuses channels with a deal or a thread). `mirror_mapping.dart`
  is the row ↔ model codec shared with `core/sync/mirror_tables.dart`.
- `repositories/local/` — pipeline-side files the app reads directly
  (`search_runs`, `settings.json`, `aws_gateways.json`).
- `repositories/mock/` — in-memory implementations with seeded data; what
  widget tests and the web preview run on. Kept deliberately.
- `repositories/email_library/` — `email_library.db`, the separate SQLite
  file behind the Email Library page (tags, records, exported handbook).
- `repositories/secure/`, `repositories/supabase/` — AI keys in the OS
  keychain; the AWS gateway credentials table (the one table read from
  Supabase directly rather than mirrored).

### 3.3 `lib/features/`

Each folder is `application/` (controllers, pure logic) and `presentation/`
(the screen and its `widgets/`). Routes are in `routing/app_routes.dart`.

| Feature | Route | Notes |
|---|---|---|
| `shell` | — | `AppShell`: nav rail, app bar, conflicts badge, pipeline badge. `nav_rail_controller` remembers collapse state. |
| `auth` | `/login`, `/access-pending` | Supabase email sign-in; `auth_controller` owns the session and the access level that gates Outreach (`basic` hides it). |
| `dashboard` | `/` | Tiles, channel analytics (30-day series), keyword distribution, "searching now" from presence. |
| `search` | `/search` | The Start button. `search_launch` builds the run, `active_search_run_controller` streams it, `search_progress_parser` reads the pipeline's lines, `search_resume`/`search_autochain` keep it going, `video_catchup` pulls videos for channels missing them, `backfill_run`/`reenrich_run` share `ChannelRunNotifier`, `auto_clean` and `remote_search_intake` handle the scheduled archive and search requests from other machines. |
| `roster` | `/roster` | One destination, three sections switched from the app bar: `influencers`, `brands`, `archive`. |
| `influencers` | `/influencers/:id` | List with filters and pins; profile with header, stage, contacts, emails, notes, recent videos, CRM calculator, conflict banner, archive countdown. `influencer_mutation_guard` wraps every edit with the compare-and-set conflict check. |
| `brands` | `/brands/:id` | List and profile. |
| `archive` | (roster section) | Rejected/inactive channels, bulk clean dialog, restore. |
| `deals` | `/deals`, `/deals/:id` | List with stage filter; detail with notes and history. |
| `outreach` | `/outreach`, `/outreach/thread/:id`, `/outreach/compose/:influencerId` | Thread list, thread detail, the method-aware composer (email / DM / call), `follow_up_planner`, `gmail_gateway` → `GmailBridge`, AI brief, writing rules, template library. |
| `email_library` | (from Outreach) | The critique library of sent emails with tags, timecodes and handbook export (`handbook_export.dart` writes what `pipeline/tools/email_library.py` reads). |
| `conflicts` | `/conflicts[?channel=]` | Edits refused because the base value had changed; resolve or discard. |
| `news` | `/news` | Industry feeds fetched by `pipeline/tools/news.py`, read locally. |
| `logs`, `notifications` | `/logs` | Activity log; the notification history behind the bell. |
| `scratchpad` | `/scratchpad` | One live shared text box per person (the one Realtime `postgres_changes` table). |
| `settings` | `/settings` | General, time zone, account + sync status, GitHub, AWS gateways, AI providers, Python environment, outreach mailbox, search tuning, merge status, images, dhikr, update button. `settings_attention_controller` decides which card needs attention. |

## 4. Tests — `test/`

Mirrors `lib/`: `test/core/...`, `test/data/...`, `test/features/...`, plus
`app_smoke_test.dart` (the app boots on mocks) and `timezone_guard_test.dart`.
`test/support/temp_mirror.dart` opens a throwaway `gratovo.db` for the
repository and sync tests; widget tests run on `data/repositories/mock/`.
~1150 tests.

```powershell
flutter analyze --fatal-infos   # the CI gate; infos fail
flutter test
```

## 5. The pipeline — `pipeline/`

```
pipeline/
├── search.py            the entry point (--status, --push-only, --pull-only,
│                        --refetch, --catch-up-videos, --archive-ids, ...)
├── requirements.txt
├── gratovo/
│   ├── config.py        paths, .env, settings.json, run_config.json
│   ├── store.py         the SQLite store (owns the scraped tables of gratovo.db)
│   ├── pipeline.py      discovery + fetching (YouTube API for details, scrapetube for search)
│   ├── r2.py, sync.py   Cloudflare R2: per-channel objects + the catalog log
│   ├── feeds.py         RSS/Atom for the News page
│   ├── gmail.py, mailbox.py   the outreach mailbox and mailbox.db
│   └── scrapetube/      vendored, with proxy-pool and AWS-gateway routing
├── tools/
│   ├── enrich.py, import_handles.py, news.py, get_subtitles.py
│   ├── email_send.py    what GmailBridge runs (--json)
│   ├── aws_gateway_setup.py   provisions the API Gateway rotators
│   ├── email_library.py, transcript.py
│   │                    the email library and transcripts
│   └── outreach playbook.md, email critique library*.md   the notes those read
├── gemini_bridge/       Python side of the Gemini bridge: WebSocket server the
│   │                    extension dials, `Gemini` client, `actions.py` (the
│   │                    prompts: keywords, classify; the Comms queue's
│   │                    `comms_propose` / `comms_check`),
│   │                    `daemon` (JSON lines for the app), CLI. Contracts:
│   │                    PROTOCOL.md (extension ↔ Python), DAEMON.md (app ↔ daemon),
│   │                    CONTEXT.md (the handoff / status)
├── gemini_extension/    the Chrome/Edge MV3 extension (load unpacked): self-healing
│                        locators, send state machine, model switch, account, queue;
│                        jsdom tests in test/
└── tests/               pytest, no network (~280 tests)
```

`pipeline/README.md` is the full reference, including the R2 object formats
and the rule for changing a database schema (additive → just ship it;
breaking → add an action to `data/reset_manifest.json`).

## 6. The backend — `backend/`

- `schema.sql` — the Supabase schema: only the typed-in tables, RLS, the
  `apply_channel_edit` compare-and-set function, tombstones, the
  `remote_search_requests` queue. Idempotent; re-run it to upgrade.
- `migrate_v2.sql` — the one-off that converted the pre-September-2026
  live-first project (drops the scraped tables).
- `SETUP.md` — creating the R2 bucket and the Supabase project from nothing
  (~30 minutes).
- `tests/` — SQL tests run against a throwaway Postgres in Docker
  (`./run.sh`); `00_supabase_stubs.sql` fakes the `auth` schema.

## 7. The data folder — `data/`

The pipeline's working folder, shipped inside the installer and seeded into
the user's copy on first launch (`PipelineDataDir.ensureDataDir`).

| Tracked | |
|---|---|
| `.env` | The shared YouTube and R2 keys — the whole team runs on them. The AWS IAM pair, the Supabase service-role key and the Gmail client secret are **not** here; they live in the untracked `.env.local`, which `config.py` reads after `.env`. |
| `settings.json`, `keywords.json`, `all_keywords.txt`, `run_config.json` | Pacing and thresholds, the seed keyword list, the per-run config the app writes |
| `reset_manifest.json` | "This build retires these local files" — see §5 |
| `gemini skills/` | The skill files `pipeline/gemini_bridge/actions.py` prepends to a prompt when no Gem URL is configured (`keyword generator skill.md`, `channel classifier skill.md`). Drafting no longer has files here: the old drafter / QA / reply skills and the email-critique workflow documents were removed on 2026-10-18. |
| `found_channels_data/found_data.json` | Sample scraped data |

Untracked, per machine: `database/` (`gratovo.db`, `mailbox.db`,
`email_library.db`, `_needs_merge/`, backups), `logs/`, `.env.local`,
`settings.local.json`, `aws_gateways.json`, `gmail_accounts.local.json`,
`migration/`.

## 8. Building and releasing — `scripts/`

| Script | What |
|---|---|
| `build_windows.ps1` | `flutter build windows`, stage under `dist/gratovo_toolbox-<version>-windows-x64/`, zip it, optionally (`-Installer`) run Inno Setup on `installer.iss`. Runs `auto_version.ps1` first. |
| `auto_version.ps1` | Bumps `version:` in `pubspec.yaml` from the commit messages since the last `v*` tag ("major" → major, "rework" → minor, 10+ commits → minor, else patch). |
| `bump_version.ps1` | Manual bump (`-Part Major -Tag` pushes the tag). |
| `installer.iss` | The Inno Setup script: the app folder, `pipeline/`, `data/` and `pyruntime/` (the interpreter — the target machines have no Python). |
| `generate_icons.ps1` | Regenerates the Android/iOS/Web launcher icons from `assets/images/logo.svg`. The Windows `.exe` icon is generated on every build by `tool/generate_app_icon.dart`. |

`.github/workflows/release.yml` builds and publishes a GitHub Release with the
installer on every `v*` tag; the in-app updater (`lib/core/update/`) finds it
there. `ci.yml` runs the three test suites on every push and pull request.

## 9. How the pieces talk

```
                    ┌─────────────── one machine ───────────────┐
                    │                                            │
   Supabase ◄──────►│  Flutter app  ◄── gratovo.db ──►  pipeline │◄──────► R2
  (typed-in rows)   │  lib/core/sync    (SQLite, WAL)   search.py│  (scraped objects)
                    │        │                              ▲    │
                    │        └── Process.start / stdout ────┘    │
                    └────────────────────────────────────────────┘
```

- The app **never** talks to R2 and the pipeline **never** talks to Supabase.
- A human action → repository writes `gratovo.db` + an `_outbox` row →
  `ref.bumpData` refreshes screens → the engine drains the outbox to Supabase
  and broadcasts `{"tables": [...]}` on `gratovo:live` → other machines pull.
- A search → `ScraperProcess.startSearch` → `search.py` writes `channels`,
  `videos` → on exit the app asks `search.py --push-only` to share, and every
  sync tick asks `--pull-only` to fetch what others found.
- Archiving is app-driven: `local_archive.sweepDueArchives` tombstones locally
  and queues `archive.channels`, which the pipeline applies to R2.
- AI features (keywords; drafting in the Comms queue, nothing sent
  automatically) → `GeminiBridge` starts
  `python -m gemini_bridge daemon` (stdin/stdout JSON lines) → the daemon is a
  WebSocket server the `pipeline/gemini_extension/` extension dials from the
  browser → the extension drives the signed-in Gemini tab. Prompts live in
  `gemini_bridge/actions.py`; the app never composes one.
