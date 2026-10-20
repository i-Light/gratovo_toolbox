-- ---------------------------------------------------------------------------
-- Tests for the sync columns and notification_switches
-- (supabase/migrations/20261022090000_sync_columns.sql)
-- ---------------------------------------------------------------------------
-- Covers the four new columns and their checks, activity_log.received_at,
-- the notification_switches table (own row only), and that no existing column
-- of the four tables changed type, default or nullability.
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

-- Runs one statement as a signed-in user and returns the SQLSTATE it fails
-- with, or 'ok'.
create or replace function pg_temp.sqlstate_of(p_uid text, p_sql text)
returns text language plpgsql as $$
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  begin
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;

-- Same, as the anonymous role.
create or replace function pg_temp.sqlstate_anon(p_sql text)
returns text language plpgsql as $$
begin
  set local role anon;
  begin
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;

-- Rows an `authenticated` caller updates or deletes with one statement.
create or replace function pg_temp.rows_changed(p_uid text, p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;

-- --- fixture ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('b3000000-0000-0000-0000-000000000001', 'sw-one@x'),
  ('b3000000-0000-0000-0000-000000000002', 'sw-two@x'),
  ('b3000000-0000-0000-0000-000000000003', 'sw-waiting@x')
  on conflict do nothing;
update public.profiles set role = 'basic' where id in
  ('b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000002');
-- ...0003 stays 'unauthorized'.
delete from public.notification_switches;
insert into public.notification_switches (profile_id, switches) values
  ('b3000000-0000-0000-0000-000000000002', '{"mine": false}');

\set QUIET off
\echo '# sync_columns'

-- --- the four new columns --------------------------------------------------
select pg_temp.check('creator_stage, sells, status and flow_step exist with the right types',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and (table_name, column_name, data_type) in (
      ('channel_state', 'creator_stage', 'text'),
      ('brands', 'sells', 'text'),
      ('brands', 'status', 'text'),
      ('deals', 'flow_step', 'smallint'))
      and is_nullable = 'YES' and column_default is null) = 4);

insert into public.channel_state (channel_id, handle) values ('sync-c1', '@sync_ai') on conflict do nothing;
insert into public.brands (id, name) values ('b3000000-0000-0000-0000-0000000000b1', 'Sync Brand') on conflict do nothing;
insert into public.deals (id, brand_id, channel_id) values
  ('b3000000-0000-0000-0000-0000000000d1', 'b3000000-0000-0000-0000-0000000000b1', 'sync-c1') on conflict do nothing;


create or replace function pg_temp.try(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

select pg_temp.check('creator_stage accepts each of the 11 stages and null',
  not exists (
    select 1 from unnest(array['new','shortlisted','contact','emailed','replied','kit','audience','signed','rejected','parked','never']) s
     where pg_temp.try(format('update public.channel_state set creator_stage = %L where channel_id = ''sync-c1''', s)) <> 'ok')
  and pg_temp.try('update public.channel_state set creator_stage = null where channel_id = ''sync-c1''') = 'ok');
select pg_temp.check('creator_stage refuses a stage that is not one of the 11 (23514)',
  pg_temp.try('update public.channel_state set creator_stage = ''contacted'' where channel_id = ''sync-c1''') = '23514'
  and pg_temp.try('update public.channel_state set creator_stage = '''' where channel_id = ''sync-c1''') = '23514');

select pg_temp.check('brands.sells accepts null and 500 characters, refuses 501 (23514)',
  pg_temp.try('update public.brands set sells = null') = 'ok'
  and pg_temp.try('update public.brands set sells = repeat(''a'', 500)') = 'ok'
  and pg_temp.try('update public.brands set sells = repeat(''a'', 501)') = '23514');
select pg_temp.check('brands.status accepts null and 40 characters, refuses 41 (23514)',
  pg_temp.try('update public.brands set status = null') = 'ok'
  and pg_temp.try('update public.brands set status = repeat(''a'', 40)') = 'ok'
  and pg_temp.try('update public.brands set status = repeat(''a'', 41)') = '23514');

select pg_temp.check('deals.flow_step accepts null and 0 to 9, refuses -1 and 10 (23514)',
  pg_temp.try('update public.deals set flow_step = null') = 'ok'
  and pg_temp.try('update public.deals set flow_step = 0') = 'ok'
  and pg_temp.try('update public.deals set flow_step = 9') = 'ok'
  and pg_temp.try('update public.deals set flow_step = -1') = '23514'
  and pg_temp.try('update public.deals set flow_step = 10') = '23514');

-- --- activity_log.received_at ---------------------------------------------
select pg_temp.check('received_at is timestamptz, not null, defaulted',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'activity_log' and column_name = 'received_at'
             and data_type = 'timestamp with time zone' and is_nullable = 'NO' and column_default is not null));
