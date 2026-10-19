# Outreach Intelligence System: audit of the outreach-model notes + the design

2026-10-02. Input: [mini AI model thoughts about creating outreach intelligence system.md](mini%20AI%20model%20thoughts%20about%20creating%20outreach%20intelligence%20system.md).
Checked against:
- the curriculum: lesson 1.2 *How to Write a Cold Email*, 1.2 *Learn how to Communicate*, 2 *How to Message Influencers* (Ammar), 2.6 *Common Mistakes When Messaging Influencers*;
- *The Cold Email Blueprint*;
- *Cold Email Sauce and Check List*;
- the live cards (`data/gemini skills/outreach/cards.json`), the live prompt the daemon builds (`outreach_cards.sequence_prompt`), and the 10 bench drafts in `outreach/bench/latest.json`.

---

## 1. The short version

The outreach model's main claim is wrong for this system. It says quality is lost because expert knowledge gets **compressed**, and that the cure is draft-time retrieval: File Search, long context, a retrieval judge and fine-tuning. The evidence says otherwise:

- The live prompt is **~1,100 words** and already holds the right course rules.
- The bad drafts break rules that are **in that prompt**.
- The factory already keeps the sources lossless, with verified quotes behind every rule.

The failures come from **how the prompt asks**, **how many jobs one call does**, and **an evaluator that can't see the failures**. They don't come from missing knowledge.

So most of its architecture is discarded. A few of its ideas are right and already half-built: situation-first classification, rules that carry conditions, the same doctrine for the writer and the critic, and an outcome loop. Those are kept and finished below.

---

## 2. What the bench drafts actually got wrong

All 10 bench drafts passed lint, and the judge scored most of them 8–10. Read against the course, they fail like this:

