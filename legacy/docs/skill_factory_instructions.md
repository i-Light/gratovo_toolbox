# Skill factory: standing instructions

These are the factory's own instructions. They are **not a skill** and never go into a drafting
prompt. Whoever runs the factory follows them, whether that is Claude Code driving Gemini through
the bridge or a later in-app job. Attach this file, or the section for the current step, to every
factory prompt.

The factory turns the knowledge base (KB) into skills. For outreach, a skill is **knobs → cards →
rules**: a few knob values describe the situation, and they pick the cards. Only those cards' draft
rules reach the writer. Background and reasons are in `course_knowledge_base_usage_plan.md`, in the
section "The skill factory". The reference implementation is the sandbox in
`E:\IMA work\Sandbox\kb-session\` (`notebook-export/`, `bridge/`, `factory/`).

There are two ways to run it:

| Mode | Use it when | What it reads | Risk it guards against |
|---|---|---|---|
| **Update** | after every capture run (new calls, new lessons, new own emails) | only what is new or changed since the last run | slow drift: rewording rules that were fine |
| **Relearn** | the way the KB is read has changed (see §6) | the whole KB, from scratch | rules lost or blurred by a full rebuild |

---

## 1. Sources of truth

1. **Allowed sources.** The course pages, the call transcripts, the course PDFs, and the owner's own
   emails (`my-emails/`, `.md` or `.txt`). Nothing else.
2. **Forbidden source.** `data/gemini skills/email drafter skill.md` and its rules JSON are **not a
   source, not a base and not a reference**. Never read them, quote them, diff against them or
   "keep what was good" from them (owner decision S1).
3. **Gemini's words are leads, never evidence.** Every quote Gemini returns is looked up in the raw
   KB (`kb.locate`). Only a quote found there (`exact`, or `close` per P4) counts as evidence. A
   quote that is not found is dropped, not reworded.
4. **Who said it** comes from the transcript, not from Gemini's citation. Coach labels carry
   `(Imaccelerator)`. Abu Numaan counts as a coach (P7). Fathom often files a coach's reply under the
   student's label, so any quote sitting in a student turn goes through `attribution.py`. There, a
   `coach` verdict counts as coach, a `student` verdict is not doctrine, and an `unclear` verdict is
   not used as evidence (P5).
5. **The owner's decisions** live in the page's db (`decisions/<id>`) and are exported to
   `bench/decisions-export/`. Once the app's Skills page takes over (plan, slice 2), they live in
   `data/gemini skills/outreach/decisions.json`, and verdicts live in the Email Critique Library
   (slice 3). Either way, the factory reads them and **never changes them**.

## 2. Invariants: no run may break these

- **Evidence.** Every rule has at least one verified evidence fragment, unless it is marked `yours`
  (the owner's own words) or `house` (the owner writes the rule text).
- **The owner's text is frozen.** `yours` and `house` rules are never reworded or merged, and never
  retired by the factory.
- **Stable ids.** Every card, rule and decision has a stable id. A rule is never deleted. It is
  *retired*, with a reason and the evidence that replaced it. Decisions and bench verdicts point at
  ids, so ids must survive both modes.
  - Rule ids are issued once and kept in `factory/rule_ids.json` (`factory/appio.py`), keyed by the
    card and the rule's source text (or `house:<decision>`). The first id is `<card>.<slug>` of the
    live text; it never changes after that. Rewording a rule in `content.py` would mint a new id, which
    is why Update never rewords and Relearn maps findings onto the old keys.

**Publishing to the app** is `python factory/export_app.py`. It writes, atomically, into
`data/gemini skills/outreach/`: `cards.json` (live draft rules with ids, evidence and lint checks),
`inbox.json` (open decisions), `changelog.json` and `bench/latest.json`. It writes the same
`cards.json`, the bench cases and their prompts into `pipeline/tests/fixtures/outreach_cards/` for the
daemon's golden-prompt test. Rules the owner switched off in the app stay in `cards.json` with
`"off": true` (so the switch can turn them back on) and never reach a prompt. The owner's own rules
come in from `decisions.json` (`myRules`). `bench.py --goldens` re-lints the drafts the owner rated
good; drafts rated bad that carry their knobs and facts become bench cases.
- **Rules are ideas, not lines.** Rule text says *what to do*, never a sentence the writer could
  paste. The first bench run showed rule wording leaking into drafts ("until results arrive",
  "clearly convert"). Evidence quotes stay on the page and never go into the drafting prompt.
- **Read the context, not the fragment.** Before a quote supports a rule or a decision option,
  read its turn and the turns around it (`locate()` returns them). A fragment can say the opposite
  of its turn. The first CTA rules came from "don't ask them, are you open, are you interested".
  The turn around it means "ask a stronger yes/no question", not "ask no question". That misread
  produced decision D8 and 8 bad drafts out of 10 (2026-10-01).
- **Scope.** Each rule has a `use`: `draft`, `research`, `checker` or `ops`. Only `draft` rules
  reach the writer. A rule-level `when` narrows a rule inside its card.
- **Slots.** A card changes only the email slots its knob owns (subject, opener, offer, proof, CTA,
  length). A finding that would change another slot belongs on another card.
- **No stamps.** Rules never prescribe fixed wording, structure or flow. Every email is different
  (owner rule D16). Banned words are never used.
- **Disagreement is shown, not resolved.** If policy does not settle a contradiction (§5), it goes
  to the decision inbox.

## 3. The state file

`factory/state.json` records what the skills were learned from:

```json
{
  "cards_version": 7,
  "last_update": "2026-10-01T19:27",
  "last_relearn": null,
  "consumed": {
    "call:<fathom id>":         {"hash": "sha256…", "run": "u-2026-10-08"},
    "lesson:<module>/<title>":  {"hash": "sha256…", "run": "r-2026-10-01"},
    "pdf:The_Cold_Email_Blueprint": {"hash": "sha256…", "run": "r-2026-10-01"},
    "mine:<file name>":         {"hash": "sha256…", "run": "u-2026-10-08"}
  },
  "rules_touched_since_relearn": 0
}
```

A source unit is one call, one lesson page, one PDF or one own-email file. That is the same unit
the export manifest uses. *Not built yet:* the first Relearn run writes this file.

---

## 4. Mode 1: Update (new content only)

The aim is to add what the new material teaches and leave everything else exactly as it is. The
existing cards are not regenerated, summarized or "tidied". The only operations allowed are to
**add evidence**, **add a rule**, **retire a rule under policy**, and **open a decision**.

```
 capture run ──► export.py (manifest: NEW / CHANGED / REMOVED)
                    │
                    ├─► re-upload only the changed notebook sources        (for later questions)
                    │
                    ▼
            delta = source units whose hash ≠ state.json
                    │
   ┌────────────────┴─────────────────┐
   ▼                                  ▼
 calls / lessons / PDFs            my-emails/
 4.2 extract (raw text + index)    4.6 examples, not rules
   ▼
 4.3 verify quotes + attribution
   ▼
 4.4 route each finding ──► add evidence · new rule · evolution · decision · nothing
   ▼
 4.5 gates: evidence · bench ──► promote → cards_version+1, state.json, changelog
