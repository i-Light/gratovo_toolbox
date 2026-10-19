# About legacy/: the old app, for reference only

A copy of the old repository `i-Light/gratovo_code` at commit `43596b8` (2026-10-19). (The `README.md` next to this file is the old project's own README.) It is here because cloud sessions can see only this repository, and the rebuild ports behaviour, the sync design, the Python pipeline and the course data from it. See [docs/decisions/0005-legacy-reference-folder.md](../docs/decisions/0005-legacy-reference-folder.md).

## Rules

- **Read only.** Never edit, build, format or lint anything here. When porting, write the new code in its new place and leave this copy alone.
- **Port behaviour, not structure.** The new app has its own architecture ([docs/architecture.md](../docs/architecture.md)).
- **Deleted in step 11**, after step 10 proves parity.

## What's here

The old repository's tracked files, with the same layout, so its docs still work. Start with:

- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md): the map of the old app (Flutter app, Python pipeline, backend, data, how the pieces talk).
- `pipeline/README.md`: the pipeline reference, including R2 object formats and database-schema rules.
- `pipeline/gemini_bridge/DAEMON.md` and `PROTOCOL.md`: the app ↔ daemon and extension ↔ daemon contracts.
- `docs/plans/`: the communication workflow plan, the decisions build plan (including the four gaps on hold) and the outreach intelligence notes.
- `backend/schema.sql`, `backend/tests/`, `backend/SETUP.md`: the Supabase schema, its SQL tests, and project setup.
- `data/comms/`: the course-mined playbook, the skill, and the test scenarios that the comms engine reads.

## What was left out, and why

| Left out | Why |
|---|---|
| `data/.env` | Live secrets. Never copied. Its keys must be rotated ([SECURITY.md](../SECURITY.md)). |
| `backend/.env.example`, `data/.env.example` | Templates the owner called stale. The new app documents its configuration in `docs/` instead. |
| `android/`, `ios/`, `web/`, `windows/` | Generated Flutter platform runners. |
| `.idea/`, `.vscode/`, `.claude/`, `gratovo_toolbox.iml`, `devtools_options.yaml` | Editor and agent settings for the old project. |
| Untracked local files (databases, logs, `.env.local`, `*.local.json`, `aws_gateways.json`, build output) | Machine-specific, secret, or generated. They were never in the old repository either. |

## What was changed

`lib/core/config/supabase_config.dart`: the compiled-in Supabase project URL and anon key were replaced by placeholders. The new app passes them at build time.

## The physical backup

A complete copy of the old folder, including its git history and untracked local files, is at `E:\IMA work\Code\gratovo_code backup 2026-10-19` on the owner's machine.
