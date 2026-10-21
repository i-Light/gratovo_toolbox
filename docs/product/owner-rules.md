# The owner's rules and preferences

What the owner has asked for, with the reasons, collected from past sessions so every session (local or cloud) starts with them. When the owner changes one, update it here in the same commit.

## Who the app is for

- **For the next six months, mostly the owner.** Employees (account managers, VAs) come later and must learn fast, so every screen explains itself and roles are built in from the start.
- **Windows only** (owner, 2026-10-19). The app is built, tested and supported on Windows alone, for the long term. Put no effort into Linux, macOS or phones (no CI jobs, test workarounds or docs for them) until the owner asks for another system. That includes phone-sized layouts: UI is checked at desktop width only, never at 400 px (owner, 2026-10-20). Cloud sessions still run in Linux containers; there they edit code and run lint, typecheck and unit tests, and the app itself is tested on Windows in CI.
- **Dark only, for now** (owner, 2026-10-20). The app always runs in the dark theme. There is no theme switch (no Settings row, palette action or menu hint), and the light theme isn't built, tested or looked at. The light tokens stay in `tokens.css`, so a theme choice can come back when the owner asks. The owner's reason: make the app work first, not the light theme.
- **No hand-off file** (owner, 2026-10-20). `docs/handoff.md` was removed. The migration plan's status table says where work stands and what is next, and `.router/PROGRESS.md` holds a step in progress. Lasting notes and lessons live in [workflow.md](../workflow.md).
- **Keys: no rotation for now** (owner, 2026-10-20). The leaked keys (A1) are not rotated yet. Use the existing ones from the old repo's `data/.env`, but only at run time: in the app's secret store or Supabase's function secrets. Never print, log, commit or copy them into this repository.
- **Team roles** (owner, 2026-10-20). The agency's roles are what someone does:
  - **Owner:** runs the agency; full access to everything, including the hidden admin sections and tools.
  - **Scout** (the VA's search part): searches for AI creators, sorts and shortlists the finds.
  - **Outreach** (the VA's email part): writes to creators, follows up, handles replies.
  - **Deal lead:** pitches brands, negotiates, signs the deal. Works mostly in Close, but can read and edit anything that bears on a deal, notes included.
  - **Delivery:** makes sure the video goes live, sends the report, tracks payment.

  One person can hold several roles, because a small team can't have one person per role: store a list per person (for example Omar as Scout and Outreach). Roles and access are separate: what someone does is apart from what they can see, so "sees money" stays its own switch.
- **English only for now.** The old app had Arabic; strings stay in one place per feature so a language can be added later.
- **The niche is AI.** Creators who cover AI tools, chatbots, coding with AI (Claude Code, Cursor, MCP), AI video and AI news; brands that sponsor them (for example Higgsfield, Wispr Flow, Zapier, invideo, GoDaddy Airo, Vanta, Even Realities). Every example, persona, fixture and test channel comes from this niche. Woodworking or travel channels were rejected as "irrelevant to my niche".

## Safety and data

- Never print, log, commit or copy secrets.
- **Never read the connected mailbox,** and never use real inbox content as test data. Test data comes from the course examples and real public channel data.
- **Never send email automatically.** Every outgoing message waits for a person's approval. Auto-send may be unlocked per message type later, after about 95% of drafts are approved unedited, and only by the owner.
- Don't commit or push unless the owner asks, or a plan step's planned end is a commit.
- **Sessions run the GitHub side themselves** (owner, 2026-10-19). Open the pull request, get CI green, fix the review findings, then merge it. Never ask the owner to merge or to do anything by hand on GitHub. Stop to ask only a critical question about the workflow or the migration that the docs don't answer.
- Cleanup comes last: nothing is deleted from `legacy/` or merged in the docs until the 100% check (step 10) has passed.
- **Nobody uses the old app** (owner, 2026-10-20: "I don't care about the old app at all, no one is or will use it"). Nothing keeps it working, and there is no old-app check after a rollout. Production data still matters: a migration never destroys or rewrites existing data, and anything that alters what exists gets its own production step with the owner's go.

## Replies and drafting

- **Replies:** by default the app reads them. A convenient way to paste a reply by hand covers any failure, and it must stay compact and quiet ("shouldn't be screaming for attention or taking too much space").
- **Knowledge comes from the course only:** the lessons and the coach calls. Not the Cold Email Blueprint PDF, not old skill files, not `cards.json`. Never learn from, quote or compare against the old `email drafter skill.md`.
- **Never templated:** banned words are never used, and each email varies its words, structure and flow, so it never reads like the same AI template. Checks reject drafts that repeat openers or sentences from earlier drafts.
- **Quotes stand alone:** a playbook quote proves its rule by itself. Quote the whole point (up to about 70 words), one passage per quote, never ending on a colon or "N things". The owner reviews video quotes by ear (`legacy/review_quotes.bat`, the quote review page); flagged quotes are fixed by quoting the full passage from the transcript.
- **The bar is a trained graduate of the course, in most cases,** for judgment: reading the person, angle, tone, personalisation. **Where machines are stronger, the bar is near-perfect** and is never traded away. That covers:
  - every applicable rule applied;
  - the same care on the 500th message;
  - every fact and number checked;
  - the money and contract gates;
  - follow-ups on time;
  - never templated;
  - speed.
  Report the two tiers separately, and propose a different design when the current one can't get there.

## Gemini

- Live Gemini automation is allowed. Ask the owner when a step needs them (signing in, a choice).
- **Thinking level must be verified as high on every send.** It resets on every new tab or reload. Output made on low is never used.
- **Pacing:**
  - 3 tabs at most, at least 60 s between sends, one prompt per fresh chat;
  - never stack tabs and never retry `open` in a loop;
  - a refusal toast, or three generic errors in 15 minutes, means pause for 30 minutes or more.
  - An account lasts about 9 hours of steady use a day.
- **Long deterministic runs** are launched detached, checkpoint every answer to disk, and end with a Windows toast and a summary file. Don't babysit them.
- Never run two Gemini bridge runs at once (port 8765).

## Design

- **Deep, powerful, simple on the brain, and it feels nice.** Lots of convenience, quality of life and feedback. Not plain or immature.
- **Prototype mode:** the real app on injected example data (not a clone), owner-only, off by default, with minimal impact on normal use ("as if that mode didn't exist"). It has scenarios and a comment tool for planning and future fixes.
- **The account:** clicking your own picture opens your account and Settings. The sidebar shows your real name, and when collapsed it shows only the picture.
- **Channel banners** appear on the side panel and on the full record page.

## On hold

The workflow-map gaps the owner marked **Noted** wait for their input: `search-1`, `first-1`, `mail-1`, `mail-2`. Don't build them. Their details are in `legacy/docs/plans/decisions_build_plan.md`.

## Carried over from the old app (moot now that nobody uses it; kept until the step 11 cleanup)

- Paste `legacy/backend/schema.sql` into Supabase before 2026-10-30. After that date, new tables need explicit grants.
- Set the agency sender name in the old app.
- The 30-day report code is kept but switched off for now (owner's choice).
