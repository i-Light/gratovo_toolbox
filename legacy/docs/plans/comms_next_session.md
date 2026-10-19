# Next session: rebuild the gratovo-comms playbook from the whole course

Handoff written 2026-10-15. Read this whole file before acting. The history, decisions and measurements are in
`docs/plans/communication_workflow_plan.md`; its §8 log is the source of truth for what happened and why.

## Goal

Make the Gratovo communication workflow as complete and correct as the course allows. The workflow is the
`gratovo-comms` Gemini skill plus the engine that uses it, and it covers every message to or from creators,
managers and brands, and every deal step. Use the two big sources the playbook did not have when it was first
written:

1. **Transcripts of 86 lesson videos** (all but one). The playbook was written from the lesson pages, which are condensed
   summaries (about 150 characters per video minute).
2. **Advice mined from the 513 coaching-call transcripts** by Gemini. This is still running.

Then rebuild the skill, deploy it, and test it on real scenarios until it is reliable. Do not tell the owner it
works until it has been tested that way.

## Owner's rules (hard)

- **Sources are the course only:** lesson pages, lesson videos and coaching calls.
  - Not the Cold Email Blueprint PDF.
  - Not old skill files.
  - Nothing under `data/gemini skills/`.
  - Not `cards.json`.
  - Never reference the old "email drafter skill.md".
- Every outgoing message waits for a person's approval. There is no auto-send.
- **Test data:** course examples and real channels from `data/database/gratovo.db`. Never read the connected
  mailbox.
- Generated emails are never templated, and never use spam or banned words.
- Precision over speed. The owner accepts long runs.
- Commit or push only when asked. Nothing from this work is committed yet (about 46 changed or untracked paths).
- Never print secrets: there are tokens in `gmail_accounts.local.json`.
- Ask the owner only for decisions that are theirs, for example the house-choice picks, which are still all
  unset.

## What exists (read these first)

### Code: `pipeline/comms/`

| File | What it does |
|---|---|
| `course.py` | Loads lessons and calls (default `E:\IMA work\Learning\course scraping toolkit\course content`, override with `GRATOVO_COURSE_DIR`). Helpers: `norm`, `contains`, `context`, `speaker_of`, `search`. |
| `playbook.py` | `AREAS` (foundations, influencer and brand stages), the `Rule`/`Source` types, `rules()`, `coaches()`, `scope()`. |
| `verify.py` | `python -m comms.verify` (from `pipeline/`). Every quote must be in its source, at least 20 characters, not the lesson title, and call quotes must be said by a rostered coach. Also checks scope. |
| `skill_build.py` | `python -m comms.skill_build` writes `data/comms/skill/gratovo-comms/`: SKILL.md (procedure, hard limits, checklist, JSON answer format) plus `references/` (rules by area and stage, house choices, situations, glossary, build id). Current build: `comms-31a552eb64`. |
| `checks.py` | Deterministic checks on a drafted message (spam words, openers, length, call to action, made-up numbers, copied course lines, repeats) and the gates a person must confirm (price, terms, claims, ethics). |
| `engine.py` | `propose(gemini, case)`: case → skill → Gemini's JSON → checks → repair loop → status (`ready`, `needs_human`, `blocked` or `no_message`). Always sends with thinking high. Not run live yet. |
| `pool.py` | Multi-tab Gemini batch runner. Resumable, saves every answer as it arrives, records the thinking level, waits for a ready tab, recovers answers left on tabs, and pauses on refusals. Defaults: 3 tabs, 60 s between sends. |
| `mine_calls.py` | The call-mining prompt and run, plus `verify`, which writes `verified.json` and only counts answers with a confirmed high level. |

### Data: `data/comms/`

- **`playbook/rules/{foundations,influencer,brand}.rules.json`:** 284 rules, all quotes verified, 93 of 134 lessons
  cited.
- **`playbook/coaches.json`:** 17 coaches, with the label spellings they have in the transcripts.
- **`playbook/house_choices.json`:** HC-01 to HC-12, the places where coaches disagree. The owner has picked none,
  so the defaults apply.
- **`playbook/situations.json`:** deal stages and 47 reply types.
- **`playbook/scope.json`:** the lessons ruled out of scope, and `pending_video` (lessons to cite from their
  videos).
- **`tests/replies.json`:** 47 inbound reply scenarios, one per reply type, with expectations.

### Tests

