-- ---------------------------------------------------------------------------
-- Tests for creator_stage through the compare-and-set
-- (supabase/migrations/20261022090100_creator_stage_edit.sql)
-- ---------------------------------------------------------------------------
-- The migration changes two existing functions, so this also checks that the
-- old fields still behave (test_12_conflicts.sql runs unchanged beside it).
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

-- Calls apply_channel_edit as a signed-in member (the real role, so the
-- caller's own policies apply) and returns the outcome, or the SQLSTATE.
create or replace function pg_temp.edit(p_uid text, p_channel text, p_field text,
                                        p_base jsonb, p_new jsonb, p_label text default null)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', p_uid, false);
  set role authenticated;
  begin
    v := public.apply_channel_edit(p_channel, p_field, p_base, p_new, false, p_label);
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return v;
end $$;

create or replace function pg_temp.resolve(p_uid text, p_id uuid, p_resolution text, p_value jsonb)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', p_uid, false);
  set role authenticated;
  begin
    v := public.resolve_edit_conflict(p_id, p_resolution, p_value);
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return v;
end $$;

-- --- fixture ---------------------------------------------------------------
-- apply_channel_edit is security invoker and calls auth.uid(); a real project
-- lets `authenticated` use the auth schema, the stub does not.
grant usage on schema auth to authenticated;

insert into auth.users (id, email) values
  ('b4000000-0000-0000-0000-000000000001', 'stage-a@x'),
  ('b4000000-0000-0000-0000-000000000002', 'stage-b@x')
  on conflict do nothing;
update public.profiles set role = 'full', display_name = 'Stage A'
  where id = 'b4000000-0000-0000-0000-000000000001';
update public.profiles set role = 'full', display_name = 'Stage B'
  where id = 'b4000000-0000-0000-0000-000000000002';
delete from public.edit_conflicts where channel_id like 'stage-%';
delete from public.channel_state where channel_id like 'stage-%';

\set A '''b4000000-0000-0000-0000-000000000001'''
\set B '''b4000000-0000-0000-0000-000000000002'''

\set QUIET off
\echo '# creator_stage_edit'

-- --- first edit, auto, noop ------------------------------------------------
select pg_temp.check('a first edit with base null applies',
  pg_temp.edit(:A, 'stage-1', 'creator_stage', 'null'::jsonb, '"emailed"'::jsonb, '@stage_ai') = 'applied');
select pg_temp.check('and created the row with the label, the stage and the editor',
  (select handle = '@stage_ai' and creator_stage = 'emailed'
      and last_edited_by = 'b4000000-0000-0000-0000-000000000001'
      and last_edited_by_name = 'Stage A'
     from public.channel_state where channel_id = 'stage-1'));
select pg_temp.check('writing the value the row already holds is auto',
  pg_temp.edit(:B, 'stage-1', 'creator_stage', 'null'::jsonb, '"emailed"'::jsonb) = 'auto');
select pg_temp.check('a base equal to the new value is a noop',
  pg_temp.edit(:B, 'stage-1', 'creator_stage', '"emailed"'::jsonb, '"emailed"'::jsonb) = 'noop');
select pg_temp.check('a current base moves the stage on',
  pg_temp.edit(:B, 'stage-1', 'creator_stage', '"emailed"'::jsonb, '"replied"'::jsonb) = 'applied');
select pg_temp.check('and the column holds it',
  (select creator_stage = 'replied' from public.channel_state where channel_id = 'stage-1'));

-- --- stale base: a conflict, column untouched ------------------------------
select pg_temp.check('a stale base files a conflict',
  pg_temp.edit(:A, 'stage-1', 'creator_stage', '"emailed"'::jsonb, '"signed"'::jsonb) = 'conflict');
select pg_temp.check('the open conflict holds base, mine and theirs',
  (select count(*) = 1 and bool_and(base_value = '"emailed"'::jsonb and mine_value = '"signed"'::jsonb
                                    and theirs_value = '"replied"'::jsonb and field = 'creator_stage')
     from public.edit_conflicts where channel_id = 'stage-1' and resolved_at is null));
select pg_temp.check('and the column was not touched',
  (select creator_stage = 'replied' from public.channel_state where channel_id = 'stage-1'));
select pg_temp.check('a second stale edit is a conflict again',
  pg_temp.edit(:A, 'stage-1', 'creator_stage', '"emailed"'::jsonb, '"kit"'::jsonb) = 'conflict');
select pg_temp.check('and it updated the open row instead of adding one',
  (select count(*) = 1 and bool_and(mine_value = '"kit"'::jsonb)
         from public.edit_conflicts where channel_id = 'stage-1' and resolved_at is null));

-- --- resolving -------------------------------------------------------------
select pg_temp.check('resolving with mine applies mine',
  pg_temp.resolve(:A, (select id from public.edit_conflicts
                        where channel_id = 'stage-1' and resolved_at is null),
                  'mine', '"kit"'::jsonb) = 'applied');
select pg_temp.check('the stage is mine and the conflict is closed',
  (select creator_stage = 'kit' from public.channel_state where channel_id = 'stage-1')
  and not exists (select 1 from public.edit_conflicts where channel_id = 'stage-1' and resolved_at is null));

-- --- values the column refuses, and empty text ----------------------------
select pg_temp.check('an unknown stage is refused by the check (23514)',
  pg_temp.edit(:A, 'stage-1', 'creator_stage', '"kit"'::jsonb, '"contacted"'::jsonb) = '23514');
select pg_temp.check('an empty string reads as null',
  public.canonical_edit_value('creator_stage', '""'::jsonb) is null
  and pg_temp.edit(:A, 'stage-1', 'creator_stage', '"kit"'::jsonb, '""'::jsonb) = 'applied');
select pg_temp.check('and the column is null',
  (select creator_stage is null from public.channel_state where channel_id = 'stage-1'));
select pg_temp.check('an empty string against a null base is a noop',
  pg_temp.edit(:A, 'stage-2', 'creator_stage', 'null'::jsonb, '""'::jsonb) = 'noop');

-- --- nothing else changed --------------------------------------------------
select pg_temp.check('a field outside the whitelist is still refused (22023)',
  pg_temp.edit(:A, 'stage-1', 'handle', '"a"'::jsonb, '"b"'::jsonb) = '22023'
  and pg_temp.edit(:A, 'stage-1', 'creator_stagee', '"a"'::jsonb, '"b"'::jsonb) = '22023');
select pg_temp.check('the old text fields still apply and read empty as null',
  pg_temp.edit(:A, 'stage-1', 'notes', 'null'::jsonb, '"hello"'::jsonb) = 'applied'
  and pg_temp.edit(:A, 'stage-1', 'notes', '"hello"'::jsonb, '""'::jsonb) = 'applied');
select pg_temp.check('and notes ended null',
  (select notes is null from public.channel_state where channel_id = 'stage-1'));

-- --- who can run it --------------------------------------------------------
select pg_temp.check('anon cannot execute either function',
  not has_function_privilege('anon', 'public.apply_channel_edit(text,text,jsonb,jsonb,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'public.canonical_edit_value(text,jsonb)', 'execute'));
select pg_temp.check('authenticated can, and public cannot',
  has_function_privilege('authenticated', 'public.apply_channel_edit(text,text,jsonb,jsonb,boolean,text)', 'execute')
  and not exists (select 1 from information_schema.routine_privileges
                   where routine_schema = 'public' and grantee = 'PUBLIC'
                     and routine_name in ('apply_channel_edit', 'canonical_edit_value')));

delete from public.edit_conflicts where channel_id like 'stage-%';
delete from public.channel_state where channel_id like 'stage-%';

\echo 'CREATOR STAGE EDIT PASSED'
