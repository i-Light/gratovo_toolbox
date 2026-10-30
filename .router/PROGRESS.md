# Progress

The owner asked for the full prototype on 2026-10-27 (ADR 0021, migration plan step P). It runs now; steps 7 to 9 are built inside it and then wired. On 2026-10-30 the owner asked to finish step P: the parts run one after another, each its own pull request.

## Step P (in progress)

Working plan: [PLAN.md](PLAN.md). Gap list and conflicts: [GAPS.md](GAPS.md).

| Part | What | State |
|---|---|---|
| plan | ADR 0021, the plan change, this working plan, the gap map of v6 against the app | **Done** 2026-10-27, branch `feat/full-prototype` |
| P8a | Insights without deals and money, with its example history; live on real data | **Done** 2026-10-29 (ADR 0022). Owner split P8 in two on 2026-10-28: P8a first, then P1, then P8b |
| P1 | Foundations | **In progress** 2026-10-30, branch `feat/p1-foundations`. P1-0 (contracts) done; P1-1, P1-2, P1-4, P1-5, P1-6 building; then P1-3 (the seed), P1-7 (review, PR) |
| P8b | Insights' deals and money (Money, Funnel › Brands, the deal and money parts of Overview and Goal) | **After P1** |
| P2 to P7, P9, P10 | See PLAN.md | Not started |

Owner answers so far are in ADR 0021 D6. Still to put to the owner when their part starts: the creator record's tab names beyond Overview, Emails, Deals, Notes and Activity (proposed: Channel, Videos, Sponsors, Contacts, Audience), checked in prototype mode after P2.

## P8a (done 2026-10-29, ADR 0022)

All tasks A0 to A14 done on `feat/insights-p8a`. Live: Overview, Funnel, Emails, Search, Goal (owner, 2026-10-28); Money hidden.
Left for later, small: the Search › Archive box opens Toolbox › Archive without the typed words; a keyword's last run can't count channels already live (the pipeline doesn't record it); prototype mode takes about 8 s to open with the history.
Told to the owner: the example's archive days are 90; emailed is 1,150 in the example, not 1,202 (the mockup's targets can't all hold at once); the backlog's days are its size at your review pace; the biggest drop starts at Confirmed.

## Carried into step P from steps 7 and 8

- Step 8 part 1 (Signing) is done ([ADR 0020](../docs/decisions/0020-signing.md)). Parts 2 and 3 are P5 and P6. The full Close flow suite runs in P10; part 1 has one smoke test (`e2e/close-roster.spec.ts`).
- Step 7 part 2 (prototype mode) is done ([ADR 0019](../docs/decisions/0019-prototype-mode-built.md)). Part 1 (Today) is P4. Part 3 (branch protection) isn't available on the free plan for a private repository; `pnpm verify --status` is the gate.
- Today's "Check X's audience" bucket and the problems bar's feed come with Today (P4).
- The record's buttons carry their `data-ui` ids on an inner span: `Btn` (`packages/ui`) doesn't pass `data-ui` through. Fix it in P2.
- Two small gaps the prototype-mode review left: a failed Reopen or a failed Undo of Mark done is silent in the comment card.
