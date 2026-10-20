-- ---------------------------------------------------------------------------
-- The minimum Supabase surface the migrations depend on.
-- ---------------------------------------------------------------------------
-- Test scaffolding, never part of the migration set. It exists so the real
-- `supabase/migrations` files can be run UNMODIFIED against a stock Postgres — a test
-- that needed the migrations edited to run would be testing something other
-- than what ships.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- The caller's id, faked through a session setting.
--
-- Empty means "no JWT at all", which is how the scheduled (pg_cron) path is
-- simulated — that path is a real branch in archive_due_channels() and it is
-- the one that actually deletes, so it has to be reachable from a test.
--
-- Must be set with `set local` inside a transaction; a bare `set local` outside
-- one is a warning that silently does nothing.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
