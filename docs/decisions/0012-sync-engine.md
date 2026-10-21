# 0012. The sync engine

- **Date:** 2026-10-21
- **Status:** accepted for step 3d-2b. It answers the open items of [0010](0010-data-layer.md) (IPC limits, encryption) and the consequences [0011](0011-accounts-roles-team-keys.md) left (the team refresh, the name PATCH, unsent changes on sign-out, money in notifications).

## Context

After 3d-2a a member could sign in and see the team, but the local copy held nothing else. Changes stayed on the computer, except your name. Step 3d-2b fills the copy from the team's Supabase project and keeps it in step, both ways. The owner's answers (2026-10-20):

- **One pull request.**
- **`gratovo.db` stays unencrypted,** with BitLocker advised.
- **Unsent changes are kept for the same account only.**
- **The app holds the 5,000 most relevant creators.**
- **Private live channels of the app's own,** with its own small presence.
- **"I don't care about the old app at all, no one is or will use it."** Nothing here keeps the old app working. Migrations still never destroy or rewrite existing data.

Production holds 15,605 creators, no brands or deals yet, 364 log lines and about 38,000 tombstones.

## Decision

1. **One engine in the main process, one pass at a time** (`apps/desktop/src/main/sync/`). A pass works in this order:
   - drop outbox rows that belong to any other user;
   - drain the outbox;
   - re-fetch the rows the drain asked for;
   - read the small tables whole: profiles, roles, your notification switches and your open conflicts;
   - check the purge horizon;
   - seed the tombstone cursor on a first pull;
   - keyset-pull creators, brands, deals and the log;
   - pull tombstones;
   - broadcast "changed" if anything was sent.

   What starts a pass: start, sign-in, a write (1 s after the last one), a teammate's broadcast, the 20 s catch-up, or `sync:now`. A trigger during a pass runs one more pass after it. The engine uses the account's one REST client and session, so only one token refresh ever runs.
2. **Keyset pages keep the server's own time text.** The cursor is the last row's raw `updated_at` (microseconds, `+00:00`). It never passes through `Date`. Every value in the `or=(…)` filter is double-quoted and the whole parameter is encoded, so a `+` never becomes a space.
   - Pages start at 500 rows. They halve on a timeout or 5xx, down to 25, and double again after five good pages.
   - A page is applied in one transaction, with the event loop let through between pages.
   - Rows are written with `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`, which would change a row's place in the frame.
   - A row the local copy can't hold is skipped and logged by table name, so it can't stall the table.
3. **The log is pulled by the server's receive time.** A new column, `activity_log.received_at`, holds it. `at` is the writer's own clock, so a teammate who was offline would upload lines older than everyone else's cursor, and those lines would never be pulled.
4. **Tombstones, the resurrection guard and the horizon.** A first pull seeds the tombstone cursor at the newest tombstone, so it reads none of the 38,000. A tombstone deletes the local row only when the row has nothing pending and is older than the deletion. If the server purged tombstones past the copy's cursor, the next pull is a full one, and afterwards it removes local rows that weren't seen.
5. **An outbox of intent, strict first-in first-out.** Each local write and its outbox row go in the same transaction. The kinds:
   - your name;
   - log lines, with undo and redo as new lines (the server only ever gets inserts);
   - your notification switches;
   - a creator's stage, through `apply_channel_edit`'s compare-and-set;
   - settling a conflict, through `resolve_edit_conflict`;
   - a brand (only its own columns);
   - a deal's step (one column).

   A retryable failure stops the drain. Every row carries its user id. The ported refusal rules:
   - **Dropped and shown in a toast:** `42501`, `22…` and `23…`. The row is also re-fetched from the server. A refused batch of log lines is re-sent one line at a time, so only the refused lines drop.
   - **Retried:** a schema that is behind, offline, timeouts, 5xx and anything else.
   - **A session problem:** a 401 after one refresh, or an auth error.

   After four failed passes on the same row the status says "stuck". Nothing is ever skipped past it.
6. **Unsent work is never overwritten.** Four rules keep it safe:
   - the drain runs before the pull in the same pass;
   - the puller skips a row that has a pending outbox entry;
   - the whole-table refresh writes a pending name, switches or conflict choice back over what it read;
   - the page adopts new data only while its persister is idle.
