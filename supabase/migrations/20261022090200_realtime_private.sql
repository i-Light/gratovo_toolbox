-- ---------------------------------------------------------------------------
-- Private Realtime channels (step 3d-2b, S18)
-- ---------------------------------------------------------------------------
-- Owner's answer Q5 (2026-10-20): private Realtime channels from the start,
-- with topics of the app's own, never the old app's public channels.
--
-- This touches ONLY policies on realtime.messages, and has its own production
-- rollout step (R1). It creates nothing in the realtime schema and does not
-- enable row level security there: Realtime already has it on, and the
-- statement would fail with 42501 (must be owner of table messages).
--
-- D23: two policies. A signed-in, authorized member may receive and send
-- broadcast and presence messages on exactly two topics:
--   toolbox:sync  broadcast "something changed" after an upload
--   toolbox:team  presence (the app's own small payload)
-- A waiting (unauthorized) member, anon and any other topic or extension
-- (for example postgres_changes) get nothing. Private joins are checked
-- against these policies whichever way "Allow public access" is set; the
-- owner turns that switch off by hand in production so public channels are
-- closed as well.
--
-- Safe to run again.
-- ---------------------------------------------------------------------------

drop policy if exists toolbox_realtime_receive on realtime.messages;
create policy toolbox_realtime_receive on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) in ('toolbox:sync', 'toolbox:team')
    and realtime.messages.extension in ('broadcast', 'presence')
    and (select public.is_authorized())
  );

drop policy if exists toolbox_realtime_send on realtime.messages;
create policy toolbox_realtime_send on realtime.messages
  for insert to authenticated
  with check (
    (select realtime.topic()) in ('toolbox:sync', 'toolbox:team')
    and realtime.messages.extension in ('broadcast', 'presence')
    and (select public.is_authorized())
  );
