"""Pairwise coach judgments (comms/pairwise.py): which of two drafts the coaches would rather see sent.

Pinned 2026-10-16: absolute verdicts agreed with the coaches only half the time; a pair is calibrated on a student's
email against the coach's own rewrite (the rewrite should win), with the order fixed per item by a hash.
"""

import json

from comms import pairwise


class FakeGemini:
    def __init__(self, *texts):
        self.texts, self.sent = list(texts), []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":
            return [{"role": "user", "text": self.sent[-1]["text"]}, {"role": "model", "text": "answer"}]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


def test_a_comparison_is_one_fresh_chat_with_both_drafts_and_parses():
    g = FakeGemini('```json\n{"better": "B", "why": "B asks one easy question", "rules": ["INF-FIRST-05"]}\n```')
    r = pairwise.choose(g, "influencer", "replies", "They asked which brands.", "Draft one", "Draft two")
    assert r["pair"]["better"] == "B" and g.sent[0]["newChat"] is True and g.sent[0]["skills"] == ["gratovo-comms"]
    assert "DRAFT A:\n```\nDraft one" in g.sent[0]["text"] and "DRAFT B:\n```\nDraft two" in g.sent[0]["text"]
    assert pairwise.parse('{"better": "maybe"}') is None


def test_the_coachs_rewrite_is_a_or_b_by_the_items_hash_and_is_what_should_win():
    it = {"student_email": "student", "rewrite": "coach"}
    orders = {k: pairwise._calibration_order(k, it) for k in (f"pair-{i}" for i in range(40))}
    assert {o[2] for o in orders.values()} == {"A", "B"}
    assert all((o[0] if o[2] == "A" else o[1]) == "coach" for o in orders.values())


def test_accuracy_counts_the_rewrite_chosen_and_reports_ties_and_failures_apart(tmp_path):
    (tmp_path / "answers").mkdir()
    for key, expected, got in (("pair-1", "A", "A"), ("pair-2", "B", "A"), ("pair-3", "B", "same"), ("pair-4", "A", None)):
        res = {"expected": expected, "pair": {"better": got} if got else None}
        (tmp_path / "answers" / f"{key}.json").write_text(json.dumps({"result": res}), encoding="utf-8")
    rep = pairwise.accuracy(tmp_path)
    assert rep["judged"] == 2 and rep["right"] == 1 and rep["right_pct"] == 50.0 and rep["same"] == 1 and rep["failed"] == 1


def test_a_head_to_head_report_names_the_winning_run_whatever_the_order(tmp_path):
    (tmp_path / "answers").mkdir()
    (tmp_path / "runs.json").write_text(json.dumps({"A": "run-x", "B": "run-y"}), encoding="utf-8")
    for key, a_first, got in (("c1", True, "A"), ("c2", False, "A"), ("c3", False, "B"), ("c4", True, "same")):
        res = {"run_a_first": a_first, "pair": {"better": got}}
        (tmp_path / "answers" / f"{key}.json").write_text(json.dumps({"result": res}), encoding="utf-8")
    rep = pairwise.report(tmp_path)
    assert rep["cases"] == {"c1": "A", "c2": "B", "c3": "A", "c4": "same"}
    assert rep["wins_a"] == 2 and rep["wins_b"] == 1 and rep["same"] == 1


def test_a_case_judged_in_both_orders_counts_only_when_the_two_agree(tmp_path):
    # two decent drafts are a hard call; a verdict that flips with the order is the judge not knowing
    (tmp_path / "answers").mkdir()
    (tmp_path / "runs.json").write_text(json.dumps({"A": "run-base", "B": "run-write"}), encoding="utf-8")
    for key, a_first, got in (("c1", True, "B"), ("c1~swap", False, "A"),     # run B both times
                              ("c2", True, "A"), ("c2~swap", False, "A")):    # run A, then run B: split
        (tmp_path / "answers" / f"{key}.json").write_text(
            json.dumps({"result": {"run_a_first": a_first, "pair": {"better": got}}}), encoding="utf-8")
    rep = pairwise.report(tmp_path)
    assert rep["cases"] == {"c1": "B", "c2": "split"} and rep["wins_b"] == 1 and rep["split"] == 1 and rep["wins_a"] == 0