7. **The app's own columns win.** The app writes `creator_stage`, `sells`, `status` and `flow_step`, and none of a row's legacy fields. The legacy fields are read only as the fallback for rows that never got the app's column.
8. **The frame stays inside the IPC limits.** It holds at most 5,000 creators: every creator a deal names, then those past "new", then the most recently pulled. At most 100 conflicts. A 20,000-row test copy gives a frame under 2 MB. Step 5's search can lift the cap.
9. **Money can't leak.** For a member who may not see money, the frame leaves out notifications of kind `money`, notifications flagged as money, notifications whose text mentions an amount, and log lines about a money field or that mention an amount.
10. **Events from main to the page** go over one channel, `gratovo:event`, which carries `frame:changed`, `sync:status` and `presence:changed`. Main checks every payload against its schema and sends only to the app's own page. The bridge gains `on(name, listener)`. The page adopts server data through `adoptServerData`, which writes nothing and keeps Undo.
11. **The sync state is visible, minimally.** The top bar's chip shows "Not synced" when changes wait and the app is offline or stuck, and its tip says what is true. Three other notices:
    - a toast when the server refuses a change;
    - one line on the sign-in screen when a signed-out copy holds unsent changes;
    - a conflict notification and toast with **Use mine** and **Keep theirs**.
12. **Sign-out keeps unsent changes, for the same account.** The drain gets up to 5 s. A copy with nothing unsent is deleted, as in 3d-2a. Otherwise only the outbox and the account id stay in the file, then it is vacuumed. The next sign-in by the same account sends them first. If someone else signs in, they are deleted.
13. **`gratovo.db` stays unencrypted.** `node:sqlite` has no encryption, SQLCipher would bring back a native module, and encrypted columns would break search. The file lives in the Windows account's profile and is deleted on sign-out. `docs/setup.md` advises BitLocker.
14. **Realtime on private topics of the app's own:** `toolbox:sync` (a "changed" broadcast naming tables, no row data) and `toolbox:team` (presence). Two policies on `realtime.messages` let only authorized members receive or send on those topics.
    - The client is `@supabase/realtime-js` 2.117.2, behind the allowlist. Its transport is a WebSocket class that checks the address first, and its fetch is the network module's.
    - It logs kinds only, never payloads or URLs.
    - It fetches the token before joining. Without that, the first joins went out as anonymous and were refused (found by the server tests).
    - The app never joins the old app's public channels, and "Allow public access" is turned off.
15. **The presence payload is the app's own:** `{ v: 1, screen, idle }`. There are no record ids, search terms, names or emails. It is published at most once a second and only on a change. Present and not idle shows as online with the screen's name; idle or absent shows as away.
16. **Three migrations.**
    - `sync_columns` only adds: four columns, `received_at`, and `notification_switches`, where each member can read and write only their own row.
    - `creator_stage_edit` replaces `apply_channel_edit` and `canonical_edit_value` in place, with the same signatures, to add `creator_stage` to the editable list.
    - `realtime_private` adds the two policies.

    Each had its own production step, with the owner's go.

## Alternatives considered

- **Two pull requests:** the first plan. The owner chose one.
- **`INSERT OR REPLACE`:** it deletes the row first, which changes its order in the frame and drops local-only columns.
- **A cursor on the log's `at`, with an overlap window:** any window can be outrun by a longer absence.
- **Seeding tombstones from the client's clock:** clocks drift. The newest tombstone is the server's own time.
- **Raising the IPC list limit to fit every creator:** a 15,000-row frame on every start, for lists the screens don't show yet.
- **Encrypting the file:** see decision 13.
- **Refusing to sign out while changes are unsent:** it traps a person on a shared computer. Keeping only the outbox is enough.
- **A separate `apply_creator_stage` function:** it would copy the base check, the conflict filing and the editor stamp that `apply_channel_edit` already has.
- **Database-trigger broadcasts:** `realtime.send` fails until a socket has created the day's partition, and a trigger would sit on every write.
- **The old app's public channels and presence fields:** public, and fields the owner said no longer make sense.
- **A hand-written Phoenix client:** about 300 lines of protocol to own, for nothing the official client lacks.

## Consequences

- Teammates see each other's changes within a second or two over Realtime, and within 20 s at worst.
- Screens in steps 4 to 9 write through the kinds built here. Compare-and-set for fields other than a creator's stage comes with their screens; the uploader already handles every whitelisted field.
- Brands and deals are last-writer-wins. Compare-and-set for them can come with their screens.
- The other 15 legacy tables aren't mirrored until their steps.
- The packaged build (3h) must ship `@supabase/realtime-js` with the main process.
- Money is still readable by every authorized member in the database. Locking it stays with steps 10 and 11, as the migration plan says (the owner, 2026-10-21).
- If anyone re-runs the old `schema.sql`, re-apply the three migrations right after.
- **Known limits, found in review (2026-10-21), for a later step:**
  - Two server transactions that commit out of order can stamp an older `updated_at` (or `received_at`) after a pull has moved past it, and that row is then missed until it changes again. The fix is to re-read a few seconds behind the cursor; it needs care with the stall check.
  - The tombstone cursor moves only when something is deleted. After 90 days with no deletion, the daily purge passes it, and each device then does a full re-pull every day until a deletion happens. The fix is to remember when the tombstones were last read up to date.
