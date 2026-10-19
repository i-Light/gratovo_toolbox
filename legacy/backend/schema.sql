-- ============================================================================
-- Gratovo IMA Toolbox — the whole Supabase database, in one file
-- ============================================================================
-- Paste into the Supabase SQL Editor and Run. That is the entire setup.
--
-- This is the CURRENT STATE of the schema, not a history of it. Safe on an
-- empty project and safe to re-run on a live one: every statement is
-- IF NOT EXISTS / OR REPLACE / guarded.
--
-- A project built on the PREVIOUS shape (one with `channels`, `videos`,
-- `keywords`, `runs`, …) must run `migrate_v2.sql` ONCE before this file —
-- it carries the human-edited channel columns into `channel_state` and then
-- drops the tables that no longer live here. See SETUP.md.
--
-- ---------------------------------------------------------------------------
-- WHAT LIVES HERE, AND WHAT DOES NOT
--
-- This database holds only what a person TYPED IN and the rest of the team
-- must see: which channels were shortlisted/tagged/annotated, deals, brands,
-- outreach, templates, reminders, writing rules, the activity log, the team
-- scratchpad, the agency's own facts, the Comms queue, and who the accounts are. Every table is small and changes at
-- human speed.
--
-- Nothing SCRAPED lives here. Channels, their videos, the keywords that found
-- them and the archive of rejected channels are produced by the Python
-- pipeline in bulk — millions of rows over time — and live in Cloudflare R2
-- (one compressed object per channel plus an append-only catalog log; see
-- pipeline/README.md). The app never reads any of that from a server: each
-- machine keeps everything in one local SQLite file and this database is
-- pulled into it as a delta, so the app works fully offline.
--
-- Nothing DERIVED lives here either. Rollups, outreach counts, dashboard
-- statistics, "what a video is worth" — all computed on each machine from
-- the local file. A derived number a server stores is a number that has to be
-- kept in step, and there is no reason to pay for that.
--
-- The one live thing: `scratchpads` is in the realtime publication. Every
-- other "something changed" signal is a single Broadcast message the client
-- sends after its own upload succeeds — one message per human action, however
-- many rows the action touched.
--
-- ACCESS LEVELS, enforced here and not in the app:
--   unauthorized  the default for any new account. Reads nothing.
--   basic         reads and writes everything a `full` account does. The app
--                 hides the Outreach page from this level — a UI convenience,
--                 not a data boundary; the data still syncs to that machine
--                 so local counts work.
--   full          everything.
--
-- ORDER: extensions, tables, functions, triggers, security, realtime, retired
-- objects, cron. Nothing references anything defined below it.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
-- pg_trgm serves the `ilike '%…%'` boxes on the logs page. It lives in
-- `extensions`, not `public`, because `public` is the schema PostgREST
-- exposes (the linter's `extension_in_public`). Every mention of
-- `gin_trgm_ops` below must be schema-qualified for that reason.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

do $$ begin
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Roles and profiles
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('unauthorized', 'basic', 'full');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null,
  -- The colour of this person's editing borders everywhere in the app.
  color         text not null default '#3B82F6',
  role          public.app_role not null default 'unauthorized',
  created_at    timestamptz not null default now(),
  -- Pulled into every machine's local copy like everything else, so the
  -- cursor column is needed here too.
  updated_at    timestamptz not null default now()
);

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();


-- ---------------------------------------------------------------------------
-- 3. Channel state — the human-edited half of a channel
-- ---------------------------------------------------------------------------
-- The scraped half (name, subscribers, description, videos …) is NOT here; it
-- is in R2 and in each machine's local file, keyed by the same channel_id. A
-- row exists here only once somebody has touched the channel — a note, a tag,
-- a stage change, a contact — so this table is sized by the team's work, not
-- by the pipeline's output.
--
-- No foreign key to a channels table, because there is none. A row whose
-- channel this machine has not yet downloaded from R2 is kept locally and
-- joined the moment the channel arrives.
create table if not exists public.channel_state (
  channel_id         text primary key,
  -- What the channel is CALLED, snapshotted at first edit so conflicts and
  -- the log can name it without a join to data this database does not hold.
  handle             text not null,
  vetting_status     text not null default 'newlyFound'
                       check (vetting_status in ('newlyFound','shortlisted','rejected')),
  relevance_criteria jsonb,
  notes              text,
  pipeline_stage     text not null default 'new'
                       check (pipeline_stage in (
                         'new','contacted','interested','roster',
                         'negotiating','contract','awaitingDelivery','paid','lost')),
  -- What the channel is ABOUT — a closed vocabulary mirroring ChannelTag in
  -- lib/data/models/influencer.dart. Adding a tag means editing both.
  channel_tags       text[] not null default '{}'::text[]
                       constraint channel_state_channel_tags_vocabulary
                       check (channel_tags <@ array['undecided','qualified',
                                                    'haramStuff','irrelevant',
                                                    'inactive']::text[]),
  -- Shape: [{"method":"email","value":"a@b.com","label":"manager","primary":true}]
  contacts           jsonb not null default '[]'::jsonb,
  provided_data      jsonb,
  -- Set by trigger 7 days after the channel is tagged rejected; nulled the
  -- moment it stops being. The app runs the sweep (it is the only party that
  -- can also delete the R2 objects), so this is a countdown every machine can
  -- read, not something the database acts on.
  archive_due_at     timestamptz,
  last_deal_at       timestamptz,
  -- So a conflict can name the other person rather than saying "somebody".
  last_edited_by      uuid references public.profiles(id) on delete set null,
  last_edited_by_name text,
  updated_at         timestamptz not null default now()
);

create index if not exists idx_channel_state_archive_due
  on public.channel_state (archive_due_at) where archive_due_at is not null;


-- ---------------------------------------------------------------------------
-- 4. Business data
-- ---------------------------------------------------------------------------
-- Every table here carries `updated_at` (the pull cursor) and a tombstone
-- trigger (section 11), because every one of them is copied to every machine.

