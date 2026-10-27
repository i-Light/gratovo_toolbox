# 0020. Signing: the media kit, the audience check and the roster

- **Date:** 2026-10-27
- **Status:** accepted for step 8, part 1 (Signing). It records the decisions of the step's plan (D1 to D12 in `.router/PLAN.md` while the step ran) as built, with the review's fixes. Brands, pitching, negotiation, contracts and Settings › Agency facts are parts 2 and 3.

## Context

Step 6 stopped the creator loop at reading a reply: its facts (a rate, top countries, an age band) could be saved to the record, but nothing used them. The owner asked for step 8's signing before step 7's Today, with the full scope (the media kit, the audience check, Sign, the roster) and a decline that drafts a kind no through the comms engine. The prototype's Close › Roster and `W.AudienceCheck` are the spec.

## Decision

1. **The rule** (`packages/core/src/close/audience.ts`, `audienceRule`): four checks, each yes, no or not known.
   - The country with the largest share leads the top 3 and is US, GB, CA or AU.
   - The age band lies within 18 to 44.
   - Engagement is 3% or more.
   - A rate is known.

   The verdict is `pass` when all four say yes, `fail` when any says no, and `missing` otherwise. The numbers are constants until Settings › Agency facts (part 3) makes them editable. The pipeline's `readiness.py` (the engine's own pitch readiness) is a different check and is unchanged.
2. **One place for the numbers.** `channel_state.media_kit` (the server's column, the old app's shape) holds what a person types. `provided_data` holds what replies gave. The frame's `Creator.kit` merges them field by field: the typed kit wins, then the reply's fact. Engagement falls back to the old app's `manual_engagement_rate`. `fromReply` marks numbers that come only from emails.

   The merge is defensive, because one bad row must never break the frame. Codes must be two letters (UK reads as GB). Shares and engagement must lie in 0 to 100. A link must be https and at most 2,000 characters. Anything else reads as not known.
3. **The kit write** `creator.kit` goes straight through, as notes do, and is not an undo step. An omitted field keeps the stored value; `null` removes it. It syncs as `channel.edit media_kit` with the stored value as its base. Main drops the rate from the write of a member who doesn't see money, and the frame shows them `rateKnown` without the amount.
4. **replied → kit by itself.** In the same transaction as a `reply.fact` or `creator.kit` write, a `replied` creator with a rate and a country moves to `kit` through the ordinary stage write, with a log line. Both are queued for sync like any other change. Main then tells the page that the creators and the log changed.
5. **Sign** is an act in the page (`kit` or `audience` → `signed`, with a log line and Ctrl Z), offered only when the verdict is `pass`.
6. **Decline kindly** (`close:decline`) runs in main, because the draft lives there. One commit does four things:
   - sets the stage to `rejected` with the reason `audience` (tags and the 7-day archive date follow, as for a Find reject);
   - writes a log line naming the failed checks;
   - skips the creator's open drafts;
   - queues an answer draft with the goal `decline`.

   The drafter sends the comms engine `goal: "decline_audience"` and `failed`, so the email names only the checks that failed. Undo (`close:decline-undo`, one commit) puts the stage back and brings back the skipped drafts, never as approved or scheduled. It skips the decline draft in every state that hasn't started sending, approved and scheduled included, so an Undo can never send the no. A decline already sending or sent is kept, and the toast says so.
7. **Ask for what's missing** (`close:ask`) queues an answer draft with the goal `ask_kit`. The drafter adds `missing`, read from the check at drafting time. It is refused when nothing is missing, when a draft to the creator is already open (add the ask there), or when the creator hasn't written yet. Its Undo skips the draft.
8. **Draft goals:** migration 0006 adds `outreach_drafts.goal` (`decline`, `ask_kit` or null). The kind stays `reply`. On example data each goal has a stand-in text.
9. **Park for 90 days** reuses `reach:park`, which now also takes a `replied`, `kit` or `audience` creator with a sequence in any state. On waking (`wakeStage`):
   - a running sequence goes back to `emailed`, as before;
   - a stopped one goes to `kit` when the kit has a rate and a country;
   - otherwise to `replied` when the creator has written;
   - otherwise to `emailed`.

   A stopped sequence is never re-timed, so waking drafts no follow-up. The day timer also reads parked sequences, and it wakes only a creator whose stage is `parked`.
10. **The engine sees the kit:** `buildCommsFacts` sends `mediaKit` in the old shape. The integration rate is `agreed: true` once the creator is signed.
11. **The live gate:** `liveWired.close = ["roster"]` and the rail's live line reads "Check audiences and sign creators". The Reach board shows all six lanes on live data. The Media kit card shows the verdict and opens the creator's Overview.
12. **Close › Roster** has two parts:
    - "Waiting for an audience check": each kit creator with their verdict and the check one click away.
    - "Signed creators": rate, median views from the Find catalog, and audience.

    The record's Overview has an Audience and rate card: the numbers, the kit link (as text with Copy, because the app opens only YouTube and Gmail links outside), the editor, and the check with its buttons.

## Consequences

- A creator's path now runs Find → Reach → Close › Roster on live data. Parity rows 49 to 60 are mostly built (below).
- The roster's Live deals, Last go-live and Best next brand columns wait for deals and brands (step 8 parts 2 and 3, step 9).
- Today's "Check X's audience" bucket comes with Today (step 7, part 1).
- On example data the record page shows its summary (an earlier choice), so the Audience card is seen on live data. The Roster shows the check on both.

## Known limits

- A creator with no sequence (only old imported mail) can't be parked, as before.
- The kit file is a link, not an uploaded file.
- The decline names the failed checks. The rule's numbers are fixed until Agency facts.

## Parity rows this step answers

Numbers are from `docs/product/parity-checklist.md`. Step 10 ticks the boxes.

- 45 Label the reply: now complete (saving the rate and countries moves the stage to Media kit in).
- 49 Record the media kit and rates: built (facts from the reply, or typed in the kit editor).
- 50 Ask the creator for it: built (Ask for what's missing drafts the request; the reply's answer draft already asks).
- 51 Keep the file they sent: in part (the kit's link, not the file).
- 52 Keep other numbers they sent: built (one Audience and rate card).
- 53 See past rates: in part (the current rate; rate history comes with deals).
- 54 Enter top countries, age band and engagement: built (saved from the reply or typed once).
- 55 Pass or fail with the reasons: built (the four rows).
- 56 Record engagement: built (one field, falling back to the old app's).
- 57 List only creators who pass: built (Sign only on a pass; Decline kindly or Park for 90 days on a fail).
- 58 Mark a creator as signed: built.
- 59 Count signed creators against the target: not built (Insights, step 9).
- 60 Check a signing checklist: built (the audience check is the checklist; no agreement file).
- 107 Offer the same creator to another brand: not built (best next brand needs brands, part 2).
