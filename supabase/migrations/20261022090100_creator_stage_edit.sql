-- ---------------------------------------------------------------------------
-- Creator stage through the compare-and-set (step 3d-2b, S17)
-- ---------------------------------------------------------------------------
-- THIS CHANGES TWO EXISTING FUNCTIONS and has its own production rollout step
-- (R1). `create or replace` of public.canonical_edit_value and
-- public.apply_channel_edit, same signatures and same bodies as the baseline
-- (section 9), with one difference: 'creator_stage' joins the editable
-- whitelist and the "empty text is null" fields, and apply_channel_edit's
-- text-update branch.
--
-- D22 (why change them rather than add an apply_creator_stage): the stage is
-- one column with no legacy fields to keep in step, and apply_channel_edit
-- already does the base check, files the conflict on uq_edit_conflicts_open
-- and sets last_edited_by; a second function would copy all of it.
-- resolve_edit_conflict needs no change (it calls apply_channel_edit). The
-- channel_state_creator_stage_check constraint (sync_columns) refuses an
-- unknown stage, so no list of stages is repeated here.
--
-- No data changes, no table changes. Safe to run again. The baseline file
-- stays byte-for-byte the old schema.sql; this runs after it and wins.
-- ---------------------------------------------------------------------------

create or replace function public.canonical_edit_value(p_field text, p_value jsonb)
returns jsonb
language sql immutable set search_path = public
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when p_field in ('notes','vetting_status','pipeline_stage','creator_gender','creator_stage')
         and p_value #>> '{}' = '' then null
    when p_field in ('channel_tags','relevance_criteria')
         and jsonb_typeof(p_value) = 'array' then (
           select coalesce(jsonb_agg(e order by e), '[]'::jsonb)
             from jsonb_array_elements(p_value) e
         )
    else p_value
  end;
$$;

-- Same argument list as the baseline, so this replaces it in place.

-- Returns one of:
--   'noop'     nothing was being changed
--   'auto'     the value already equals what was being written
--   'applied'  the base still matched, so the edit went in
--   'conflict' the base was stale; an edit_conflicts row now holds all three
--              values and the column was NOT touched
--
-- There is no 'missing' any more: a channel's state row is created on its
-- first edit, with the defaults every never-touched channel implicitly has,
-- so an edit against a channel this database has never heard of is simply
-- the first edit. `p_label` is the handle to name that new row with.
--
-- SECURITY INVOKER (the plpgsql default), deliberately: every statement runs
-- under the caller's own policies, so this grants nothing a direct UPDATE
-- would not — it only makes the write conditional.
create or replace function public.apply_channel_edit(
  p_channel_id text,
  p_field      text,
  p_base       jsonb,
  p_new        jsonb,
  p_force      boolean default false,
  p_label      text default null
) returns text
language plpgsql set search_path = public
as $$
declare
  v_current    jsonb;
  v_label      text;
  v_their_name text;
  v_my_name    text;
  v_base       jsonb := public.canonical_edit_value(p_field, p_base);
  v_new        jsonb := public.canonical_edit_value(p_field, p_new);
begin
  -- A hardcoded whitelist, not a check on the caller's string: this function
  -- builds an UPDATE with format(%I), and the set of writable columns must be
  -- decided here rather than by whatever the client sends.
  if p_field not in ('notes','vetting_status','pipeline_stage','channel_tags',
                     'relevance_criteria','provided_data','contacts',
                     'media_kit','creator_gender','creator_stage') then
    raise exception 'field % is not editable through apply_channel_edit', p_field
      using errcode = '22023';
  end if;

  -- First edit of this channel anywhere: create its row with the defaults.
  insert into public.channel_state (channel_id, handle)
  values (p_channel_id, coalesce(nullif(p_label, ''), p_channel_id))
  on conflict (channel_id) do nothing;

  execute format(
    'select to_jsonb(c.%I), c.handle, c.last_edited_by_name
       from public.channel_state c where c.channel_id = $1', p_field)
    into v_current, v_label, v_their_name
    using p_channel_id;

  v_current := public.canonical_edit_value(p_field, v_current);

  if not p_force then
    if v_base is not distinct from v_new then
      return 'noop';
    end if;
    if v_current is not distinct from v_new then
      return 'auto';
    end if;
    if v_current is distinct from v_base then
      select coalesce(display_name, 'someone') into v_my_name
        from public.profiles where id = auth.uid();

      insert into public.edit_conflicts as ec
        (channel_id, channel_label, field, base_value, mine_value, theirs_value,
         mine_actor_id, mine_actor_name, theirs_actor_name)
      values
        (p_channel_id, coalesce(nullif(p_label, ''), v_label), p_field,
         v_base, v_new, v_current,
         auth.uid(), coalesce(v_my_name, 'someone'), v_their_name)
      on conflict (channel_id, field, mine_actor_id) where resolved_at is null
      do update set
        mine_value        = excluded.mine_value,
        theirs_value      = excluded.theirs_value,
        theirs_actor_name = excluded.theirs_actor_name,
        detected_at       = now();
      return 'conflict';
    end if;
  end if;

  if p_field = 'channel_tags' then
    update public.channel_state
       set channel_tags = coalesce(
             (select array_agg(e) from jsonb_array_elements_text(v_new) e),
             '{}'::text[]),
           handle = coalesce(nullif(p_label, ''), handle),
           last_edited_by = auth.uid(),
           last_edited_by_name = (
             select display_name from public.profiles where id = auth.uid())
     where channel_id = p_channel_id;
  elsif p_field in ('notes','vetting_status','pipeline_stage','creator_gender','creator_stage') then
    execute format(
      'update public.channel_state set %I = $1, last_edited_by = $2,
              handle = coalesce(nullif($4, ''''), handle),
              last_edited_by_name = (select display_name from public.profiles
                                      where id = $2)
        where channel_id = $3', p_field)
      using v_new #>> '{}', auth.uid(), p_channel_id, p_label;
  else
    execute format(
      'update public.channel_state set %I = $1, last_edited_by = $2,
              handle = coalesce(nullif($4, ''''), handle),
              last_edited_by_name = (select display_name from public.profiles
                                      where id = $2)
        where channel_id = $3', p_field)
      using v_new, auth.uid(), p_channel_id, p_label;
  end if;

  return 'applied';
end $$;

-- Re-state the grants as the baseline has them: execute for authenticated only.
revoke all on function public.canonical_edit_value(text, jsonb) from public, anon;
revoke all on function public.apply_channel_edit(text, text, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.canonical_edit_value(text, jsonb) to authenticated;
grant execute on function public.apply_channel_edit(text, text, jsonb, jsonb, boolean, text) to authenticated;

notify pgrst, 'reload schema';
