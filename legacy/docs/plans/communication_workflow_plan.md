# Gratovo communication workflow — plan (started 2026-10-14)

Owner's ask: one workflow that runs **all** communication with influencers and brands — outbound,
inbound, follow-ups, negotiation, closing, delivery, payment — the way a role-model graduate or a
course coach would, built on Gemini 4 Argon (skills + tasks), simple to use, nothing missing.
Start fresh: no knowledge from old files; test everything with real data before calling it done.

---

## 1. The honest answer to "can we rely on it for everything?"

**For most of the work, yes — if it is built as "AI decides and drafts, a person approves", and
proven on tests first.** Concretely:

| It can do reliably (once tested) | It must hand to a person |
|---|---|
| Know the course's playbook for every situation, both sides | Any money number: quoting a brand, accepting or countering a creator's rate (it proposes the number with the course's math, a person confirms) |
| Read every reply, classify it, pull out the facts (rates, dates, names) | Contracts, payment details, anything legally binding |
| Pick the next step the course prescribes and draft it in house style | Facts it was never given (roster names, past results, brand relationships) — it asks instead of inventing |
| Schedule follow-ups with the course's cadence and stop rules | Halal/haram calls on a brand that the rules don't settle |
| Prepare call briefs and negotiation plans | Calls themselves; situations the course never covers (flagged, never improvised) |
| Flag what needs a human, with the reason and the lesson it comes from | Turning on auto-send for a message type (only after its drafts are approved unedited ~95% of the time) |

Limits that will not go away: Gemini runs through the web page (Google can change it; the
extension heals and reports what broke), the Pro plan has usage caps, a task takes ≥ 1 minute,
and quality on *real* replies is only proven by measuring it on real threads after launch.

## 2. What Argon gives us (verified live on the owner's Pro account, 2026-10-14)

| Feature | Verified behaviour |
|---|---|
| Model | "4 Argon" in the model menu; "مستوى التفكير" (thinking level) is a submenu there |
| Chat ↔ task | Segmented toggle under the prompt box (`data-value` 0 = chat, 40 = task); a scripted click works |
| Skills page | `/customize/skills`; Create menu → Upload; card menu → use now / edit / download / **replace** / deactivate / delete |
| Upload | A `.zip` dropped on the upload dialog keeps the folder tree (SKILL.md + references/ + scripts/) |
| Replace | Swaps all files, **and turns the skill off** — automation must switch it back on |
| Invoke | `@` in the prompt box opens skills (and connected apps: Gmail, Drive, Docs, Calendar…) |
| Skill in **chat** | Reads reference files (~15 s). A skill **with scripts is refused** in chat, files and all |
| Skill in **task** | Reads references **and runs Python 3.11 scripts** (~1 min). Right after an upload the files were missing once; a minute later fine → verify after every upload |
| Task done signal | Step list header gets class `done`, last step shows ✓ "تم إنجاز المطلوب"; the footer's `complete` comes minutes later |

Already in the account and **active**: `cold-email-drafter`, `cold-email-qa-optimizer`,
`cold-email`, `spam-word-checker` (+ inactive `influencer-marketing`). Active skills are applied
automatically "when relevant", so they would leak old/generic rules into every draft.

## 3. What the finished system is, for the team

One place — **Comms** — with a queue of everything that needs a person today, oldest risk first:

- **New replies** — the AI's read ("asked for rates; course says ask theirs first — Negotiating
  with Influencers, step 2"), the proposed answer, and Send / Edit / Redo / Skip.
- **Follow-ups due** — drafted with the right weight (light/heavy) for its place in the sequence.
- **Decisions** — price, terms, contract, "brand not covered by the rules": options + the
  course's recommendation; nothing goes out until someone picks.
- **New outreach** — pick creators or brands, the AI qualifies them (course criteria), drafts
  first messages per situation, the person approves in a batch.

Every message shows *why* (which rule, which lesson) so the team learns the course while using it.
The same brain is available in Gemini itself: `@gratovo-comms` in any chat for ad-hoc questions.

## 4. How it is built

```
course (lessons + coach calls)
   │  fresh extraction; every rule carries a verbatim quote + lesson/call + timestamp;
   │  a script rejects any quote not found in the source or not said by a coach
   ▼
knowledge/  playbook by situation + "house choices" where coaches disagree (owner picks)
   ▼
Gemini skills (built from knowledge/, uploaded + verified by the extension)
   gratovo-comms        references only → chat: analyse / decide / draft, fast
   gratovo-comms-tasks  + scripts → tasks: batch drafting, research, self-checks
   ▼
engine (Python, beside the Gemini bridge)
   case file → analyse inbound → next action (state machine per side) → draft →
   hard checks (facts grounded, money/contract gates, stage rules, deliverability) → repair
   ▼
app: Comms queue, contact + deal stages, Gmail send/receive, follow-up scheduler
```

**Kept** (plumbing that works): Gmail connection, the extension + daemon, the app's screens and
database. **Replaced** (knowledge and the drafting workflow): old skill files, `cards.json`, the
old prompts and the knob panel, the generic skills in Gemini. Old files stay on disk until the
owner says delete; nothing new reads them.

## 5. Coverage map — every course topic has a home

| Side | Stage | Course sources (lessons; calls add edge cases) |
|---|---|---|
| Both | Foundations: communication, power dynamics, halal/haram, deliverability, volume, warm-up, weekends, forms | 1.2 Communicate, 1.3–1.6 email setup/volume/deliverability, 1.8 Halal & Haram, FAQs |
| Influencer | Qualify, find contact | 2.1, 2.2, How to Qualify Influencers |
| Influencer | First message by situation (email + DM) | How to Message Influencers, 2.2 Why trust me, 2.6 Common mistakes, 2.7 Good vs bad, FAQ lowball, approach with a deal |
| Influencer | Follow-ups, light vs heavy, 7 with no reply | 2.8 Follow-ups, FAQs |
| Influencer | Every kind of reply | 2.1 What to do when they respond, FAQs (price me, already worked with brand…) |
| Influencer | Offer, deal types, pricing, media kits | 2.2 Proposing, 2.3 CPM vs straight, 2.3 Deal kinds, 2.4–2.5 Pricing, 2.5 Media kits |
| Influencer | Negotiation, managers/agencies | 2.6–2.7 Negotiating, Secret Sauce (Osama), 2.3 Creator with agency |
| Influencer | Closed → onboarding, contracts, upsell | 2.8 Closed, now what; 4.2–4.3; Upselling (bonus) |
| Brand | Find, qualify, audit | 3.1 Where to find, 3.2 Audit, 3.4 Qualifying |
| Brand | Pitch, offers, presenting creators | 3.1/3.2 Offers, 3.4 Strong pitch, 3.3 Presenting, 3.5 Foot in the door |
| Brand | Replies, objections | 3.2 Typical brand responses, 3.5/3.6 Objection handling |
| Brand | Negotiation, budget | 3.4 Negotiate, Secret Sauce (Kushtrim), FAQ brand budget |
| Brand | Accepted → contract, payment | 3.1 Brand accepted, 3.2 Contract masterclass, 3.4 Collect payment, FAQ payment methods |
| Both | Delivery: brief, onboarding, campaign, post-campaign, reviews | 3.3 Service delivery, 4.1–4.5, 3.5 Results and reviews |
| Both | Calls: prep and sales calls | FAQ Masterclass on calls, 8 How to take sales calls |

Part of "done" is a check that every lesson above is cited by at least one rule.

## 6. Testing — what "works" means

- **Scenario catalog**: every row of §5 × the situations inside it (who reads it, stage, what we
  have, their state, channel), both sides, plus edge cases (angry reply, wrong person, bounce,
  out-of-office, manager hijacks thread, asks for money upfront, competitor conflict, haram brand,
  Arabic reply, two people on one thread, reply after 3 months…). Case files use **real** channels
  and videos from the database and real replies from the course's roast calls / the connected
  mailbox (read-only).
- **Lifecycle runs**: a simulated creator/brand (separate Gemini chat with a persona) replies;
  the engine runs first email → follow-ups → negotiation → close → onboarding → payment.
- **Team flows**: each employee use case driven in the app (queue, edit, approve, decide, chase).
- **Pass bar**: right situation + right next step + hard checks pass + grader ≥ bar on ≥ 95% of
  scenarios on two consecutive full runs, and **100%** on the safety gates (no unapproved money,
  contract or invented fact). Failures are fixed and the whole suite re-run.

## 7. Order of work

1. Extension + bridge: skills (upload / replace / activate / verify / list / delete), chat↔task,
   task completion, thinking level, Argon — with jsdom tests from the live markup. ← next
2. Knowledge from the course (lessons read in full; calls mined, quote-verified).
3. Skills built from knowledge/, uploaded and verified; engine; scenario suite; iterate.
4. App: Comms queue wired to the engine and Gmail; employee flows.
5. Full live runs on real data; harden; owner review.

Progress and decisions are logged in §8 as they happen.

## 7b. Toward a course graduate (v2, 2026-10-16)

The goal is a workflow that does the job of a competent graduate of the course in most cases, and does better than any graduate wherever a computer is naturally stronger. A graduate is the floor for judgment, not the ceiling, and a graduate's weak spots are not copied. So every target has two tiers:

| Tier | What it covers | Bar |
|---|---|---|
| Judgment and taste | reading the person, choosing the angle, voice and tone, personalization, when to push and when to let go | a competent graduate, in most cases: coach "good" ≥ 90%; the rest goes to a person with the coach's notes, never sent worse |
| Machine strengths | recall of the whole course (every rule that applies is applied, not only what a graduate remembers); the same care on the 500th message as on the first; every fact and number checked against the record; the money and contract gates; follow-ups on time, nothing dropped; never templated, no banned words; speed and volume | better than any graduate, and never traded for anything else: 100% on the gates, zero invented facts, zero missed follow-ups, every key rule for the situation applied |

What the coaches roasted in students stays ruled out even though graduates do it: templated openers, pressure tactics, guessed facts, replies longer than the message they answer.

Where it stands after run-01 and the coverage audit:

| Layer | Tier | Evidence | Verdict |
|---|---|---|---|
| Deciding (reply type, action, what needs a person) | both | grader 39/40 on the first 40 answers; every claim checked was in the facts; 88% of the key rules for the reply type cited | judgment near graduate; rule recall short of the machine bar (88%, target ~100%) |
| Knowing (the playbook) | machine | 150 random call items judged by hand: 88.5% covered, 10.1% partly, 1.4% missing (95% upper bound 5.1%); the 16 gaps closed (b75) | short of the machine bar: the "partly" items need closing too |
| Writing (the message itself) | judgment | replies of 120-190 words to one-line questions; all first emails on one frame (6-14 shared four-word runs); research notes pasted in; defensive disclaimers | below graduate |
| Measuring quality | — | the grader checks mechanics only | missing |

What changes, in this order (each step is measured before the next):

1. **A coach that grades like the coaches.** A second skill, `gratovo-coach`, takes a case and a draft and answers a verdict (good, mixed, bad) with the points a coach would make, by rule id. It is calibrated on held-out roasts from the calls (1,976 coach verdicts on student emails): agreement on bad-or-not and recall of the coach's points are measured before it is trusted. Then every scenario run is graded on quality as well as mechanics.
2. **Decide, then write.** The drafting splits in two passes: the current skill decides (situation, action, gates, the facts and points the message must carry), and a writer pass turns that plan into the message. The writer sees the voice rules, a length target from the message it answers, the agency's recent messages (never to resemble), and three to five examples for this situation. One pass against two passes is compared on the same cases, judged by the calibrated coach.
3. **Many more examples.** The calls hold 963 coach rewrites and 255 emails a coach called good (most are reconstructions of what was on screen, so they teach the moves, not the wording). They go into an example bank tagged by side, stage and reply type, filtered for ethics and invented claims; the writer gets the few that match the case. The copy and template checks keep them from being reused word for word.
4. **One revision when the coach objects.** Draft, coach critique, one rewrite when the verdict is not good; the person approving sees the final draft and the coach's notes.
5. **Inputs a graduate has.** First emails see only video titles; a graduate mentions a moment from the video. Giving the case the latest video's description or a transcript excerpt is the biggest lever left for first emails (a data task outside comms).

Done already: a template check against the agency's recent messages (`TEMPLATED`, the engine passes `recent_messages`), strict answer-shape checking in the engine, reply-length and research-notes rules, the audit's gaps.

Built offline on 2026-10-16, waiting for Gemini (another session's run-01 holds both accounts):
- step 1: `comms/coach.py` (calibrate, agreement, judge, report) and the skill's "Coach review mode"; the calibration set
  `E:\IMA work\Learning\mined calls\coach_calibration.json` (120 held-out roasts: 45 bad, 40 mixed, 35 good).
- step 3: `comms/example_bank.py` and `data/comms/playbook/example_bank.json`, 992 entries (each with a checked coach
  quote; pressure tactics, invented claims and the skill's own 33 left out).
- step 2: the engine's `variant` (base | examples | write), `scenarios run --variant`.
- step 5 (within comms): cases now carry the creator's latest video (title, views, the prose of its description) and the
  tools the creator already links in recent descriptions, read from gratovo.db.
- The build id now covers SKILL.md (before, a change to the procedure alone kept the old id). Build comms-6786ca5afd,
  not deployed. 92 comms tests pass.

Next, when Gemini is free: deploy that build to both accounts; calibrate the coach (120 reviews); coach-judge run-01's
drafts as the baseline; run the three variants on the writing-heavy cases (25 first emails and the replies that carry a
message) and judge them the same way; keep what wins; then a full run twice for the bar, reported per tier. Judgment:
coach "good" >= 90% and a careful read agreeing. Machine strengths: mechanics >= 95% (100% on the gates), zero invented
facts, the key rules for each situation applied.

## 8. Log

- 2026-10-14: Argon platform mapped live (§2). Probe skill `gratovo-probe` created for tests.
- 2026-10-14: owner decisions — sources = course only (lessons + coach calls; not the Blueprint PDF, not old
  skill files); tests use course examples + real channels/videos, never the mailbox; every message waits for
  approval; old outreach skills deleted (backed up to `E:\IMA work\Sandbox\gemini-skill-backups\2026-10-14\`).
  Correction: only cold-email-drafter and cold-email-qa-optimizer had been on; influencer-marketing stays (off).
- 2026-10-14: **step 1 done.** Extension 0.3.0: `content/skills.js` (list / read / upload / replace / on-off /
  delete / diagnostics), background `drop_files` (page-world drop), `send` with `mode` + `skills`, task completion
  from the step list, `textRaw`, `get_task`, `get_mode`/`set_mode`, thinking level (hover submenu). Python:
  `gemini_bridge/skills.py` (build/validate/zip, upload, deploy + verify, probe), `action.skill_*`, CLI commands.
  Tests: extension 83/83 (23 new), Python 24 new + 139 existing green. Live on the owner's account: create 16 s,
  replace 11 s, read-back of nested folders, chat probe through `@` with the skill off, task ran an uploaded
  script (38 s), on/off, delete. Thinking level set to **high** (it was low). Contracts updated (PROTOCOL.md,
  DAEMON.md "Gemini 4 Argon").
- Found on the way: Gemini's answer text used to glue paragraphs ("CANNOT-RUNThe…"); `textRaw` and a DOM-built
  fallback fix it. Using a skill by `@` turns it back on, so "off" is not a stable state for a skill in use.
- 2026-10-14: **step 2 started.** `pipeline/comms/` (course.py: lessons + 574 call transcripts, `norm`,
  `contains`, `speaker_of`; playbook.py; verify.py → `python -m comms.verify`). Playbook in `data/comms/playbook/`
  (README, coaches.json = 17 coaches with their Fathom label spellings, rules/<area>.rules.json). Module 2
  (influencers) fully read: 78 rules, all quotes verified, 22/134 lessons cited. Next: modules 3, 4, 5, 1, 8, 6.
  Rule batches are written as JSON and appended with a helper (see the session scratchpad `addrules.py`: it
  replaces same ids and runs the verifier).
- Open house choices found so far (to put in house_choices.json for the owner): niche CPM tables differ
  between lesson 2.4 and 2.5 (tech 30-50 vs 20-40, fitness 20-35 vs 15-30); agency share as 20-30% commission
  (2.3) vs 30-70% markup (2.4); follow-up timing to be compared with the calls.
- Gap found: the lesson pages are condensed summaries (~150 chars per video minute; some video lessons have
  one line). ~33 h of lesson video + 2.5 h of Q&A recordings were never transcribed. Transcribing them with
  Whisper large-v3-turbo (faster-whisper, CPU, isolated venv on E:, detached, low priority) so the playbook can
  cite what the coaches actually say in the videos. Owner has an RX 570 8 GB: a Vulkan whisper.cpp build would
  need the Vulkan SDK (admin install) — offered as a speed-up, not required.
- 2026-10-14 (evening): **owner caught that every Gemini call so far ran on 4 Argon with thinking at LOW** (the
  "set to high" above held for one tab only; `send`/`comms.pool` never set or checked it). Everything Gemini
  produced until now (skill probes, the 4-call mining pilot) is treated as low quality and will be re-run. Rule:
  every send sets and re-reads thinking = high per tab, refuses to send if it cannot confirm, and every answer
  file records model + level. The full call-mining run was not started.
- Transcription (two-model consensus: Parakeet TDT 0.6B v2 + Whisper large-v3 int8, `E:\IMA work\Tools\transcribe`).
  The first run grew to 58 GB and stalled at video 50/86: on continuous speech the VAD did not split, so pieces
  of 70-240 s went to the model 16 at a time. Fixed: pieces are capped at 60 s (cut at the quietest 100 ms after
  30 s; 60 s keeps the context that gets course terms right, 25 s heard "influencer marketing" as "influence on
  acting"), decoded one at a time, padding never overlaps a neighbour; each video runs in its own process under an
  8 GB cap (job object, which also ends children if the run dies); progress inside a video is written as it goes
  (`<video>.partial.jsonl` + `.partial.txt`) and a stopped run resumes inside the video (tested: kill + resume for
  both models). 30 min of audio now takes 4.4 min at 3.5 GB. The first run's 45 finished transcripts are kept (complete;
  labelled with how they were made, `config.batch = 16`, long pieces). 3 downloads have no sound track and need
  re-downloading: Module 2/3.3 Closing an influencer that has an agency, Module 1/4.7 The Most Important Skill
  Entrepreneurs Need (.f2784, video-only), Module 4/4.5 Post Campaign Delivery (.fhls-853, video-only).
- 2026-10-14 (night): **thinking level enforced and the Gemini work redone.** Live: the level lives in the page
  (survives a new chat, resets to low on every new tab, reload or navigation; the model button reads
  "Argon مرتفع" when high). `send` takes `thinking` (add-on 0.3.4): set after new chat/mode, read back by reopening
  the menu, retried when the menu opens late or on the wrong rows, THINKING_NOT_SET otherwise (nothing sent).
  `comms.pool`/`comms.engine` always ask for high and record the level; an answer without a confirmed level counts as
  not done and is asked again; `mine_calls verify` skips it. Pilot re-run on the same 4 calls, low → high: 41 → 62
  items, quotes verified 89/93 → 141/143 (low answers archived in `mined calls\low-thinking-2026-10-14\`).
- Full call-mining run, first two launches failed and were stopped before any prompt was marked failed: 10 tabs
  loading at once took sends into half-loaded pages; sends that looked refused went through, then every send met
  BUSY and the workers burnt retries in a loop. Root causes and fixes: (1) a leftover loading element inside a
  finished answer read as "generating" for good — now it counts only while the answer's actions are missing or its
  text moves (`spinnerAt` in diagnostics); (2) "new chat" on an empty chat whose box still held an untaken prompt
  could never succeed — the text is now cleared; (3) the pool now waits for a ready tab before each send, keeps
  answers found on tabs under the right key (matched by the END of the prompt: all prompts share the instruction
  header — the old recover() compared the first 120 chars and could have filed one call's answer under another),
  waits a minute for a slow prompt to show before calling it refused, and never charges tab problems to a prompt's
  attempts. Third launch: 18 answers in 10 min (8 recovered from the tabs), 0 retries, 0 failures; ~100 calls/hour.
- Tests: extension 89/89; pipeline pytest 642 passed, 2 failing tests are `test_drafting_rules.py` looking for
  `data/gemini skills/email drafter rules.json`, deleted in commit ff4e5d6 (not this work). New:
  tests/test_comms_thinking.py, tests/test_comms_pool.py (fake bridge reproducing the run's failures).
- 2026-10-14 (late): first account refused every send ("check your internet connection" toast, prompt put back)
  after ~25 big high-thinking prompts in 35 min on 10 tabs. Owner switched the managed Firefox to a second account
  (English UI). Changes: a toast after submit with no answer now ends `send` at once (GEMINI_ERROR, `refused`);
  the pool treats it as a limit (pause 30 min, counted once however many tabs meet it), runs 3 tabs by default with
  60 s between any two sends; "new chat" that does nothing (this account's chats are not saved, the address stays
  on /app) now reloads the chat page (add-on 0.3.6).
- **Medium vs high thinking, same 4 real mining prompts, one prompt per fresh tab** (owner's request): high 62 items /
  141 checked quotes in 702 s; medium 52 items / 103 checked quotes in 301 s; quote accuracy the same (~97-100%).
  Equal on the shortest call (38k chars); on the 68k call medium found 8 items to high's 15; on the 73k call 36
  quotes to 59. Two high runs of the same call also differ (59 vs 45 quotes; 37 shared), so one run never catches
  everything. 305 of the 513 calls are over 55k chars, where the gap is largest. Decision: mining stays on high.
  Medium's case is speed (2.3x); revisit for the drafting engine with the scenario suite.
- 2026-10-15: **quality audit of the mined calls** (184 answered, 3,794 items, 8,965 quotes). The checker had gaps,
  Gemini's output did not: most "not found" quotes ran across a Fathom timestamp line or a late speaker change, one
  coach label was missing ("Farhad Dlir"), 2 answers had broken JSON, 10 of the 12 empty answers were Fawaz Central
  sessions. Fixed (`Call.turns`, `coach_part` trimming to the coach's own sentences, roster, `parse_answer`,
  `fawaz_led`), tests in test_comms_mining.py. After the fixes: 96.8% of quotes usable (93.7% whole, 3.1% trimmed),
  98.4% of items keep a checked quote. A careful read of samples: advice 8/8 and disagreements 5/5 faithful; roast
  verdicts faithful, but the student emails and rewrites are Gemini's reconstructions (email shown on screen, partly
  read; `email_read_aloud` scores it). Disagreements show newer coach guidance overriding lessons (subject lines,
  the subscriber rule). Decision: no mining skill, no re-run. Handoff: docs/plans/comms_next_session.md.
- 2026-10-15: **the six silent lesson videos fixed.** The toolkit re-downloaded them with sound (`manager.py videos
  --download --fix-silent`; the silent copies are in `course videos/_superseded/`) and `transcribe_new.py` transcribed
  each as it arrived: Learn how to Communicate (48 min), Closing an influencer that has an agency (47), Sales crash
  course (34), Marketing crash course (18), The Most Important Skill (18), Post Campaign Delivery (8). 86
  transcripts, ~438k words. Not available: "Contest Winner - July - September 2025" (Vimeo 403 outside Skool's
  player, even with browser impersonation). The out_of_scope decisions in scope.json were made from page summaries
  and are to be rechecked against the transcripts (handoff updated).
- 2026-10-15 (evening): **videos done, calls in progress.** Lesson videos are sources `video:<lesson id>`
  (comms/course.py); every video quote is re-heard by Whisper large-v3 on its passage (comms/video_check.py, cache
  data/comms/playbook/whisper_checks.json; ~1 quote in 30 needed trimming, e.g. names). videos.json names who speaks
  in each video. scope.json rechecked against the transcripts: 32 lessons out of scope, every in-scope lesson and
  video cited. New foundations stage `calls` (FND-CALL-01..12, from How To Take Sales Calls). Rules: 427.
  Coach disagreements (all 162 mined) read: live coaching overrides older lessons where coaches say so
  (FND-MIND-22): no course subject lines, never name the colleague you also emailed, creators 50k-200k views
  without a brand, close 4-5 creators. House choices HC-13..HC-20 added (owner picks still open, defaults apply).
  Ethics overrides written in: no fake "RE:", no letting a manager think we are the brand, opt-out ends outreach,
  sponsored content always disclosed. checks.py now blocks em dashes, course subject lines/phrases and fake replies;
  the CTA check follows HC-20. verify also fails dangling rule/house-choice references.
  Calls: `mine_calls verify` on 332 answers -> 6,887 items (5,665 advice, 1,060 roasts, 162 disagreements).
  Read so far: disagreements, creator replies. Plan: read the draft-shaping stages in full, sample deliverability
  and other setup topics, then a roast-examples reference (learn from, never copy), then skill_build and step 5.
  Working notes for the session: scratchpad PROGRESS.md; batches b01-b46 applied through a helper (upsert).
- 2026-10-16: **call mining finished and step 3 complete.** Mining ended at 484/484 calls (498 answers);
  `mine_calls verify` -> 10,559 items. Every draft-shaping stage was read in full (influencer and brand), items from
  the 165 late calls read for the stages done earlier, setup stages (channels, deliverability, formatting) sampled.
  Rules written by hand from them: 551 rules (was 427), house choices HC-01..HC-33 (new: HC-21..HC-33, e.g. tone
  own-voice vs match-style, gifted product vs fee, whitelisting ask-first vs state-it, content requirements with the
  terms vs at draft, faith phrases). Coach-vs-coach and coach-vs-lesson disagreements are house choices plus a
  "Coach X" tip rule; the default is the lesson's option. Left out or rewritten honestly (ethics first): speaking as
  if we are the brand, not revealing we are an agency, wrong-brand reverse-psychology bait (now a dont), invented
  scarcity, fake internal approval, invented creator excuses, invented "males convert better" reasons, usage rights
  hidden in contracts, quietly inserted case-study clauses, guilt-trip apologies, going around a brand's agency.
  New musts include: urgency only from real dates (INF-FU-11), every term in plain words before closing
  (INF-CLOSE-06), never change a brief behind the brand's back (BRD-DELIV-08), never go around the agent
  (INF-MGR-14), honest content requirements (INF-DELIV-14).
- 2026-10-16: **roast examples.** `data/comms/playbook/examples.json`: 33 coach verdicts on student emails (picked from
  1,976 roasts; AI/tech first; 9 dropped by hand for ethics or for a quote that does not stand alone; claims and
  spam words taken out of rewrites). The emails and rewrites are Gemini's reconstructions and are labelled so; the
  coach quote is checked verbatim in the coach's own turn. The skill ships them as `references/examples.md`
  ("learn from them, never copy them"); `checks.COPY_COURSE` now blocks any 8-word run shared with an example, and
  `verify` checks every example (`example_problems`). Code since the last entry: `comms/scenarios.py` (list / run /
  grade), `pool` job hook + `TabClient`, rounded numbers ("63k") pass FACT_NUMBER, `skill_build --deploy` (waits for
  a ready tab, uploads, probes the build id), `playbook.examples()`. Tests: test_comms_scenarios.py,
  test_comms_examples.py, +1 in test_comms_checks.py.
- 2026-10-16: smoke run on the earlier build (comms-31ed66c4e9, 3 cases): 3/3 graded pass; a careful read found the
  Zapier pitch invented a judgement of the brand's campaign -> BRD-OFFER-17. First deploy of build comms-35105181c8
  failed: the managed Firefox tabs never reported ready (window in the background); not retried, no tabs opened.
- 2026-10-16: owner on the bar: "graduate level" means a competent graduate in most cases, not a ceiling; where a
  computer is stronger (whole-course recall, consistency at volume, fact and number checks, gates, follow-up timing)
  the workflow must beat any graduate and never trade that away. §7b now sets two tiers of targets and reports them
  separately; the 88% key-rule recall and the 10% "partly covered" audit items count as gaps under the machine tier.
- 2026-10-16: **machine-tier fixes from run-01 (offline, no Gemini).** (1) Three first emails were filed under other
  people (Kalshi held the Wispr Flow pitch to Maya; Matt Loui's held the email to "Mo"): a send reported refused had
  gone through and the next send on that tab got its answer back. Every prompt now ends with a per-call ref; the
  engine (and the coach) refuses an answer unless the tab's last prompt carries it (WRONG_CHAT, a tab problem for the
  pool); checks `WRONG_PERSON` blocks a draft greeting anyone but the counterpart or a thread writer (catches exactly
  the three). The add-on-level check is put to the owner by the Gemini session. (2) The price gate fired on view counts
  ("53k median views") and title or audience percentages: seven false gates; `checks.money` now reads 'k' and '%' as
  money only in a money context (no real amount in run-01 lost). (3) The ethics hints missed betting that does not
  call itself betting (Kalshi); hints added, and two more ethics cases with real sponsors (SoFi via @CodieSanchezCT,
  interest-based lending; Webull via @ZietInvests, margin trading): all three gate before Gemini answers. (4) The
  write pass now gets the reply type's key rules from the situations map, word for word (run-01 cited 95/108 = 88%;
  real misses: one price where BRD-OFFER-04 asks for 2-3 options, go-live reminders collapsed to one); the action
  stays the first pass's. The grade reports key-rule recall; `scenarios grade --recheck` re-scores a finished run with
  today's checks: run-01 58/72 -> 66/72 (91.7%); the six left are the three misfiled answers, one old wrong-shape
  answer (now re-asked by the engine) and two not yet answered. Build unchanged (comms-6786ca5afd). 104 comms tests.
- 2026-10-16: **the situations map is now load-bearing** (the write pass shows the reply type's key rules; the grade
  counts them), so it was audited: for each of the 47 reply types the rules closest to its label and signs but not in
  the map were listed and read in full. 30 added where the rule is written for exactly that reply (e.g. FND-ETH-12 for
  unsubscribe, INF-PAY-03 for upfront payment, INF-REPLY-24 for rude replies, INF-REPLY-22 for "fully booked",
  BRD-OBJ-22 for "what deals have you done", BRD-REPLY-25 for a referral to a colleague); the rule written for the reply
  leads its list. For brd.asks_rates, BRD-REPLY-20 ("asked for the rate: answer it, never with a budget question")
  replaces BRD-QUAL-08 (a qualifying-stage rule pulling the other way). A no or a "not now" with no follow-up gets a
  reconnect date from the engine: the month they named, else about three months (INF-FU-06, BRD-OBJ-23); a "later"
  with a question in it keeps the normal cadence (INF-REPLY-22, INF-FU-01). Two unclear-reply cases added (BRD-REPLY-09:
  "UGC as an initial test" must not become a free video; a creator asking us for an invoice we never sent). Suite: 76
  cases. Build comms-2c02f839c6 (538,601 bytes), not deployed. 106 comms tests; verify clean apart from the owner's
  listening queue (119 Whisper flags, 17 quotes not yet heard).
- 2026-10-16: **careful read of run-01's first emails**: the 16 influencer ones are one email with the nouns swapped
  (title reaction, "Most channels just...", "Speaking of X, we are onboarding creators for upcoming outreach", "your
  content could be a good fit", "Are you open to...?"). The pairwise TEMPLATED check misses a tic spread thinly over
  many sends, and a machine should beat a person here, not match one. New: `checks.overused_phrases(history)` learns
  the agency's own tics (three-word runs in >= 40% of its recent messages of that kind, names set aside), the case
  carries them, the prompt and the write pass say "use none of them", and `OVERUSED` (FND-WRITE-03) blocks a draft
  with two or more. Calibrated leave-one-out on run-01: 16/25 first emails blocked, 0/39 replies; learned phrases
  "we are onboarding", "are you open to", "could be a good fit" (the ideas are the course's, INF-FIRST-10/24/05; the
  repeated wording is what goes). `coach compare RUN...` puts variant runs side by side (verdicts, mechanics, length
  against target, first-email frame overlap); run-01 baseline: length 1.18x target, frame overlap up to 19 runs.
  Engine-only: build still comms-2c02f839c6. 109 comms tests.
- 2026-10-16: the tics are learned per message type (side x first/reply): pooled, the brand first emails' own frame
  ("was a smart move", "a natural next step", "should I send his details", in 9 of 9) stayed under the bar among all
  25 first emails. Per type, leave-one-out on run-01: brand first 8/9 blocked, creator first 15/16, replies 0/38.
- 2026-10-16: 64 of the coach's 120 held-out calibration roasts were also in the example bank (the coach never sees
  the bank, so the calibration is clean, but a held-out set stays held out): `example_bank.build` now leaves them out,
  928 entries. Owner said continue: sequence_01 launched detached at 07:01 (smoke test, calibration, run-01 judged,
  run-02 base/examples/write on the 30-case subset, each judged, compare); 85 holds off the bridge until it ends.
- 2026-10-16: **step 4 built (offline, off by default)**: `engine.propose(..., coach_rounds=N)` / `scenarios run
  --coach-rounds N`. A draft that passes the checks is reviewed by the coach in a fresh chat; when the verdict is not
  "good" it is rewritten once against the coach's points in another fresh chat with the whole case (prompt REVISE),
  then checked and repaired as usual; the action stays the first pass's. The result carries the reviews ("coach") and
  the pre-revision message ("before_coach") for the person approving. Run after run-02 picks a variant, on the winner.
  112 comms tests.
- 2026-10-16: **sequence_01 so far** (launched 07:01 on the owner's "continue"). Coach calibration v1, 114 reviewed:
  exact 50%, bad-or-not 63%, good-or-not 75%: below the bar. It catches the bad (39/43) but is far too harsh: 77
  "bad" where the coaches said 43, and 15 of 34 coach-praised emails got "bad" for the same style rules everywhere
  (FND-WRITE-21, -11, -08, -27); the number of points does not separate the classes. So the v1 coach can rank
  variants against each other but cannot certify "good". Coach v2 (opt-in, `--version 2`): a grading guide (a must rule
  broken in one easy sentence is mixed, not bad; style points alone are mixed at most; transcription artifacts are
  ignored) plus real coach verdicts on similar emails from the example bank as anchors (`example_bank.for_review`;
  calibration items are out of the bank). sequence_02 (queued after sequence_01) calibrates v2 on 45 stratified
  items, confirms on the other 69 only if it beats v1 by 8+ points there, and re-judges the runs only if it holds.
  run-02 base took 6 h for 30 cases: drafting was done by 11:05; one tab reported "generating" through every stop and
  the pool waited out 900 s twenty times while holding the last case. Fixed in `comms/pool.py`: with a job, a
  generation left on a tab is stopped at once, a tab that stays generating through a stop and a reload twice gives
  its prompt back, and idle tabs wait while a prompt is still out (test). 113 comms tests.
- 2026-10-16 16:35: account /u/1 began answering "حدث خطأ (1)" (Gemini's generic error) after nine hours of use, 4 times
  in 12 minutes, never before today. The pool now counts three of those on one account within 15 minutes as a refusal
  (the account pauses and the sequence stops after the stage; one alone is retried), and a tab that will not open the
  model menu is a tab problem, no longer a prompt's failed attempt. Both from the next stage on. 114 comms tests.
- 2026-10-16 16:46: /u/1 failed on all three of its tabs (generic errors, a model menu that would not open; 1 answer in
  20 minutes while /u/0 kept answering). To protect the account, sequence_01 and _02 were stopped (all answers kept)
  and the rest relaunched as sequence_03 on /u/0 only, reordered to spend the fewest sends: coach v2 on the 45 tuning
  roasts first (so no judging is spent on a coach that loses), then the run-02 examples and write drafts, then v2's
  confirmation on the other 69 if it won, then judging the four runs on the 30-case subset with the coach kept, then
  compare. About 340 sends at one a minute: roughly six hours.
- 2026-10-16 17:20: nine Gemini answers today were empty, only the skill header ("Skills: gratovo-comms"), or
  "Sorry, something went wrong": the prompt never reached the model, and the same-chat "answer again" got "no details
  are available in this session". `engine._send` now raises an error answer for the pool (so its throttle rule sees
  it) and sends an empty first answer again once in a fresh chat; the coach accepts points written as sentences
  (version 2 copies the anchors' prose style); calibration agreement counts only reviews with a verdict and lists the
  rest as failed sends. v1 rescored on its 111 verdicts: exact 51.4, bad-or-not 62.2, good-or-not 74.8. First v2
  reviews read like the coaches (the move, not the style), and may lean lenient: 3 of 7 coach-bad emails called bad.
  118 comms tests.
- 2026-10-16 17:50: interim coach v2 on 23 of the 45 tuning items: bad-or-not 61 (v1 48 on the same), good-or-not 61
  (v1 70), exact 30 (v1 39); it swung lenient (coach-mixed emails go to good or bad, never mixed). One absolute verdict
  on a three-step scale looks like the wrong instrument. Built `comms/pairwise.py`: which of two drafts the coaches
  would rather see sent (the question a variant comparison asks), calibrated on a student's email against the coach's
  own rewrite of it (25+ words, at least 60% of the student's length: 315 such pairs in the mined calls; 60 used, 30 per
  side, the order fixed per item by a hash). `pairwise judge RUN_A RUN_B` runs head to head on the cases both answered.
  Not run yet. 122 comms tests.
- 2026-10-16 18:14: **coach v2 on the 45 tuning roasts** (42 with a verdict): exact 45.2, bad-or-not 69.0, good-or-not
  66.7; v1 on the same: 42.2 / 57.8 / 66.7. v2 is better on bad-or-not (+11) and equal on good-or-not, so by the rule
  set beforehand (+8 on both) v1 stays. v2's table (rows coach, columns v2): good 9/4/2, mixed 6/2/4, bad 2/5/8: it
  recognises the coach-good emails (v1 called 15 of 34 bad) but lets bad ones through (8 of 15 caught; v1 39 of 43),
  and neither version can find "mixed". An absolute three-step verdict looks like the limit of this instrument: the
  pairwise judge is the next test. sequence_03 moved on to drafting run-02 examples (all today's engine and pool fixes
  loaded) and will judge with v1.
- 2026-10-16 18:50: careful read of run-02 examples found a check being talked around. brd-budget-1: the model priced
  $3,000 by the course's math (creator rate $2,000, 30-70% markup) and raised the price gate itself; FACT_NUMBER then
  blocked "$3,000" as not in the facts, and the repair wrote "three thousand USD", past that check and the price gate.
  Two faults, both fixed in checks.py: (1) the check fought the skill's hard limit ("write the proposed number and
  raise the gate"): a money amount is no longer a FACT_NUMBER when the price gate is raised; (2) amounts written in
  words are read as digits (`spell_out`: only with hundred/thousand/million or a currency word, so "two brands" stays)
  for every number and money check, and NUMBER_WORDS asks for digits. Rechecked on every run-01/run-02 draft: the only
  new flag is that one. Confound to note: base and examples ran under the old FACT_NUMBER, write runs under the new,
  so cases that propose a new price got a repair round in the first two. 125 comms tests.
- 2026-10-16 19:23: **run-02 read and the comparison restarted clean.** run-02 examples (coach examples placed before
  the skill's instruction) lost the decision layer: invented reply types ("budget_inquiry", "rate_quote", "positive")
  in place of the map's ids, so no key rules, and three gates missed: a machine-tier failure, so that placement is
  dropped (the write variant shows the examples after the decision). Fixed the same evening:
  `engine.shape_problems` now requires a reply type from the situations map (re-asked once with the side's ids), and
  rewrites are checked after merging onto the first pass; a "k" figure after "usual/average/median/typical" in a
  sentence about views is views ("past your usual 590k"), while "2.5k per video" beside "63k viewers" stays a price;
  the grader counts a stop to ask about the open house choice HC-08 (female and couple creators, owner not yet picked)
  as a deferral, not a failure. run-02 base rechecked with all of it: 24/30 (24 of the 27 answered); left: three
  cases the browser never delivered, one invented reply type (now re-asked), one empty answer (now resent), and a
  "we represent" claim gate where "agreed we pitch you" was true and available (a real, minor writing miss).
  Because run-02's variants ran under different code, sequence_03/04 were stopped (answers kept) and sequence_05
  launched on /u/0: the pairwise judge's calibration (60 pairs), then run-03 base and write on the same 30 cases with
  the final code, then base v write head to head if the judge chose the coach's rewrite in 80%+ of pairs. Build
  unchanged (comms-2c02f839c6). 128 comms tests. The owner's Whisper watcher (PIDs 11180/3172) was found no longer
  running (started with --idle 720); not touched.
- 2026-10-16 19:55: the pairwise judge's first 21 calibration pairs: the coach's rewrite chosen 21 of 21 (11 of 11 as
  A, 10 of 10 as B), with coach-like reasons (proves the video was watched, bridge into the offer, ends on a yes-or-no
  question). A student's email against the coach's rewrite is the easy end, though; two decent drafts are harder, so
  the head-to-head now judges every case in both orders and counts a win only when the two agree ("split" otherwise).
  129 comms tests.
- 2026-10-16 20:48: **pairwise judge calibrated: 56/60 (93.3%)** chose the coach's rewrite over the student's email
  (28/30 per side, no ties, no failed sends; order balanced by hash). All four misses are coach-"mixed" items (the
  close calls), each with a playbook-consistent reason (e.g. no "$50K" before the budget is known; a rewrite that
  demands analytics cold against INF-FIRST-05). This is the first quality instrument today that clears its bar
  (absolute coach verdicts: 51-62%). sequence_05 moved on to drafting run-03 base, then write, then base v write in
  both orders.
- 2026-10-16 21:30: run-03 base drafted slowly: tab 4 answered in 4-9 minutes while tabs 1 and 2 timed out on prompt
  after prompt (15 min each), and each timeout used up a prompt's attempt while the broken tabs kept taking prompts.
  `comms/pool.py`: a response timeout is now a tab problem: the prompt goes back without using an attempt, the tab is
  stopped and reloaded, and after three in a row it is retired (test). sequence_05 stopped and relaunched (answers kept;
  the pairwise calibration is not redone). 130 comms tests.
- 2026-10-16 21:46: **paused for the night.** After the relaunch /u/0 answered nothing in 16 minutes (6 answers in the
  hour before); all three tabs were timing out, as /u/1 did from 16:25: the accounts slow down after a long day of use.
  sequence_05 stopped; every answer kept. State: pairwise judge calibrated (56/60); run-03 base 6/30 drafted; run-03
  write and the base v write head-to-head not started. To resume (both accounts rested), from the scratchpad:
  `python -u sequence_05.py` (it skips what is done); with /u/1 healthy again, POOL can go back to --accounts 0,1.
- 2026-10-16, next idea (not built): **a direct graduate bar with the pairwise judge.** The calls hold situations
  with a student's email and the coach's rewrite. Turn a held-out set of them into engine cases, let the engine draft
  its own answer, and judge it pairwise (both orders) against the student's email (it should win nearly always) and
  against the coach's rewrite (graduate level = it ties or wins in about half or more). That measures the writing
  against the course's own answers instead of only ranking our variants against each other.
- 2026-10-17 20:09: **resumed** after ~22 h of rest, on both accounts (`--accounts 0,1`, 3 tabs each). A smoke test
  first (one tab per account, two run-03 base cases): both answered at thinking high in under five minutes, 2/2 graded
  clean. sequence_05 relaunched (it skipped the pairwise calibration, already done). Seen in the smoke drafts: a first
  email bridging with "Speaking of useful software over hype", the kind of cheesy transition the coaches roast
  ("Speaking of nice things", call item 4031); to check across run-03 before adding a check.
- 2026-10-17 20:20: **the graduate bar built** (`comms/gradbar.py`, `data/comms/tests/gradbar.json`, 6 tests). 33
  roasts from the calls where the coach rewrote a student's email, in the agency's niche: 14 AI, coding or software
  ("ai") and 19 consumer tech ("tech", the closest niche the calls have, reported apart; travel, fashion, fitness and
  so on left out). Each is an engine case written from the call's situation and the student's own email only (the
  coach's rewrite was not read while writing them; placeholders like [Brand] kept). Left out: item 7078, whose
  rewrite shares 15 seven-word runs with the built skill (a recall test, not a writing test); two others share one
  stock phrase each and stay. The 33 are held out of the example bank (`example_bank.build`, 928 -> 897 entries), so
  the write variant is never shown the rewrite it is judged against. Judging: the engine's draft against the coach's
  rewrite in both orders (a verdict that flips is a split) and against the student's email once; a subject line is
  shown only when the other draft has one (most rewrites were spoken without one). Bar (judgment tier): the engine
  ties or wins against the coach in about half the cases or more, and beats the student nearly always. sequence_06
  (queued behind sequence_05) drafts the 33 with the variant that wins base v write and judges them
  (`E:\IMA work\Learning\scenario runs\gradbar-01`). 131 comms tests.
- 2026-10-17 20:35: **run-03 base finished: 28/30 as run, 29/30 (96.7%) rechecked**, 0 gate misses, replies 15/15,
  key rules cited 37/47, on both accounts with one tab timeout. Two fixes from its two failures (machine tier):
  - brd-no-1: "Not interested at this time, thanks." got a reasonable question back (timing or fit?) but a follow-up
    in 3 working days: chasing a no (BRD-FU-05: after a no, stay in touch). `engine.reconnect` now moves a follow-up
    under 20 working days after a no, a pause or a not-interested to the reconnect (60, or the time they named), and
    keeps the model's date when they named the time themselves; `_named_start` also reads "next week", "next month",
    "in two weeks" (test). This is the 29th pass above.
  - inf-first-iswaryaagp: Gemini answered a bare {subject, body}, and the same again after the format was spelled out:
    blocked UNPARSED. The engine now asks the whole case once more in a fresh chat (new ref) when a chat stays in
    another shape (test). The draft itself was fine (one of the case's numbers, its titles, no gate).
  Both changes reach the graduate bar (sequence_06 starts new processes); run-03 base and write drafted on the same
  engine, so their head-to-head stays like for like. 133 comms tests.
- 2026-10-17 22:07: **run-03 base v write, same 30 cases, same engine, judged pairwise in both orders: write 11, base
  8, split 9** (28 cases with a message in both; no failed sends, no usage limits). Mechanics: both 29/30 rechecked
  (96.7%), 0 gate misses; write cites more key rules (43/47 against 37/47). Write's one failure is a real slip the
  checks caught: "Edwina is on our roster" for a creator who only agreed to be pitched (claim gate; BRD-FIRST-16 says
  "we work with"). **By kind the two split: first emails write 7, base 1, split 6; replies base 7, write 4, split
  3.** The judge's reasons are the course's: on first emails write keeps to one honest point from the video, says "we
  work with", leaves out the agency explanation and the case notes, bridges cleanly; on replies base is tighter and
  stays honest about where things stand (inf-mediakit-1: write "acts like we already speak for" the brands). The judge
  also praised "exact numbers" more than once, so the precise view counts are not a writing fault to fix. Next:
  confirm the per-kind result (write for first emails, base for replies) on more replies before making it the
  default. sequence_06 takes write for the graduate bar (31 of its 33 cases are first emails). Bridge note for the
  add-on's owners: "Send was clicked but nothing happened" followed by "Gemini is still generating" (the send did go
  through) came 2 times in run-03 base and 7 times in write (second prompts in a chat); the pool recovers, at the cost
  of a few wasted generations.
- 2026-10-17 22:10: engine variant "auto" (write for a first message, base when there is a thread), from run-03's
  split by kind; built and tested (134 comms tests), not the default until more replies confirm base wins them.
  sequence_06 started the graduate bar at 22:08 (write, both accounts).
- 2026-10-17 23:06: **graduate bar drafted: 33/33, none blocked** (write; 8 ready, 25 needs a person, mostly
  fact_missing for the cases' own placeholders such as [Name]; no usage limits; one tab retired after three "still
  generating" problems). Machine tier: three of the four price gates were false ("220K+ views", "130K+ viewers",
  "200k+ views": the "+" hid the audience word from the money check); fixed in `checks.KILO` (test), only gb-9172's
  real $900 counter-offer stays gated. Seen in the drafts: the same three phrases nearly everywhere ("we're onboarding
  creators", "could be a good fit", "Are you open to paid sponsorships?"): the graduate bar gives the engine no outbox,
  and a batch of first emails needs its unsent drafts counted as recent messages (integration requirement). The
  pairwise judge sees one pair at a time and cannot see this; the tic check can. Judging (99 comparisons) started.
- 2026-10-18 00:02: **graduate bar v1 judged (99 comparisons, no failures, no limits): the engine's draft beat the
  coach's rewrite in 33 of 33 cases, in both orders, and the student's email in 33 of 33.** Not taken as "better
  than the coaches": the judge's reasons show the comparison is unfair to the coach. In 57 of the 66 coach
  comparisons the reason is that the coach's version is incomplete (52: "skips the offer", "trails off", "no call to
  action"; on the calls the coaches mostly spoke only the part they would change, and only 7 of the 33 rewrites are
  whole emails) or "invents" details (23) that the coach had from the screen or the video but the case, written from
  the student's email, does not hold. What v1 does show: the engine's first emails are complete, honest and follow the
  course's structure, and beat the student's email every time (the judge chose the coach's rewrite over the student's
  in 56 of 60 calibration pairs, so the student is a fair floor). What it does not show: graduate parity.
  **Graduate bar v2 (next):** the graduate's answer is a student email a coach called *good* (a whole email by a
  student who got it right, which is what a competent graduate writes), and the case is written from that email, so
  both drafts hold the same facts. 38 such emails in the AI/tech niche (28 first emails). Two more controls, since the
  judge and the engine are the same model with the same skill and may favour their own style: the same pairs judged
  by a second, different judge, and a blind sample for the owner to choose from.
- 2026-10-18 00:09: **graduate bar v2 built and launched** (sequence_07, gradbar-02). 21 student emails a coach called
  good, in the AI/tech niche (9 ai, 12 tech; 19 first emails, 2 replies), picked from 38: left out were emails cut
  off on the record ("..."), entries holding several emails, a LinkedIn meme and garbled spoken negotiations. Each
  case is written from the good email itself (no rewrite exists), so both drafts hold the same facts; the engine's
  draft is judged against the good email in both orders. `comms/gradbar.py` now takes `bar` (rewrite | good),
  `--bar`, per-item past campaigns and the call's date; v2's items are held out of the example bank too (878
  entries). Drafted with variant auto. 136 comms tests.
- 2026-10-18 00:43: v2 drafted (21/21, none blocked; one answer under the wrong prompt was caught by its ref and
  re-asked); the judge is running. **Owner's blind review page** published (private):
  https://claude.ai/artifact/5T9sCvhWyWnwyMJ1pSe5xH: the 21 v2 pairs, the engine's draft and the good email in a
  random order (the engine is A in exactly 10), "Send A / Send B / About the same" plus an optional reason, saved to
  the page's `picks` collection (read with ArtifactData). The page holds no hint of which draft is which; the key is
  `E:\IMA work\Learning\scenario runs\gradbar-02\blind_mapping.json` (with the page builder). For fairness a trailing
  sign-off is dropped from both drafts and the engine's subject shows only when the good email has one. The page says
  the student emails were typed up from call recordings, which may hint at the source; the owner judges the move and
  the message. This is the control for the judge favouring its own model's style.
- 2026-10-18 01:15: **graduate bar v2 judged (42 comparisons, no failures, no limits): against student emails a coach
  called good, the engine's draft won 17 of 21, lost 1, split 3: ties or wins 95.2%, wins 81.0%** (ai 9 of 9; tech
  8 won, 1 lost, 3 split). On the judge's reading the judgment-tier bar (ties or wins about half) is met. The reasons
  are the course's: the engine adds the why behind its video point instead of retelling the video, bridges into the
  offer, stays honest about unpitched brands ("looking into"), ends on one easy yes-or-no question; the good emails
  lose on retelling the video, asking for analytics cold, hedging ("I think", "apparently") and claiming a fit
  ("aligns perfectly"). **Where the graduate wins, the reason is voice:** gb-7933 lost in both orders ("sounds like a
  real person texting a creator instead of a stiff AI summary"), and the splits name "a curiosity subject line" and
  "flows as one human thought". That matches the batch tics seen in v1 ("we're onboarding creators", "looking into
  pairing", "could be a good fit", "Speaking of ..."). Caveat kept open: the judge is the engine's own model with the
  same skill, so the owner's blind picks on the review page are the check on it. Next lever (judgment tier): voice and
  variety in first emails (subject lines with curiosity, one human thought, no stock offer line); the unsent-batch tic
  check (integration). Gemini stopped for the night after about five hours: in the last half hour three tabs could not
  confirm thinking "high" again and again (the check refuses before sending, so nothing was wasted).
- 2026-10-18 06:40: **blind review done for the owner by a second, different judge** (the owner had not finished the
  course and asked for it to be done by Claude Opus 5.5 at extra-high effort, in a sealed folder holding only the 21
  pairs and the skill, never the key). It preferred the engine's draft in **17 of 21** (81%), the good email in 4,
  none "about the same"; 8 picks high confidence. Its reasons match the course: the losing draft trailed off instead of
  one yes-or-no question (HC-20, INF-FIRST-05), had no bridge from the hook to the offer or retold the video
  (INF-FIRST-16/26), or claimed beyond the facts. **Caveat on the page:** `build_page.py` drops `status` from the facts,
  so "he agreed we pitch him to [Brand]" (in the case, pairs 05/06/11/13) looked invented to the judge; it decided
  pairs 06 and 13 against the engine. So against a different model the result holds (17-19 of 21), and Gemini's own
  judge (17 won, 3 split) was not flattering itself. Two things it flagged as the next lever, the same as v1: the
  preferred drafts share one skeleton ("Speaking of X, we're onboarding Y creators... could be a good fit... Are you
  open to paid partnerships?"), which at volume trips FND-WRITE-01/14, and the voice it rejected was often the more
  casual one HC-28 asks for. Picks and notes: `gradbar-02/opus_blind/`, and on the review page (`picks`, marked by).
