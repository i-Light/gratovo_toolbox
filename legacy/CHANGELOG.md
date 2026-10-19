# Changelog

What changed for the people using the app, per release. Releases are the
`v*` tags; `scripts/auto_version.ps1` picks the number from the commits since
the previous tag. The **Unreleased** section is what the next tag will carry —
add to it as you go, then rename it when the tag is cut.

## Unreleased

### Added
- Gemini in the browser: the app can drive the team's signed-in Gemini web
  app through a small Edge/Chrome extension (Settings → "Gemini in browser":
  start, test, open Gemini, and a diagnostics panel that says what could not
  be found on the page, how it used to be found, and offers one-click fixes).
  Search gains "Generate keywords" (long-tail phrases, already-searched ones
  greyed out) and Outreach gains "Draft with Gemini" (drafter → rule check →
  QA fix → use the draft), both without an API key.
- Gemini in the browser now runs in its own Firefox window by default: the
  app opens it when nothing is connected, adds and updates the extension
  itself, and reconnects after a drop — nothing to install by hand. The
  account you signed in with is remembered, with one click to use it for
  actions. Settings → "Gemini in browser" gains a browser picker with
  "Detect browsers", the extension's state, a keywords gem field and
  switches for starting and opening the window automatically. Only the
  chosen browser's extension is accepted, so a leftover Edge extension can
  no longer take the connection.
- Gems update themselves: a skill deck's Gem cards are pushed to the Gem in
  Gemini a few seconds after you stop editing them (and whenever Gemini
  connects). A deck without a Gem gets one created, and its link filled in
  under Settings → Gemini. Cards you never edited are not pushed, so a Gem
  already set up in Gemini is read into them instead of overwritten.
- The Gemini browser window now opens minimized and never takes the focus,
  whether it is Firefox, Edge or Chrome.
- Generate keywords can split a request across up to 8 separate Gemini
  chats for more variety, shows each chat finishing, keeps what came back
  when some chats fail, and uses the keywords gem when one is set.
- Draft with Gemini: "Choose the situation" sends only the parts of the
  drafter skill that apply (brands in the niche, call-to-action style, …).
  Rules that state a fact ask for it before drafting, and rules that change
  a hard rule of the skill say so. The rules live in
  `data/gemini skills/email drafter rules.json` and can be edited.
- The Skills page keeps two permanent setup cards per gem (name and
  description, instructions), left out of exports and the skill text. The
  app can update an existing gem's name, description and instructions in
  Gemini (wiring to the Skills page is next).
- A first-launch onboarding wizard checks sign-in, the Python environment,
  the outreach mailbox and the time zone, letting you fix any of them inline
  or skip straight to Settings; shows once, before the rest of the app.
- A "Scan for contacts" action on the influencer contacts card finds emails,
  Instagram handles and business-inquiry mentions in a channel's stored
  description and offers them as one-tap suggestions -- never written
  automatically.
- A deal's working-days estimate stays manually entered, but now shows a
  one-tap suggestion alongside it, computed from when the deal was created
  and last updated.
- Outreach template library shows per-template performance (times used,
  reply rate, average time to reply) above the editable list.
- A channel's rate history: closing a deal now records the brand price,
  influencer payout and median views at that time, shown newest-first on the
  influencer's profile alongside margin per entry.
- Ownership: a deal or influencer can be assigned to a team member (or left
  unassigned) from a picker on its header; assignment shows as a chip
  elsewhere.
- A deal's deliverables are now tracked one by one: type, status, agreed /
  draft-received / approved dates, a published link once live, notes and
  manual reordering, instead of a single summary line.
- A manual engagement stats card on the influencer profile: rate and a note,
  entered by hand -- never pulled automatically from any API.
- A generic job scheduler runs due background jobs once a minute and shows
  every scheduled job's cadence and last/next run on Settings, with an
  enable/disable switch and delete -- per-machine, not synced.