| Draft | Line | Course rule it breaks |
|---|---|---|
| c1-A (judge **10**) | "Can I send over an outline of how we would work together?" | Asking permission. Blueprint ch.2: "Is it okay if I send you details?" is the weak form. Ammar: offer to send only what really exists |
| c1-A | "I want to pitch your channel to…" | Starts with what *you* want. Blueprint 8.3: "Start with what THEY get" |
| c1-A | "…was brutal." | An opinion or compliment on their content. Sauce: "No personalisation by complimenting" |
| c1-A | "we fill that gap" | The card's own words ("you fill that") pasted into the email |
| c2-A | "Prioritizing your own shop makes sense, but adding select outside brands…" | Sauce: "suggesting an offer framed as an improvement sounds like a criticism" |
| c2-A/B | "Creator A and Creator B" | Placeholders shipped |
| c4-B | "Hi Name," | Placeholder shipped |
| c4-A | "aligns perfectly with the shift toward self-hosted AI" | LinkedIn vocabulary. Lesson 1.2: "4th grade reading level… skip corporate phrasing" |
| c4-A | "You only pay once the results are in" | Pasted rule text (the judge caught this one) |
| c5-A/B | "We do not have a signed partner just yet. We are currently in talks with several…" | Confesses (the card says don't) and then over-explains. Sauce: "The more you explain, the less power you have" |

Four of the ten drafts were judged as copying rule wording. **None** were judged for asking permission, starting with what you want, criticism framed as improvement, or placeholders. The checks that should catch these don't exist.

---

## 3. Audit of the notes

### KEEP (valid, and in line with the course)

| Idea from the notes | Why it stands | Status here |
|---|---|---|
| Never replace the sources with a summary; summaries are only a map | The factory already does this: every rule cites a verbatim, verified quote | Done (ledger + evidence) |
| Classify the situation **before** choosing any rules | The course splits by reader, stage and what you have. Most "conflicts" go away once the situation is known (situation map §1) | Done as knobs. **Prefill needs a sanity check** (gap G5) |
| A rule carries its conditions and exceptions ("don't ask for a call" really means "…unless") | The real case is X3: a call is fine for small brands and brands new to influencer marketing. "Never mention money" doesn't hold in a live deal with a budget | Done as `when` / `dec` |
| Keep coach disagreements, don't flatten them | House choices and the decision inbox | Done |
| The writer and the critic use the **same** doctrine | The judge today grades against the writer's rule list, not the course's roast criteria (gap G4) | **Not done**. The biggest gap |
| Outcome feedback: send → reply/no reply → knowledge update | Blueprint: "Track what works. Double down on winners." It expects a 10–20% reply rate from good emails | Not built |
| Benchmark before scaling | Bench exists | Done. Its judge needs fixing |
| Keep the coach's *reasoning*, not just the rule | Fixes weak-model drift: a rule with its reason generalises, a bare ban gets lawyered around | Partly. Rules have evidence but no one-line **why** |

### DISCARD

| Idea from the notes | Why it goes |
|---|---|
| **The diagnosis itself** ("the problem is the compression step") | The prompt is short and correct, yet the drafts break it. See §2 |
| Retrieve raw transcripts or 20 roast calls **at draft time** (File Search, long context, progressive retrieval) | Roast calls are full of **student** emails (bad ones) and coach phrasings. Pouring them into the writer brings both into the draft. The course says copied phrasing lands in spam (Sauce, Blueprint 8.4), and the owner's rule D16 bans stamps. Retrieval belongs at **build time** (the factory), not draft time |
| "12 good + 8 bad example emails" in every prompt | Measured: the bench scored 7.6 with cards only and 7.0 with PDF examples added. Examples get mimicked. They go to the **critic** as fail patterns, never to the writer |
| A "retrieval judge" model, and a writer that "explains what it retrieved before writing" | More text and more steps for a weak model inside the consumer Gemini UI. **Code** decides which cards load (the knob preview already shows this). The model never decides what applies |
| "Why did you write this sentence?" as a feature | The model would invent the justification, the same way it invented "Roast #37, 21:14–22:06" in its own example. Explanation comes from the card ids that loaded, not from the model |
| Its example coach quote and atom ("Roast #37…") | **Made up.** No such source exists. Any quote from a model counts only after `ledger.py` finds it verbatim |
| The pattern "observation → implication → offer" as a required bridge | It produces forced links. Sauce: "Don't link the personalisation to the offer with forced links ('Speaking of…')". The course keeps the parts separate: personalization proves homework, then the offer states the fit |
| Metadata `tone: peer`, `objective: reply`, `cta: next_step` | These aren't situations, they're constants. Tone is always peer. The first email always aims for a reply. The CTA is always one yes/no question. Making them variables invites "other" values |
| `proof_level` / `RELATIONSHIP` and an "influencer deal sourcing" offer | SDR framing. The course axis is **what I have** (nothing · roster · brand in hand · deal + budget), and each value has its own honest offer (§5.3). "Proof level: limited" pushes the model to invent proof |
| "Should I send the brief?" as a default CTA | Only when a brief exists. Ammar: "Avoid 'Should I send more details?' unless you actually have details ready to send" |
| Fine-tuning | No volume of graded drafts yet, and the doctrine still changes week to week. Revisit only after several hundred owner verdicts |
| Vendor capacity claims (File Search store sizes, NotebookLM limits) | Not verified, and they don't affect email quality |

### FIX (right idea, wrong form)

| Idea | Fixed form |
|---|---|
| "Knowledge atom" with 15 fields | Keep today's rule schema and add 3 fields: `why` (one line, from the course), `fail` (a short real bad line) and `check` (how to test it). `fail` goes **only to the critic and lint**, never to the writer |
| "Roast the draft using the same knowledge base" | The critic gets a **binary checklist** built from the course's own checklists (§5.5), not a 1–10 score against the writer's rules |
| "Level 1 classification" by a model | Code prefills the knobs from facts. Then a **contradiction check** flags facts that disagree with a knob, and the owner confirms (G5) |

---

## 4. Why the model didn't follow instructions

Each gap below shows up in the live prompt, the cards or the bench output, and each has a cure in §5.

**G1. One call does four jobs.** A first email always comes back with three follow-ups (`sequence=True` by default). The model holds four stages' rules at once, and rules bleed between emails. Every email gets the same 50–70-word limit, so follow-ups are as long as email 1. Cure: **one email per call** (§5.1).

**G2. The prompt contradicts itself.** Three cases:
- "Never a soft or opinion ask…" is in the **every email** block. Two sections later: "Follow-ups may use a softer ask." The lint scopes this rule to the first email, but the prompt doesn't.
- "Different words, a different **structure** and a different **flow** for every email" (D16) clashes with Ammar's "Every influencer email follows exactly four parts in the same order… get the order wrong and the email falls apart."
- "The offer comes from the pain you found" loads even when the facts hold no pain, so the model has to make one up.

A weak model resolves contradictions at random. Cure: scope every rule to the email it governs, and turn D16 into **vary the words and the detail, never the part order** (decision Q1, §7).

**G3. Rules are written in email words, so they get pasted.** "you fill that", "how we'd work together", "closing soon" and "pay once the results are in" all went straight into drafts. A line that already reads like an email gets used as one. Cure: write rules as **conditions on the email** ("the yes/no question offers only something you hold"), not as sentences the email could contain. Keep quoted phrases (banned lists, bad CTAs) **out of the writer prompt**. They belong in lint, with the repair loop to catch them (G6). The only exception is a short list of openers, which the writer does need to see.

**G4. The evaluator is blind.** The judge is Gemini grading Gemini, 1–10, against the rule list the writer saw. It gave 10/10 to c1-A, which has a permission CTA, a want-first sentence and a compliment. If the yardstick can't see a failure, the bench can't drive improvement. Cure: §5.5.

**G5. Wrong situation in, wrong rules out.** The c1 facts say the channel "sells his own online program", but the knob was `state = unsponsored`. So the *sells own product* card (opener angle and CTA) never loaded. Cure: a contradiction check between facts and knobs (§5.2).

**G6. Lint shows, nothing repairs.** Violations are displayed to the owner after the fact. The model never gets a second, targeted pass. Cure: lint → repair loop (§5.6).

**G7. Course rules missing from the cards.** None of these appear in `cards.json`:

| Missing rule | Source |
|---|---|
| A video's title never appears in the email | Sauce, "Other tips": "The name of the videos should never be in the email" |
| Don't open with "I" or "We" | Sauce, Body: "Don't start with I, We" |
| No forced bridge between personalization and offer ("speaking of", "which is why", "that's where we come in") | Sauce, First line |
| An offer framed as an improvement reads as criticism | Sauce, First line |
| Don't tell them what they already know | Sauce, Body |
| No "if" hedging: assume interest | Sauce, Body: "'If', 'if', 'if' – NO" |
| Start with what they get, not what you want ("I want / we'd love / we're looking for") | Blueprint 8.3 |
| No em-dashes | Blueprint 8.2: "Immediately signals AI-generated content" |
| Permission phrasing is weak ("Can I / Is it okay if I / Mind if I") | Blueprint ch.2 rule 2 |
| 4th-grade reading level, no corporate vocabulary | Lesson 1.2 *How to Write a Cold Email* |
| More about them than about you (the 3:1 ratio, flipped) | Lesson 1.2 |
| No placeholders ever ship ("Name", "Creator A", "[Brand]") | Not in the course, but implied everywhere. Pure lint |
| No acronyms they may not know | Sauce, Body |

Each needs a verified quote through the factory before it becomes a card rule (P3: one verified coach quote is enough). The pointers above are where to look.

**G8. The facts block invites copying.** It hands over raw video titles in quotes, and the model quotes them back, which the course bans. Cure: research turns titles into **the detail** ("a 300-pound lift got no-repped on day 1"), and titles stay out of the writer's facts.

**G9. The runtime isn't clean (unverified).** Drafts run in the consumer Gemini web app on the Ultra account that is also used for the notebook. That app adds its own hidden instructions, and possibly *Saved info* or personal context from past chats. I can't see that from here. Check: Gemini → Settings → *Saved info* and *Personal context* are empty or off for that account.

---

## 5. The design

```
 FACTORY (build time, exists)                         DRAFT (per email)
 ─────────────────────────────                        ────────────────────────────────────────────
 sources, lossless ─► verified quotes ─► cards        0 RESEARCH   facts card: one detail, sponsors,
   + owner decisions + house choices      │                        brands they did, no prose
                                          │           1 CLASSIFY   knobs prefilled by code
                                          │                        + facts-vs-knobs contradiction check
                                          │           2 PLAN       code: loaded cards → ≤12 rules
                                          │                        + slot plan (opener/offer/ask)
                                          ├──────────►3 WRITE      LLM, ONE email, ONE stage
                                          │           4 CHECK      lint (code) + critic (LLM, checklist)
                                          │           5 REPAIR     LLM fixes only failed checks, ≤2 rounds
                                          │           6 OWNER      good/bad + why → library
                                          │           7 OUTCOME    sent / replied, per knob combo
                                          ◄────────── monthly: verdicts + outcomes → card proposals
                                                      (owner accepts; factory never auto-edits)
```

Two rules run through the whole design:
- **Code decides what applies; the model only writes.**
- **Knowledge is retrieved at build time, never at draft time.**

### 5.1 Stage separation and threading

- One call writes one email. A sequence is N calls, in order.
- Each follow-up call receives the **sent** thread: the bodies of the earlier emails, marked as already sent and not to be repeated. It also gets that stage's card only.
- Threading rules, all from current cards or the Blueprint:
  - a follow-up is a reply in the same thread and has no subject;
  - brands named in email 1 are not repeated, and brands held back are named in follow-up 1;
  - a new video since the last email becomes fresh personalization;
  - bold is allowed for the offer only, from follow-up 1;
  - the ask may soften as the sequence goes on, and the closing email changes approach;
  - each follow-up is shorter than email 1;
  - cadence is the house choice.
- One ask per email, every stage.

### 5.2 Classify

Code prefills the knobs, as it does today. Then a deterministic contradiction table runs over the facts:

| Facts say | Knob says | Action |
|---|---|---|
| sells own program/product/shop | `state = unsponsored` or `unknown` | propose `state = own product` |
| a sponsor in the last 5 videos | `state = unsponsored` | propose `some` |
| reader email is a management agency domain | `reader = creator` | propose `manager` |
| `have = brand` but no brand name in facts | — | block: the brand is missing |
| `have = roster` but no creator names | — | block: no placeholders allowed |

The owner sees each proposal and accepts or rejects it. No silent overrides.

### 5.3 Plan: the slot plan (code, from cards)

Before writing, code picks **what goes in each slot**. The model is then told what to say, never how to word it:

| What I have | Offer slot | Ask slot (a yes leads to…) |
|---|---|---|
| nothing | the service: finding brands that fit their content. Optionally 2 fit brands they haven't done, framed as "brands in your space", never as brands you work with | whether they want that. Never "send details" or "send brands" |
| roster | similar creators already onboarded (real names only) | the next real step you can take |
| brand in hand | the brand by name, plus a real deadline | the brief, if one exists |
| deal + budget | the brand plus a money range | whether the range works |

Plus: **opener** = the one detail from research, stated flatly, with no verdict on it (G7 compliment rule; see Q2). **Subject** = distilled from that detail.

### 5.4 Write: the writer prompt contract

Target: **under 500 words, one email.** Fixed order:

1. Role, one line: the founder of a small influencer agency, writing to a peer.
2. **The job of this email**, one line (stage card): e.g. "First email. Its only job is a reply."
3. **Slot plan** (§5.3), as plain facts: opener detail, offer content, ask content.
4. **Constraints**, at most 12, each written as a condition plus its `why` in ≤10 words. Never a quotable sentence, and no banned-phrase lists except the short never-open-with list.
5. **Hard limits**, the numbers only: word range, 1 question mark, the last line is the ask, no links, plain text, first-name sign-off.
6. Output JSON.

Nothing else goes in. Specifically no examples, evidence quotes, coach names or decision ids (today's prompt leaks "(D10)").

### 5.5 Check: lint + a calibrated critic

**Lint** (code) keeps today's checks and adds: em-dash; placeholder tokens (`Name`, `Creator [A-Z]`, `[`, `{`); a video-title substring from the facts; the first word is "I" or "We"; want-first phrases (`I want`, `we'd love`, `we're looking for`, `I'd like to`); permission asks (`Can I`, `May I`, `Is it okay`, `Mind if`); forced bridges (`speaking of`, `which is why`, `that's where`); hedges (`if you're`, `if this`, `just`, `maybe`, `perhaps`); a rule-text echo (any 4-word run copied from a loaded rule's text).

**Critic** (LLM, separate call, a different prompt from the writer). It answers yes/no per item, quoting the offending line. It returns a list of failures, never a score. Items come straight from the course's own checklists:

- Could this exact email go to another creator? (lesson 1.2, the MrBeast/Mufti Menk test)
- Does any line praise, judge or react to their work? (Sauce)
- Does any line say what the sender wants before what they get? (Blueprint 8.3)
- Does any line explain the agency, how it works, or why it needs something? (Sauce: "the more you explain…")
- Does the offer read as fixing a flaw in what they do now? (Sauce)
- Does the email tell them something they already know? (Sauce)
- Is anything claimed that is not in the facts? (no lies)
- Is the ask a yes/no question that offers only something the sender has? (Ammar; lesson 2.6)
- Could they answer it in one word with a phone in one hand? (Sauce)
- Does it read like AI, or like LinkedIn? (lesson 2.6, lesson 1.2)

The critic also gets each item's `fail` lines from real roasted emails, the opposite of what the writer gets.

**Calibration.** The owner's good/bad verdicts are the ground truth. The critic is trusted only while it agrees with the owner on the verdict set: a critic "pass" on a draft the owner marked bad counts as a critic miss. Re-check after every card or critic change.

### 5.6 Repair

When lint or the critic flags something, the writer gets one follow-up message with:
- the draft;
- the list of failed checks, each as a one-line instruction;
- "change only these lines; keep everything else".

Re-lint after each pass, at most 2 rounds. If it still fails, show the draft with its flags. Never silently ship it.

### 5.7 Owner + outcome loop

- **Verdicts** (slice 3, in progress): good/bad + why on every draft the owner looks at. Bad + why becomes a critic `fail` example and a regression case. Good becomes a golden, used by the bench only.
- **Outcomes**: when an email is sent, store the knob combo, card version and draft id. A reply (or none after the sequence ends) is recorded against it.
- Monthly, or every 50 sends: reply rate per knob combo, compared with the course's 10–20% expectation. A combo that's well under it opens an inbox item for its cards. **Outcomes propose; the owner decides.** Cards are never edited automatically.

---

## 6. Migration from today, smallest first

| # | Change | Where | Fixes |
|---|---|---|---|
| 1 | Scope "never soft" to the first email in the prompt; drop "The offer comes from the pain you found" unless the facts carry a pain; strip decision ids from rule text | `outreach_cards.py`, factory cards | G2 |
| 2 | `sequence` defaults to false; follow-ups become their own calls carrying the sent thread | `actions.py`, draft dialog | G1 |
| 3 | New lint checks (§5.5 list) | `pipeline/tools/outreach_lint.py` | G6, G7 |
| 4 | Repair loop, ≤2 rounds | daemon `draft_email` | G6 |
| 5 | Facts: titles out, research gives "the detail" | `ai_brief_builder.dart` | G8 |
| 6 | Facts-vs-knobs contradiction check | `outreach_knob_prefill.dart` | G5 |
| 7 | Factory: verify quotes for the G7 rules, add `why` / `fail` / `check` fields, rewrite rule text as conditions | sandbox factory | G3, G7 |
| 8 | Checklist critic replaces the 1–10 judge; calibrate on owner verdicts | bench + daemon | G4 |
| 9 | Outcome tracking on send | outreach records | §5.7 |
| 10 | Check Gemini *Saved info* / personal context on the drafting account | owner, 2 minutes | G9 |

Steps 1–4 are small, and they would probably have caught most of the §2 failures. That's a guess until the bench is re-run.

---

## 7. Decisions for the owner

- **Q1 (D16 vs the course).** D16 says vary "words, structure and flow" every email. Ammar says the four parts always come in the same order. Proposal: **the part order is fixed; words, sentence shapes and the chosen detail vary.**
- **Q2 (compliments).** The Sauce says never compliment, not even "great idea". Lesson 2.6 says "compliment the work instead of the person: 'That segment was seamless'". The drafts land in between ("made for a sharp hook", "was brutal"). Pick one:
  - **A:** no verdicts at all; state the detail flatly;
  - **B:** one short verdict on the work, never on the person.
- **Q3.** Should follow-ups be drafted together with email 1 (as one review session, but separate calls), or only when each is due? The first lets you review the whole thread up front. The second lets each follow-up use a newer video.

---

## 8. Implementation status (2026-10-02)

| # | Step | Status |
|---|---|---|
| 1 | Prompt contradictions (G2) | **Partly done.** "Never soft" is scoped to first and re-engage emails (factory `when`). Decision ids are stripped from rule text before the writer sees it (`outreach_cards.rule_text`). "The offer comes from the pain you found" is **still unscoped**: it is the research card's only draft rule, and scoping it unloads the card together with its "one specific detail" need (a test caught this). It needs a second research rule with a verified quote first |
| 2 | One email per call (G1) | **Done.** `sequence` defaults to false. A sequence is N calls in send order, each with its own stage's rules and the earlier emails as a quoted thread block. A follow-up drafted from the app carries the emails really sent in that thread (`thread`); re-engage doesn't. `sequence_prompt` is gone |
| 3 | New lint checks (G6, G7) | **Done**, as always-on house checks in `outreach_lint.py` (`rule: house.<id>`, no card): em-dash, placeholders, video title from the facts, I/We first word, want-first, permission ask, forced bridge, if-hedge/maybe/perhaps, and a 4-word run copied from a loaded rule. On the 10 old bench drafts they flag 8. That covers three of the four failure types §2 says nothing caught (permission, want-first, placeholders); the fourth, criticism framed as improvement, is the critic's job |
| 4 | Repair loop (G6) | **Done** in the daemon's `draft_email`: lint + critic → targeted repair ("change only these lines"), at most 2 rounds. Whatever is still open comes back in `review` and shows as finding chips in the draft dialog. `review: "lint"` skips the critic, `"off"` returns the bare draft |
| 8 | Checklist critic (G4) | **Built, not yet calibrated.** `outreach_review.py`: 10 yes/no items from the course checklists (§5.5). It never sees the writer's rules, and a failure counts only if its quoted line really is in the email. Not calibrated against owner verdicts yet, and the factory bench's 1–10 judge is not replaced yet. `factory/bench/pipeline_bench.py` runs the new pipeline on the bench cases, with the critic run on the old drafts as a baseline |
| 5, 6, 7, 9, 10 | | Not started |

The factory bench's `build_prompt` now calls the repo's `outreach_cards.prompt`, so the bench and the app share one prompt builder.

### Decisions taken

- **Q2: A.** No verdicts at all; the detail is stated flatly. The critic's `praise` item enforces it.
- **Q3:** one email per draft. A follow-up is drafted when it's due, at its own stage, with the real thread. That lets a newer video become the follow-up's personalization. The daemon can still draft a whole sequence (`sequence: true`), one call per email.
- **Q1: left for the owner.** It edits the owner's own D16 rule, and that rule is also a standing instruction ("different structure and flow every time"). Recommendation unchanged: fix the part order, vary the words and the detail.

### Owner's idea: emails and coach comments from the call transcripts

The owner's view: drafts are weak because the model lacks precise examples of right and wrong. The roast calls hold many student emails, or parts of them, plus the coach's comment on each.

The idea is good. The comments are worth more than the emails, because the coach says **why** a line fails. What the corpus feeds, in order of safety:

1. **The critic, first.** Each `(line, coach verdict, coach reason)` triple becomes a `fail` example on the matching checklist item, verified verbatim by `ledger.py` like any quote. This is §5.5's "fail lines from real roasted emails", and it is where examples help without being copied into drafts.
2. **Calibration data.** Roasted emails come with a verdict, so they double the owner's verdict set for checking whether the critic agrees with a coach.
3. **The writer, only as a measured experiment.** The "examples hurt" finding (§3: 7.6 → 7.0) was measured with the blind judge (G4), so it is weak evidence. Once the critic is calibrated, run an A/B: cards only vs cards + 2–3 **contrast pairs** for the situation (a roasted line, then the coach's fixed version, labelled "the idea, never the words"). Keep it only if the critic's fail rate and the owner's verdicts both improve, and the repeat test shows no stamping.

Proposed as step 11: a factory job that extracts `{email excerpt, coach comment, verdict, checklist item, timestamp}` from the roast transcripts. Each comment is verified verbatim, the same way rules are.
