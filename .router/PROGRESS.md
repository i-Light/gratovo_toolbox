# Progress

Two steps are open. The owner asked for step 8 part 1 (Signing) before step 7 part 1 (2026-10-27).

## Step 8, part 1: Signing (in progress)

Branch `feat/8-signing`. Plan and contracts: `.router/PLAN.md`; recon: `.router/CONTEXT.md`. Owner's choices: the full signing scope; Decline drafts a kind no through the comms engine.

| Task | State |
|---|---|
| C1 core contracts, C2 IPC, P1 pipeline goal and engine kit | Done (00313f5) |
| D1 data layer, D2 sync, D3 example kits | Done (f650e1b) |
| M1 draft goal, M2 decline, ask, park and wake | Done (a90c747) |
| R1 Audience card, kit editor, actions | Done (87381d7) |
| R2 Close › Roster, live gate, board lanes | In progress |
| E1 smoke test, Z1 docs, RV review, PR | Next |

Notes from the build:
- A kit creator parked after a reply has a stopped sequence; the day timer now also reads parked sequences (`runningSequences` includes `park_until IS NOT NULL`) and a stopped one is woken without re-timing.
- Example data: c14 AgentWorks passes, c15 Silicon Sage fails, c16 Context Window has reply numbers only; c1 to c5 (signed) have typed kits. Seed version 8.
- The kit link opens through the record's existing `target="_blank"` links (https only); the renderer has no open-external channel.

## Step 7 (paused)

| Part | What | State |
|---|---|---|
| 2 | Prototype mode and the comment tool | **Done** 2026-10-27, branch `feat/7-prototype-mode`. Decisions as built: [ADR 0019](../docs/decisions/0019-prototype-mode-built.md) |
| 1 | Today: the next-action engine, the queue, the day band, Settings › Your day | **Next after step 8 part 1.** Start a fresh plan from the plan's step 7 item 1. Today's audience bucket ("Check X's audience") comes with it, now that signing exists |
| 3 | Branch protection | After part 1. Branch protection isn't available on the free plan for a private repository (docs/workflow.md); `pnpm verify --status` is the gate |

Left for part 1 or the end of step 7, from part 2:
- The problems bar has no feed yet (part of Today's work); the "Something broke" scenario shows its problems through notifications, Reach's Gemini banner and the signed-out mailbox.
- The full prototype flow suite (`proto_flow.py`, `review_fixes.py` as Playwright tests) runs at the end of step 7.
- Two small gaps the review left: a failed Reopen or a failed Undo of Mark done is silent in the comment card.
