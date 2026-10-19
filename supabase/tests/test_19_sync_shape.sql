-- ---------------------------------------------------------------------------
-- Tests for the sync shape (supabase/migrations/20261020120000_baseline.sql, sections 4, 6, 10–13)
-- ---------------------------------------------------------------------------
-- Every table the app copies to each machine has to satisfy three things a
-- pull-since sync silently depends on: `updated_at` moves on every UPDATE, a
-- DELETE leaves a tombstone, and the old-shape tables are actually gone.
-- Plus the access story: `basic` reads outreach (the page lock is UI-only),
-- `unauthorized` reads nothing, and the activity log cannot be rewritten.
-- Run with supabase/tests/run.ts (pnpm test:sql).
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end $$;

-- --- fixture ---------------------------------------------------------------
delete from public.outreach_messages;
delete from public.outreach_threads;
delete from public.deals;
delete from public.brands;
delete from public.email_templates;
delete from public.follow_up_reminders;
delete from public.writing_rules;
delete from public.channel_state;
delete from public.sync_tombstones;

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'full@x'),
  ('99999999-9999-9999-9999-999999999999', 'basic@x'),
  ('00000000-aaaa-aaaa-aaaa-000000000000', 'nobody@x')
  on conflict do nothing;
update public.profiles set role = 'full'  where id = '88888888-8888-8888-8888-888888888888';
update public.profiles set role = 'basic' where id = '99999999-9999-9999-9999-999999999999';

\set QUIET off

-- --- the old shape is gone --------------------------------------------------
\echo '# retired objects'
select pg_temp.check('no scraped-data table exists in this database',
  to_regclass('public.channels') is null
  and to_regclass('public.videos') is null
  and to_regclass('public.keywords') is null
  and to_regclass('public.channel_keywords') is null
  and to_regclass('public.channel_archive') is null
  and to_regclass('public.runs') is null
  and to_regclass('public.edit_claims') is null
  and to_regclass('public.channel_outreach_counts') is null
  and to_regclass('public.news_items') is null
  and to_regclass('public.client_merge_status') is null);

select pg_temp.check('no retired function is still reachable',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname in ('email_feed','deal_feed','claim_entity','channel_stats',
                                   'bulk_reject_by_subscribers','archive_due_channels',
                                   'refresh_channel_video_rollups','latest_video_per_channel')));

-- --- updated_at moves, tombstones are left -----------------------------------
\echo '# cursor and tombstones on every copied table'

insert into public.brands (id, name) values ('b0000000-0000-0000-0000-000000000001', 'Acme');
insert into public.deals (id, brand_id, channel_id)
  values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'UC_1');
insert into public.outreach_threads (id, channel_id)
  values ('e0000000-0000-0000-0000-000000000001', 'UC_1');
insert into public.outreach_messages (id, thread_id, direction, subject)
  values ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
          'outbound', 'hello');
insert into public.email_templates (id, name) values ('a0000000-0000-0000-0000-000000000001', 't');
insert into public.writing_rules (id, text) values ('a0000000-0000-0000-0000-000000000002', 'r');
insert into public.follow_up_reminders (id, title, due_at)
  values ('a0000000-0000-0000-0000-000000000003', 'call', now());
insert into public.channel_state (channel_id, handle) values ('UC_1', '@one');

-- Backdate every row, then update it: the trigger must bring updated_at forward.
update public.brands              set updated_at = now() - interval '1 day';
update public.deals               set updated_at = now() - interval '1 day';
update public.outreach_threads    set updated_at = now() - interval '1 day';
update public.outreach_messages   set updated_at = now() - interval '1 day';
update public.email_templates     set updated_at = now() - interval '1 day';
update public.writing_rules       set updated_at = now() - interval '1 day';
update public.follow_up_reminders set updated_at = now() - interval '1 day';
update public.channel_state       set updated_at = now() - interval '1 day';

