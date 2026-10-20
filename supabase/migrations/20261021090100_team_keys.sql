-- ---------------------------------------------------------------------------
-- Team keys: the YouTube key (step 3d-2a, decision G13)
-- ---------------------------------------------------------------------------
-- Serves the owner's answer on team keys. Additive only: two new functions,
-- nothing the old app reads or writes changes. The key lives in Supabase Vault
-- under the name `team_youtube_key` (added by the owner in the dashboard); this
-- migration does not create the extension (every Supabase project has it).
-- Only an authorized member can read it, through public.team_youtube_key().
-- Safe to run again.
-- ---------------------------------------------------------------------------

create schema if not exists private;

create or replace function private.team_youtube_key() returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select public.is_authorized()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'team_youtube_key');
end $$;

create or replace function public.team_youtube_key() returns text
language sql stable security invoker set search_path = ''
as $$ select private.team_youtube_key(); $$;

revoke execute on function private.team_youtube_key() from public, anon;
revoke execute on function public.team_youtube_key() from public, anon;
grant execute on function private.team_youtube_key() to authenticated, service_role;
grant execute on function public.team_youtube_key() to authenticated, service_role;
