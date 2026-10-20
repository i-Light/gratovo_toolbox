-- ---------------------------------------------------------------------------
-- Tests for remote_search_requests (supabase/migrations/20261020120000_baseline.sql, sections 5, 12, 15)
-- ---------------------------------------------------------------------------
-- One person hands another a keyword list to run on their machine. The rule
-- to get right: visible and writable only to the two people a request is
-- between (not the whole team, unlike most shared tables here) -- a third,
-- unrelated authorized user must see and touch nothing. Read/write use ONE
-- symmetric policy rather than split sender-inserts/recipient-updates ones,
-- because the sync engine writes every row through `upsert()`, and Postgres
-- requires an INSERT ... ON CONFLICT DO UPDATE's proposed row to satisfy
-- both the INSERT and UPDATE policy's WITH CHECK regardless of which branch
-- fires -- see the comment above `remote_search_requests_rw` in schema.sql.
-- Run it with supabase/tests/run.ts (pnpm test:sql).
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
-- Two authorized teammates who exchange a request, a third authorized
-- teammate who is party to nothing, and one unauthorized outsider.
delete from public.remote_search_requests;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'sender@x'),
  ('b2222222-2222-2222-2222-222222222222', 'receiver@x'),
  ('d4444444-4444-4444-4444-444444444444', 'bystander@x'),
  ('c3333333-3333-3333-3333-333333333333', 'nobody@x')
  on conflict do nothing;
update public.profiles set role = 'full'  where id = 'a1111111-1111-1111-1111-111111111111';
update public.profiles set role = 'basic' where id = 'b2222222-2222-2222-2222-222222222222';
update public.profiles set role = 'basic' where id = 'd4444444-4444-4444-4444-444444444444';
-- c333…3 stays 'unauthorized'.

\set QUIET off

-- --- sending a request -----------------------------------------------------
\echo '# sending'
begin;
  set local role authenticated;
  select set_config('test.uid', 'a1111111-1111-1111-1111-111111111111', true);
  insert into public.remote_search_requests (from_user_id, to_user_id, keywords)
    values ('a1111111-1111-1111-1111-111111111111',
            'b2222222-2222-2222-2222-222222222222',
            'budget travel'||chr(10)||'ai tools');
commit;
select pg_temp.check('the sender''s request lands with status pending',
  (select status = 'pending' and keywords = 'budget travel'||chr(10)||'ai tools'
     from public.remote_search_requests
    where from_user_id = 'a1111111-1111-1111-1111-111111111111'
      and to_user_id = 'b2222222-2222-2222-2222-222222222222'));

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'd4444444-4444-4444-4444-444444444444', true);
  begin
    insert into public.remote_search_requests (from_user_id, to_user_id, keywords)
      values ('a1111111-1111-1111-1111-111111111111',
              'b2222222-2222-2222-2222-222222222222', 'bystander forging a request');
    perform pg_temp.check(
      'an authorized user who is neither party cannot file a request between two others', false);
  exception when insufficient_privilege then
    perform pg_temp.check(
      'an authorized user who is neither party cannot file a request between two others', true);
  end;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'c3333333-3333-3333-3333-333333333333', true);
  begin
    insert into public.remote_search_requests (from_user_id, to_user_id, keywords)
      values ('c3333333-3333-3333-3333-333333333333',
              'a1111111-1111-1111-1111-111111111111', 'unauthorized attempt');
    perform pg_temp.check('an unauthorized user cannot send a request', false);
  exception when insufficient_privilege then
    perform pg_temp.check('an unauthorized user cannot send a request', true);
  end;
end $$;

-- --- who can read it ---------------------------------------------------
\echo '# visibility is between the two people only'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'a1111111-1111-1111-1111-111111111111', true);
  perform pg_temp.check('the sender sees the request', (select count(*) = 1 from public.remote_search_requests));
end $$;
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'b2222222-2222-2222-2222-222222222222', true);
  perform pg_temp.check('the recipient sees the request', (select count(*) = 1 from public.remote_search_requests));
end $$;
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'd4444444-4444-4444-4444-444444444444', true);
  perform pg_temp.check('an authorized bystander sees none of it',
    (select count(*) = 0 from public.remote_search_requests));
end $$;
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'c3333333-3333-3333-3333-333333333333', true);
  perform pg_temp.check('an unauthorized user sees none of it',
    (select count(*) = 0 from public.remote_search_requests));
end $$;

-- --- acknowledging: either party may, nobody else can --------------------
\echo '# acknowledging'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', 'd4444444-4444-4444-4444-444444444444', true);
  update public.remote_search_requests set status = 'dismissed'
    where to_user_id = 'b2222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform pg_temp.check('a bystander''s update matches zero rows', n = 0);
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', 'b2222222-2222-2222-2222-222222222222', true);
  update public.remote_search_requests set status = 'applied', applied_at = now()
    where to_user_id = 'b2222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform pg_temp.check('the recipient can mark it applied', n = 1);
end $$;
select pg_temp.check('the touch trigger stamped updated_at at the same time',
  (select updated_at > now() - interval '1 minute' and status = 'applied'
     from public.remote_search_requests
    where to_user_id = 'b2222222-2222-2222-2222-222222222222'));

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', 'b2222222-2222-2222-2222-222222222222', true);
  begin
    update public.remote_search_requests set to_user_id = 'd4444444-4444-4444-4444-444444444444'
      where to_user_id = 'b2222222-2222-2222-2222-222222222222';
    perform pg_temp.check(
      'reassigning a request away from yourself is refused (you''d no longer be a party to it)', false);
  exception when insufficient_privilege then
    perform pg_temp.check(
      'reassigning a request away from yourself is refused (you''d no longer be a party to it)', true);
  end;
end $$;

\echo ''
\echo 'ALL REMOTE SEARCH REQUEST TESTS PASSED'
