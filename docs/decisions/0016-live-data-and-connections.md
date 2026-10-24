# 0016. Live data and connections

- **Date:** 2026-10-24
- **Status:** accepted for step 4 (live data import and operational connections). It records the decisions of the plan (`.router/PLAN.md`, D1 to D15) as built. It changes one line of ADR 0014 (the bridge "needs no secrets", see Consequences). ADR 0013, 0014 and 0015 otherwise stand.

## Context

The owner re-ordered the plan to put the pipeline first (ground rules 9 and 10). Step 4 gets the owner's real data into the new app and makes every connection that Find and Reach need work: the YouTube key, proxies, AWS gateways, Gmail, the Gemini bridge and its browser add-on, and the course folder.

Rule 9 says a signed-in app shows only what is wired to real data. Rule 10 says each task is tested with lint, typecheck, Vitest and pytest, and a step adds only one new Electron smoke test. Step 4 follows both.

## Decision

1. **The live gate.** The frame carries `source: "example" | "live"`.
   - **What live shows in step 4:** Find (the Search tab only), the record page, and these Settings sections: Profile, Appearance, Keyboard, Notifications, Search rules, Writing rules and Connections.
   - **Where it is enforced:** one module, `renderer/lib/wired.ts`. Every way into a screen goes through it: the rail, the palette, the G keys, `go()`, the URL hash, a notification's link, back and forward (a hidden entry is skipped), the action and setting commands, and the Settings section list.
   - **The first-run route.** While the import has never happened, the app opens at Settings, Connections. After that it opens at Find, Search. While the import state is still loading, it opens at Find, Search.
   - **Example data shows everything**, as before, until prototype mode (step 7) takes over.
   *Why:* a screen that shows example numbers beside real data is a lie. Hiding it is cheaper than faking it.

