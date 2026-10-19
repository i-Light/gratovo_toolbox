-- ---------------------------------------------------------------------------
-- Tests for the 1.4 additions (backend/schema.sql): the owner's decisions of
-- 2026-10-18 (docs/plans/decisions_build_plan.md, step 2).
-- ---------------------------------------------------------------------------
-- Media kit and creator flag on a channel, brand contacts and country, payment
-- terms and two contracts on a deal, the 30-day report on a deliverable,
-- threads that belong to a brand, and two new shared tables: the agency's
-- facts and the Comms queue. Plus the access story for the new tables, and the
-- explicit grants Supabase needs from 2026-10-30, when new tables stop being
-- exposed to the Data API by default.
-- Run with backend/tests/run.sh.
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

create or replace function pg_temp.has_col(p_table text, p_col text)
returns boolean language sql as $$
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = p_table
                    and column_name = p_col);
$$;

-- --- fixture ---------------------------------------------------------------
delete from public.comms_proposals;
delete from public.agency_settings;
delete from public.outreach_messages;
delete from public.outreach_threads;
delete from public.deliverables;
delete from public.deals;
delete from public.brands;
delete from public.channel_state;

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'full@x'),
  ('99999999-9999-9999-9999-999999999999', 'basic@x'),
  ('00000000-aaaa-aaaa-aaaa-000000000000', 'nobody@x')
  on conflict do nothing;
update public.profiles set role = 'full'  where id = '88888888-8888-8888-8888-888888888888';
update public.profiles set role = 'basic' where id = '99999999-9999-9999-9999-999999999999';

\set QUIET off

\echo '# new columns'
select pg_temp.check('channel_state has media_kit (jsonb) and creator_gender',
  pg_temp.has_col('channel_state', 'media_kit')
  and pg_temp.has_col('channel_state', 'creator_gender')
  and (select data_type = 'jsonb' from information_schema.columns
        where table_name = 'channel_state' and column_name = 'media_kit'));
select pg_temp.check('brands has category, country, contacts, budget_currency, source',
  pg_temp.has_col('brands', 'category') and pg_temp.has_col('brands', 'country')
  and pg_temp.has_col('brands', 'contacts') and pg_temp.has_col('brands', 'budget_currency')
  and pg_temp.has_col('brands', 'source'));
select pg_temp.check('deals has payment terms, a tracking link and two contracts',
  pg_temp.has_col('deals', 'payment_terms') and pg_temp.has_col('deals', 'tracking_link')
  and pg_temp.has_col('deals', 'creator_contract_url') and pg_temp.has_col('deals', 'creator_contract_status')
  and pg_temp.has_col('deals', 'creator_signed_at') and pg_temp.has_col('deals', 'brand_contract_url')
  and pg_temp.has_col('deals', 'brand_contract_status') and pg_temp.has_col('deals', 'brand_signed_at'));
select pg_temp.check('payment terms have no default (decision payment-terms: set per deal)',
  (select column_default is null from information_schema.columns
    where table_name = 'deals' and column_name = 'payment_terms'));
select pg_temp.check('deliverables carry the publish date and the 30-day report',
  pg_temp.has_col('deliverables', 'published_at') and pg_temp.has_col('deliverables', 'report_views')
  and pg_temp.has_col('deliverables', 'report_views_at') and pg_temp.has_col('deliverables', 'report_clicks'));
select pg_temp.check('a thread can name a brand and its contact',
  pg_temp.has_col('outreach_threads', 'brand_id') and pg_temp.has_col('outreach_threads', 'contact_email'));

\echo '# checks'
do $$
begin
  begin
    insert into public.channel_state (channel_id, handle, creator_gender) values ('UC_g', '@g', 'other');
    perform pg_temp.check('creator_gender outside its vocabulary is refused', false);
  exception when check_violation then
    perform pg_temp.check('creator_gender outside its vocabulary is refused', true);
  end;
  begin
    with b as (insert into public.brands (name) values ('Chk') returning id)
    insert into public.deals (brand_id, channel_id, creator_contract_status)
      select id, 'UC_c', 'lost' from b;
    perform pg_temp.check('a contract status outside its vocabulary is refused', false);
  exception when check_violation then
    perform pg_temp.check('a contract status outside its vocabulary is refused', true);
  end;
end $$;

\echo '# brand threads'
insert into public.brands (id, name) values ('b1400000-0000-0000-0000-000000000001', 'Brand One');
insert into public.outreach_threads (channel_id, brand_id, contact_email)
  values (null, 'b1400000-0000-0000-0000-000000000001', 'jack@brand.one');
select pg_temp.check('a thread can belong to a brand contact with no channel',
  (select count(*) = 1 from public.outreach_threads
    where brand_id = 'b1400000-0000-0000-0000-000000000001' and channel_id is null));