```

### 4.1 Find the delta
1. Run `export.py`. Its manifest marks each output file NEW, CHANGED, unchanged or REMOVED.
2. Hash each source unit. The delta is every unit whose hash is not in `state.json` or differs from
   it.
3. A **removed** unit does not remove a rule by itself. Rules whose only evidence was in that unit
   get the status `evidence-gone` and are listed for the owner.
4. If the delta is empty, stop. Nothing else runs.

### 4.2 Extract from the raw new text, not from the notebook
A delta is small: a week of calls is a few tens of thousands of words. Send it **raw** to Gemini
(plain chat, `gemini_pool.run_prompts`, parallel tabs). Notebook retrieval only sees passages, so
it can miss things; the raw text can't.

- Split long calls on turn boundaries into pieces of 40k words or less. Keep the call tag
  (`[CALL: title | date]`) at the top of each piece.
- With every piece, send the **card index**: each card's id, title and `when`, plus its draft rules
  as `id: text`, with no evidence. It is about 15 KB. That index is how Gemini can say
  "this confirms rule X" instead of inventing a near-duplicate.
- The prompt asks for findings only. It does not ask for a summary:

```
You read a coaching-call transcript from an influencer-marketing course. Below it is the current
rule index for OUTREACH skills. List every statement in the transcript that teaches something about
writing outreach emails or messages (to creators, their managers, or brands), including replies and
follow-ups.