create table if not exists public.brands (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  website            text,
  budget             numeric,
  campaign_brief     text,
  preferred_criteria jsonb,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.deals (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null references public.brands(id) on delete cascade,
  channel_id            text not null,
  stage                 text not null default 'proposed'
                          check (stage in ('proposed','negotiating','agreed','contractSent',
                                           'signed','live','closed','lost')),
  brand_price           numeric not null default 0,
  influencer_payout     numeric not null default 0,
  deliverables          text,
  deadline              timestamptz,
  contract_url          text,
  notes                 text,
  working_days_estimate integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_deals_channel on public.deals (channel_id);
create index if not exists idx_deals_brand   on public.deals (brand_id);
create index if not exists idx_deals_stage   on public.deals (stage);

create table if not exists public.outreach_threads (
  id          uuid primary key default gen_random_uuid(),
  channel_id  text not null unique,
  deal_id     uuid references public.deals(id) on delete set null,
  status      text not null default 'notContactedYet'
                check (status in ('notContactedYet','awaitingReply','replied','needsFollowUp')),
  updated_at  timestamptz not null default now()
);

create table if not exists public.outreach_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.outreach_threads(id) on delete cascade,
  direction     text not null check (direction in ('outbound','inbound')),
  -- The vocabulary mirrors ContactMethod.wire in Dart, name for name.
  method        text not null default 'email'
                  check (method in ('email','whatsapp','phone','instagram',
                                    'telegram','twitter','discord','other')),
  subject       text,
  body          text,
  -- The counterparty address, whatever its shape (`peerAddress` in Dart).
  peer_email    text,
  at            timestamptz not null default now(),
  is_ai_drafted boolean not null default false,
  template_id   uuid,
  updated_at    timestamptz not null default now()
);

alter table public.outreach_messages
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_msgs_thread on public.outreach_messages (thread_id, at desc);

create table if not exists public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text,
  body       text,
  kind       text not null default 'email' check (kind in ('email','dm')),
  updated_at timestamptz not null default now()
);

