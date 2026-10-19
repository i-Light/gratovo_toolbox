# Build an outreach handbook from these critiques

You are being handed a batch of raw study notes on cold-outreach emails. Turn
them into one self-contained Markdown handbook. Everything you need is in this
message - do not ask for files, and do not assume you can open anything.

## What this data is

Below is a numbered list of records. Each record is **one real cold email**,
quoted verbatim, paired with **the verdict an expert gave on it** while
reviewing it out loud in a training video.

Every email in this batch was written to an **influencer or content creator** - B2C-style outreach, usually proposing a sponsorship, a collaboration, or a paid placement.

Each record can carry these fields:

- **Video date** - when the training video was published. Advice from three
  years ago and advice from last month are not equally load-bearing; where two
  records disagree, the newer one is usually the revision.
- **Timecode** - where in that video the email was reviewed.
- **Stage** - where the email sits in an outreach sequence: initial cold
  outreach, follow-up, or closing.
- **Niche** - what industry or vertical the email was for.
- **Context** - the situation the email was written into: who the recipient
  was, what had already happened. A follow-up is unreadable without it.
- **Subject** and **Body** - the email itself, exactly as written. `@receiver`,
  `@sender`, `@creator`, `@brand` and `@product` are placeholders standing in
  for real names.
- **Critique** - what the expert said about it.

**The critique is the load-bearing part.** The email is the example; the
critique is the lesson. An email with no critique is a data point with no
verdict attached - use it only as illustration, never as the source of a rule.

## What to produce

A single Markdown document, structured like this:

1. An `# H1` title.
2. A short provenance paragraph: what this was built from, the date range, and
   how many source records.
3. A **Contents** list, numbered, linking to each section anchor.
4. Then numbered `## H2` sections. Suggested spine - drop any section the data
   does not support, and add any it demands:
   - Core Principles
   - Power Dynamics (who is asking whom for what)
   - Anatomy of a Cold Email (subject line, opener, body, offer, CTA, sign-off)
   - Personalisation & Research
   - Follow-Up Sequences
   - Handling Replies & Objections
   - Negotiation & Pricing
   - Banned Words & Phrases
   - Hard "Never Do" List
   - Worked Examples (a weak email, the critique, and the rewrite)
   - Pre-Send Checklist
5. Inside each section, state rules in a Markdown table with the columns
   `| # | Rule | Why |`, numbered `<section>.<n>` - so 3.1, 3.2, and so on.
   The **Why** column carries the expert's actual reasoning, not your own.

## Rules for the extraction

1. **Be exhaustive.** Extract every rule, heuristic, warning and preference
   the critiques contain, including ones stated only once and ones stated in
   passing. A rule you judged too minor to include is the failure mode here.
2. **Deduplicate ruthlessly.** The same advice recurs across many records.
   State it once, in the section where it belongs, and let its frequency show
   up as confidence - a rule repeated in ten records is a stronger rule than
   one mentioned once, and it is worth saying so.
3. **Preserve exact wording for examples.** When a critique names a phrase as
   good or bad, quote that phrase verbatim rather than paraphrasing it. The
   before/after pairs are most of the practical value; a paraphrase destroys
   them. Prefer a two-column `Instead of | Write` table for these.
4. **Never invent.** Every rule must trace to a critique in this batch. Do not
   supplement from general knowledge about cold email, and do not smooth over a
   gap with something that sounds right. If the data does not cover something,
   the handbook does not cover it.
5. **Surface contradictions, do not resolve them silently.** When two records
   disagree, give the disagreement its own section near the end: what each
   said, which record each came from, which is more recent, and your reading of
   which applies when. A handbook that hides a conflict teaches a rule that
   will fail.
6. **Cite provenance.** After each rule, note the record number(s) it came
   from, like `[#4, #17]`, so any line can be traced back to the email that
   produced it.
7. **Generalise, but only one step.** A critique about one email's specific
   wording becomes a rule about that kind of wording. It does not become a rule
   about outreach in general.