- Manual payment tracking on a deal (invoice sent/paid, payout due/paid,
  method and reference) and a new Finance page: a filterable, sortable ledger
  across all deals with brand-revenue, margin and owed-to-creators totals --
  everything entered by hand, nothing pulled from a bank or API. Its top
  section is the team performance rollup: per member per week, messages
  sent, replies received, reply rate and median first-response time,
  sortable, with a team-wide deals-closed and margin card and a week picker.
- A "My Day" section on the dashboard, above the stat tiles: today's most
  time-sensitive open items across deals, deliverables and outreach --
  overdue payouts and invoices, deliverables coming due, replies waiting,
  and upcoming follow-up reminders.
- Outreach threads show an SLA badge once a reply is waiting on us (and flag
  it past 24 hours), and an inbound reply can be tagged (interested, asking
  rate, not now, decline, wrong contact, auto-reply) with a filter for it.
- Campaigns: a brand's profile can group its deals under a named campaign
  (status, notes, start/live dates -- no budget or KPI fields, that stays
  the brand's own job) and shortlist channels under consideration before
  they become deals, with the going rate frozen in at shortlist time.
- Sponsorship detection: whenever a channel is (re)enriched, the pipeline
  scans its stored video descriptions for sponsorship signals (`#ad`, promo
  codes, "sponsored by", ...) and records what fraction of its videos carry
  one and any brand named with confidence (`sponsored_ratio`, `seen_brands`
  on the pipeline's `channels` table).
- In-app updater: Settings checks GitHub Releases, downloads the installer and
  runs it once the outbox has drained (`lib/core/update/`).
- GitHub account card and a shared read-only release token, so every install
  can download updates without a personal token.
- Dhikr reminders (optional, Settings).
- Uncaught errors are written to a crash log under the app's support folder.
- CI: `flutter analyze --fatal-infos`, `flutter test`, `pytest` and the
  backend SQL tests run on every push and pull request.
- Outreach: "Send later" — a clock beside Send with Gmail schedules the
  email (in an hour, tomorrow 09:00, Monday 09:00 or a picked time, in the
  display time zone). The app sends it on time while it is open; one that
  came due while the app was closed waits in a strip at the bottom of the
  app for Send now, Change time or Don't send. Waiting emails show on the
  thread (with Edit) and as a clock on the thread list. Never sent twice,
  even if the app stops mid-send.
- Influencers: a "Search in" menu beside the search box also finds the text
  in channel descriptions and video descriptions.
- Search: an optional parallel mode (Settings → Advanced Search Tuning, off
  by default) works one keyword per AWS gateway or proxy when there are two
  or more, at the Normal speed. The progress panel shows whether requests
  actually went through AWS, proxies or this computer, and how many.
- Settings → My apps: open the team's other apps, install them from their
  latest GitHub release, or get them from Google Play / as an APK on
  Android. `docs/MY_APPS.md` explains adding one.

### Changed
- Scratchpad is no longer its own nav destination: it's a third view on the
  Outreach page, next to Outreach and the email critique library, reached
  from the same switcher.
- Settings page laid out as cards with an attention outline on the one that
  needs a look; the outreach mailbox card lists its connected emails.
- Dashboard analytics refined; gradient text and settings layout fixes.
- A backfill now refuses to start while a re-enrich is running (the reverse
  check already existed; both share `gratovo.db` and the quota).
- The brand and deal notes fields use the same outlined style as the
  influencer one.
- Search requests now rotate on every request across the AWS gateways and
  proxies, never the same one twice in a row, with at least 6 seconds
  between two requests through the same one.
- Supabase settings: "Reset to defaults" goes back to the server address the
  build shipped with, which the card now shows; a restart is only asked for
  when the next launch would actually change.
- The Azkar (dhikr) overlay is gone; the mouse-glow effect stays.

### Fixed
- The installed app could not start the Gemini helper (it only worked when
  run from the IDE); it now starts, and says why at once if it cannot.
- Gemini settings saved before they had finished loading could wipe the
  saved account and other values; Settings' Save no longer overwrites
  values it did not edit.
- Archive now records the median-views basis it was decided on, and the
  standing auto-clean keeps running between launches.
- Keywords export and scraper improvements.
- The "Schedule follow-up" (alarm clock) button is back in the composer for
  every contact method, and "Use this draft" from Gemini keeps the
  follow-up emails Gemini wrote, each on its own day.
- The dashboard and the Archive page no longer freeze the window for up to
  half a second while they load on a large database.
- The "Client presence rate limit exceeded" warning: signing-in token
  refreshes no longer reconnect presence two or three times each.
- Builds made from a `data/.env` with an empty server address no longer
  ship an empty default.
- The onboarding wizard's greeting no longer overflows in a narrow window.
- Nothing on the main screens runs off the edge any more at a narrow window
  or with the text size turned up. Eight places did: the Dashboard and
  Settings title bars, the channel list's sort menu, the activity log's
  action filter, an archived-channel row, a conflict card, the Account card's
  status chips, the scheduled-jobs list, and four Settings rows (time zone,
  language, theme, text size). A couple of them spilled at the default text
  size, not only at the top of the slider.
- Status colours are readable in the light theme. The green, amber and blue
  used for "good / caution / note" were the dark theme's, and on white they
  measured between 1.9:1 and 2.4:1 against a 4.5:1 minimum — a status pill's
  own label was the text that could not be read. The brand rose, magenta and
  red had the same problem in reverse on the dark theme, where each sat
  under 4.5:1 as text on a card.
- A screen title is legible in the light theme. The gradient headings are
  tuned to glow on the dark navy; over a white app bar the same ramp measured
  1.46:1, which is very nearly invisible. The light theme now has its own.
- The three Settings checkboxes (saved pictures, launch at startup, always on
  top) had a 32px hit area, under every platform's minimum; so did the
  Roster's section switcher, at 36px. Both are full size now.
- A channel card in the grid is announced by name to a screen reader, instead
  of as an unnamed button followed by its contents as separate items.
- Draft with Gemini had been sending the drafter skill without its opening
  instructions. Editing the skill through the Skills page renamed its first
  heading and split the preamble into an "Intro" section, which left the rule
  file pointing at a section that no longer existed — so every draft went out
  missing "you are an elite B2B Business Development Executive…", the "this IS
  the style guide" instruction and the "not a draft for review" instruction.
  The rules point at the headings the file actually has now, and your local
  copy is set aside on the next launch so the correction reaches every
  machine.

### Internal
- Three test suites that did not exist before, each of which found real bugs
  on its first run and now guards against them coming back: every main screen
  laid out at three window widths and two text sizes with nothing allowed to
  overflow (`test/layout/`), the theme's colour roles measured against WCAG
  contrast ratios (`test/a11y/theme_contrast_test.dart`), and every tappable
  thing on a screen checked for a name and a minimum size
  (`test/a11y/accessibility_test.dart`).
- `GratovoStatusColors` and `GratovoGradients` are per-brightness now, which
  is what both of their "split these if a contrast pass disagrees" comments
  asked for; `colorScheme.secondary`, `tertiary` and `error` likewise, so a
  pinned brand hex no longer overrides what `ColorScheme.fromSeed` derives for
  the theme it was asked for.
- `flutter analyze --fatal-infos`, which CI gates on, was failing on
  `tool/_regroup.dart`; the script says what it is now and exempts itself from
  `avoid_print`, which is its interface rather than a leak.
- The skills deck's scroll test asserted the deck/preview scroll sync that was
  deliberately removed; it now pins what replaced it — the wheel moves the
  pane under the pointer, forwards only, and leaves the other one alone.
- 1.3's ownership, payment-tracking, manual-engagement and reply-classification
  columns are now readable/writable from the app models and repositories
  (Deal, Influencer, OutreachThread, OutreachMessage) -- still nothing
  user-visible; the UI for each lands with its own feature.
- Release 1.3 foundation: additive Supabase/local schema and repositories for
  campaigns, deliverables, payment fields on a deal, channel rate history,
  sequences and a local job-scheduler table, plus ownership columns on
  channels/deals/threads -- nothing user-visible yet, everything the rest of
  1.3 builds on.
- The Supabase service-role key and the AWS IAM pair are no longer in the
  tracked `data/.env`; they live in the untracked `data/.env.local`.
- Dead folders removed (`_to_delete/`, the 41 MB `.bak` from git, leftover
  mini-game widgets); the email tools moved to `pipeline/tools/` where their
  own paths expected them.
- Backfill and re-enrich share one `ChannelRun` model and controller;
  `ScraperProcess` split into launch / data-dir / settings / mailbox parts;
  `mirror_puller.dart` split out its table registry and keyset helpers; the
  follow-up planner and sync status row moved to their own files.
- `PROJECT_STRUCTURE.md` rewritten for the local-first codebase; this file
  added.
- Tests for the AWS identity check (SigV4 signing and the verdict mapping),
  the router's redirect rule (now `routing/app_redirect.dart`), the sign-in
  error translation, and the shell's nav-rail and pipeline-badge state.
- The last `Colors.*` literals in feature code now come from the theme (the
  raised panel button the Search and Scratchpad toolbars share is one style in
  `core/theme/panel_button_style.dart`; a member's colour palette lives on
  `TeamMember`); the reply and follow-up notifications and the bulk-clean Stop
  button are localised; `String?.trimmedOrNull` replaces the trim-or-null
  ternaries; twenty more lint rules on, all already satisfied.
- One-off `dart format` over `lib/` and `test/` (137 files), imports sorted by
  `directives_ordering`, and CI now fails on an unformatted file.

## 1.2.2 — 2026-09-13

### Fixed
- Slow first start on a new machine.

### Added
- Upload progress during video catch-up.

## 1.2.1 — 2026-09-13

### Fixed
- Riverpod circular dependency in catch-up.

## 1.2.0 — 2026-09-13

The local-first rework. The app reads and writes one shared SQLite file;
Supabase holds only the typed-in tables; everything scraped travels through
Cloudflare R2 via the Python pipeline. `backend/migrate_v2.sql` converts a
live project.

### Added
- R2 sharing: per-channel objects plus an append-only catalog; the app runs
  `search.py --pull-only` on every sync tick.
- Archive metadata bootstrapped from R2; peer-waited channels delayed in the
  backlog.
- Multi-country search and merge-status resets.
- New logo and theme; font scale setting.
- A shortcut to the data folder in the build.

### Fixed
- Local mirror faults handled and live data reconnected after a drop.

## 1.1.0 — 2026-09-08

### Added
- Scratchpad: one live shared text box per person.
- Keyword evaluation UI and archive notes.
- Scheduled-archive bulk action and `found_via` tracking.
- Auto-clean gate, database rebuild and sync UI on the dashboard.
- Last manual sync status exposed in Settings.

### Changed
- "Average views" is a trailing-30-day median everywhere.
- Keyword dashboard copy and layout refined.

### Fixed
- `schema.sql` upgrade path for the median rename.
- `channel_archive` mirrored by `updated_at`.
- Refetch improved.

## 1.0.1 – 1.0.8 — 2026-09-06

Release-automation patches: auto version bump from commit messages, the
Windows release workflow, assets attaching to GitHub Releases, pruning old
bundles from `dist/`, `-SkipBuild`, pinned Windows runner. Also the About
card and pinned filters.

## 1.0.0-beta.1 — 2026-09-06

First tagged build. Everything from the August rebuild: dashboard with
analytics and series toggles, search with live progress and resume, influencer
roster with filters, pins, archive and countdown, brands, deals, outreach with
templates, writing rules, follow-ups and the Gmail mailbox, email critique
library, news feeds, activity log, notifications on Windows, time zones,
Arabic/English, and the Inno Setup installer.