For each one return:
  quote      the exact words from the transcript (copy, never paraphrase), 8–60 words
  speaker    the label on that turn, as written
  at         the @mm:ss marker of that turn
  kind       confirms | contradicts | refines | new_rule | new_situation
  rule_id    for confirms / contradicts / refines: the rule it touches
  card_id    for new_rule: the card it belongs on (or "none fits")
  knobs      the situation it applies to, as knob=value pairs from the index (empty = always)
  idea       for new_rule / refines: the rule as an instruction, in your own words, never a
             sentence to paste into an email

Skip small talk, student questions without a coach answer, and anything not about outreach.
Reply with ONLY a JSON array.
```

Do the same for new or changed lesson pages and PDFs. Run the same prompt per workflow (e.g. the
negotiation index) when that workflow has cards.

### 4.3 Verify
For every finding:
1. Look up the quote with `kb.locate()`. A finding with no match is **dropped** and logged.
2. Take the speaker and role from the transcript, never from Gemini.
3. If the quote sits in a student turn, run `attribution.py` (P5). A `student` or `unclear` verdict
   means the finding is not doctrine. Log it and keep it out of the cards.

### 4.4 Route each surviving finding

| kind | What the factory does | Owner sees |
|---|---|---|
| `confirms` | append the quote to that rule's evidence; the rule text does not change | count in the changelog |
| `new_rule` with a fitting card | add the rule, status `new`, `use` and `when` from the finding. One coach quote is enough (P3) | listed under "New rules"; one click turns it off |
| `new_rule`, no card fits | open a `gap` decision (P6: when the KB is silent on placement, ask) | inbox |
| `new_situation` | open a `gap` decision proposing a knob value or a card | inbox |
| `refines` | **never auto-applied**: a rewording drifts. Open an `evolution` decision showing old text, proposed idea and evidence | inbox |
| `contradicts` | apply the policies in §5 | auto-applied, or inbox |

A finding that touches a `yours` or `house` rule is always shown to the owner as information. It
never changes that rule.

### 4.5 Gates, then promote
1. **Evidence gate.** Every new or changed rule has at least one verified coach fragment.
2. **Bench gate.** Run `bench.py` on the standing cases plus the goldens (§7), but **only for knob
   combinations whose loaded cards changed**. Promote if there is no new lint flag, the judge
   average does not drop more than 0.5, there are no new repeat hits, and no golden fails. If the
   gate fails, the new rules stay `new` and off, and the failure goes in the changelog.
3. **Promote.** `cards_version + 1`. Write `state.json` (mark the delta consumed and add the number
   of rules touched to `rules_touched_since_relearn`). Write a changelog entry, rebuild the page,
   republish it.

### 4.6 The owner's own emails (`my-emails/`)
New files become **examples**, not rules. Each one is tagged with the knob values it fits (Gemini
proposes them, the owner can correct them on the page). It is stored as `source: mine`. Examples go
into a prompt only as "shape and length, never wording", and only when the bench shows that they
help. On the first run the PDF examples did not help (§7).

---

## 5. Policies when sources disagree (owner's choices, 2026-10-01)

| | Situation | Rule |
|---|---|---|
| P1 | the same coach contradicts himself over time | the newer one wins **only** if both dates are known and it is at least a year newer. Then the old rule is retired with a link to the new one. Otherwise: an `evolution` decision |
| P2 | a lesson page against a call | the call wins (newer and live). Shown in the changelog |
| P3 | how much evidence a rule needs | one verified coach quote |
| P4 | a reworded quote | a `close` match counts as evidence |
| P5 | a quote in a student turn | automated attribution; only `coach` counts |
| P6 | the KB is silent | ask the owner (`gap` decision) |
| P7 | Abu Numaan | a coach |
| — | two coaches disagree in the same situation | a `conflict` decision. Never pick one silently |

If the owner changes a policy, that is a reason to Relearn (§6).

---

## 6. Mode 2: Relearn (the whole KB, without losing quality)

A full rebuild is where quality gets lost: a rule that was found once does not get found again, a
sharp rule gets summarized into a vague one, or a decision falls off because its rule changed. The
fix is to **build in the shadow and treat the current cards as a floor**.

Relearn when any of these is true. Otherwise use Update.
- `topics.json`, the export format or the notebook layout changed.
- A new knob axis or a new workflow was added.
- A policy (P1–P7) changed, the coach list changed, or attribution changed.
- `rules_touched_since_relearn` is at least 25% of all rules.
- It has been about three months since the last Relearn.

```
 freeze vN ──► re-export everything ──► discovery (3 passes) ──► verify ──► match to vN ids
                                                                              │
     promote card by card ◄── owner reads diff ◄── bench vN vs vN+1 ◄─────────┘
     (vN kept for rollback)
