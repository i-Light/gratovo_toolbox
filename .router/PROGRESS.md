# Progress

The owner asked for step 8 part 1 (Signing) before step 7 part 1 (2026-10-27). It is done; what comes next is the owner's call (step 7 part 1, Today, is the plan's order; step 8 part 2, brands and pitching, continues Close).

## Step 8 (in progress)

| Part | What | State |
|---|---|---|
| 1 | Signing: the media kit, the audience check, Sign, Decline kindly, Park, Ask, Close › Roster | **Done** 2026-10-27, branch `feat/8-signing`. Decisions as built: [ADR 0020](../docs/decisions/0020-signing.md). Its working plan and recon were removed when it ended; they are in the git history of that branch |
| 2 | Brands and pitching | Not started |
| 3 | Negotiation, contracts, Toolbox › Calculator, Settings › Agency facts (the audience rule's numbers become editable here) | Not started |

Left from part 1:
- Today's "Check X's audience" bucket comes with Today (step 7 part 1).
- The full Close flow suite runs at the end of step 8; part 1 has one smoke test (`e2e/close-roster.spec.ts`).
- The record's buttons carry their `data-ui` ids on an inner span: `Btn` (`packages/ui`) doesn't pass `data-ui` through.

## Step 7 (paused)

| Part | What | State |
|---|---|---|
| 2 | Prototype mode and the comment tool | **Done** 2026-10-27, branch `feat/7-prototype-mode`. Decisions as built: [ADR 0019](../docs/decisions/0019-prototype-mode-built.md) |
| 1 | Today: the next-action engine, the queue, the day band, Settings › Your day | Not started. Start a fresh plan from the plan's step 7 item 1. Its audience bucket now has signing behind it |
| 3 | Branch protection | After part 1. Branch protection isn't available on the free plan for a private repository (docs/workflow.md); `pnpm verify --status` is the gate |

Left for part 1 or the end of step 7, from part 2:
- The problems bar has no feed yet (part of Today's work); the "Something broke" scenario shows its problems through notifications, Reach's Gemini banner and the signed-out mailbox.
- The full prototype flow suite (`proto_flow.py`, `review_fixes.py` as Playwright tests) runs at the end of step 7.
- Two small gaps the review left: a failed Reopen or a failed Undo of Mark done is silent in the comment card.
