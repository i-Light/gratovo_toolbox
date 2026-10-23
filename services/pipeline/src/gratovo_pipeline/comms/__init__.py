"""The Gratovo communication workflow (started 2026-10-14): one case in, one checked proposal out.

The course is the only source of truth. Its text is the owner's and stays on the owner's PC (plan
D8); the playbook built from it ships in `services/pipeline/data/comms/` (`gratovo_pipeline.paths`).

What the app uses (through the Gemini bridge's `action.comms_propose` and `action.comms_check`):

engine.py        `propose(gemini, case)`: the quick path, the Gemini prompt, repairs, the status
checks.py        the deterministic checks on a message and the gates a person must confirm
readiness.py     whether a creator may go into a brand pitch (BRD-PRES-15, HC-08) playbook.py
the playbook: rules with verbatim course quotes, the situations map, house choices course.py
the course, read-only, from the folder the app passes in (empty without it) example_bank.py  the
coach rewrites a case is shown (`for_case`); `build` is run by hand

Tools a person runs by hand (`python -m gratovo_pipeline.comms.<tool>`), never the app; they come in
later tasks: verify, skill_build, coach, gradbar, pairwise, scenarios, mine_calls, pool,
quote_review, review_claims, video_check."""
