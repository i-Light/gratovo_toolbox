# PROGRESS: plan step 6 (Reach)

Plan: `.router/PLAN.md` (decisions D1–D19, D6a; 6a's task table). Map: `.router/CONTEXT.md`.

## Where it stands (2026-10-25, paused for a context compact)

- Sub-step **6a** on branch `feat/6a-reach-drafts`, committed as work in progress. No agent is running.
- `pnpm lint` and `pnpm typecheck` pass. Last test runs: main 1423+ (all pass), renderer 785 (all pass after the store test fix), core and ipc pass, pytest 1613 pass. Run `pnpm test` once in full on resume.
- The pre-commit hook can't take ~100 files at once on Windows ("The command line is too long"): commit in batches of about 30 named paths.

## 6a tasks

| id | tier used | state | note |
|---|---|---|---|
| A0 | H | done | Bridge pacing (D6a): 60 s gap and a fresh chat on every send in `gemini/client.py`; the engine's, coach's and pairwise's follow-up turns are standalone fresh-chat prompts (`engine.fresh_turn`); breaker `gemini/pause.py` (a true refusal pauses 30 min at once; generic errors count, 3 in 15 min); `PAUSED` code, `bridge.status.pausedUntil`; main's waits +60 s per prompt (`promptGapS`). |
| A1 | H (lead) | done | Contracts: `core/data/reach-types.ts`, `core/data/outreach-store.ts` (`DataSource.outreach`), `core/reach/{gates,board}.ts`, `ipc/reach.ts`, four draft writes, frame part `reach`, seven `reach:*` channels (`reach:rewrite` also answers `no_sender`). |
| A2+A3 | N | done | Migration 0004, `repositories/outreach.ts`, sqlite-source writes and `commit`; draft writes bypass `onWrite` (local only, D1). Example seed v3: creators c6–c10, c13, c14, three example mailboxes in `mail.settings`. |
| A4 | H | done | `main/reach/drafter.ts`, `facts.ts`, `strings.ts`. Lead fixes: starts "off" on live until it has checked the bridge (always "ready" on example data); checks the bridge when the queue is empty (a status call, never a prompt). |
| A5 | H | done | `quick-queue.ts`, `mail-state.ts`, `sender.ts`, `sender-strings.ts`. A send queued at quit comes back `maybe_sent` (the safe side). |
| A6 | N | done | `reach-service.ts`, handlers, services, index wiring. Lead fix: `connections-harness.ts` clears the seeded mail settings. |
| A7 | N | done | Renderer data side: `AppData.reach`, the persist diff, `mergeReach`, `reach-actions.ts`, strings. |
| A8 | N | done | Reach screen, board, draft card, thread, Emails tab, peek on a tab. Lead safety fix: `takeBack` is no longer an undo step (it goes straight through with `adoptServerData`), and main sets every approval's hold itself (`sendHoldMs` in `writeDraftState`), so a Redo or an Undo carrying an old time never sends at once (contract test added). |
| A9 | – | next | One Electron smoke test `apps/desktop/e2e/reach-board.spec.ts` (example data: the Board lanes; open a Waiting card on its Emails tab; Send, the toast, Undo; Send again and the card leaves the lane). Run: `pnpm build`, then `cd apps/desktop && pnpm exec playwright test e2e/reach-board.spec.ts` (`unset ELECTRON_RUN_AS_NODE` first). |
| A10 | H | after A9 | Look at Reach at 1440 px, dark (the lead's screenshot scripts: `docs/lead-scripts.md`), then a `router-reviewer` review of the diff (no send without approval; no body, address or secret in a log; the plan). Fix the findings. |

## Known open points for 6a

- Example creators (`c1`…) show the record summary in the peek, not `CreatorRecord`; the Emails section sits under the summary (A8 deviation 1). Check that it looks right.
- The record page's Full page button doesn't carry the tab (the route has no tab slot).
- "Send as new" asks with an inline Yes/Cancel (the app has no modal confirm).
- The sub line says "N follow-ups to approve" (the prototype: "due today"); follow-ups arrive in 6c.
- `counts.reach` comes from main's overlay: check the rail shows it after a `frame:changed {parts:["reach"]}`.
- `comms/pool.py` keeps its own copy of the generic-error pattern (a hand-run tool).

## Then

The PR for 6a (its body lists what was checked and how), `pnpm verify --status` until green, fix the review findings, merge. Update the plan's §5 row 6 ("6a done …") in the same PR. Then plan 6b's tasks from D9 and D12 (the Mailboxes tab, Send later, Toolbox › Scheduled).