- Python: `pipeline/tests/test_comms_thinking.py`, `test_comms_pool.py`, `test_gemini_skills.py`.
- Full pytest from `pipeline/`: 642 pass. The 2 failures in `test_drafting_rules.py` predate this work: that
  file was deleted in commit ff4e5d6.
- Add-on: `cd pipeline/gemini_extension/test && npm test` gives 92 of 92.

## The new data

### Lesson video transcripts (complete)

- **Location:** `E:\IMA work\Learning\video transcripts\parakeet\<module folder>\<video>.mp4.json`, with a `.txt`
  beside each.
- **Size:** 86 videos, about 438,000 words. Every file has a lesson id.
- **JSON fields:**
  - `video`;
  - `lesson`: the lesson page id, using the same ids as `course.py`, e.g. `module 8 Bonuses/8.Abu Lahya Reviewing
    Emails`;
  - `duration`;
  - `segments`: `[{start, end, text}]`, in pieces of up to 60 s;
  - `config`.
  - The first 45 files have `config.batch = 16` and longer pieces. Both kinds are fine.
- **Model:** NVIDIA Parakeet TDT 0.6B v2. On 19 videos done by both models it agreed with Whisper large-v3 on
  93.6% of words: about 97% on clean lesson audio and 84–87% on the multi-speaker "Contest Winners" videos.
  Parakeet mishears the odd word; it does not invent text.
- **Quote rule:** a quote from a video is kept only if Whisper hears the same words in that passage.
  - The full Whisper pass was dropped on purpose; check per passage instead.
  - Build a helper that transcribes only `[start − 2 s, end + 2 s]` of the video with Whisper and compares the
    normalised words.
  - Where Whisper lives: the `Whisper` class in `E:\IMA work\Tools\transcribe\transcribe.py`, using the venv in
    `E:\IMA work\Tools\whisper-venv`, with `HF_HOME=E:\IMA work\Tools\hf-cache`. Its settings are no prompt, word
    timestamps and `hallucination_silence_threshold=2`.
  - Record the check in the rule's source.
  - Do not restart the full Whisper pass.
- **The six silent videos were re-downloaded and transcribed on 2026-10-15.** The downloads had no sound track.
  The toolkit re-fetched them (`python manager.py videos --download --fix-silent`, run in
  `E:\IMA work\Learning\course scraping toolkit`), moved the silent copies to `course videos/_superseded/`, and
  each was transcribed as it arrived. They are among the most valuable lessons, so read them first:

  | Lesson id (`lesson` field) | Length | Words |
  |---|---|---|
  | `module 1 welcome/1.2. Learn how to Communicate(most important course)` | 48 min | 9,929 |
  | `module 2 influencers/2.3. Closing an influencer that has an agency` | 47 min | 9,999 |
  | `module 1 welcome/1.4. Sales crash course` | 34 min | 8,275 |
  | `module 1 welcome/1.5. Marketing crash course` | 18 min | 4,370 |
  | `module 1 welcome/1.7. The Most Important Skill Entrepreneurs Need` | 18 min | 4,608 |
  | `module 4 service delivery/4.5. Post Campaign Delivery - Coach Michael` | 8 min | 1,610 |

  That makes **86 transcripts, about 438,000 words**.
- **One lesson video is not available:** `module 6 Student Stories/6.Contest Winner- July - September 2025`.
  - Vimeo serves it only inside Skool's player and answered 403, even with yt-dlp's browser impersonation and a
    Skool referrer.
  - It is a student-stories video, which is low value here. Skip it unless the owner gets the file.
- **Tools for future videos.** When the toolkit reports silent or missing videos, run the command above. Then run
  `E:\IMA work\Tools\whisper-venv\Scripts\python.exe "E:\IMA work\Tools\transcribe\transcribe_new.py"`, which
  transcribes each new linked file as soon as it is complete. The E: venv also has a yt-dlp with browser
  impersonation (curl_cffi), for when Vimeo blocks the toolkit's default yt-dlp.
- **Recheck `scope.json` → `out_of_scope` against the transcripts.** Those decisions were made from the page
  summaries only. Examples:
  - "1.7 The Most Important Skill Entrepreneurs Need" is marked "personal mindset";
  - "1.3 Understanding business" is marked "generic business framing".

  Keep a lesson out only if its transcript has nothing on communication or deals.

### Mined coaching calls (in progress)

