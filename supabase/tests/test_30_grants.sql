-- ---------------------------------------------------------------------------
-- Tests for the table grants and row-level security on every public table
-- ---------------------------------------------------------------------------
-- The guard for 2026-10-30, when Supabase stops exposing new public tables to
-- the Data API by default: every table must have row-level security, signed-in
-- users and the service key must hold all four privileges, and anonymous
-- callers must hold none. A later migration that adds a table without its
-- grant lines fails here.
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

\set QUIET off
\echo '# grants'

select pg_temp.check('there is at least one public table',
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')));

select pg_temp.check('every public table has row-level security',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not c.relrowsecurity));

select pg_temp.check('signed-in users hold select, insert, update and delete on every public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')));

select pg_temp.check('the service key holds select, insert, update and delete on every public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not has_table_privilege('service_role', c.oid, 'select,insert,update,delete')));

select pg_temp.check('anonymous callers hold no privilege on any public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and (has_table_privilege('anon', c.oid, 'select')
                   or has_table_privilege('anon', c.oid, 'insert')
                   or has_table_privilege('anon', c.oid, 'update')
                   or has_table_privilege('anon', c.oid, 'delete'))));

\echo 'GRANTS PASSED'
