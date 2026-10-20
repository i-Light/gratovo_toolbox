-- ---------------------------------------------------------------------------
-- Tests for the edit compare-and-set (supabase/migrations/20261020120000_baseline.sql, section 9)
-- ---------------------------------------------------------------------------
-- The claim being tested, stated once: sequential collaboration must NEVER
-- conflict, and simultaneous divergence must ALWAYS conflict. Everything below
-- is a case of one or the other.
--
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

-- Acts as one person for the duration of a statement.
create or replace function pg_temp.as_user(p_uid uuid) returns void
language sql as $$ select set_config('test.uid', p_uid::text, false)::void; $$;

-- --- fixture ---------------------------------------------------------------
delete from public.edit_conflicts;
delete from public.channel_state;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'sara@x'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'omar@x'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'lina@x')
  on conflict do nothing;
update public.profiles set role = 'full', display_name = 'Sara'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set role = 'full', display_name = 'Omar'
  where id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.profiles set role = 'full', display_name = 'Lina'
  where id = 'aaaaaaaa-0000-0000-0000-000000000003';

\set SARA '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OMAR '''aaaaaaaa-0000-0000-0000-000000000002'''
\set LINA '''aaaaaaaa-0000-0000-0000-000000000003'''

\set QUIET off

-- --- the first edit creates the row ----------------------------------------
\echo '# first edit'

select pg_temp.check('no state row exists before anyone touches the channel',
  (select count(*) = 0 from public.channel_state where channel_id = 'UC_x'));

select pg_temp.as_user(:SARA);
select pg_temp.check('the first edit of a never-touched channel applies',
  public.apply_channel_edit('UC_x','notes', 'null'::jsonb, '"Sara was here"'::jsonb,
                            false, '@x') = 'applied');

select pg_temp.check('and created the state row, named by the label',
  (select handle = '@x' and notes = 'Sara was here'
      and vetting_status = 'newlyFound' and pipeline_stage = 'new'
     from public.channel_state where channel_id = 'UC_x'));

-- --- the case that must never conflict -------------------------------------
\echo '# sequential collaboration'

-- Omar opens the page AFTER Sara saved, so he sees her text and it becomes his
-- base. This must go through silently no matter how many times it repeats.
select pg_temp.as_user(:OMAR);
select pg_temp.check('editing on top of a colleague''s saved text applies',
  public.apply_channel_edit('UC_x','notes',
    '"Sara was here"'::jsonb, '"Sara was here. Omar added this."'::jsonb)
    = 'applied');

select pg_temp.as_user(:SARA);
select pg_temp.check('and again, indefinitely, in either direction',
  public.apply_channel_edit('UC_x','notes',
    '"Sara was here. Omar added this."'::jsonb,
    '"Sara was here. Omar added this. Sara replied."'::jsonb) = 'applied');

select pg_temp.check('no conflict was filed by any of that',
  (select count(*) = 0 from public.edit_conflicts));

-- --- the case that must always conflict ------------------------------------
\echo '# divergence'

select pg_temp.as_user(:SARA);
select pg_temp.check('Sara''s edit lands',
  public.apply_channel_edit('UC_x','notes',
    '"Sara was here. Omar added this. Sara replied."'::jsonb,
    '"Sara rewrote the whole thing."'::jsonb) = 'applied');

select pg_temp.as_user(:OMAR);
select pg_temp.check('Omar''s stale-base edit is a conflict',
  public.apply_channel_edit('UC_x','notes',
    '"Sara was here. Omar added this. Sara replied."'::jsonb,
    '"Omar rewrote it differently."'::jsonb) = 'conflict');

select pg_temp.check('the column was NOT overwritten by the refused edit',
  (select notes = 'Sara rewrote the whole thing.' from public.channel_state
    where channel_id = 'UC_x'));

select pg_temp.check('the conflict records all three values and both names',
  (select base_value #>> '{}' = 'Sara was here. Omar added this. Sara replied.'
      and mine_value #>> '{}' = 'Omar rewrote it differently.'
      and theirs_value #>> '{}' = 'Sara rewrote the whole thing.'
      and mine_actor_name = 'Omar'
      and theirs_actor_name = 'Sara'
      and field = 'notes'
      and channel_label = '@x'
     from public.edit_conflicts where resolved_at is null));

select pg_temp.check('re-saving does not stack a second conflict',
  public.apply_channel_edit('UC_x','notes',
    '"Sara was here. Omar added this. Sara replied."'::jsonb,
    '"Omar tried again."'::jsonb) = 'conflict'
  and (select count(*) = 1 from public.edit_conflicts where resolved_at is null));

select pg_temp.check('but the base stays at the point they actually diverged',
  (select base_value #>> '{}' = 'Sara was here. Omar added this. Sara replied.'
     from public.edit_conflicts where resolved_at is null));

-- --- the cases that must NOT conflict --------------------------------------
\echo '# things that look like conflicts and are not'

select pg_temp.check('writing the value already there auto-resolves',
  public.apply_channel_edit('UC_x','notes',
    '"anything at all"'::jsonb, '"Sara rewrote the whole thing."'::jsonb)
    = 'auto');

select pg_temp.check('a save that changes nothing is a no-op',
  public.apply_channel_edit('UC_x','notes',
    '"same"'::jsonb, '"same"'::jsonb) = 'noop');

select pg_temp.check('empty string and null are the same fact',
  public.apply_channel_edit('UC_x','vetting_status', 'null'::jsonb, '""'::jsonb)
    = 'noop');

-- Per-field, not per-row: two people working on the same channel but
-- different things.
select pg_temp.as_user(:LINA);
select pg_temp.check('a stage edit does not conflict with a pending notes edit',
  public.apply_channel_edit('UC_x','pipeline_stage', '"new"'::jsonb, '"contacted"'::jsonb)
    = 'applied');
select pg_temp.check('and still only one conflict exists',
  (select count(*) = 1 from public.edit_conflicts where resolved_at is null));

-- --- canonical comparison --------------------------------------------------
\echo '# canonical comparison'

update public.channel_state set channel_tags = array['irrelevant','haramStuff']
  where channel_id = 'UC_x';

select pg_temp.check('a reordered tag list is not a change',
  public.apply_channel_edit('UC_x','channel_tags',
    '["haramStuff","irrelevant"]'::jsonb, '["irrelevant","haramStuff"]'::jsonb)
    = 'noop');

select pg_temp.check('a genuinely different tag list applies',
  public.apply_channel_edit('UC_x','channel_tags',
    '["irrelevant","haramStuff"]'::jsonb, '["irrelevant"]'::jsonb) = 'applied');

select pg_temp.check('and it really did write the array',
  (select channel_tags = array['irrelevant'] from public.channel_state
    where channel_id = 'UC_x'));

select pg_temp.check('a rejecting tag started the 7-day archive countdown',
  (select archive_due_at between now() + interval '6 days' and now() + interval '8 days'
     from public.channel_state where channel_id = 'UC_x'));

select pg_temp.check('replacing the rejecting tag applies',
  public.apply_channel_edit('UC_x','channel_tags',
    '["irrelevant"]'::jsonb, '["qualified"]'::jsonb) = 'applied');
select pg_temp.check('and removing it cleared the countdown',
  (select archive_due_at is null from public.channel_state where channel_id = 'UC_x'));

update public.channel_state
   set contacts = '[{"method":"email","value":"a@b.com"},{"method":"phone","value":"1"}]'::jsonb
 where channel_id = 'UC_x';
select pg_temp.check('reordering contacts IS a change, unlike tags',
  public.apply_channel_edit('UC_x','contacts',
    '[{"method":"email","value":"a@b.com"},{"method":"phone","value":"1"}]'::jsonb,
    '[{"method":"phone","value":"1"},{"method":"email","value":"a@b.com"}]'::jsonb)
    = 'applied');

-- --- the whitelist ---------------------------------------------------------
\echo '# the field whitelist'

do $$
begin
  begin
    perform public.apply_channel_edit('UC_x','handle','null'::jsonb,'"@y"'::jsonb);
    raise exception 'FAILED: a non-whitelisted column was writable';
  exception when sqlstate '22023' then
    raise notice '  ok  a non-whitelisted column cannot be written through this';
  end;
  begin
    perform public.apply_channel_edit('UC_x','notes; drop table channel_state --',
                                      'null'::jsonb,'"x"'::jsonb);
    raise exception 'FAILED: an injected field name was accepted';
  exception when sqlstate '22023' then
    raise notice '  ok  an injected field name is refused by the whitelist';
  end;
end $$;

-- --- resolving -------------------------------------------------------------
\echo '# resolving'

select pg_temp.as_user(:LINA);

select pg_temp.check('a third person can resolve it',
  public.resolve_edit_conflict(
    (select id from public.edit_conflicts where resolved_at is null),
    'merged',
    '"Sara rewrote the whole thing. Omar tried again."'::jsonb) = 'applied');

select pg_temp.check('the chosen value is what the column now holds',
  (select notes = 'Sara rewrote the whole thing. Omar tried again.'
     from public.channel_state where channel_id = 'UC_x'));

select pg_temp.check('and it is recorded as resolved, by whom, and how',
  (select resolution = 'merged' and resolved_by_name = 'Lina'
      and resolved_at is not null
     from public.edit_conflicts limit 1));

select pg_temp.check('no open conflicts remain',
  (select count(*) = 0 from public.edit_conflicts where resolved_at is null));

select pg_temp.check('resolving a settled conflict says so instead of erroring',
  public.resolve_edit_conflict(
    (select id from public.edit_conflicts limit 1), 'mine', '"x"'::jsonb)
    = 'already_resolved');

select pg_temp.as_user(:OMAR);
select pg_temp.check('a new disagreement on the same field can be filed again',
  public.apply_channel_edit('UC_x','notes',
    '"a stale base"'::jsonb, '"something new"'::jsonb) = 'conflict');

\echo ''
\echo 'ALL CONFLICT TESTS PASSED'
