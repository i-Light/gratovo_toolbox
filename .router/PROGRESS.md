# Progress: step 7

Step 7 has three parts (migration plan §6). The owner asked for part 2 first (2026-10-27).

| Part | What | State |
|---|---|---|
| 2 | Prototype mode and the comment tool | **Done** 2026-10-27, branch `feat/7-prototype-mode`. Decisions as built: [ADR 0019](../docs/decisions/0019-prototype-mode-built.md). Its working plan and recon were removed when it ended; they are in the git history of that branch |
| 1 | Today: the next-action engine, the queue, the day band, Settings › Your day | **Next.** Start a fresh plan in `.router/PLAN.md` from the plan's step 7 item 1 |
| 3 | Branch protection | After part 1. Note: branch protection isn't available on the free plan for a private repository (docs/workflow.md); `pnpm verify --status` is the gate |

Left for part 1 or the end of step 7, from part 2:
- The problems bar has no feed yet (part of Today's work); the "Something broke" scenario shows its problems through notifications, Reach's Gemini banner and the signed-out mailbox.
- The full prototype flow suite (`proto_flow.py`, `review_fixes.py` as Playwright tests) runs at the end of step 7.
- Two small gaps the review left: a failed Reopen or a failed Undo of Mark done is silent in the comment card.