- **Location:** `E:\IMA work\Learning\mined calls\answers\<call key>.json`.
- **How they were made:** Gemini 4 Argon at **high** thinking, one prompt per call.
- **Item fields:** `kind` (advice, roast or disagreement), `side`, `stage`, `situation`, `advice`, verbatim
  `quotes`, and for roasts `student_email`, `verdict` and `rewrite`.
- **Progress:** at 2026-10-15 ~04:00, 184 calls were done. The 15 remaining Fawaz Central sessions are now
  skipped, which leaves about 315 calls at about 40 an hour, so roughly 8 hours more. A Windows toast appears at
  the end, and `status.json` then shows `"finished": true`.
- **Verifying:** `python -m comms.mine_calls verify` (from `pipeline/`) checks every quote against the transcript
  and the coach roster and writes `verified.json`. It is offline, so run it whenever you like. In the pilot, 98.6%
  of quotes verified.
- **Use items as raw material:** write rules by hand from them, never copy them in wholesale.
  - Some advice clashes with the honesty rules: "don't say you're an agency in the first email", "lowball the
    creator", "never disclose your margin". Reconcile these with the FND-ETH rules and house choices, ethics
    first.
  - Some items are off-topic, such as YouTube email-lookup tricks. Skip them.
- **Experiments, never sources:** the folders `low-thinking-2026-10-14/` and `level-test/`.

#### Quality audit (2026-10-15, on 184 answered calls)

The mining output is good enough to build on. No mining skill and no re-run are needed. The problems were all in
the checking tools, and they are fixed.

**What `verified.json` holds**

- 3,794 items: about 3,300 advice, 400 email reviews ("roasts") and 90 coach disagreements, from 184 calls.
- 8,965 quotes:
  - 8,400 (93.7%) are verbatim and said by a rostered coach;
  - 280 (3.1%) are trimmed to the coach's own sentences and marked `"trimmed": true`;
  - 46 are not found;
  - 239 are a student speaking. Gemini sometimes quotes students; the checker drops those.
- 98.4% of items keep at least one checked quote.

**What a careful read found**

- **Advice:** 8 of 8 sampled items were faithful to the quote in context, with specific situations and sensible
  side and stage labels.
- **Disagreements:** 5 of 5 were accurate. They are the most valuable part, because they show where coaches
  differ and where **newer call guidance overrides a lesson**. Examples:
  - Ammar now bans "Partnership/Sponsorship request" subject lines, which a lesson teaches, because about 700
    students copy them.
  - Younes says to ignore the 50k–500k subscriber rule and filter by recent views (35–50k or more).
  - Younes names the creator plus one key stat in the first brand email; other coaches pitch generally.
  - Use the call `date`, and prefer the newer guidance when it is a coach's explicit correction.
- **Roasts:** the coach's verdicts and reasons are faithful and quoted. But `student_email` and `rewrite` are
  **reconstructed** by Gemini, because the email is shown on screen and only partly read aloud.
  - `email_read_aloud` gives the share of 6-word runs found in the transcript: of 401 emails, 42 scored 0.6 or
    more, 272 scored between 0.2 and 0.6, and 87 scored below 0.2.
  - Use them only as labelled "reconstructed" learning examples, never as exact course emails. Only the coach's
    quoted words are evidence.
- **Coverage:** in a 10-minute stretch of an email-review call that I read myself, every coaching point became an
  item, including ones buried in long turns.

**Fixed in the tools**

- `Call.turns`: a quote may cross a timestamp line inside one speaker's turn, never across two speakers.
- `mine_calls.coach_part`: keeps the coach's sentences when the transcript changes speaker late.
- Coach list: added the plain "Farhad Dlir" label. Every other unlisted heavy speaker is a student.
- `parse_answer`: reads Gemini's broken JSON (bare quotes, an answer that restarted halfway, item-by-item
  fallback).
- `fawaz_led`: Fawaz Central sessions (habits, sleep, productivity) are no longer mined; answers already made for
  them are kept.
- Tests: `pipeline/tests/test_comms_mining.py`.

## Gemini: operating rules (learned the hard way)

- **Don't start any Gemini or bridge process while the mining run is going.** The run owns bridge port 8765 and
  the managed Firefox tabs.
  - To check: `Get-CimInstance Win32_Process | ? CommandLine -match 'mine_calls'`, and the `status.json` above.
  - Do the offline steps first. If you must use Gemini earlier, stop the run on purpose; it resumes when
    restarted with `python -m comms.mine_calls run`.