select pg_temp.check('received_at is indexed with the id as tie-break',
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'activity_log'
             and indexname = 'idx_activity_log_received'
             and indexdef like '%(received_at, id)%'));
insert into public.activity_log (id, at, actor_name, actor_role, action, entity_type)
  values ('b3000000-0000-0000-0000-0000000000a1', '2020-01-01T00:00:00Z', 'Sync', 'basic', 'note', 'app');
select pg_temp.check('a line written with an old `at` still gets a fresh received_at',
  (select received_at > now() - interval '1 hour' and at < received_at
     from public.activity_log where id = 'b3000000-0000-0000-0000-0000000000a1'));

-- --- notification_switches -------------------------------------------------
select pg_temp.check('the table has RLS and a touch trigger',
  (select relrowsecurity from pg_class where oid = 'public.notification_switches'::regclass)
  and exists (select 1 from pg_trigger where tgrelid = 'public.notification_switches'::regclass
                 and tgname = 'trg_notification_switches_touch' and not tgisinternal));
select pg_temp.check('switches must be a json object: an array, a scalar and a json null are refused (23514)',
  pg_temp.try($q$ insert into public.notification_switches (profile_id, switches)
                  values ('b3000000-0000-0000-0000-000000000003', '[]') $q$) = '23514'
  and pg_temp.try($q$ insert into public.notification_switches (profile_id, switches)
                  values ('b3000000-0000-0000-0000-000000000003', '5') $q$) = '23514'
  and pg_temp.try($q$ insert into public.notification_switches (profile_id, switches)
                  values ('b3000000-0000-0000-0000-000000000003', 'null') $q$) = '23514');

begin;
  select pg_temp.check('an authorized member inserts their own row',
    pg_temp.sqlstate_of('b3000000-0000-0000-0000-000000000001',
      $q$ insert into public.notification_switches (profile_id, switches)
           values ('b3000000-0000-0000-0000-000000000001', '{"mine": true}') $q$) = 'ok');
  set local role authenticated;
  select set_config('test.uid', 'b3000000-0000-0000-0000-000000000001', true);
  create temp table seen_sw as select profile_id, switches from public.notification_switches;
  grant select on seen_sw to public;
  reset role;
  select pg_temp.check('a member reads only their own row (the other member''s row is hidden)',
    (select count(*) = 1 and bool_and(profile_id = 'b3000000-0000-0000-0000-000000000001') from seen_sw));
  select pg_temp.check('a member updates their own row',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000001',
      $q$ update public.notification_switches set switches = '{"mine": false}'
           where profile_id = 'b3000000-0000-0000-0000-000000000001' $q$) = 1);
  select pg_temp.check('updated_at moves on update',
    (select updated_at = now() from public.notification_switches
      where profile_id = 'b3000000-0000-0000-0000-000000000001'));
  select pg_temp.check('another member''s row: an update touches 0 rows',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000001',
      $q$ update public.notification_switches set switches = '{"x": 1}'
           where profile_id = 'b3000000-0000-0000-0000-000000000002' $q$) = 0);
  select pg_temp.check('another member''s row: a delete touches 0 rows',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000001',
      $q$ delete from public.notification_switches
           where profile_id = 'b3000000-0000-0000-0000-000000000002' $q$) = 0);
  select pg_temp.check('writing a row for someone else is refused (42501)',
    pg_temp.sqlstate_of('b3000000-0000-0000-0000-000000000001',
      $q$ insert into public.notification_switches (profile_id) values ('b3000000-0000-0000-0000-000000000003') $q$) = '42501');
  select pg_temp.check('moving your row to someone else is refused (42501)',
    pg_temp.sqlstate_of('b3000000-0000-0000-0000-000000000001',
      $q$ update public.notification_switches set profile_id = 'b3000000-0000-0000-0000-000000000003'
           where profile_id = 'b3000000-0000-0000-0000-000000000001' $q$) = '42501');
  select pg_temp.check('deleting your own row touches 0 rows (no delete policy)',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000001',
      $q$ delete from public.notification_switches
           where profile_id = 'b3000000-0000-0000-0000-000000000001' $q$) = 0);
  select pg_temp.check('the switches column must stay an object on update (23514)',
    pg_temp.sqlstate_of('b3000000-0000-0000-0000-000000000001',
      $q$ update public.notification_switches set switches = '[1]'
           where profile_id = 'b3000000-0000-0000-0000-000000000001' $q$) = '23514');
rollback;

