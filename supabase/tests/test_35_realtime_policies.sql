-- ---------------------------------------------------------------------------
-- Tests for the private Realtime policies
-- (supabase/migrations/20261022090200_realtime_private.sql)
-- ---------------------------------------------------------------------------
-- Realtime evaluates the policies on realtime.messages as the joining user,
-- with the topic in `realtime.topic`. The stubs fake that table and function;
-- here each case sets the topic and the caller, then tries a select and an
-- insert. Run with supabase/tests/run.ts (pnpm test:sql).
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

-- Does an insert of (topic, extension) go through for this caller?
-- p_uid null = the anonymous role. Returns 'ok' or the SQLSTATE.
create or replace function pg_temp.send(p_uid text, p_topic text, p_ext text)
returns text language plpgsql as $$
begin
  perform set_config('test.uid', coalesce(p_uid, ''), false);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false);
  perform set_config('realtime.topic', p_topic, false);
  if p_uid is null then set role anon; else set role authenticated; end if;
  begin
    insert into realtime.messages (topic, extension, payload, event)
    values (p_topic, p_ext, '{}'::jsonb, 'changed');
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end $$;

-- How many seeded rows can this caller see on this topic?
create or replace function pg_temp.visible(p_uid text, p_topic text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), false);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false);
  perform set_config('realtime.topic', p_topic, false);
  if p_uid is null then set role anon; else set role authenticated; end if;
  begin
    select count(*) into n from realtime.messages where payload ->> 'seed' = '1';
  exception when others then
    reset role;
    return -1;
  end;
  reset role;
  return n;
end $$;

-- --- fixture ---------------------------------------------------------------
-- A real project lets `authenticated` use the auth schema (is_authorized and
-- auth.uid() need it); the stub does not.
grant usage on schema auth to authenticated;

insert into auth.users (id, email) values
  ('b5000000-0000-0000-0000-000000000001', 'rt-member@x'),
  ('b5000000-0000-0000-0000-000000000002', 'rt-waiting@x')
  on conflict do nothing;
update public.profiles set role = 'basic' where id = 'b5000000-0000-0000-0000-000000000001';
update public.profiles set role = 'unauthorized' where id = 'b5000000-0000-0000-0000-000000000002';

delete from realtime.messages;
insert into realtime.messages (topic, extension, payload, event) values
  ('toolbox:sync', 'broadcast', '{"seed":1}', 'changed'),
  ('toolbox:team', 'presence',  '{"seed":1}', 'presence_state'),
  ('toolbox:sync', 'postgres_changes', '{"seed":1}', 'x');

\set M '''b5000000-0000-0000-0000-000000000001'''
\set W '''b5000000-0000-0000-0000-000000000002'''

\set QUIET off
\echo '# realtime_private'

-- --- the policies ----------------------------------------------------------
select pg_temp.check('the two policies exist by name, for the right commands and role',
  (select count(*) = 2
     from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and ((policyname = 'toolbox_realtime_receive' and cmd = 'SELECT')
        or (policyname = 'toolbox_realtime_send' and cmd = 'INSERT'))
      and roles = '{authenticated}'));
select pg_temp.check('no other policy was added to realtime.messages',
  (select count(*) = 2 from pg_policies where schemaname = 'realtime' and tablename = 'messages'));
select pg_temp.check('row level security is on and the migration did not need to enable it',
  (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass));

-- --- a member on the app's two topics --------------------------------------
select pg_temp.check('a member sends a broadcast on toolbox:sync',
  pg_temp.send(:M, 'toolbox:sync', 'broadcast') = 'ok');
select pg_temp.check('a member sends presence on toolbox:team',
  pg_temp.send(:M, 'toolbox:team', 'presence') = 'ok');
select pg_temp.check('a member receives broadcast and presence on toolbox:sync (2 seeded rows, not postgres_changes)',
  pg_temp.visible(:M, 'toolbox:sync') = 2);
select pg_temp.check('a member receives on toolbox:team',
  pg_temp.visible(:M, 'toolbox:team') = 2);

-- --- anything else ---------------------------------------------------------
select pg_temp.check('the old app''s public topic is refused for sending (42501)',
  pg_temp.send(:M, 'gratovo:live', 'broadcast') = '42501'
  and pg_temp.send(:M, 'gratovo:workspace', 'presence') = '42501');
select pg_temp.check('another toolbox topic is refused for sending (42501)',
  pg_temp.send(:M, 'toolbox:other', 'broadcast') = '42501');
select pg_temp.check('those topics show 0 rows',
  pg_temp.visible(:M, 'gratovo:live') = 0 and pg_temp.visible(:M, 'toolbox:other') = 0);
select pg_temp.check('no topic at all shows 0 rows and refuses sending',
  pg_temp.visible(:M, '') = 0 and pg_temp.send(:M, '', 'broadcast') = '42501');
select pg_temp.check('the postgres_changes extension is refused on an allowed topic (42501)',
  pg_temp.send(:M, 'toolbox:sync', 'postgres_changes') = '42501');

-- --- a waiting member and anon ---------------------------------------------
select pg_temp.check('a waiting (unauthorized) member is refused on both topics',
  pg_temp.send(:W, 'toolbox:sync', 'broadcast') = '42501'
  and pg_temp.send(:W, 'toolbox:team', 'presence') = '42501'
  and pg_temp.visible(:W, 'toolbox:sync') = 0
  and pg_temp.visible(:W, 'toolbox:team') = 0);
select pg_temp.check('anon is refused on both topics',
  pg_temp.send(null, 'toolbox:sync', 'broadcast') <> 'ok'
  and pg_temp.send(null, 'toolbox:team', 'presence') <> 'ok'
  and pg_temp.visible(null, 'toolbox:sync') <= 0
  and pg_temp.visible(null, 'toolbox:team') <= 0);

delete from realtime.messages;

\echo 'REALTIME POLICIES PASSED'
