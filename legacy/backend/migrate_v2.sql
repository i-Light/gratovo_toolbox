-- ============================================================================
-- One-time migration: the "live-first" database → the "typed-in only" one
-- ============================================================================
-- Run this ONCE, in the Supabase SQL Editor, on a project built from the
-- previous schema.sql (the one with `channels`, `videos`, `keywords`, `runs`,
-- `edit_claims`, `news_*`, …). Then run schema.sql.
--
-- Everything here happens inside Postgres: no egress, no download. What it
-- does, in order:
--
--   1. Creates `channel_state` and copies every human-edited column of
--      `channels` into it — but ONLY for channels somebody actually touched,
--      so the new table is sized by the team's work, not the pipeline's.
--   2. Drops the tables whose data now lives in R2 or on each machine:
--      videos, channels, keywords, channel_keywords, channel_archive, runs,
--      edit_claims, channel_outreach_counts, client_merge_status,
--      news_sources, news_items. This is the step that returns the space.
--   3. Clears the old tombstone rows (they named tables that no longer exist)
--      and resets the purge horizon, so every machine's first sync after the
--      new build starts clean.
--
-- BEFORE running it:
--   * every machine has finished its last `search.py` run (its local
--     gratovo.db is the source of the scraped data from here on);
--   * `python search.py --export-supabase` has been run once from a machine
--     with the service key — it saves the archive, keywords and channel↔keyword
--     links to data/migration/*.jsonl for the R2 bootstrap. Small (a few MB).
--
-- Safe to re-run: every step is guarded on the old table still existing.
-- Atomic: the SQL Editor runs the file as one transaction.
-- ============================================================================

-- --- 1. channel_state ------------------------------------------------------
create table if not exists public.channel_state (
  channel_id         text primary key,
  handle             text not null,
  vetting_status     text not null default 'newlyFound'
                       check (vetting_status in ('newlyFound','shortlisted','rejected')),
  relevance_criteria jsonb,
  notes              text,
  pipeline_stage     text not null default 'new'
                       check (pipeline_stage in (
                         'new','contacted','interested','roster',
                         'negotiating','contract','awaitingDelivery','paid','lost')),
  channel_tags       text[] not null default '{}'::text[]
                       constraint channel_state_channel_tags_vocabulary
                       check (channel_tags <@ array['undecided','qualified',
                                                    'haramStuff','irrelevant',
                                                    'inactive']::text[]),
  contacts           jsonb not null default '[]'::jsonb,
  provided_data      jsonb,
  archive_due_at     timestamptz,
  last_deal_at       timestamptz,
  last_edited_by      uuid references public.profiles(id) on delete set null,
  last_edited_by_name text,
  updated_at         timestamptz not null default now()
);

do $$
declare v_copied integer;
begin
  if to_regclass('public.channels') is null then
    raise notice 'channels already gone — nothing to copy';
    return;
  end if;

  -- "Touched" = any app-owned column differs from its default. A channel the
  -- pipeline found and nobody looked at has no state worth a row.
  insert into public.channel_state (
    channel_id, handle, vetting_status, relevance_criteria, notes,
    pipeline_stage, channel_tags, contacts, provided_data, archive_due_at,
    last_deal_at, last_edited_by, last_edited_by_name, updated_at)
  select
    c.channel_id, c.handle, c.vetting_status, c.relevance_criteria, c.notes,
    c.pipeline_stage, c.channel_tags, c.contacts, c.provided_data,
    c.archive_due_at, c.last_deal_at, c.last_edited_by, c.last_edited_by_name,
    c.updated_at
  from public.channels c
  where c.vetting_status <> 'newlyFound'
     or c.pipeline_stage <> 'new'
     or c.channel_tags <> '{}'::text[]
     or c.contacts <> '[]'::jsonb
     or nullif(c.notes, '') is not null
     or c.relevance_criteria is not null
     or c.provided_data is not null
     or c.last_deal_at is not null
     or c.archive_due_at is not null
  on conflict (channel_id) do nothing;

  get diagnostics v_copied = row_count;
  raise notice 'channel_state: % rows carried across', v_copied;
end $$;

-- --- 2. Drop what no longer lives here --------------------------------------
-- CASCADE takes the foreign keys other tables held to `channels` (deals,
-- outreach_threads, follow_up_reminders, edit_conflicts) and the two views
-- with it. The referencing tables themselves are untouched.
drop table if exists public.videos                  cascade;
drop table if exists public.channel_keywords        cascade;
drop table if exists public.channel_outreach_counts cascade;
drop table if exists public.channel_archive         cascade;
drop table if exists public.channels                cascade;
drop table if exists public.keywords                cascade;
drop table if exists public.runs                    cascade;
drop table if exists public.edit_claims             cascade;
drop table if exists public.client_merge_status     cascade;
drop table if exists public.news_items              cascade;
drop table if exists public.news_sources            cascade;

-- --- 3. Reset the sync bookkeeping ------------------------------------------
-- The old tombstones named `channels` / `channel_archive`, which the new
-- check constraint (schema.sql) would refuse. They are meaningless now: the
-- tables they pointed at are gone and every machine re-pulls the (small)
-- copied tables from scratch on its first sync with the new build.
do $$
begin
  if to_regclass('public.sync_tombstones') is not null then
    delete from public.sync_tombstones;
  end if;
  if to_regclass('public.sync_control') is not null then
    update public.sync_control set tombstones_purged_before = now() where id;
  end if;
end $$;

-- Now run schema.sql. It re-creates every function, trigger, policy and
-- index against the new shape, and drops the retired functions and cron
-- jobs that referred to the tables above.