do $$
begin
  insert into public.outreach_threads (channel_id, brand_id) values (null, null);
  perform pg_temp.check('a thread with neither a channel nor a brand is refused', false);
exception when check_violation then
  perform pg_temp.check('a thread with neither a channel nor a brand is refused', true);
end $$;

\echo '# agency settings'
insert into public.agency_settings (id, body) values ('agency', '{"name":"Gratovo"}');
do $$
begin
  insert into public.agency_settings (id, body) values ('another', '{}');
  perform pg_temp.check('agency_settings holds exactly one row', false);
exception when check_violation then
  perform pg_temp.check('agency_settings holds exactly one row', true);
end $$;

\echo '# comms queue'
insert into public.comms_proposals (id, channel_id, kind, subject, body)
  values ('c1400000-0000-0000-0000-000000000001', 'UC_q', 'first', 's', 'b');
select pg_temp.check('a proposal starts as proposed',
  (select status = 'proposed' from public.comms_proposals
    where id = 'c1400000-0000-0000-0000-000000000001'));
do $$
begin
  insert into public.comms_proposals (channel_id, kind) values ('UC_q', 'spam');
  perform pg_temp.check('a proposal kind outside its vocabulary is refused', false);
exception when check_violation then
  perform pg_temp.check('a proposal kind outside its vocabulary is refused', true);
end $$;
update public.comms_proposals set updated_at = now() - interval '1 day'
  where id = 'c1400000-0000-0000-0000-000000000001';
update public.comms_proposals set status = 'approved'
  where id = 'c1400000-0000-0000-0000-000000000001';
select pg_temp.check('updated_at moves on every update of a proposal',
  (select updated_at > now() - interval '1 minute' from public.comms_proposals
    where id = 'c1400000-0000-0000-0000-000000000001'));
delete from public.comms_proposals where id = 'c1400000-0000-0000-0000-000000000001';
select pg_temp.check('deleting a proposal leaves a tombstone',
  exists (select 1 from public.sync_tombstones
           where table_name = 'comms_proposals' and row_id = 'c1400000-0000-0000-0000-000000000001'));

\echo '# access'
select pg_temp.check('row level security is on for both new tables',
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.agency_settings'::regclass, 'public.comms_proposals'::regclass)));
select pg_temp.check('signed-in users are granted the new tables explicitly (Data API, 2026-10-30)',
  has_table_privilege('authenticated', 'public.agency_settings', 'select,insert,update,delete')
  and has_table_privilege('authenticated', 'public.comms_proposals', 'select,insert,update,delete'));
select pg_temp.check('the service key is granted every public table explicitly',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not has_table_privilege('service_role', c.oid, 'select')));
select pg_temp.check('anonymous callers get nothing on the new tables',
  not has_table_privilege('anon', 'public.agency_settings', 'select')
  and not has_table_privilege('anon', 'public.comms_proposals', 'select'));

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '99999999-9999-9999-9999-999999999999', true);
  perform pg_temp.check('a basic user reads the agency facts',
    (select count(*) = 1 from public.agency_settings));
  insert into public.comms_proposals (channel_id, kind) values ('UC_b', 'reply');
  perform pg_temp.check('a basic user can add to the queue',
    (select count(*) = 1 from public.comms_proposals where channel_id = 'UC_b'));
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '00000000-aaaa-aaaa-aaaa-000000000000', true);
  perform pg_temp.check('an unauthorized user reads neither new table',
    (select count(*) = 0 from public.agency_settings)
    and (select count(*) = 0 from public.comms_proposals));
end $$;

\echo '# channel edits'
do $$
declare r text;
begin
  -- As the owner with test.uid set, like test_12: the stubs give the
  -- authenticated role no access to the auth schema that auth.uid() lives in.
  perform set_config('test.uid', '88888888-8888-8888-8888-888888888888', true);
  r := public.apply_channel_edit('UC_mk', 'media_kit', 'null'::jsonb,
         '{"countries":[{"code":"US","pct":41}],"ageBand":"18-34"}'::jsonb, false, '@mk');
  perform pg_temp.check('the media kit is editable through apply_channel_edit', r = 'applied');
  r := public.apply_channel_edit('UC_mk', 'creator_gender', 'null'::jsonb, '"male"'::jsonb, false, '@mk');
  perform pg_temp.check('the creator flag is editable through apply_channel_edit', r = 'applied');
end $$;
select pg_temp.check('both edits landed on the row',
  (select media_kit->'countries'->0->>'code' = 'US' and creator_gender = 'male'
     from public.channel_state where channel_id = 'UC_mk'));

\echo 'DECISIONS SCHEMA PASSED'