- **Account:** the managed Firefox profile is now signed into a second account.
  - English UI, with 4 Argon and tasks.
  - Its chats are not saved, so the address stays on `/app`. Add-on 0.3.7 handles that.
  - The first account was refused for a while after about 25 heavy prompts in 35 minutes on 10 tabs.
- **Thinking level:**
  - It resets to low on every new tab and reload.
  - Always pass `thinking: "high"`. The add-on sets it and reads it back, and answers record it.
  - Measured on long inputs, medium finds about 16% fewer items and 27% fewer quotes.
  - For the drafting engine, test medium against high fairly before choosing.
- **Pace:** 3 tabs and at least 60 s between sends. A toast like "check your internet connection" is a refusal:
  pause for 30 minutes or more.
- **Fair comparisons:** one prompt per fresh chat or tab. Never put several test prompts in the same chat.
- **Skill deployment:** `gratovo-comms` is **not** deployed on the new account.
  - Deploy with `gemini_bridge.skills.deploy` or `python -m gemini_bridge skill-deploy <folder>`, then probe the
    build id.
  - A skill must be picked from the `@` list; typing "@name" as text does not invoke it.

## The task, in order

1. **Videos in the code.**
   - `course.py` loads the Parakeet transcripts as sources, for example `video:<lesson id>` with timed segments.
   - `verify.py` accepts video quotes when:
     - the quote is in the transcript;
     - the speaker is the lesson's coach;
     - the passage is confirmed by the Whisper check.
   - Resolve `scope.json` → `pending_video`.
2. **Playbook from the videos.** Go lesson by lesson, highest value first:
   - the six re-downloaded lessons above: Learn how to Communicate, Closing an influencer that has an agency,
     Sales crash course, Marketing crash course, Post Campaign Delivery, The Most Important Skill;
   - module 1: cold email, writing, deliverability;
   - module 2: influencers;
   - module 3: brands, pitching, negotiation, objection handling;
   - module 4: contracts, delivery;
   - the bonuses: Abu Lahya Reviewing Emails, How To Take sales calls, upselling.

   For each lesson:
   - add the missing rules;
   - deepen the existing ones with steps, examples and numbers;
   - cite verbatim video quotes that Whisper has checked.

   Cover the 41 lessons that are still uncited, or record in `scope.json` why not. Optionally, mine the videos
   with Gemini the same way as the calls (one prompt per video, same verify, reusing `pool.run`), but only after
   the call mining finishes.
3. **Playbook from the calls.** From `verified.json`:
   - new rules and edge cases for each reply type;
   - roast examples (the student's email, the coach's verdict and the coach's rewrite) in an examples reference
     marked "learn from, never copy";
   - evidence for the house choices: follow-up timing, daily caps and so on;
   - coach disagreements, recorded in `house_choices.json`.
4. **Rebuild.** `python -m comms.verify` must come back clean, then run `python -m comms.skill_build`. Review the
   skill's size and structure, and add the examples reference.
5. **Test, after the mining finishes.**
   - Deploy the skill on the new account.
   - Build the scenario runner.
     - Inputs: `data/comms/tests/replies.json`, plus first-contact cases from real channels in `gratovo.db`.
     - Channel fields to use: subscribers, `median_views_last_30`, recent video titles, `seen_brands`,
       `sponsored_ratio`, country.
     - Run it with `engine.propose` at thinking high, 3 tabs, one case per fresh chat.
   - Grade with `checks.py`, the expectations, and a careful read.
   - Iterate on the rules and the skill until two consecutive runs both pass at least 95% of scenarios, with every
     safety gate holding (price, terms, claims, ethics).
6. **Keep the log.** Update the plan's §8 log, and report to the owner honestly, with numbers.

## Gotchas

- Whisper invents text when given a prompt: the hint leaked into 2 of 19 files as "In this lesson, we'll talk about
  influencer outreach…". It also sometimes adds "thanks for watching". Use Whisper only as a cross-check, never as
  a source.
- A generated email must never reuse a course sentence; `checks.py` enforces this with `COPY_COURSE`.
- Use `PYTHONIOENCODING=utf-8` when printing Arabic or other non-Latin text on this Windows console.
- Long jobs run detached, with a toast at the end. Don't babysit them.
- The transcription run is stopped. Nothing else of this work is running except the call mining.