begin;
  -- An unauthorized member: a row exists for them, but they can neither read nor write it.
  insert into public.notification_switches (profile_id, switches)
    values ('b3000000-0000-0000-0000-000000000003', '{"mine": true}');
  select pg_temp.check('an unauthorized member cannot update their own row (0 rows)',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000003',
      $q$ update public.notification_switches set switches = '{"x": 1}'
           where profile_id = 'b3000000-0000-0000-0000-000000000003' $q$) = 0);
  select pg_temp.check('an unauthorized member cannot delete their own row (0 rows)',
    pg_temp.rows_changed('b3000000-0000-0000-0000-000000000003',
      $q$ delete from public.notification_switches
           where profile_id = 'b3000000-0000-0000-0000-000000000003' $q$) = 0);
  set local role authenticated;
  select set_config('test.uid', 'b3000000-0000-0000-0000-000000000003', true);
  create temp table seen_sw_waiting as select profile_id from public.notification_switches;
  grant select on seen_sw_waiting to public;
  reset role;
  select pg_temp.check('an unauthorized member reads nothing, not even their own row',
    (select count(*) = 0 from seen_sw_waiting));
rollback;
select pg_temp.check('an unauthorized member cannot insert their own row (42501)',
  pg_temp.sqlstate_of('b3000000-0000-0000-0000-000000000003',
    $q$ insert into public.notification_switches (profile_id) values ('b3000000-0000-0000-0000-000000000003') $q$) = '42501');

select pg_temp.check('anon holds nothing on the table',
  not has_table_privilege('anon', 'public.notification_switches', 'select')
  and not has_table_privilege('anon', 'public.notification_switches', 'insert')
  and not has_table_privilege('anon', 'public.notification_switches', 'update')
  and not has_table_privilege('anon', 'public.notification_switches', 'delete')
  and pg_temp.sqlstate_anon('select * from public.notification_switches') = '42501');

-- --- nothing existing changed ----------------------------------------------
-- The runner applies migrations before any row exists, so data surviving can't
-- be shown directly. What can be shown: the columns that were there keep their
-- type, nullability and default. (table, column, type, nullable, default)
create temp table expected_columns (t text, c text, ty text, nullable text, def text);
insert into expected_columns values
  ('channel_state', 'channel_id',     'text',                     'NO',  null),
  ('channel_state', 'handle',         'text',                     'NO',  null),
  ('channel_state', 'vetting_status', 'text',                     'NO',  '''newlyFound''::text'),
  ('channel_state', 'notes',          'text',                     'YES', null),
  ('channel_state', 'pipeline_stage', 'text',                     'NO',  '''new''::text'),
  ('channel_state', 'channel_tags',   'ARRAY',                    'NO',  '''{}''::text[]'),
  ('channel_state', 'contacts',       'jsonb',                    'NO',  '''[]''::jsonb'),
  ('channel_state', 'provided_data',  'jsonb',                    'YES', null),
  ('channel_state', 'updated_at',     'timestamp with time zone', 'NO',  'now()'),
  ('brands',        'id',             'uuid',                     'NO',  'gen_random_uuid()'),
  ('brands',        'name',           'text',                     'NO',  null),
  ('brands',        'budget',         'numeric',                  'YES', null),
  ('brands',        'contacts',       'jsonb',                    'NO',  '''[]''::jsonb'),
  ('brands',        'budget_currency','text',                     'NO',  '''USD''::text'),
  ('brands',        'updated_at',     'timestamp with time zone', 'NO',  'now()'),
  ('deals',         'id',             'uuid',                     'NO',  'gen_random_uuid()'),
  ('deals',         'brand_id',       'uuid',                     'NO',  null),
  ('deals',         'channel_id',     'text',                     'NO',  null),
  ('deals',         'brand_price',    'numeric',                  'NO',  '0'),
  ('deals',         'influencer_payout','numeric',                'NO',  '0'),
  ('deals',         'updated_at',     'timestamp with time zone', 'NO',  'now()'),
  ('activity_log',  'id',             'uuid',                     'NO',  'gen_random_uuid()'),
  ('activity_log',  'at',             'timestamp with time zone', 'NO',  'now()'),
  ('activity_log',  'actor_name',     'text',                     'NO',  null),
  ('activity_log',  'action',         'text',                     'NO',  null),
  ('activity_log',  'entity_id',      'text',                     'YES', null),
  ('activity_log',  'detail',         'jsonb',                    'YES', null);
select pg_temp.check('every declared existing column keeps its type, nullability and default',
  not exists (
    select 1 from expected_columns e
      left join information_schema.columns i
        on i.table_schema = 'public' and i.table_name = e.t and i.column_name = e.c
     where i.column_name is null
        or i.data_type <> e.ty
        or i.is_nullable <> e.nullable
        or i.column_default is distinct from e.def));

\echo 'SYNC COLUMNS PASSED'
