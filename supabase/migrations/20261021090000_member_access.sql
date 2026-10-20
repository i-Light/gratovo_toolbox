-- ---------------------------------------------------------------------------
-- Member access: agency roles and "sees money" (step 3d-2a, decision G9)
-- ---------------------------------------------------------------------------
-- Serves the owner's answers on roles and money. Additive only: it adds a
-- schema, a table and functions, and changes nothing the old app reads or
-- writes (no existing table, column, policy, grant or function is touched).
--
-- Why a new table and not columns on `profiles`: `profiles_self_update` lets a
-- member update every column of their own row, so a roles column there would
-- be self-editable. A separate table with no write policy is not.
--
-- Writes go only through public.set_member_access (security invoker, the one
-- PostgREST exposes), which calls private.set_member_access (security definer
-- in a schema the Data API does not expose). Safe to run again.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create table if not exists public.member_access (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  roles       text[] not null default '{}'
              check (roles <@ array['owner','scout','outreach','deal_lead','delivery']::text[]),
  sees_money  boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid null
);

create index if not exists member_access_updated_idx
  on public.member_access (updated_at, profile_id);

drop trigger if exists trg_member_access_touch on public.member_access;
create trigger trg_member_access_touch
  before insert or update on public.member_access
  for each row execute function public.touch_updated_at();

alter table public.member_access enable row level security;

-- Read: any authorized member reads every row; anyone else only their own.
-- No insert, update or delete policy exists, so RLS refuses every direct write.
drop policy if exists member_access_read on public.member_access;
create policy member_access_read on public.member_access
  for select to authenticated
  using ((select public.is_authorized()) or profile_id = (select auth.uid()));

revoke all on public.member_access from public;
revoke all on public.member_access from anon;
revoke all on public.member_access from authenticated;
grant select on public.member_access to authenticated;
grant select, insert, update, delete on public.member_access to service_role;

-- True when the caller is an authorized member holding the Owner role.
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select public.is_authorized())
     and exists (select 1 from public.member_access m
                  where m.profile_id = (select auth.uid()) and 'owner' = any (m.roles));
$$;

create or replace function private.set_member_access(
  p_profile_id uuid, p_roles text[], p_sees_money boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_roles text[];
begin
  if not private.is_owner() then
    raise exception 'only an owner can change member access' using errcode = '42501';
  end if;

  -- One writer at a time. Without this, two owners who each remove the other's
  -- Owner role in the same instant both pass the last-owner check below (each
  -- still sees the other as an owner) and the team is left with none. A
  -- transaction-level advisory lock rather than a table lock: it serialises
  -- only this function and leaves plain reads of member_access untouched, and
  -- it is released at commit or rollback. Non-owners never reach it.
  perform pg_advisory_xact_lock(hashtext('public.member_access'));

  -- Checked again under the lock: the writer before us may have just taken
  -- this caller's Owner role away. Each statement here sees the latest
  -- committed rows (read committed), so this check and the one below do too.
  if not private.is_owner() then
    raise exception 'only an owner can change member access' using errcode = '42501';
  end if;

  if p_roles is null or p_sees_money is null
     or not (p_roles <@ array['owner','scout','outreach','deal_lead','delivery']::text[]) then
    raise exception 'unknown role or missing value' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'no such member' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct r order by r), '{}') into v_roles from unnest(p_roles) as r;

  insert into public.member_access (profile_id, roles, sees_money, updated_by)
    values (p_profile_id, v_roles, p_sees_money, (select auth.uid()))
  on conflict (profile_id) do update
    set roles = excluded.roles, sees_money = excluded.sees_money, updated_by = excluded.updated_by;

  -- Only an owner who can still sign in counts: an Owner row on a profile the
  -- old app has set back to 'unauthorized' would leave nobody able to manage access.
  if not exists (select 1 from public.member_access m
                   join public.profiles p on p.id = m.profile_id
                  where 'owner' = any (m.roles) and p.role in ('basic', 'full')) then
    raise exception 'the team needs an owner' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.set_member_access(
  p_profile_id uuid, p_roles text[], p_sees_money boolean
) returns void
language sql security invoker set search_path = ''
as $$ select private.set_member_access(p_profile_id, p_roles, p_sees_money); $$;

-- is_owner() is called only from inside private.set_member_access, which runs
-- as the function owner, so no API role needs it.
revoke execute on function private.is_owner() from public, anon, authenticated;
revoke execute on function private.set_member_access(uuid, text[], boolean) from public, anon;
revoke execute on function public.set_member_access(uuid, text[], boolean) from public, anon;
grant execute on function private.is_owner() to service_role;
grant execute on function private.set_member_access(uuid, text[], boolean) to authenticated, service_role;
grant execute on function public.set_member_access(uuid, text[], boolean) to authenticated, service_role;