2. **The import.** A Python job, `import.legacy`, in the store lane.
   - **Where the data is.** The old app kept the pipeline and its Supabase mirror in **one** file, `gratovo.db`. There is no old `pipeline.db`. The picker lists candidates: the old installed copy (`%LOCALAPPDATA%\Gratovo IMA ToolBox\data\database\gratovo.db`) if it exists, plus any file the owner picks. It refuses a file inside the new app's data folder (its own database has the same name), a file on a network share or a mapped drive (`network_path`: the owner copies it to this computer first), a file that isn't SQLite, and one with no `channels` table.
   - **The path checks see the real file.** Main refuses `\\?\` and `\\.\` paths. Then it resolves the chosen path and the app's data folder with `realpath` (links, junctions and 8.3 short names) and compares them, ignoring case on Windows. The job gets the resolved path, so the file checked is the file read. The job checks again: it resolves the source, refuses one inside the app's data folder (the parent of its `dataDir`) with `source_in_data_dir`, and treats a network or device path as unreadable.
   - **Read-only.** The job opens the old file with `mode=ro&immutable=1` and never writes it. If a non-empty `-wal` file sits beside it, the old app probably has changes not yet in the main file, so the job refuses with `old_app_open`. A plain `mode=ro` open made SQLite create `-shm` and `-wal` files beside the old copy; the rehearsal caught it.
   - **What is copied.** `keywords, channels, channel_keywords, videos, channel_archive, runs, video_transcripts`, in that order so a parent row comes before the rows that name it. Only the columns both sides have. `INSERT OR IGNORE`, so a row the new app already holds wins. `runs` is the exception. Its `run_id` is `AUTOINCREMENT` on both sides, so old run 3 and this app's run 3 are different runs. The id is left out, and an old run counts as already here when one with the same `started_at` and `kind` is (the dry run counts the same way). An old run still saying `running` arrives `interrupted`, as `reconcile_stale_runs` would close it, and without its `pid`, so a reused pid can't make it look alive. One transaction and one progress line per table. A foreign-key guard drops rows whose parent is missing.
   - **What is skipped, and why.** The tables the app mirrors from Supabase (the sync brings them back), the sync and R2 bookkeeping (`sync_state`, `_applied_segments`, `archive_keyword_pending`, which belonged to the old worker; step T starts its own), and the news tables (not ported). Gmail token files, `.env`, `email_library.db` and `skills_library.db` are never read. The report lists every skipped table with its reason and row count.
   - **Unsent old work.** `_outbox` rows and `activity_log` rows with `synced = 0` do not move. The dry run warns about them, so the owner opens the old app once to send them, or redoes them by hand.
   - **Backup.** Before a real import, if `pipeline.db` already exists, the job runs `VACUUM INTO <userData>/backups/pipeline-<UTC stamp>.db`. Main copies `find.json` beside it. The report names the backup.
   - **The dry run** is the same job with `dryRun: true`. It never creates or writes the destination. Per table it reports the rows in the old file, the rows to add and the rows already here.
   - **After the job, main seeds names.** The local `channels (channel_id, name)` table gets the imported channels' names where one is missing (the sync would bring them, and that waits for step T). Main records `local_settings.import = {at, source, counts, backup}` first, as soon as the job has succeeded.
   - **A step after the job never turns success into failure.** The job has committed by then. Recording the import, the `find.json` copy, seeding the names and the old rules each run on their own. One that fails is logged (its kind only) and named in the result's `warnings`: `import_state`, `find_backup`, `channel_names` or `old_rules`. If the `find.json` copy failed, the old rules are not applied, so the current rules can't be lost; that is an `old_rules` warning too. The page doesn't show the warnings yet.
   - **Old search rules, on request.** If the owner ticks "Use my old search rules", main maps `run_config.json` and `settings.json` from the old `data/` folder into `find.json` (sort, result type, handles per keyword, the subscriber band, auto-clean).
   *Why:* one file holds both halves, so one read-only job brings both.

3. **Search rules.** `find.json` rules gain `minMedianViews` and `minUploads30` (empty means off) and `archiveDays` (default 7).
   - After a kept channel's videos are fetched and its signals derived, a channel below either bound is archived the way an auto-clean sweep archives. It gets the label the sweep uses. The search does this itself, so no new job is needed.
   - The bounds are judged when the uploads sweep ends, and on a stop or a block mid-sweep, so the channels already stamped are still judged. Any other error judges nothing and goes up as it is. If judging fails during a stop, the run still reports the stop.
   - A channel exactly on a bound is kept. A channel with no videos counts as 0, but only after a successful fetch. If the fetch failed, the channel is left alone.
   - `archiveDays` is saved now and kept in main. Step 5's reject will read it. Find's rules card shows it.
   - Settings, Search rules edits all of it, and Find's rules card has "Edit rules", which opens that section.

4. **Writing rules.** Main reads the playbook rule files `services/pipeline/data/comms/playbook/rules/*.rules.json` and gives the renderer `{id, area, stage, title, rule, level}` for each rule. Settings, Writing rules searches them by id or words and groups them by area. A packaged build can't find the files until step T5, and then it says "not found". No "N drafts now" count appears until drafts exist (step 6).

5. **Settings persistence.** Non-secret values live in the open data source's `local_settings`, so example and live data never mix: `pipeline.settings` (pacing, parallel, proxy switches), `mail.settings` (label, sender name, each mailbox's address, daily cap and warm-up date), `course` (the course and video folders) and `import`. Search rules stay in `find.json`.
   - Secrets keep their names from step 3e (`mail.client`, `mail.mailboxes`, `pipeline.proxies`, `pipeline.gateways`, `aws.keys`) and get **set-only** channels. The renderer can send a value but never reads one back. It sees only booleans ("set") or counts.
   - Find's and the mail jobs' start messages now fill `settings` from these values. Find sent `{}` before. A search's start message leaves the mail settings out, so it carries no mailbox address.

6. **Gmail consent** (`main/mail/consent.ts`): OAuth 2.0 for installed apps.
   - A one-shot listener on `127.0.0.1` with a port the system picks. PKCE (S256). A random `state`. Google's page opens in the system browser. The person has five minutes, and one code is accepted.
   - Only the redirect with our `state` ends a connect, or the five minutes running out. A request with a missing or wrong `state` gets an empty 404 and changes nothing: any web page in the person's browser can reach the port, and must not be able to cancel the connect so that Google's real redirect finds no one listening. (The `bad_state` reason stays in the IPC schema but main no longer answers it.)
   - The scopes are `gmail.modify` and `gmail.send`, as the old app had, plus `openid email`. Main reads the address from the `email` claim in the `id_token` of the token response. It checks the claims (the audience is our client id, the issuer is Google, `email_verified` is `true`; a missing claim is refused) but **not the signature**. The token comes straight from Google over TLS in answer to our own request with our client secret, so a signature adds nothing here.
   - Main exchanges the code with its **own network instance**, which allows only `https://oauth2.googleapis.com`. The Supabase host is not on it.
   - The browser opens only if the consent URL passes a narrow check (`isGoogleConsentUrl`: https, `accounts.google.com`, the path `/o/oauth2/v2/auth`, no port, no login part, no fragment). The page's own external-link allowlist is not widened.
   - The 20-mailbox limit is checked **before** the browser opens, with the same count the save enforces (settings rows and stored tokens together), and without building the whole status.
   - The refresh token goes into `mail.mailboxes` (replacing the same address). The mailbox row goes into `mail.settings` (cap 20, warm-up from today). The owner enters the Gmail app's client id and secret once (`mail.client`).
   - A refresh token that can't be stored (the limit reached in the meantime, a store that won't write) is revoked at once at `https://oauth2.googleapis.com/revoke` (same origin, same network instance), so no live grant is left at Google with no copy here. It is best effort: only the HTTP status is logged, and the answer to the person doesn't change.
   - Nothing secret is logged: no code, verifier, state, token, client secret or address. The tests use a fake token endpoint and a fake browser opener.

7. **Gemini control.** The owner starts the bridge from Settings, Connections ("Start", or "Open the Gemini window"). Nothing else starts it. Step 4 **never sends a prompt**: it only starts the bridge and connects the add-on, so the owner's pacing rules are not touched. Main stops the bridge on every switch of data source, because the bridge's folder belongs to the open source (the open item in ADR 0014). The account has no "source changed" event, so main (`main/settings/source-switch.ts`) compares the open source after every sign-in, recheck and sign-out, and before every reload. Main pushes `gemini:state` events from the daemon.
   - The bridge gets its folders from main: the source's pipeline folder, a Gemini profile folder under the app data, the add-on folder (found beside the pipeline folder, as the Python path is; missing in a packaged build until step T5), and the course and video folders.

8. **The per-launch token.**
   - **How it travels.** Main makes 32 random bytes (64 hex characters) for each bridge start and passes them in the child's environment as `GRATOVO_BRIDGE_TOKEN`. Never in argv. The bridge reads it once and removes it from its environment.
   - **Where it is used.** When the bridge builds the **Firefox** copy of the add-on, it writes `bridge-token.js` (`self.GB_BRIDGE_TOKEN = "…";`) into the built folder, first in the background scripts. The add-on sends it as `token` in its `hello`. The bridge compares it in constant time. A wrong or missing token closes the connection with code **4001**. The token is cut from the `hello` before the hello is stored.
   - **Who needs it.** A Firefox add-on needs it. A connection from a `moz-extension://` origin **always** needs it, whatever browser its `hello` claims, so an add-on can't say "edge" to skip the check.
   - **Chrome and Edge are exempt.** They load the source folder unpacked, and an unpacked folder can't hold a value that changes at every launch. For them the guards are the origin check (no web page gets in) and browser admission. A token for them would need native messaging (see Alternatives).
   - **A stale add-on.** The token changes at every start, so the first window of a run reinstalls the add-on, which writes the new token.
   - **Never logged.** The bridge never logs the token or what was sent in its place. Main's Gemini log blanks it from every line.

9. **The add-on port.** `legacy/pipeline/gemini_extension/` is copied to `services/gemini-extension/`, with its layout kept (the bridge loads `tools/build_addon.py` from there). Stale paths are fixed, the version is **0.4.0**, and the token is added. Its jsdom tests (`node --test`) run inside `pnpm test` through a small workspace package. `test_build_addon.py` is ported to `services/pipeline/tests/`. A test checks that the add-on id in the build equals the one the bridge expects. The bridge now counts the folder as the add-on when `manifest.json` exists (it held only a README before).

## Consequences

- ADR 0014 said the bridge process "needs no secrets". That no longer holds: it gets one secret, the per-launch token, in its environment. It still gets no key, proxy or password. The daemon has a new end reason, `bad_token`.
- In live mode most screens are unreachable until their steps arrive. That is the point of the gate.
- The dry run's "to add" count is an **estimate**. It counts against the destination as it is now. A real import can differ if the new app writes in between.
- The old outbox is not imported. The owner sends or redoes unsent old work (the dry run warns about it).
- Chrome and Edge have no per-launch token. The origin check and browser admission carry the load for them.
- Sending a Gemini prompt, sending mail and reading the mailbox are not part of step 4. Connecting a mailbox is consent only. The mailbox check in tests runs `mail.status` against a fake.
- Two files in the renderer, `routing-rows.tsx` and `gmail-rows.tsx`, are over the size guide and are to be tidied later.

## Alternatives considered

- **Copy the old file whole as `pipeline.db`.** Rejected. The old file holds about 1.2 GB of tables this app doesn't use, and an older copy lacks `channels.found_emails`, so the schema would be wrong. Copying table by table into a migrated file is safe for both.
- **Do the import in main with `node:sqlite`.** Rejected. The pipeline owns the schema of `pipeline.db`, so the pipeline should be the writer. Two writers of one schema drift apart.
- **A per-launch token for Chrome and Edge through native messaging.** Not worth it now. It needs a native host to install and register. The origin check and browser admission already keep web pages out. Reconsider if the owner moves to Chrome or Edge.

## Rehearsal

The lead ran the job read-only on a copy of the owner's newest old database (1.21 GB, 2026-10-19) with its four non-secret settings files beside it. The copy was deleted afterwards.

- **Dry run, 0.1 s.** To add: keywords 1,487, channels 2,373, channel_keywords 7,584, videos 35,448, channel_archive 104,341, runs 234, video_transcripts 1. The destination was not created. Thirty tables were skipped (for example `channel_state` with 15,606 rows and `activity_log` with 365, both mirrored, and 79 news rows not ported). Unsent old work: 1 outbox row and 1 activity row. All four settings files were found.
- **Real import, 3.1 s.** The same counts were added. No backup, because the destination was new.
- **Second real import, 1.8 s.** A backup was made, 0 rows were added, and every row was reported "already here".
- **The source file** had the same SHA-256 and modified time afterwards. But `-shm` and `-wal` files appeared beside the copy: the old file is in WAL mode and plain `mode=ro` still creates them. That is why the job opens it with `immutable=1` and refuses when a non-empty `-wal` is present (`old_app_open`). After that change the rehearsal ran again on a fresh copy: the same counts, and the folder held only `gratovo.db` afterwards.
