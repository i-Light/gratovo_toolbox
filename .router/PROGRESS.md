# Progress

The owner asked for the full prototype on 2026-10-27 (ADR 0021, migration plan step P). It runs now; steps 7 to 9 are built inside it and then wired.

## Step P (in progress)

Working plan: [PLAN.md](PLAN.md). Gap list and conflicts: [GAPS.md](GAPS.md).

| Part | What | State |
|---|---|---|
| plan | ADR 0021, the plan change, this working plan, the gap map of v6 against the app | **Done** 2026-10-27, branch `feat/full-prototype` |
| P8a | Insights without deals and money, with its example history; Search live | **In progress** 2026-10-28, branch `feat/insights-p8a`. Owner split P8 in two the same day: P8a first, then P1, then P8b. Tasks in PLAN.md § P8a; state below |
| P1 | Foundations | **After P8a.** Start with P1-0 (the contracts, Tier H) and write them into PLAN.md before building |
| P8b | Insights' deals and money (Money, Funnel › Brands, the deal and money parts of Overview and Goal) | **After P1** |
| P2 to P7, P9, P10 | See PLAN.md | Not started |

Owner answers so far are in ADR 0021 D6. Still to put to the owner when their part starts: the creator record's tab names beyond Overview, Emails, Deals, Notes and Activity (proposed: Channel, Videos, Sponsors, Contacts, Audience), checked in prototype mode after P2.

## P8a task state

Done and committed: A0 contracts, A1 migration 0007 + weekly totals (the data source has an `insights` store), A2 stats and readings, A3 funnel/emails/search, A4 goal/alerts/overview/report (162 core tests), A5 the example history (about 0.7 s), A9 the screen base, A10 the charts.
Running: A6+A7 (the Python `example.load` job and loading the history when prototype mode opens), A8 (main's reader, service and the four channels; the lead wires `main/index.ts` after A7).
Next: A11 tabs Overview, Funnel, Emails; A12 Search and Goal; A13 the live gate (owner, 2026-10-28: all real-data tabs live, Money hidden) and the smoke test; A14 review, docs, verify, PR.
Builder's calls to tell the owner: the example's archive days are 90 (A8 in PLAN.md); emailed is 1,150 in the example, not 1,202 (the mockup's targets can't all hold at once); the backlog's days are its size at your review pace.

## Carried into step P from steps 7 and 8

- Step 8 part 1 (Signing) is done ([ADR 0020](../docs/decisions/0020-signing.md)). Parts 2 and 3 are P5 and P6. The full Close flow suite runs in P10; part 1 has one smoke test (`e2e/close-roster.spec.ts`).
- Step 7 part 2 (prototype mode) is done ([ADR 0019](../docs/decisions/0019-prototype-mode-built.md)). Part 1 (Today) is P4. Part 3 (branch protection) isn't available on the free plan for a private repository; `pnpm verify --status` is the gate.
- Today's "Check X's audience" bucket and the problems bar's feed come with Today (P4).
- The record's buttons carry their `data-ui` ids on an inner span: `Btn` (`packages/ui`) doesn't pass `data-ui` through. Fix it in P2.
- Two small gaps the prototype-mode review left: a failed Reopen or a failed Undo of Mark done is silent in the comment card.
