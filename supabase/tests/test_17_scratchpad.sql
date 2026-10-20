-- ---------------------------------------------------------------------------
-- Tests for the team scratchpad (supabase/migrations/20261020120000_baseline.sql, sections 5, 15, 17)
-- ---------------------------------------------------------------------------
-- The scratchpad's whole security story is its RLS pair: shared read for any
-- authorized user, write limited to `user_id = auth.uid()`. That is exactly
-- the kind of rule that reads as obviously correct and is quietly wrong (a
-- missing WITH CHECK, a `for all` that forgot inserts), so it is worth
-- exercising under a real `authenticated` role rather than as the table owner,
-- who bypasses RLS entirely. Run it with supabase/tests/run.ts (pnpm test:sql).
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
-- Three people: one `full`, one `basic`, one left at the signup default of
-- `unauthorized`. The profile rows are created by the on_auth_user_created
-- trigger the moment the auth.users row lands (see test_11 for the same idiom).
delete from public.scratchpads;

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'full@x'),
  ('66666666-6666-6666-6666-666666666666', 'basic@x'),
  ('77777777-7777-7777-7777-777777777777', 'nobody@x')
  on conflict do nothing;
update public.profiles set role = 'full'  where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set role = 'basic' where id = '66666666-6666-6666-6666-666666666666';
-- 7777… stays 'unauthorized'.

\set QUIET off

-- --- creating your own box -----------------------------------------------
\echo '# your own box'
begin;
  set local role authenticated;
  select set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);
  insert into public.scratchpads (user_id, body)
    values ('55555555-5555-5555-5555-555555555555', 'note from the full user');
commit;
select pg_temp.check('an owner can create their own row',
  (select body = 'note from the full user'
     from public.scratchpads where user_id = '55555555-5555-5555-5555-555555555555'));

begin;
  set local role authenticated;
  select set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  insert into public.scratchpads (user_id, body)
    values ('66666666-6666-6666-6666-666666666666', 'note from the basic user');
commit;
select pg_temp.check('a basic user can create their own row too (no role gate on write)',
  (select body = 'note from the basic user'
     from public.scratchpads where user_id = '66666666-6666-6666-6666-666666666666'));

-- --- you cannot touch someone else's box --------------------------------
\echo '# someone else''s box is off limits'
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  update public.scratchpads set body = 'basic overwriting full'
    where user_id = '55555555-5555-5555-5555-555555555555';
  get diagnostics n = row_count;
  perform pg_temp.check('a non-owner UPDATE matches zero rows', n = 0);
end $$;
select pg_temp.check('the full user''s row is unchanged after that attempt',
  (select body = 'note from the full user'
     from public.scratchpads where user_id = '55555555-5555-5555-5555-555555555555'));

do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  begin
    insert into public.scratchpads (user_id, body)
      values ('55555555-5555-5555-5555-555555555555', 'basic forging a row for full');
    perform pg_temp.check('inserting a row under another user_id is refused', false);
  exception when insufficient_privilege then
    perform pg_temp.check('inserting a row under another user_id is refused', true);
  end;
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  delete from public.scratchpads where user_id = '55555555-5555-5555-5555-555555555555';
  get diagnostics n = row_count;
  perform pg_temp.check('a non-owner DELETE matches zero rows', n = 0);
end $$;

-- --- who can read the boxes --------------------------------------------
\echo '# shared read'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);
  perform pg_temp.check('the full user sees every box',
    (select count(*) = 2 from public.scratchpads));
end $$;
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  perform pg_temp.check('the basic user sees every box',
    (select count(*) = 2 from public.scratchpads));
end $$;
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '77777777-7777-7777-7777-777777777777', true);
  perform pg_temp.check('an unauthorized user sees no boxes',
    (select count(*) = 0 from public.scratchpads));
end $$;

-- --- editing your box, and the updated_at trigger --------------------
\echo '# saves and the last-edited stamp'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);
  -- Try to backdate the stamp in the same statement that changes the body;
  -- trg_touch_scratchpads must win.
  update public.scratchpads
     set body = 'note from the full user, revised',
         updated_at = now() - interval '10 days'
   where user_id = '55555555-5555-5555-5555-555555555555';
  perform pg_temp.check('an owner can save their own box',
    (select body = 'note from the full user, revised'
       from public.scratchpads where user_id = '55555555-5555-5555-5555-555555555555'));
  perform pg_temp.check('the touch trigger stamps updated_at at save time',
    (select updated_at > now() - interval '1 minute'
       from public.scratchpads where user_id = '55555555-5555-5555-5555-555555555555'));
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  delete from public.scratchpads where user_id = '66666666-6666-6666-6666-666666666666';
  get diagnostics n = row_count;
  perform pg_temp.check('an owner can delete their own row', n = 1);
end $$;

\echo ''
\echo 'ALL SCRATCHPAD TESTS PASSED'
