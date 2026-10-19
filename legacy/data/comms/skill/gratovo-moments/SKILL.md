---
name: gratovo-moments
description: Finds the moments in one YouTube video's subtitles that the Gratovo agency's first email to that creator can mention - one specific, checkable point a stranger could not paste into an email to anyone else. Use it on a transcript before a first email to a creator.
---

# Usable moments in a creator's video

The agency writes a first email to a YouTube creator. The email's personal line must point at one specific moment of their latest video - something that proves a person really took in the video and that could not be pasted into an email to anyone else (INF-FIRST-02, FND-WRITE-09). It makes one point, casually, and never retells the video (INF-FIRST-26). Your job is to read the transcript and pick the moments that line can use. You do not write the email.

The message you receive contains the video's title, its upload date, whether the subtitles are automatic, and the transcript with time marks like [7:40].

## What makes a moment usable

A usable moment is a short passage where the creator says something **specific to this video** that a reader can check by jumping to the time mark. Look for, in roughly this order of value:

1. **A strong opinion or verdict** - "I'm cancelling my subscription", "this is the best model for coding right now", "nobody should pay for this".
2. **A surprising result or number from something they did** - a test, a benchmark, a measurement, a cost: "it took 41 minutes", "it got 3 of 10 right", "I spent $200 on API calls".
3. **A test or experiment they ran on camera** - what they tried and how it turned out.
4. **An admitted mistake or a change of mind** - "I was wrong about this last month", "I switched back".
5. **A prediction or a bet about what comes next** - "in six months every editor will have this".
6. **A contrarian take against the common view** - "everyone says X, I think the opposite".
7. **A personal story or detail** - something from their own work or life that the video tells.
8. **A running joke or a memorable line** the audience would recognise.

Prefer moments from the first and last minutes and from the part the video builds towards (the result, the verdict): that is where the creator puts their point.

## What is never usable

- **Sponsor reads, ad segments, discount codes, affiliate links**, and "this video is sponsored by" passages - they are not the creator's own point, and the email is about brand deals.
- **Intros and outros that fit any video**: greetings, "smash the like button", "subscribe", channel updates, merch, Patreon shout-outs.
- **A summary of the whole video** or of the channel - the course forbids an AI-style overview (INF-FIRST-02).
- **Anything only visible on screen**: "look at this", "as you can see", a chart they point at - the email cannot quote a picture.
- **Praise of any kind** you would add yourself, and anything the creator did not actually say.
- **Moments about sensitive or haram topics** (gambling, alcohol, adult content, interest-based finance), or a tragedy, an illness, a family loss - not a light opening for a business email.
- **Proper nouns you cannot trust**: automatic subtitles mangle names ("n8n" comes out as "NAN"). When the subtitles are automatic, describe a name generically ("the automation tool") unless the title spells it.

## How to answer

Pick 3 to 5 usable moments, best first. Fewer is fine when the video has fewer; none is a valid answer for a video that is only a sponsor read, a stream recap or music. Answer ONLY with JSON, no other text:

```json
{"moments": [
  {"at": "7:40",
   "quote": "the creator's own words, at most 25 words, copied from the transcript",
   "point": "what they meant, in one short plain sentence",
   "kind": "opinion | result | test | mistake | prediction | contrarian | story | joke",
   "why_usable": "why this proves the video was watched and is specific to it",
   "bridge": "one short way an email could pick it up casually, without retelling it - no praise, no 'I watched', no 'the way you'"}
 ],
 "auto_subtitles": true}
```

Rules for every field:

- `at` is the nearest time mark before the quote, exactly as written in the transcript.
- `quote` is copied, not rewritten; trim it, never join two passages into one (the quote must stand alone).
- `point` and `bridge` add nothing the creator did not say. No numbers you did not see in the transcript.
- Keep the creator's language in `quote`; write `point`, `why_usable` and `bridge` in English.
