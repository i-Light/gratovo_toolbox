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

-- Tables that are read-only for signed-in users on purpose: writes go through a
-- function (or the service key). Everything else must hold all four privileges.
create temp table read_only_tables (name text primary key);
insert into read_only_tables values ('member_access');

\set QUIET off
\echo '# grants'

select pg_temp.check('there is at least one public table',
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')));

select pg_temp.check('every public table has row-level security',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not c.relrowsecurity));

select pg_temp.check('signed-in users hold select, insert, update and delete on every public table, except the declared read-only ones',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and c.relname not in (select name from read_only_tables)
                 and not (has_table_privilege('authenticated', c.oid, 'select')
                      and has_table_privilege('authenticated', c.oid, 'insert')
                      and has_table_privilege('authenticated', c.oid, 'update')
                      and has_table_privilege('authenticated', c.oid, 'delete'))));

select pg_temp.check('the declared read-only tables exist and give signed-in users select only',
  not exists (select 1 from read_only_tables r
               where to_regclass('public.' || r.name) is null
                  or not has_table_privilege('authenticated', to_regclass('public.' || r.name), 'select')
                  or has_table_privilege('authenticated', to_regclass('public.' || r.name), 'insert')
                  or has_table_privilege('authenticated', to_regclass('public.' || r.name), 'update')
                  or has_table_privilege('authenticated', to_regclass('public.' || r.name), 'delete')));

select pg_temp.check('the service key holds select, insert, update and delete on every public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and not (has_table_privilege('service_role', c.oid, 'select')
                      and has_table_privilege('service_role', c.oid, 'insert')
                      and has_table_privilege('service_role', c.oid, 'update')
                      and has_table_privilege('service_role', c.oid, 'delete'))));

select pg_temp.check('anonymous callers hold no privilege on any public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p')
                 and (has_table_privilege('anon', c.oid, 'select')
                   or has_table_privilege('anon', c.oid, 'insert')
                   or has_table_privilege('anon', c.oid, 'update')
                   or has_table_privilege('anon', c.oid, 'delete'))));

\echo 'GRANTS PASSED'
