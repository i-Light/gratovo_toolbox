"""Roast examples (examples.json) are checked like rules' quotes (2026-10-16): the coach's quote must be in the
call, in a coach's turn, and make its point; the verdict is good, mixed or bad."""

from comms import playbook, verify


def test_the_shipped_examples_pass():
    assert verify.example_problems(playbook.examples(), playbook.coaches()) == []


def test_a_broken_example_is_reported():
    good = playbook.examples()[0]
    roster = playbook.coaches()
    wrong_verdict = dict(good, id="EX-T1", verdict="great")
    no_quote = dict(good, id="EX-T2", quote={"doc": good["quote"]["doc"], "quote": "words the coach never said on that call at all"})
    no_email = dict(good, id="EX-T3", student_email=" ")
    problems = verify.example_problems([wrong_verdict, no_quote, no_email], roster)
    assert any("EX-T1" in p and "verdict" in p for p in problems)
    assert any("EX-T2" in p and "not found" in p for p in problems)
    assert any("EX-T3" in p and "student email" in p for p in problems)