select pg_temp.check('the touch trigger wins over a backdated updated_at on every copied table',
  (select bool_and(updated_at > now() - interval '1 minute') from (
     select updated_at from public.brands
     union all select updated_at from public.deals
     union all select updated_at from public.outreach_threads
     union all select updated_at from public.outreach_messages
     union all select updated_at from public.email_templates
     union all select updated_at from public.writing_rules
     union all select updated_at from public.follow_up_reminders
     union all select updated_at from public.channel_state) t));

delete from public.outreach_messages;
delete from public.outreach_threads;
delete from public.deals;
delete from public.brands;
delete from public.email_templates;
delete from public.writing_rules;
delete from public.follow_up_reminders;
delete from public.channel_state;

select pg_temp.check('a delete on each copied table leaves exactly one tombstone',
  (select count(*) = 8 from public.sync_tombstones)
  and (select count(distinct table_name) = 8 from public.sync_tombstones));

select pg_temp.check('a channel_state tombstone is keyed by channel_id',
  exists (select 1 from public.sync_tombstones
           where table_name = 'channel_state' and row_id = 'UC_1'));

select pg_temp.check('a deal tombstone is keyed by id',
  exists (select 1 from public.sync_tombstones
           where table_name = 'deals' and row_id = 'd0000000-0000-0000-0000-000000000001'));

-- --- who reads what --------------------------------------------------------
\echo '# access'
insert into public.outreach_threads (id, channel_id)
  values ('e0000000-0000-0000-0000-000000000002', 'UC_2');
insert into public.outreach_messages (thread_id, direction, subject, body)
  values ('e0000000-0000-0000-0000-000000000002', 'outbound', 'subj', 'the body');
with b as (insert into public.brands (name) values ('Beta') returning id)
insert into public.deals (brand_id, channel_id, brand_price)
  select id, 'UC_2', 500 from b;

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '99999999-9999-9999-9999-999999999999', true);
  perform pg_temp.check('a basic user reads outreach messages (the page lock is UI-only)',
    (select count(*) = 1 and bool_and(body = 'the body') from public.outreach_messages));
  perform pg_temp.check('a basic user reads deals',
    (select count(*) = 1 from public.deals));
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '00000000-aaaa-aaaa-aaaa-000000000000', true);
  perform pg_temp.check('an unauthorized user reads no outreach',
    (select count(*) = 0 from public.outreach_messages));
  perform pg_temp.check('an unauthorized user reads no channel state',
    (select count(*) = 0 from public.channel_state));
  perform pg_temp.check('an unauthorized user reads no tombstones',
    (select count(*) = 0 from public.sync_tombstones));
end $$;

-- --- the log is append-only --------------------------------------------------
\echo '# activity log'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', '88888888-8888-8888-8888-888888888888', true);
  insert into public.activity_log (actor_id, actor_name, actor_role, action, entity_type)
    values ('88888888-8888-8888-8888-888888888888', 'Full', 'full', 'edit', 'channel');
  update public.activity_log set action = 'rewritten';
  get diagnostics n = row_count;
  perform pg_temp.check('an UPDATE on the log matches zero rows', n = 0);
  delete from public.activity_log;
  get diagnostics n = row_count;
  perform pg_temp.check('a DELETE on the log matches zero rows', n = 0);
  begin
    insert into public.activity_log (actor_id, actor_name, actor_role, action, entity_type)
      values ('99999999-9999-9999-9999-999999999999', 'Basic', 'basic', 'edit', 'channel');
    perform pg_temp.check('filing an entry under a colleague''s id is refused', false);
  exception when insufficient_privilege then
    perform pg_temp.check('filing an entry under a colleague''s id is refused', true);
  end;
end $$;

-- --- realtime ----------------------------------------------------------------
\echo '# realtime'
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '  --  no supabase_realtime publication in this Postgres; skipped';
    return;
  end if;
  perform pg_temp.check('scratchpads is the only table in the realtime publication',
    (select array_agg(tablename order by tablename) = array['scratchpads']
       from pg_publication_tables where pubname = 'supabase_realtime'));
end $$;

\echo ''
\echo 'ALL SYNC SHAPE TESTS PASSED'