alter table public.email_templates
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.writing_rules (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.writing_rules
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.follow_up_reminders (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  due_at     timestamptz not null,
  kind       text not null default 'custom'
               check (kind in ('followUp','dealDeadline','custom')),
  channel_id text,
  deal_id    uuid references public.deals(id) on delete cascade,
  is_done    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.follow_up_reminders
  add column if not exists created_at timestamptz not null default now();
alter table public.follow_up_reminders
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_reminders_due on public.follow_up_reminders (due_at) where not is_done;
create index if not exists idx_reminders_channel_open
  on public.follow_up_reminders (channel_id) where not is_done;


-- ---------------------------------------------------------------------------
-- 4.5 Campaigns, deliverables, rate history and sequences (1.3)
-- ---------------------------------------------------------------------------
-- A campaign is purely a label for grouping deals and building proposals and
-- reports for one brand. Deliberately no budget or KPI column: the broker
-- does not manage the brand's budget or campaign delivery, only the deals
-- inside it (each of which already carries its own `brand_price` /
-- `influencer_payout` — see the `deals` table above).
create table if not exists public.campaigns (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  name       text not null,
  notes      text,
  status     text not null default 'active' check (status in ('active','closed')),
  start_date timestamptz,
  live_date  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaigns_brand on public.campaigns (brand_id);

-- Channels under consideration for a campaign, before any of them becomes a
-- deal — the proposal-building step. `channel_id` is plain text, never an
-- FK, for the same reason `deals.channel_id` is: the channel it names may
-- live only in R2 / each machine's local file, never in this database.
create table if not exists public.campaign_shortlist (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references public.campaigns(id) on delete cascade,
  channel_id           text not null,
  why_fit              text,
  price_basis_snapshot jsonb,
  added_at             timestamptz not null default now()
);

create index if not exists idx_campaign_shortlist_campaign on public.campaign_shortlist (campaign_id);

-- One agreed-upon piece of content within a deal — a "integration + 2
-- community posts" package is one `deals` row and several of these, each
-- tracked to publish on its own.
create table if not exists public.deliverables (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references public.deals(id) on delete cascade,
  type                text not null default 'other'
                        check (type in ('integration','dedicated','short','communityPost','other')),
  agreed_date         timestamptz,
  draft_received_date timestamptz,
  approved_date       timestamptz,
  published_url       text,
  status              text not null default 'pending'
                        check (status in ('pending','drafted','approved','published')),
  notes               text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_deliverables_deal on public.deliverables (deal_id);

-- One row per closed deal: what this channel actually went for, so the next
-- proposal can price against real history instead of a guess. Never updated
-- once written; `deal_id` goes null rather than the row disappearing if the
-- deal itself is later deleted.
create table if not exists public.channel_rate_history (
  id                   uuid primary key default gen_random_uuid(),
  channel_id           text not null,
  deal_id              uuid references public.deals(id) on delete set null,
  brand_price          numeric not null,
  influencer_payout    numeric not null,
  median_views_at_deal integer,
  closed_at            timestamptz not null default now()
);

create index if not exists idx_channel_rate_history_channel on public.channel_rate_history (channel_id);
create index if not exists idx_channel_rate_history_deal    on public.channel_rate_history (deal_id);

-- A named, reusable outreach plan. Mirrors `email_templates`' shape — a
-- small team-wide library, last write wins, no per-field conflict handling.
create table if not exists public.sequences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- One step of a sequence: send `template_id` `delay_days` after the
-- previous step (or after the sequence starts, for step 1).
create table if not exists public.sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  step_no     integer not null,
  template_id uuid references public.email_templates(id) on delete set null,
  delay_days  integer not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_sequence_steps_sequence on public.sequence_steps (sequence_id);
create index if not exists idx_sequence_steps_template on public.sequence_steps (template_id);

-- 1.3 additions to existing tables --------------------------------------
alter table public.deals add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
alter table public.deals add column if not exists owner_id    uuid references public.profiles(id) on delete set null;
alter table public.deals add column if not exists currency    text not null default 'USD';
alter table public.deals add column if not exists brand_invoice_sent_at  timestamptz;
alter table public.deals add column if not exists brand_invoice_paid_at  timestamptz;
alter table public.deals add column if not exists creator_payout_due_at  timestamptz;
alter table public.deals add column if not exists creator_payout_paid_at timestamptz;
alter table public.deals add column if not exists payment_method    text;
alter table public.deals add column if not exists payment_reference text;

create index if not exists idx_deals_campaign on public.deals (campaign_id);
create index if not exists idx_deals_owner    on public.deals (owner_id);

-- Engagement is manual-entry only by design — no automated fetch, so no
-- "computed at" vs API columns, just what a person typed and when.
alter table public.channel_state add column if not exists owner_id                     uuid references public.profiles(id) on delete set null;
alter table public.channel_state add column if not exists manual_engagement_rate       numeric;
alter table public.channel_state add column if not exists manual_engagement_note       text;
alter table public.channel_state add column if not exists manual_engagement_updated_at timestamptz;

create index if not exists idx_channel_state_owner on public.channel_state (owner_id);

alter table public.outreach_threads add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_outreach_threads_owner on public.outreach_threads (owner_id);

alter table public.outreach_messages add column if not exists classification text
  check (classification in ('interested','askingRate','notNow','decline','wrongContact','autoReply'));


-- ---------------------------------------------------------------------------
-- 4.6 The owner's decisions of 2026-10-18 (1.4)
-- ---------------------------------------------------------------------------
-- docs/plans/decisions_build_plan.md, step 2. Inline checks on `add column if
-- not exists` are only created with the column, so re-running adds nothing.

-- A creator's media kit, typed in from what they send: top audience countries
-- with their share, main age band, engagement, the kit's link, rate card rows.
-- Shape: {"countries":[{"code":"US","pct":41}],"ageBand":"18-34",
--         "engagement":4.2,"link":"https://…","rates":[{"format":"integration","price":900}]}
alter table public.channel_state add column if not exists media_kit jsonb;
-- House choice HC-08 (avoid female creators, couples included) needs the fact
-- recorded; the engine's gate reads it.
alter table public.channel_state add column if not exists creator_gender text
  check (creator_gender in ('male','female','couple','unknown'));

-- A brand can have several contacts (HC-25), same shape as channel_state.contacts.
-- `source` says whether a person added it or it was found sponsoring a creator.
alter table public.brands add column if not exists category        text;
alter table public.brands add column if not exists country         text;
alter table public.brands add column if not exists contacts        jsonb not null default '[]'::jsonb;
alter table public.brands add column if not exists budget_currency text not null default 'USD';
alter table public.brands add column if not exists source          text
  check (source in ('manual','seenSponsoring'));

-- Payment terms have no default on purpose (decision payment-terms: set per
-- deal). Two contracts in the course's order: the brand's contract is the
-- template, the creator signs first, the brand after. The order is the app's
-- rule, not a check here, so a contract signed out of order can still be
-- recorded as what actually happened.
alter table public.deals add column if not exists payment_terms           text;
alter table public.deals add column if not exists tracking_link           text;
alter table public.deals add column if not exists creator_contract_url    text;
alter table public.deals add column if not exists creator_contract_status text not null default 'none'
  check (creator_contract_status in ('none','draft','sent','signed'));
alter table public.deals add column if not exists creator_signed_at       timestamptz;
alter table public.deals add column if not exists brand_contract_url      text;
alter table public.deals add column if not exists brand_contract_status   text not null default 'none'
  check (brand_contract_status in ('none','draft','sent','signed'));
alter table public.deals add column if not exists brand_signed_at         timestamptz;

-- When a deliverable went live, and the 30-day report: the views fetched then
-- (a snapshot with its time, never overwritten by a later fetch of the live
-- count) and clicks, typed in when a tracking link is set.
alter table public.deliverables add column if not exists published_at    timestamptz;
alter table public.deliverables add column if not exists report_views    bigint;
alter table public.deliverables add column if not exists report_views_at timestamptz;
alter table public.deliverables add column if not exists report_clicks   integer;

-- A thread can belong to a brand contact instead of a channel. channel_id
-- stays unique (NULLs never collide); every thread names one or the other.
alter table public.outreach_threads alter column channel_id drop not null;
alter table public.outreach_threads add column if not exists brand_id      uuid references public.brands(id) on delete cascade;
alter table public.outreach_threads add column if not exists contact_email text;

create index if not exists idx_outreach_threads_brand on public.outreach_threads (brand_id);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'outreach_threads_has_party'
                    and conrelid = 'public.outreach_threads'::regclass) then
    alter table public.outreach_threads add constraint outreach_threads_has_party
      check (channel_id is not null or brand_id is not null);
  end if;
end $$;

-- The agency's own facts, one shared row: name, sender, what we do, website,
-- the true claims the engine may make, past campaigns, the incubator line
-- (HC-07), the boycott list (HC-09) and the daily target (decision
-- daily-target). A jsonb body rather than columns: the team edits it as one
-- card, last write wins, and a new fact needs no schema change.
create table if not exists public.agency_settings (
  id         text primary key default 'agency' check (id = 'agency'),
  body       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The Comms queue: one message the engine proposes, waiting for a person to
-- send, edit, redo or skip it. Nothing here is ever sent by the database or
-- by the engine; `status` records what the person did.
create table if not exists public.comms_proposals (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid references public.outreach_threads(id) on delete cascade,
  channel_id     text,
  brand_id       uuid references public.brands(id) on delete cascade,
  kind           text not null check (kind in ('first','reply','followUp','decision')),
  status         text not null default 'proposed'
                   check (status in ('proposed','approved','sent','skipped','failed','blocked')),
  -- What the engine returned: ready | needs_human | blocked | no_message.
  engine_status  text,
  -- The engine's read of the case; prefills the Steer panel.
  situation      jsonb,
  -- The person's corrections from the Steer panel that produced this draft.
  steer          jsonb,
  action         text,
  why            text,
  rules          jsonb not null default '[]'::jsonb,
  needs_human    jsonb not null default '[]'::jsonb,
  subject        text,
  body           text,
  follow_up_days integer,
  variant        text,
  model          text,
  error          text,
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint comms_proposals_has_party check (channel_id is not null or brand_id is not null)
);

create index if not exists idx_comms_proposals_thread     on public.comms_proposals (thread_id);
create index if not exists idx_comms_proposals_channel    on public.comms_proposals (channel_id);
create index if not exists idx_comms_proposals_brand      on public.comms_proposals (brand_id);
create index if not exists idx_comms_proposals_status     on public.comms_proposals (status);
create index if not exists idx_comms_proposals_decided_by on public.comms_proposals (decided_by);


-- ---------------------------------------------------------------------------
-- 5. Collaboration: conflicts, the action log, the scratchpad
-- ---------------------------------------------------------------------------
-- WHAT COUNTS AS A CONFLICT: not "two people edited the same field", but
-- "somebody edited a field based on a value that is no longer there". Every
-- edit carries the value the editor was looking at — the BASE — and applies
-- only if the column still holds it. The discriminator is staleness of the
-- base, not simultaneity.
create table if not exists public.edit_conflicts (
  id             uuid primary key default gen_random_uuid(),
  channel_id     text not null,
  channel_label  text not null,
  field          text not null,
  base_value     jsonb,
  mine_value     jsonb,
  theirs_value   jsonb,
  mine_actor_id   uuid references public.profiles(id) on delete set null,
  mine_actor_name text not null,
  theirs_actor_name text,
  detected_at    timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_by_name text,
  resolution       text check (resolution in ('mine','theirs','merged')),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_edit_conflicts_open
  on public.edit_conflicts (detected_at desc) where resolved_at is null;
create index if not exists idx_edit_conflicts_channel
  on public.edit_conflicts (channel_id) where resolved_at is null;

-- One OPEN conflict per person per field per channel; apply_channel_edit()
-- upserts onto this index instead of stacking copies of one disagreement.
create unique index if not exists uq_edit_conflicts_open
  on public.edit_conflicts (channel_id, field, mine_actor_id)
  where resolved_at is null;

-- Every action anyone takes, kept whether or not that person still has an
-- account, and recording the authority they held AT THE TIME. Written locally
-- first on each machine and uploaded in batches; `at` is the client's clock
-- and, with `id`, the pull cursor.
create table if not exists public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text not null,
  actor_role   text not null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  entity_label text,
  field        text,
  old_value    text,
  new_value    text,
  detail       jsonb
);

create index if not exists idx_activity_log_at     on public.activity_log (at desc, id desc);
create index if not exists idx_activity_log_actor  on public.activity_log (actor_id, at desc);
create index if not exists idx_activity_log_entity on public.activity_log (entity_type, entity_id, at desc);
create index if not exists idx_activity_log_actor_name_search
  on public.activity_log using gin (lower(actor_name) extensions.gin_trgm_ops);
create index if not exists idx_activity_log_entity_label_search
  on public.activity_log using gin (lower(coalesce(entity_label, '')) extensions.gin_trgm_ops);

-- The team scratchpad: one free-text box per person, shared read, edited only
-- by its owner. The ONE table in the realtime publication (section 13): the
-- box the whole team is looking at updates within a second or two. The client
-- debounces saves to ~1.2s and flushes on blur.
create table if not exists public.scratchpads (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  body        text not null default '',
  updated_at  timestamptz not null default now()
);

-- One person handing another a keyword list to run on their machine. The app
-- never deletes a row (no tombstone handling needed) -- it moves from
-- 'pending' to 'applied'/'dismissed' and stays as a record of what was sent.
-- `keywords` is newline-separated, the same shape the Search screen's
-- keyword box already persists, so a receiving machine can hand it straight
-- to `SearchKeywordsNotifier.setText`.
create table if not exists public.remote_search_requests (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references public.profiles(id) on delete cascade,
  to_user_id    uuid not null references public.profiles(id) on delete cascade,
  keywords      text not null,
  status        text not null default 'pending'
                  check (status in ('pending','applied','dismissed')),
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  updated_at    timestamptz not null default now()
);


-- One person's own AWS IAM key pair for `tools/aws_gateway_setup.py`,
-- recorded here so the team can see who is holding which key and when it
-- last changed. NOT a live credential store the pipeline reads from --
-- `data/.env` on the machine running the script is still the only thing
-- `config.py` actually loads (see that script's module doc comment); this
-- table is bookkeeping, one row per person, own row only. Deliberately
-- outside the sync_tombstones/mirror machinery in section 6 below and the
-- realtime publication in section 13 -- see `SupabaseAwsGatewayCredentialsRepository`'s
-- doc comment for why this one talks to Supabase directly instead of going
-- through the local-first mirror every other table uses.
create table if not exists public.aws_gateway_credentials (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  access_key_id      text not null default '',
  secret_access_key  text not null default '',
  default_regions    text not null default '',
  updated_at         timestamptz not null default now()
);

-- Append-only history of the row above -- one snapshot per save, so a person
-- can see what their fields held at any earlier point and copy an old value
-- back in. Same reasoning as `activity_log`: no update, no delete, here or
-- in the RLS policies below.
create table if not exists public.aws_gateway_credential_history (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  access_key_id      text not null default '',
  secret_access_key  text not null default '',
  default_regions    text not null default '',
  saved_at           timestamptz not null default now()
);

create index if not exists idx_aws_gateway_credential_history_user
  on public.aws_gateway_credential_history (user_id, saved_at desc);


-- ---------------------------------------------------------------------------
-- 6. Sync bookkeeping: tombstones, the purge horizon, the cursor indexes
-- ---------------------------------------------------------------------------
-- A `where updated_at > $cursor` pull cannot return a row that no longer
-- exists, so every deletion on a copied table leaves a tombstone.
create table if not exists public.sync_tombstones (
  table_name text not null,
  row_id     text not null,
  deleted_at timestamptz not null default now(),
  primary key (table_name, row_id)
);

-- The vocabulary grew; re-declare the check rather than trust the one an
-- older run left behind.
alter table public.sync_tombstones drop constraint if exists sync_tombstones_table_name_check;
alter table public.sync_tombstones add constraint sync_tombstones_table_name_check
  check (table_name in ('channel_state','deals','brands','outreach_threads',
                        'outreach_messages','email_templates',
                        'follow_up_reminders','writing_rules',
                        'campaigns','campaign_shortlist','deliverables',
                        'channel_rate_history','sequences','sequence_steps',
                        'agency_settings','comms_proposals'));

create index if not exists idx_sync_tombstones_cursor
  on public.sync_tombstones (deleted_at, table_name, row_id);

-- The purge horizon, in a singleton table. A machine whose tombstone cursor is
-- behind it has missed deletions it can never learn about, and re-pulls the
-- copied tables from scratch (a few MB — cheap here, unlike before).
create table if not exists public.sync_control (
  id                       boolean primary key default true check (id),
  tombstones_purged_before timestamptz not null default '-infinity'
);

-- The (cursor, key) indexes the pull walks. The tie-break matters: `now()` is
-- transaction start time, so a batch upsert stamps every row identically.
create index if not exists idx_channel_state_sync_cursor       on public.channel_state (updated_at, channel_id);
create index if not exists idx_edit_conflicts_sync_cursor      on public.edit_conflicts (updated_at, id);
create index if not exists idx_deals_sync_cursor               on public.deals (updated_at, id);
create index if not exists idx_brands_sync_cursor              on public.brands (updated_at, id);
create index if not exists idx_outreach_threads_sync_cursor    on public.outreach_threads (updated_at, id);
create index if not exists idx_outreach_messages_sync_cursor   on public.outreach_messages (updated_at, id);
create index if not exists idx_email_templates_sync_cursor     on public.email_templates (updated_at, id);
create index if not exists idx_writing_rules_sync_cursor       on public.writing_rules (updated_at, id);
create index if not exists idx_follow_up_reminders_sync_cursor on public.follow_up_reminders (updated_at, id);
create index if not exists idx_profiles_sync_cursor            on public.profiles (updated_at, id);
create index if not exists idx_remote_search_requests_sync_cursor on public.remote_search_requests (updated_at, id);
create index if not exists idx_remote_search_requests_to_user   on public.remote_search_requests (to_user_id, status);
create index if not exists idx_campaigns_sync_cursor          on public.campaigns (updated_at, id);
create index if not exists idx_campaign_shortlist_sync_cursor on public.campaign_shortlist (added_at, id);
create index if not exists idx_deliverables_sync_cursor       on public.deliverables (updated_at, id);
create index if not exists idx_channel_rate_history_sync_cursor on public.channel_rate_history (closed_at, id);
create index if not exists idx_sequences_sync_cursor          on public.sequences (updated_at, id);
create index if not exists idx_sequence_steps_sync_cursor     on public.sequence_steps (updated_at, id);
create index if not exists idx_agency_settings_sync_cursor    on public.agency_settings (updated_at, id);
create index if not exists idx_comms_proposals_sync_cursor    on public.comms_proposals (updated_at, id);

-- Nothing a signed-in session does may sit holding a lock longer than the
-- work takes. lock_timeout is below PostgREST's statement_timeout on purpose,
-- so a contended write fails as a *retryable* lock error the next sync pass
-- clears. Scoped to `authenticated`; the service role keeps server defaults.
alter role authenticated set lock_timeout = '3s';
alter role authenticated set idle_in_transaction_session_timeout = '15s';


-- ===========================================================================
-- FUNCTIONS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7. Roles, timestamps, signup
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read profiles even when the caller has no rights
-- on that table — otherwise every policy that calls it would recurse into
-- profiles' own RLS. `set search_path` on every function a policy depends on.
create or replace function public.app_current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'unauthorized'::public.app_role
  );
$$;

create or replace function public.is_full() returns boolean
language sql stable set search_path = public
as $$ select public.app_current_role() = 'full'; $$;

create or replace function public.is_authorized() returns boolean
language sql stable set search_path = public
as $$ select public.app_current_role() in ('basic','full'); $$;

-- Every new signup gets a profile at the LOWEST access level. Promotion is a
-- deliberate admin action, never automatic.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    (array['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6',
           '#EC4899','#14B8A6','#F97316'])[1 + (('x'||substr(new.id::text,1,8))::bit(32)::int & 7)]
  );
  return new;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;


-- ---------------------------------------------------------------------------
-- 8. The archive countdown
-- ---------------------------------------------------------------------------
create or replace function public.channel_is_rejected(p_tags text[])
returns boolean
language sql immutable set search_path = public
as $$
  select coalesce(p_tags && array['haramStuff','irrelevant','inactive']::text[], false);
$$;

-- Seven days from the moment a rejecting tag goes on; cleared the moment it
-- comes off. A column rather than a derivation from updated_at, which any
-- unrelated edit would silently reset.
create or replace function public.set_archive_due_at()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.channel_is_rejected(new.channel_tags) then
    if new.archive_due_at is null then
      new.archive_due_at := now() + interval '7 days';
    end if;
  else
    new.archive_due_at := null;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 9. The compare-and-set that stops edits overwriting each other
-- ---------------------------------------------------------------------------
-- Every value is compared as jsonb, whatever the column's real type. Two
-- normalisations, both there to prevent conflicts about nothing: NULL and ''
-- are the same fact for a text field; tag and criteria lists are SETS.
-- `contacts` is deliberately NOT sorted — its order is meaningful.
create or replace function public.canonical_edit_value(p_field text, p_value jsonb)
returns jsonb
language sql immutable set search_path = public
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when p_field in ('notes','vetting_status','pipeline_stage','creator_gender')
         and p_value #>> '{}' = '' then null
    when p_field in ('channel_tags','relevance_criteria')
         and jsonb_typeof(p_value) = 'array' then (
           select coalesce(jsonb_agg(e order by e), '[]'::jsonb)
             from jsonb_array_elements(p_value) e
         )
    else p_value
  end;
$$;

-- The argument list changed (a label is now needed to create the row on first
-- edit), and Postgres treats that as a different function.
drop function if exists public.apply_channel_edit(text, text, jsonb, jsonb, boolean);

-- Returns one of:
--   'noop'     nothing was being changed
--   'auto'     the value already equals what was being written
--   'applied'  the base still matched, so the edit went in
--   'conflict' the base was stale; an edit_conflicts row now holds all three
--              values and the column was NOT touched
--
-- There is no 'missing' any more: a channel's state row is created on its
-- first edit, with the defaults every never-touched channel implicitly has,
-- so an edit against a channel this database has never heard of is simply
-- the first edit. `p_label` is the handle to name that new row with.
--
-- SECURITY INVOKER (the plpgsql default), deliberately: every statement runs
-- under the caller's own policies, so this grants nothing a direct UPDATE
-- would not — it only makes the write conditional.
create or replace function public.apply_channel_edit(
  p_channel_id text,
  p_field      text,
  p_base       jsonb,
  p_new        jsonb,
  p_force      boolean default false,
  p_label      text default null
) returns text
language plpgsql set search_path = public
as $$
declare
  v_current    jsonb;
  v_label      text;
  v_their_name text;
  v_my_name    text;
  v_base       jsonb := public.canonical_edit_value(p_field, p_base);
  v_new        jsonb := public.canonical_edit_value(p_field, p_new);
begin
  -- A hardcoded whitelist, not a check on the caller's string: this function
  -- builds an UPDATE with format(%I), and the set of writable columns must be
  -- decided here rather than by whatever the client sends.
  if p_field not in ('notes','vetting_status','pipeline_stage','channel_tags',
                     'relevance_criteria','provided_data','contacts',
                     'media_kit','creator_gender') then
    raise exception 'field % is not editable through apply_channel_edit', p_field
      using errcode = '22023';
  end if;

  -- First edit of this channel anywhere: create its row with the defaults.
  insert into public.channel_state (channel_id, handle)
  values (p_channel_id, coalesce(nullif(p_label, ''), p_channel_id))
  on conflict (channel_id) do nothing;

  execute format(
    'select to_jsonb(c.%I), c.handle, c.last_edited_by_name
       from public.channel_state c where c.channel_id = $1', p_field)
    into v_current, v_label, v_their_name
    using p_channel_id;

  v_current := public.canonical_edit_value(p_field, v_current);

  if not p_force then
    if v_base is not distinct from v_new then
      return 'noop';
    end if;
    if v_current is not distinct from v_new then
      return 'auto';
    end if;
    if v_current is distinct from v_base then
      select coalesce(display_name, 'someone') into v_my_name
        from public.profiles where id = auth.uid();

      insert into public.edit_conflicts as ec
        (channel_id, channel_label, field, base_value, mine_value, theirs_value,
         mine_actor_id, mine_actor_name, theirs_actor_name)
      values
        (p_channel_id, coalesce(nullif(p_label, ''), v_label), p_field,
         v_base, v_new, v_current,
         auth.uid(), coalesce(v_my_name, 'someone'), v_their_name)
      on conflict (channel_id, field, mine_actor_id) where resolved_at is null
      do update set
        mine_value        = excluded.mine_value,
        theirs_value      = excluded.theirs_value,
        theirs_actor_name = excluded.theirs_actor_name,
        detected_at       = now();
      return 'conflict';
    end if;
  end if;

  if p_field = 'channel_tags' then
    update public.channel_state
       set channel_tags = coalesce(
             (select array_agg(e) from jsonb_array_elements_text(v_new) e),
             '{}'::text[]),
           handle = coalesce(nullif(p_label, ''), handle),
           last_edited_by = auth.uid(),
           last_edited_by_name = (
             select display_name from public.profiles where id = auth.uid())
     where channel_id = p_channel_id;
  elsif p_field in ('notes','vetting_status','pipeline_stage','creator_gender') then
    execute format(
      'update public.channel_state set %I = $1, last_edited_by = $2,
              handle = coalesce(nullif($4, ''''), handle),
              last_edited_by_name = (select display_name from public.profiles
                                      where id = $2)
        where channel_id = $3', p_field)
      using v_new #>> '{}', auth.uid(), p_channel_id, p_label;
  else
    execute format(
      'update public.channel_state set %I = $1, last_edited_by = $2,
              handle = coalesce(nullif($4, ''''), handle),
              last_edited_by_name = (select display_name from public.profiles
                                      where id = $2)
        where channel_id = $3', p_field)
      using v_new, auth.uid(), p_channel_id, p_label;
  end if;

  return 'applied';
end $$;

create or replace function public.resolve_edit_conflict(
  p_id uuid, p_resolution text, p_value jsonb
) returns text
language plpgsql set search_path = public
as $$
declare
  v_conflict public.edit_conflicts;
  v_outcome  text;
  v_name     text;
begin
  if p_resolution not in ('mine','theirs','merged') then
    raise exception 'unknown resolution %', p_resolution using errcode = '22023';
  end if;

  select * into v_conflict from public.edit_conflicts where id = p_id;
  if v_conflict.id is null then
    return 'missing';
  end if;
  if v_conflict.resolved_at is not null then
    return 'already_resolved';
  end if;

  v_outcome := public.apply_channel_edit(
    v_conflict.channel_id, v_conflict.field, null, p_value, true,
    v_conflict.channel_label);

  select coalesce(display_name, 'someone') into v_name
    from public.profiles where id = auth.uid();

  update public.edit_conflicts
     set resolved_at      = now(),
         resolved_by      = auth.uid(),
         resolved_by_name = coalesce(v_name, 'someone'),
         resolution       = p_resolution
   where id = p_id;

  return v_outcome;
end $$;


-- ---------------------------------------------------------------------------
-- 10. Tombstones and their purge
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: sync_tombstones has RLS on and NO insert policy — a
-- tombstone a client can forge is a way to make a row disappear from
-- everyone's machine — and running as the definer is what lets the only
-- legitimate writer (a delete trigger) through that closed door.
--
-- One function for every copied table: the key is `id` where there is one
-- and `channel_id` on channel_state.
create or replace function public.record_sync_tombstone()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(old);
begin
  insert into public.sync_tombstones (table_name, row_id, deleted_at)
  values (tg_table_name, coalesce(v_row->>'id', v_row->>'channel_id'), now())
  on conflict (table_name, row_id) do update set deleted_at = now();
  return old;
end $$;

create or replace function public.purge_sync_tombstones(p_keep_days integer default 90)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_keep_days);
  v_purged integer;
begin
  delete from public.sync_tombstones where deleted_at < v_cutoff;
  get diagnostics v_purged = row_count;
  update public.sync_control
     set tombstones_purged_before = greatest(tombstones_purged_before, v_cutoff)
   where id;
  return v_purged;
end $$;


-- ===========================================================================
-- TRIGGERS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 11. Wiring
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','channel_state','brands','deals','outreach_threads',
    'outreach_messages','email_templates','writing_rules',
    'follow_up_reminders','edit_conflicts','scratchpads',
    'remote_search_requests','aws_gateway_credentials',
    'campaigns','deliverables','sequences','sequence_steps',
    'agency_settings','comms_proposals'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

drop trigger if exists trg_channel_state_archive_due on public.channel_state;
create trigger trg_channel_state_archive_due
  before insert or update on public.channel_state
  for each row execute function public.set_archive_due_at();

do $$
declare t text;
begin
  foreach t in array array[
    'channel_state','deals','brands','outreach_threads','outreach_messages',
    'email_templates','follow_up_reminders','writing_rules',
    'campaigns','campaign_shortlist','deliverables','channel_rate_history',
    'sequences','sequence_steps','agency_settings','comms_proposals'
  ] loop
    execute format('drop trigger if exists trg_tombstone_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_tombstone_%1$s after delete on public.%1$s
       for each row execute function public.record_sync_tombstone()', t);
  end loop;
end $$;


-- ===========================================================================
-- SECURITY
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 12. Row level security and grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','channel_state','brands','deals','outreach_threads',
    'outreach_messages','email_templates','writing_rules',
    'follow_up_reminders','activity_log','edit_conflicts',
    'sync_tombstones','sync_control','scratchpads','remote_search_requests',
    'aws_gateway_credentials','aws_gateway_credential_history',
    'campaigns','campaign_shortlist','deliverables','channel_rate_history',
    'sequences','sequence_steps','agency_settings','comms_proposals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles — every authorized user sees who their teammates are. Nobody can
-- change their own ROLE; that column is writable only by the service key.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (public.is_authorized() or id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.app_current_role());

-- The shared working tables: any authorized user may read and write,
-- 'unauthorized' gets nothing. The team is trusted here. Outreach and deals
-- are on this list on purpose — see the header on `basic`.
do $$
declare t text;
begin
  foreach t in array array[
    'channel_state','brands','deals','outreach_threads','outreach_messages',
    'follow_up_reminders','email_templates','writing_rules',
    'campaigns','campaign_shortlist','deliverables','channel_rate_history',
    'sequences','sequence_steps','agency_settings','comms_proposals'
  ] loop
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format(
      'create policy %1$s_rw on public.%1$s for all to authenticated
       using (public.is_authorized()) with check (public.is_authorized())', t);
  end loop;
end $$;

-- The old full-only policies, if an earlier run left them: with two policies
-- on a table Postgres ORs them, which would silently be correct but untidy.
drop policy if exists deals_full_only on public.deals;
drop policy if exists threads_full_only on public.outreach_threads;
drop policy if exists messages_full_only on public.outreach_messages;

-- APPEND-ONLY, ENFORCED BY THE DATABASE: a select and an insert policy, and
-- deliberately no update or delete. The insert check pins the actor to the
-- caller, so nobody can file an action under a colleague's name.
drop policy if exists activity_log_read on public.activity_log;
create policy activity_log_read on public.activity_log
  for select to authenticated using (public.is_authorized());

drop policy if exists activity_log_append on public.activity_log;
create policy activity_log_append on public.activity_log
  for insert to authenticated
  with check (public.is_authorized() and (actor_id = auth.uid() or actor_id is null));

-- The scratchpad: everyone reads every box, a person writes only their own.
drop policy if exists scratchpads_read on public.scratchpads;
create policy scratchpads_read on public.scratchpads
  for select to authenticated using (public.is_authorized());

drop policy if exists scratchpads_write on public.scratchpads;
create policy scratchpads_write on public.scratchpads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Remote search requests: visible and writable only to the two people it's
-- between, not the whole team. ONE `for all` policy rather than split
-- insert/update ones deliberately -- the sync engine writes every row
-- through `upsert()` (`mirror_uploader.dart`), and Postgres requires an
-- INSERT ... ON CONFLICT DO UPDATE's proposed row to satisfy BOTH the
-- INSERT and the UPDATE policy's WITH CHECK regardless of which branch
-- actually fires, so a sender-only insert policy alongside a recipient-only
-- update policy would make the recipient's own ack (marking a request
-- applied/dismissed) fail RLS. Being a party to the row either way is
-- enough to read or touch it; the app itself only ever calls `send()` as
-- the sender and `markApplied`/`markDismissed` as the recipient, so this is
-- looser at the database than the app's own usage needs, not looser than
-- what's safe -- the same trust level the rest of this schema gives any
-- authorized teammate over the tables above.
drop policy if exists remote_search_requests_read on public.remote_search_requests;
drop policy if exists remote_search_requests_send on public.remote_search_requests;
drop policy if exists remote_search_requests_ack on public.remote_search_requests;
drop policy if exists remote_search_requests_rw on public.remote_search_requests;
create policy remote_search_requests_rw on public.remote_search_requests
  for all to authenticated
  using (public.is_authorized() and auth.uid() in (from_user_id, to_user_id))
  with check (public.is_authorized() and auth.uid() in (from_user_id, to_user_id));

-- AWS IAM keys: unlike scratchpads, NOT visible to the rest of the team --
-- a secret access key is not a status update. Every policy here is scoped
-- to the row's own owner, both read and write, on both tables.
drop policy if exists aws_gateway_credentials_rw on public.aws_gateway_credentials;
create policy aws_gateway_credentials_rw on public.aws_gateway_credentials
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists aws_gateway_credential_history_read on public.aws_gateway_credential_history;
create policy aws_gateway_credential_history_read on public.aws_gateway_credential_history
  for select to authenticated using (user_id = auth.uid());

drop policy if exists aws_gateway_credential_history_append on public.aws_gateway_credential_history;
create policy aws_gateway_credential_history_append on public.aws_gateway_credential_history
  for insert to authenticated with check (user_id = auth.uid());

-- Conflicts are readable and resolvable by any authorized user. No delete
-- policy — a conflict can be resolved but never made to disappear.
drop policy if exists edit_conflicts_read on public.edit_conflicts;
create policy edit_conflicts_read on public.edit_conflicts
  for select to authenticated using (public.is_authorized());

drop policy if exists edit_conflicts_write on public.edit_conflicts;
create policy edit_conflicts_write on public.edit_conflicts
  for insert to authenticated with check (public.is_authorized());

drop policy if exists edit_conflicts_resolve on public.edit_conflicts;
create policy edit_conflicts_resolve on public.edit_conflicts
  for update to authenticated
  using (public.is_authorized()) with check (public.is_authorized());

-- Tombstones and the sync horizon: read for any authorized user, no write
-- policy at all (see record_sync_tombstone).
drop policy if exists sync_tombstones_read on public.sync_tombstones;
create policy sync_tombstones_read on public.sync_tombstones
  for select to authenticated using (public.is_authorized());

drop policy if exists sync_control_read on public.sync_control;
create policy sync_control_read on public.sync_control
  for select to authenticated using (public.is_authorized());

-- Grants: Postgres checks table PRIVILEGES first, then row POLICIES. Broad
-- privileges plus narrow policies is Supabase's model.
grant usage on schema public to authenticated;
grant usage on schema extensions to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The service key, granted by name too. From 2026-10-30 Supabase no longer
-- exposes a new public table to the Data API until it is granted explicitly
-- (changelog: "tables not exposed to Data and GraphQL API automatically"), so
-- every grant this project relies on is written here and re-applied each run.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- EXECUTE is the whole of the REST API's RPC surface. Take it away from
-- everything, then hand it back by name; a function absent from the list is
-- not callable over the API by anyone.
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- The two the Flutter client calls:
grant execute on function public.apply_channel_edit(text, text, jsonb, jsonb, boolean, text) to authenticated;
grant execute on function public.resolve_edit_conflict(uuid, text, jsonb)                    to authenticated;

-- Reached from inside a policy or an invoker-rights function, both of which
-- run as the caller and so check the caller's EXECUTE.
grant execute on function public.is_authorized()                   to authenticated;
grant execute on function public.is_full()                         to authenticated;
grant execute on function public.app_current_role()                to authenticated;
grant execute on function public.canonical_edit_value(text, jsonb) to authenticated;
grant execute on function public.channel_is_rejected(text[])       to authenticated;

-- Maintenance, run by the scheduler.
grant execute on function public.purge_sync_tombstones(integer) to service_role;

-- Anonymous (not signed in) gets nothing anywhere. Last, so nothing above can
-- undo it.
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;


-- ===========================================================================
-- REALTIME, RETIRED OBJECTS, SCHEDULE
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 13. Realtime — one table
-- ---------------------------------------------------------------------------
-- Each table here costs one realtime message per row change per connected
-- client. `scratchpads` is written by one person at a time at typing speed
-- (debounced), and the whole team is looking at it — the one case where
-- pushing from the database is worth it. Everything else announces itself
-- with a client Broadcast after its upload succeeds: one message per human
-- action, whatever it touched.
--
-- Anything an earlier run added is taken back out; a search run's bulk
-- writes never reach this database any more, but the list is re-asserted
-- rather than assumed.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'no supabase_realtime publication here — skipping live push';
    return;
  end if;
  foreach t in array array[
    'channels','keywords','runs','edit_claims','client_merge_status',
    'channel_state','deals','brands','outreach_threads','outreach_messages'
  ] loop
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
  begin
    execute 'alter publication supabase_realtime add table public.scratchpads';
  exception when duplicate_object then null;
  end;
end $$;

-- A publication with no subscriber still makes Postgres retain WAL.
drop publication if exists powersync;


-- ---------------------------------------------------------------------------
-- 14. Retired objects
-- ---------------------------------------------------------------------------
-- Functions, views and jobs from the previous shape of this database. Every
-- one is `if exists`, so this section is a no-op on a fresh project and
-- converges an old one. The TABLES of the old shape are NOT dropped here —
-- that is migrate_v2.sql's job, because it first has to carry data across.
drop view if exists public.influencer_rows;
drop view if exists public.active_edit_claims;

-- Triggers on tables that survive, pointing at functions that do not.
drop trigger if exists trg_outreach_count        on public.outreach_messages;
drop trigger if exists trg_thread_outreach_count on public.outreach_threads;

drop function if exists public.claim_entity(text, text, text);
drop function if exists public.release_entity(text, text);
drop function if exists public.email_feed(int, int);
drop function if exists public.email_feed(uuid, int, int);
drop function if exists public.deal_feed();
drop function if exists public.latest_video_per_channel(text[]);
drop function if exists public.increment_contact_attempts(text);
drop function if exists public.channel_outbound_count(text);
drop function if exists public.channel_stats(text, text, text, text, bigint, bigint, bigint, bigint, integer);
drop function if exists public.channel_stats_facets();
drop function if exists public.bulk_reject_by_subscribers(bigint, bigint, bigint, bigint, timestamptz, text, boolean, boolean, bigint, boolean);
drop function if exists public.bulk_manage_archive_due(text, bigint, bigint, bigint, bigint, bigint, boolean, boolean, text[]);
drop function if exists public.archive_due_channels(boolean, text[]);
drop function if exists public.set_archive_label(text, text);
drop function if exists public.set_archive_due(text, timestamptz);
drop function if exists public.archive_note_keyword(text, text, int, timestamptz);
drop function if exists public.refresh_channel_video_rollups(text[]);
drop function if exists public.videos_touch_rollups();
drop function if exists public.refresh_channel_outreach_count();
drop function if exists public.refresh_thread_outreach_counts();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('gratovo_refresh_video_rollups')
      where exists (select 1 from cron.job where jobname = 'gratovo_refresh_video_rollups');
    perform cron.unschedule('gratovo-archive-sweep')
      where exists (select 1 from cron.job where jobname = 'gratovo-archive-sweep');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 15. Seed and the one nightly job
-- ---------------------------------------------------------------------------
insert into public.sync_control (id) values (true) on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled — the tombstone purge is NOT scheduled. Enable it in Database → Extensions and re-run this file.';
    return;
  end if;

  perform cron.unschedule('gratovo-tombstone-purge')
    where exists (select 1 from cron.job where jobname = 'gratovo-tombstone-purge');
  perform cron.schedule('gratovo-tombstone-purge', '57 3 * * *',
    $job$select public.purge_sync_tombstones(90)$job$);

  raise notice 'nightly job scheduled: tombstone purge 03:57 UTC';
end $$;
