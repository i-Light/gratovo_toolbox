-- ---------------------------------------------------------------------------
-- Tests for team_youtube_key (supabase/migrations/20261021090100_team_keys.sql)
-- ---------------------------------------------------------------------------
-- Only an authorized member reads the YouTube key; nobody reads the vault
-- directly; anonymous callers cannot call the functions.
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

-- Calls the key function as a signed-in user: returns the key, or the
-- SQLSTATE it fails with prefixed by 'error:'.
create or replace function pg_temp.key_as(p_uid text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  begin
    v := public.team_youtube_key();
    reset role;
    return coalesce(v, '<null>');
  exception when others then
    reset role;
    return 'error:' || sqlstate;
  end;
end $$;

delete from vault.secrets where name = 'team_youtube_key';
insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'keyholder@x'),
  ('a2000000-0000-0000-0000-000000000002', 'waiting-key@x')
  on conflict do nothing;
update public.profiles set role = 'basic' where id = 'a2000000-0000-0000-0000-000000000001';

\set QUIET off
\echo '# team keys'

begin;
  select pg_temp.check('an unauthorized member is refused (42501)',
    pg_temp.key_as('a2000000-0000-0000-0000-000000000002') = 'error:42501');
  select pg_temp.check('a member with no secret stored gets null',
    pg_temp.key_as('a2000000-0000-0000-0000-000000000001') = '<null>');
  select vault.create_secret('yt-test-000', 'team_youtube_key', 'test key');
  select pg_temp.check('an authorized member gets the stored value',
    pg_temp.key_as('a2000000-0000-0000-0000-000000000001') = 'yt-test-000');
  select pg_temp.check('an unauthorized member is still refused once the secret exists',
    pg_temp.key_as('a2000000-0000-0000-0000-000000000002') = 'error:42501');
rollback;

select pg_temp.check('authenticated has no privilege on vault.decrypted_secrets or vault.secrets',
  not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select')
  and not has_table_privilege('authenticated', 'vault.secrets', 'select'));
select pg_temp.check('anon cannot execute either function',
  not has_function_privilege('anon', 'public.team_youtube_key()', 'execute')
  and not has_function_privilege('anon', 'private.team_youtube_key()', 'execute'));
select pg_temp.check('authenticated can execute the public function',
  has_function_privilege('authenticated', 'public.team_youtube_key()', 'execute'));

delete from vault.secrets where name = 'team_youtube_key';
\echo 'TEAM KEYS PASSED'
