-- ---------------------------------------------------------------------------
-- Sync columns (step 3d-2b, S1): creator stage, brand sells/status, deal flow
-- step, activity_log.received_at and per-person notification switches
-- ---------------------------------------------------------------------------
-- Additive only. No existing column changes type, default or nullability and no
-- existing value is rewritten: the new columns start null, and received_at's
-- default is a constant (now() is evaluated once), so no table rewrite.
-- Safe to run again.
--
-- D21: the columns and the switches table. D5: why received_at exists.
-- ---------------------------------------------------------------------------

-- D21: the app's own creator stage (one of the 11 creatorStages).
alter table public.channel_state add column if not exists creator_stage text;
alter table public.channel_state drop constraint if exists channel_state_creator_stage_check;
alter table public.channel_state add constraint channel_state_creator_stage_check
  check (creator_stage is null or creator_stage in
    ('new','shortlisted','contact','emailed','replied','kit','audience','signed','rejected','parked','never'));

-- D21: what a brand sells and where it stands.
alter table public.brands add column if not exists sells  text;
alter table public.brands add column if not exists status text;
alter table public.brands drop constraint if exists brands_sells_len_check;
alter table public.brands add constraint brands_sells_len_check
  check (sells is null or char_length(sells) <= 500);
alter table public.brands drop constraint if exists brands_status_len_check;
alter table public.brands add constraint brands_status_len_check
  check (status is null or char_length(status) <= 40);

-- D21: a deal's step in the app's flow (an index into DEAL_FLOW, 0 to 9).
alter table public.deals add column if not exists flow_step smallint;
alter table public.deals drop constraint if exists deals_flow_step_check;
alter table public.deals add constraint deals_flow_step_check
  check (flow_step is null or flow_step between 0 and 9);

-- D5: `at` is the writer's clock, so a member who was offline uploads lines
-- older than another member's pull cursor. The app pulls by the server's
-- receive time instead. Existing rows all get this migration's time.
alter table public.activity_log add column if not exists received_at timestamptz not null default now();
create index if not exists idx_activity_log_received on public.activity_log (received_at, id);

-- D21: each member's own notification switches (a row per person, own row only).
create table if not exists public.notification_switches (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  switches   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notification_switches drop constraint if exists notification_switches_object_check;
alter table public.notification_switches add constraint notification_switches_object_check
  check (jsonb_typeof(switches) = 'object');

drop trigger if exists trg_notification_switches_touch on public.notification_switches;
create trigger trg_notification_switches_touch
  before insert or update on public.notification_switches
  for each row execute function public.touch_updated_at();

alter table public.notification_switches enable row level security;

-- Own row only, and only while authorized. There is no delete policy, so RLS
-- refuses every delete even though the role holds the privilege (test_30 wants
-- all four on every table that is not read-only).
drop policy if exists notification_switches_read on public.notification_switches;
create policy notification_switches_read on public.notification_switches
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_authorized()));

drop policy if exists notification_switches_insert on public.notification_switches;
create policy notification_switches_insert on public.notification_switches
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.is_authorized()));

drop policy if exists notification_switches_update on public.notification_switches;
create policy notification_switches_update on public.notification_switches
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_authorized()))
  with check (profile_id = (select auth.uid()) and (select public.is_authorized()));

revoke all on public.notification_switches from public;
revoke all on public.notification_switches from anon;
revoke all on public.notification_switches from authenticated;
grant select, insert, update, delete on public.notification_switches to authenticated;
grant select, insert, update, delete on public.notification_switches to service_role;

notify pgrst, 'reload schema';
