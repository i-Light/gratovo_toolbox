#!/usr/bin/env bash
# Builds a throwaway Postgres in Docker, applies backend/schema.sql, and runs
# the SQL tests against it — twice over: once on a fresh database, once on a
# database built from the PREVIOUS schema and carried across by migrate_v2.sql.
#
#   cd backend/tests && ./run.sh
#
# Needs Docker running and nothing else — no local Postgres, no Supabase
# project, no credentials. The container is removed on exit, so this never
# touches anything real.
set -euo pipefail

CONTAINER=gratovo-sqltest
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(dirname "$HERE")"
REPO="$(dirname "$BACKEND")"
# The last commit of the previous shape of the database, for the migration
# pass. Pinned rather than "HEAD~1" so the test keeps meaning the same thing.
OLD_SCHEMA_REF=14240e3

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gratovo \
  postgres:16 >/dev/null
psql() { docker exec -i "$CONTAINER" psql -U postgres -d gratovo -v ON_ERROR_STOP=1 "$@"; }

# Waiting on a real query, not on pg_isready: the image runs a temporary server
# during its own initialisation and pg_isready answers "ready" to that one.
for _ in $(seq 1 60); do
  if echo 'select 1' | psql -q >/dev/null 2>&1; then break; fi
  sleep 1
done

run_tests() {
  echo
  for t in "$HERE"/test_*.sql; do
    echo "=== $(basename "$t")"
    psql < "$t"
  done
}

reset_db() {
  echo 'drop schema public cascade; create schema public; drop schema if exists auth cascade; drop schema if exists extensions cascade;' | psql -q
  psql -q < "$HERE/00_supabase_stubs.sql" >/dev/null
}

# --- pass 1: a fresh project ---------------------------------------------------
echo "applying stubs..."
psql -q < "$HERE/00_supabase_stubs.sql" >/dev/null

echo "applying schema.sql..."
psql -q < "$BACKEND/schema.sql" >/dev/null

# Applied twice on purpose: SETUP.md promises the file is safe to re-run.
echo "applying schema.sql again (re-runnability)..."
psql -q < "$BACKEND/schema.sql" >/dev/null

run_tests

# --- pass 2: a project on the previous shape, migrated ----------------------------
echo
echo "=== migration pass: old schema ($OLD_SCHEMA_REF) -> migrate_v2.sql -> schema.sql"
reset_db
git -C "$REPO" show "$OLD_SCHEMA_REF:backend/schema.sql" | psql -q >/dev/null

# Seed the old shape with the things the migration has to carry across, and
# the things it has to leave behind.
psql -q <<'SQL' >/dev/null
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'mig@x') on conflict do nothing;
update public.profiles set role = 'full', display_name = 'Mig' where id = '11111111-1111-1111-1111-111111111111';
insert into public.channels (channel_id, handle, name, subscribers, description)
  values ('UC_touched', '@touched', 'Touched', 1000, repeat('x', 5000)),
         ('UC_untouched', '@untouched', 'Untouched', 2000, repeat('y', 5000));
update public.channels
   set notes = 'keep me', channel_tags = array['qualified'], pipeline_stage = 'contacted',
       contacts = '[{"method":"email","value":"a@b.com"}]'::jsonb,
       last_edited_by = '11111111-1111-1111-1111-111111111111', last_edited_by_name = 'Mig'
 where channel_id = 'UC_touched';
insert into public.videos (video_id, channel_id, title) values ('v1', 'UC_touched', 'a'), ('v2', 'UC_untouched', 'b');
insert into public.keywords (keyword) values ('kw');
insert into public.channel_keywords (channel_id, keyword) values ('UC_touched', 'kw');
insert into public.brands (id, name) values ('b0000000-0000-0000-0000-000000000009', 'Acme');
insert into public.deals (brand_id, channel_id, brand_price) values ('b0000000-0000-0000-0000-000000000009', 'UC_touched', 42);
insert into public.outreach_threads (channel_id) values ('UC_touched');
insert into public.email_templates (name) values ('t');
insert into public.sync_tombstones (table_name, row_id) values ('channels', 'UC_old');
SQL

echo "applying migrate_v2.sql..."
psql -q < "$BACKEND/migrate_v2.sql"
echo "applying migrate_v2.sql again (re-runnability)..."
psql -q < "$BACKEND/migrate_v2.sql" >/dev/null
echo "applying schema.sql on the migrated database..."
psql -q < "$BACKEND/schema.sql" >/dev/null

psql <<'SQL'
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_label; end if;
  raise notice '  ok  %', p_label;
end $$;
\set QUIET off
\echo '# migration'
select pg_temp.check('the touched channel''s state was carried across intact',
  (select notes = 'keep me' and channel_tags = array['qualified'] and pipeline_stage = 'contacted'
      and contacts = '[{"method":"email","value":"a@b.com"}]'::jsonb and handle = '@touched'
      and last_edited_by_name = 'Mig'
     from public.channel_state where channel_id = 'UC_touched'));
select pg_temp.check('the untouched channel got no state row',
  not exists (select 1 from public.channel_state where channel_id = 'UC_untouched'));
select pg_temp.check('the scraped tables are gone',
  to_regclass('public.channels') is null and to_regclass('public.videos') is null
  and to_regclass('public.keywords') is null and to_regclass('public.channel_keywords') is null);
select pg_temp.check('deals, threads and templates survived, minus their channel foreign keys',
  (select count(*) = 1 from public.deals where brand_price = 42)
  and (select count(*) = 1 from public.outreach_threads)
  and (select count(*) = 1 from public.email_templates)
  and not exists (select 1 from pg_constraint where conname like '%channel_id_fkey%'));
select pg_temp.check('every copied table now has updated_at',
  (select count(*) = 4 from information_schema.columns
     where table_schema = 'public' and column_name = 'updated_at'
       and table_name in ('outreach_messages','email_templates','writing_rules','follow_up_reminders')));
select pg_temp.check('old tombstones were cleared and the horizon moved',
  (select count(*) = 0 from public.sync_tombstones)
  and (select tombstones_purged_before > now() - interval '1 hour' from public.sync_control));
\echo 'MIGRATION PASSED'
SQL

run_tests
