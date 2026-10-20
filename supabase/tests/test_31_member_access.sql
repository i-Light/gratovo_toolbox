-- ---------------------------------------------------------------------------
-- Tests for member_access and set_member_access
-- (supabase/migrations/20261021090000_member_access.sql)
-- ---------------------------------------------------------------------------
-- Roles and "sees money" live in their own table with no write policy; the
-- only write path is set_member_access, owner only. The old app's `profiles`
-- table must be untouched.
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
-- with, or 'ok'. Rows are visible to the caller through `as_user`.
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

-- --- fixture ---------------------------------------------------------------
-- An owner, an ordinary member, a second owner candidate, and an unauthorized one.
delete from public.member_access;
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'owner@x'),
  ('a1000000-0000-0000-0000-000000000002', 'member@x'),
  ('a1000000-0000-0000-0000-000000000003', 'other@x'),
  ('a1000000-0000-0000-0000-000000000004', 'waiting@x')
  on conflict do nothing;
update public.profiles set role = 'full'  where id = 'a1000000-0000-0000-0000-000000000001';
update public.profiles set role = 'basic' where id = 'a1000000-0000-0000-0000-000000000002';
update public.profiles set role = 'basic' where id = 'a1000000-0000-0000-0000-000000000003';
-- ...0004 stays 'unauthorized'.
-- The bootstrap row, written as the database owner (RLS does not bind it).
insert into public.member_access (profile_id, roles, sees_money)
  values ('a1000000-0000-0000-0000-000000000001', '{owner}', true),
         ('a1000000-0000-0000-0000-000000000004', '{scout}', false);

\set QUIET off
\echo '# member_access'

-- --- reading ---------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('test.uid', 'a1000000-0000-0000-0000-000000000002', true);
  create temp table seen_member as select profile_id from public.member_access;
  grant select on seen_member to public;
commit;
select pg_temp.check('an authorized member reads every row',
  (select count(*) from seen_member) = 2);

begin;
  set local role authenticated;
  select set_config('test.uid', 'a1000000-0000-0000-0000-000000000004', true);
  create temp table seen_waiting as select profile_id from public.member_access;
commit;
select pg_temp.check('an unauthorized member reads only their own row',
  (select count(*) from seen_waiting) = 1
  and (select profile_id from seen_waiting) = 'a1000000-0000-0000-0000-000000000004');

-- --- direct writes ---------------------------------------------------------
begin;
  select pg_temp.check('a direct insert as authenticated is refused',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ insert into public.member_access (profile_id, roles) values ('a1000000-0000-0000-0000-000000000003', '{owner}') $q$)
    in ('42501'));
  select pg_temp.check('a direct update as authenticated is refused',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ update public.member_access set sees_money = false $q$) = '42501');
  select pg_temp.check('a direct delete as authenticated is refused',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ delete from public.member_access $q$) = '42501');
rollback;
select pg_temp.check('the table is unchanged after the refused writes',
  (select count(*) from public.member_access) = 2
  and (select sees_money from public.member_access where profile_id = 'a1000000-0000-0000-0000-000000000001'));

-- --- set_member_access -----------------------------------------------------
begin;
  select pg_temp.check('a non-owner cannot call set_member_access (42501)',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000002',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000002', '{owner}', true) $q$) = '42501');
  select pg_temp.check('an unauthorized member cannot call it either (42501)',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000004',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000004', '{owner}', true) $q$) = '42501');
  select pg_temp.check('an owner can call it',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000002', '{outreach,scout,scout}', true) $q$) = 'ok');
  select pg_temp.check('the row is written, roles de-duplicated, updated_by stamped',
    (select roles = '{outreach,scout}' and sees_money
            and updated_by = 'a1000000-0000-0000-0000-000000000001'
       from public.member_access where profile_id = 'a1000000-0000-0000-0000-000000000002'));
  select pg_temp.check('an unknown role is refused (22023)',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000002', '{boss}', false) $q$) = '22023');
  select pg_temp.check('a missing profile is refused (22023)',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-0000000000ff', '{scout}', false) $q$) = '22023');
  select pg_temp.check('removing the last owner is refused (P0001)',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000001', '{scout}', true) $q$) = 'P0001');
  select pg_temp.check('the last owner still holds the role after the refusal',
    exists (select 1 from public.member_access
             where profile_id = 'a1000000-0000-0000-0000-000000000001' and 'owner' = any (roles)));
  -- A second owner makes the first removable.
  select public.set_member_access('a1000000-0000-0000-0000-000000000003', '{owner}', false);
  select pg_temp.check('with a second owner, the first can step down',
    pg_temp.sqlstate_of('a1000000-0000-0000-0000-000000000001',
      $q$ select public.set_member_access('a1000000-0000-0000-0000-000000000001', '{scout}', true) $q$) = 'ok');
rollback;

-- --- the old app's table is untouched --------------------------------------
select pg_temp.check('profiles still has exactly its six columns',
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles')
  = array['color','created_at','display_name','id','role','updated_at']);

select pg_temp.check('profiles_self_update is unchanged',
  (select qual = '(id = auth.uid())'
      and with_check = '((id = auth.uid()) AND (role = app_current_role()))'
     from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_self_update'));

-- --- grants ----------------------------------------------------------------
select pg_temp.check('anon has no usage on schema private',
  not has_schema_privilege('anon', 'private', 'usage'));
select pg_temp.check('authenticated has usage on schema private',
  has_schema_privilege('authenticated', 'private', 'usage'));
select pg_temp.check('anon cannot execute set_member_access (public or private)',
  not has_function_privilege('anon', 'public.set_member_access(uuid, text[], boolean)', 'execute')
  and not has_function_privilege('anon', 'private.set_member_access(uuid, text[], boolean)', 'execute')
  and not has_function_privilege('anon', 'private.is_owner()', 'execute'));
select pg_temp.check('anon holds nothing on member_access; authenticated holds select only',
  not has_table_privilege('anon', 'public.member_access', 'select')
  and has_table_privilege('authenticated', 'public.member_access', 'select')
  and not has_table_privilege('authenticated', 'public.member_access', 'insert')
  and not has_table_privilege('authenticated', 'public.member_access', 'update')
  and not has_table_privilege('authenticated', 'public.member_access', 'delete'));
select pg_temp.check('member_access has row-level security and one policy',
  (select relrowsecurity from pg_class where oid = 'public.member_access'::regclass)
  and (select count(*) from pg_policies where tablename = 'member_access') = 1);

delete from public.member_access;
\echo 'MEMBER ACCESS PASSED'