8. **Keep the reader in mind.** This is a working reference someone consults
   mid-draft, not an essay. Short rules, scannable tables, no throat-clearing.

Output the finished Markdown document and nothing else - no preamble, no
summary of what you did.

---

## Batch provenance

- Audience: Influencers / creators (B2C outreach)
- Video-date range: 2015-01-01 to 2026-09-02 (inclusive)
- Records in this batch: 7
- Exported: 2026-09-02

---

## Source records

### Record #1

- Video date: 2026-07-31
- Timecode: 3:20
- Stage: Initial cold outreach
- Niche: Tech, Ai

**Subject:**

```
Quick one
```

**Body:**

```
Andrew - that bit in your Fitbit video about thin wearables messing up heart rate during tennis, makes sense.

Are you open to working with more brands on the channel?

Best regards,
@sender
```

### Record #2

- Video date: 2026-08-05
- Timecode: 4:00
- Stage: Initial cold outreach
- Niche: Outdoors

**Subject:**

```
@receiver, sound good?
```

**Body:**

```
Hey @receiver,

Wow. Found out from your Mongolia trip that it really is full of Toyota Priuses. Learned something new.

Given the outdoor content, brands like X and Y could make sense for your channel. We'd find and introduce them to you and handle that boring stuff so you could spend your time better elsewhere, like content creation.

Does this sound good to you?

Best
@sender
```

### Record #3

- Video date: 2026-08-05
- Timecode: 10:00
- Stage: Initial cold outreach
- Niche: Productivity

**Subject:**

```
Why we do what we do
```

**Body:**

```
Hi @receiver

As a currently busy person, your philosophy resonates strongly with me - helping people make meaningful progress towards purpose-driven goals. What if I were able to partner you with brands that you valued and resonated with on a consistent basis? If this sounds interesting, get back to me.

Kind regards,
@sender
```

### Record #4

- Video date: 2026-08-05
- Timecode: 15:00
- Stage: Initial cold outreach
- Niche: Outdoors

**Subject:**

```
Yo what’s up Aaron🤙🏻
```

**Body:**

```
That 17ft Cobia restoration video was great. You made a messy electrical job look much more approachable. I laughed at the “I might have got a little bit carried away” moment. I’d end up digging half of it back out😆

What I do know is that I work with influencers to get them brands that better fit their content and audience. 

I’ve noticed your channel relies mostly on affiliate links rather than integrated sponsorships, which seems pretty common in the marine space.

Is that a deliberate choice?

Best Regards
```

### Record #5

- Video date: 2026-08-05
- Timecode: 20:00
- Stage: Initial cold outreach
- Niche: Automotive

**Subject:**

```
Schrodinger’s rotary
```

**Body:**

```
Hey @receiver 

Calling it a Schrodinger’s rotary rebuild is the most accurate description of the engine I’ve read it either runs or it doesn’t, and nobody knows until you turn the key.

Luckily this next part is more predictable. We’re gathering a list of influencers for brands such as Mishmoto and Fitment industries, and your builds seems like a good fit.

Are you interested?

Best regards
@sender
```

### Record #6

- Video date: 2026-08-05
- Timecode: 22:00
- Stage: Initial cold outreach
- Niche: Automotive

**Subject:**

```
Forty grand into a key truck
```

**Body:**

```
Hi @receiver

You spent eight months and forty thousand dollars on a kei truck, then started the video by questioning whether it was worth it. Most creators would’ve left that out.

On a side note, we’re gathering a list of influencers for brands such as Lectron and Osla Tools, and your projects seem like a match for those.

What do you think about it?

Best regards,
@sender
```

### Record #7

- Video date: 2026-08-05
- Timecode: 22:30
- Stage: Initial cold outreach
- Niche: Automotive

**Subject:**

```
Alcohol markers
```

**Body:**

```
Your point about the most useful tool in a workflow being a set of alcohol markers rather than a CAD program is truer than most people admit!

On another note, we are currently compiling a list of influencers for brands like Mishmoto and Fitteen52, and your channel looks like a great fit.

Would you be interested in collaborating with us?

Best regards,
@sender
```