```

### 6.1 Freeze
Copy the current cards, decisions, verdicts and `state.json` to `factory/versions/vN/`. Everything
else is built in `factory/next/`. **Live cards are untouched until promotion.**

### 6.2 Re-export and clear caches
Run `export.py` from scratch, re-upload the whole notebook, then delete `cache/evidence.json` and
`cache/attribution.json`. A new export can move text, so every lookup is redone.

### 6.3 Discovery: three passes, so coverage never depends on how a question is phrased
1. **The question bank.** Run every round in `bridge/questions/*.json` through the notebook
   (parallel tabs). The bank is versioned and only grows. Rounds are never deleted, only added.
2. **The sweep.** For each notebook source (each topic bundle part, each curriculum module, each
   PDF), run the §4.2 extraction prompt over the raw file in pieces of 40k words or less. This is
   the pass that catches what no question asked about.
3. **The floor check.** For each live rule in vN, ask Gemini to find support for it and to find
   contradictions of it, giving the rule text and the old evidence. A rule that is not found again
   is **never dropped silently** (§6.5).

### 6.4 Verify
Verify exactly as in §4.3: every quote through `locate()`, every student-turn quote through
attribution.

### 6.5 Match findings to vN ids
Decisions and verdicts only carry over if ids carry over, so match before building:
1. **Shared evidence.** If a finding's quote overlaps a vN rule's evidence (same call, overlapping
   text), it is the same rule.
2. **Same card, same idea.** If that doesn't settle it, Gemini judges "same instruction?" between
   the finding's idea and vN rule texts on the same card.
3. Otherwise the finding is a new rule.

Then classify every vN rule:

| status in vN+1 | Meaning | What happens |
|---|---|---|
| kept | found again, same text | carried over with its id, decisions and verdicts |
| kept, more evidence | found again with new quotes | text unchanged, evidence added |
| reworded | a better phrasing was proposed | **vN text stays**; the rewording is an `evolution` decision |
| not found again | none of the 3 passes re-found it | keeps its vN evidence (re-verified); flagged for the owner. Retired only if that evidence is gone from the KB too |
| contradicted | newer evidence disagrees | policies in §5 |
| new | no match | added, status `new` |

`yours` and `house` rules and every owner decision carry over unchanged. A decision whose options
now have different evidence is flagged `re-check`. The **old choice stays active** until the owner
looks at it.

### 6.6 Bench both versions on the same cases
Run vN and vN+1 on the standing cases plus every golden (§7). The judge runs twice per draft; if a
draft's two scores differ by more than 2, the draft counts as unstable and stays out of the gate.
Per card, vN+1 must:
- add no lint flags;
- keep the judge average at least vN − 0.3;
- add no repeat hits;
- not newly fail any golden.

### 6.7 The owner reads the diff
The page shows a Relearn report: for every card, kept / more evidence / new / reworded / not found
again / contradicted, plus that card's bench result vN against vN+1. The owner approves it per card.

### 6.8 Promote card by card
Cards that passed the gate and were approved switch to vN+1. Any other card stays at vN. Write the
new `state.json` with `last_relearn` set and `rules_touched_since_relearn` reset to 0. vN stays in
`versions/` for rollback. Rolling back is copying one card file back.

---

## 7. The bench and goldens

- **Standing cases** (`bench/cases.json`) are real creators from the app's database. Each case is a
  knob combination plus facts. Every knob combination that a card's `when` can produce needs at
  least one case. Add cases when knobs or cards are added.
- **Goldens.** Every draft the owner marks **good** on the page (`verdicts/<id>`) becomes a golden:
  later versions must still pass the same case. Every draft marked **bad**, with its note, becomes
  a regression case: the note names the failure, and later drafts must not repeat it.
- **Checks.**
  - **lint.** Regex rules only, no AI. Every lint rule names the card rule or decision it enforces.
  - **judge.** Gemini grades against the exact rules the writer had, in Ammar's roast order.
  - **repeat test.** Flags a 6-word run or an identical opener shared across drafts.
- **First run (2026-10-01), for calibration:**
  - Most CTAs asked the reader to do work (rates, screenshots, media kit, times): 8 of 10. That is
    the "assume interest" CTA (D8=B) applied too literally.
  - Rule wording leaked into drafts.
  - Variant B, with the PDF examples, scored lower than A (7.0 against 7.6) and pulled drafts
    toward the "Noticed…" opener that D10 bans.
  - The lint missed openers with no subject ("Saw…") until it was fixed.
- **Second run, same day:** the CTA rules were rebuilt from the course (see the plan, "CTA fix")
  and the lint now checks the CTA. Results are in the plan.
- **Tabs.** A Gemini tab that times out ("waiting for new chat") stays stuck. `gemini_pool` now
  hands that tab's job to another tab and retires it. Always run with one tab more than you need.

## 8. Logs every run writes

| File | What it holds |
|---|---|
| `factory/runs/<run id>.json` | mode, delta or full, findings in and out (dropped and why), rules added / retired / opened as decisions, gate results |
| `factory/changelog.md` | one short entry per promoted run, in plain words: "Added 2 rules to *Their sponsors: none*, from Ammar, 2026-10-08 RME" |
| `ledger.json` | every quote ever checked. Rows are never deleted; a re-check can turn "not found" into "found" |
| the factory page | a "What changed" view built from the changelog; the inbox shows anything new to decide |

## 9. Checklist

**Update:** export → delta → (if empty, stop) → raw extraction with the card index → locate +
attribution → route → evidence gate → bench on the changed combinations → promote → state,
changelog, republish.

**Relearn:** freeze vN → full export, clear caches → question bank + sweep + floor check → locate +
attribution → match to vN ids → bench vN against vN+1 → owner reads the diff → promote card by card
→ state, changelog, republish.

**Never:** read the old drafter skill · reword a rule during Update · touch `yours`/`house` rules
or owner decisions · drop a rule without a reason · use a quote that isn't in the KB · let a
student's line become a rule · put evidence quotes or example wording into a drafting prompt as
text to copy.
