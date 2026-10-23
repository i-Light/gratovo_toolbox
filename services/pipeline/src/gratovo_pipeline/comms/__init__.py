"""The Gratovo communication workflow (started 2026-10-14): one case in, one checked proposal out.

The course is the only source of truth. Its text is the owner's and stays on the owner's PC (plan
D8); the playbook built from it ships in `services/pipeline/data/comms/` (`gratovo_pipeline.paths`).
Nothing here ever sends a message: every one waits for a person.

What the app uses, through the Gemini bridge's `action.comms_propose` and `action.comms_check`:

- `live_case.py`: the case, from the facts main sends and the channels and videos in pipeline.db
- `engine.py`: `propose(gemini, case)`: the quick path, the Gemini prompt, repairs, the status
- `checks.py`: the deterministic checks on a message and the gates a person must confirm
- `readiness.py`: whether a creator may go into a brand pitch (BRD-PRES-15, HC-08)
- `moments.py`: usable moments of the creator's latest video, for a first email's personal line
- `playbook.py`: the rules with verbatim course quotes, the situations map, the house choices
- `course.py`: the course, read-only, from the folder the app passes in (empty without it)
- `example_bank.py`: the coach rewrites a case is shown (`for_case`); `build` is run by hand

Tools a person runs by hand (`python -m gratovo_pipeline.comms.<tool>`), never the app: verify,
skill_build, quote_review, review_claims, video_check, coach, gradbar, pairwise, scenarios,
mine_calls, pool.
"""
