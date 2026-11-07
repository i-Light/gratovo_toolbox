# Progress

Step S (the scraping upgrade) is done: see [ADR 0023](../docs/decisions/0023-scraping-upgrade.md). Step P resumed at P3 on 2026-11-07.

The owner asked for the full prototype on 2026-10-27 (ADR 0021, migration plan step P). It runs now; steps 7 to 9 are built inside it and then wired. On 2026-10-30 the owner asked to finish step P: the parts run one after another, each its own pull request.

## Step P (in progress)

Working plan: [PLAN.md](PLAN.md). Gap list and conflicts: [GAPS.md](GAPS.md).

| Part | What | State |
|---|---|---|
| plan | ADR 0021, the plan change, this working plan, the gap map of v6 against the app | **Done** 2026-10-27, branch `feat/full-prototype` |
| P8a | Insights without deals and money, with its example history; live on real data | **Done** 2026-10-29 (ADR 0022). Owner split P8 in two on 2026-10-28: P8a first, then P1, then P8b |
| P1 | Foundations | **Done** 2026-10-30, merged as #40 (PLAN.md "P1: foundations", decisions F1-F10). Left for P2: the plain example copy (signed out) has no pipeline rows, so a creator record there shows little beyond the summary |
| P8b | Insights' deals and money (Money, Funnel › Brands, the deal and money parts of Overview and Goal) | **Done** 2026-10-30, branch `feat/insights-p8b` (PLAN.md "P8b", decisions B1-B9; ADR 0022 addendum). Money stays behind the live gate until step 9 |
| P2 | Records: the creator record's ten tabs and stage-aware Overview, the brand record, the deal record frame | **Done** 2026-10-30, branch `feat/records-p2` (PLAN.md "P2", decisions R1-R10). R10's pipeline rows for the plain example copy moved to P10 |
| P3 | Find, Reach and frame additions | **Done** 2026-11-07, branch `feat/p3-find-reach-frame` (PLAN.md "P3", decisions X1-X12). Brands on the Reach board, brand replies and the Sequences Creators/Brands switch moved to P5 (X1); the board's Everyone/Mine switch to P9 (X2). The owner chose to build the draft dock, opened only by a toast's Open button (X11) |
| P4 | Today | **Done** 2026-11-07, branch `feat/p4-today` (PLAN.md "P4", decisions T1-T13). Today is live with the buckets that have real data; money, deal and brand items show in prototype mode only (`today.deals`). Left out: "Send all" follow-ups (owner); the stalled-reply nudge and the 14-day warmth pulse (P5); Mine/Team, team load and Hand off (P9) |
| P5 | Close: Brands, Match, Pitch, roster columns, media kit packet; plus the stalled-reply nudge and the warmth pulse (P4's T3) | **Next** |
| P6, P7, P9, P10 | See PLAN.md | Not started |

**Fixed in P4 (2026-11-07):** the Reach board and Sequences were empty in prototype mode because the frame keeps at most 5,000 creators and the history's 10,200 rejected ones filled every place. Rejected and never-contact creators who never wrote back are now the first left out (`creator-reads.ts`); this also helps live, which has about 15,400 channel rows. Still open: in prototype mode Review new is empty (the history leaves nothing new), so Today has no "new channels" item there; an example search fills it.

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
