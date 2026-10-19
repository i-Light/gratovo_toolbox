# The Gratovo playbook

Everything the communication workflow knows about talking to influencers and brands, taken from the
course and nowhere else (owner's decision, 2026-10-14). Each rule says what to do in our words and
carries the course's own words as proof. `python -m comms.verify` (from `pipeline/`) fails when a quote
is not in its source, when a call quote is not a coach's, or when a lesson in scope is never cited.

## Files

- `rules/<area>.rules.json` — the rules, one file per area (see below). Each file: `{"area", "rules": [...]}`.
- `coaches.json` — whose words count when a rule quotes a call transcript.
- `scope.json` — lessons that are in scope (must be cited) or out of scope (with the reason).
- `house_choices.json` — where coaches disagree: the options, who said what, and the owner's pick.

## A rule

```json
{
  "id": "INF-FIRST-04",
  "stage": "first_contact",
  "title": "Lead with what is in it for them",
  "rule": "One or two sentences: what to do, in our words. Never a coach's wording to copy.",
  "when": "Only when … (optional: the situation this rule is scoped to)",
  "do": ["…"],
  "dont": ["…"],
  "steps": ["…"],
  "level": "must | should | tip",
  "src": [{"doc": "module 2 influencers/2.How to Message Influencers - Coach Ammar", "quote": "verbatim words", "at": "6:37"}]
}
```

- `doc` is a lesson id (its path under the course's `pages clean text`, no `.txt`) or `call:<share_id>`.
- `quote` is copied from the source; only case, curly quotes, dashes and spacing may differ. Read the
  quote in its context before writing a rule on it (an earlier rule was built on a misread fragment).
- `level`: `must` = a coach states it as a rule; `should` = the default the course teaches; `tip` = a
  technique a coach recommends for some cases.
- Rules state the idea, never a template: generated messages must never copy a course line.

## Areas and stages

| file | area | stages |
|---|---|---|
| `foundations.rules.json` | how we sound and work, both sides | `mindset`, `writing`, `subject`, `formatting`, `channels`, `deliverability`, `ethics` |
| `influencer.rules.json` | creators and their managers | `qualify`, `first_contact`, `follow_up`, `replies`, `offer`, `pricing`, `negotiation`, `managers`, `closing`, `onboarding`, `delivery`, `payment`, `after` |
| `brand.rules.json` | brands and their agencies | `qualify`, `first_contact`, `follow_up`, `replies`, `objections`, `offer`, `presenting`, `negotiation`, `closing`, `contract`, `payment`, `delivery`, `after` |
