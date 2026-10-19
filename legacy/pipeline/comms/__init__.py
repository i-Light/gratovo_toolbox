"""The Gratovo communication workflow (started 2026-10-14; docs/plans/communication_workflow_plan.md).

  course.py   the course as the only source of truth: lessons and coach-call transcripts, read-only
  playbook.py the playbook (data/comms/playbook/): rules with verbatim course quotes, loaded and checked
  verify.py   `python -m comms.verify`: every quote is in its source, call quotes are a coach's words,
              every lesson in scope is cited
"""
