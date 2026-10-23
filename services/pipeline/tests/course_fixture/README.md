# A made-up course for the comms tests

The real course (lesson pages, coaching-call transcripts, video transcripts) is the owner's purchased content. It lives only on the owner's PC and is never copied here (plan D8). The comms tests run against this small course instead. Its text was written for the tests: short lessons about cold outreach to AI creators and AI tool brands. None of it comes from the real course or the playbook's quotes.

It has the same shapes `gratovo_pipeline.comms.course` reads:

- `course/pages clean text/<module>/<lesson>.txt`: the lessons. Module 7 holds call summaries, which are never sources.
- `course/transcripts.json`: the coaching calls, segments starting `@m:ss - Speaker`.
- `videos/<module>/<lesson>.mp4.json`: a lesson video's timed pieces. `.partial.*` files are not sources.

Tests point the course at it with `course.configure(...)` and reset with `course.configure(None, None)`.
