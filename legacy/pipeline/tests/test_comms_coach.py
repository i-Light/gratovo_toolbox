"""The coach (comms/coach.py, plan §7b step 1): parsing, the calibration agreement, judging a scenario run.

Pinned 2026-10-16: a draft is judged in a fresh chat by the skill's coach-review mode; its verdicts are compared
with the coaches' own on held-out roasts before they grade anything.
"""

import json

from comms import coach


class FakeGemini:
    def __init__(self, *texts):
        self.texts, self.sent = list(texts), []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":   # the tab shows the last prompt sent, then its answer
            return [{"role": "user", "text": self.sent[-1]["text"]}, {"role": "model", "text": "answer"}]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


REVIEW = '```json\n{"verdict": "mixed", "points": [{"rule": "FND-WRITE-25", "problem": "too long", "fix": "three lines"}], "summary": "cut it"}\n```'


def test_a_review_is_one_fresh_chat_with_the_skill_and_parses():
    g = FakeGemini(REVIEW)
    r = coach.review(g, "influencer", "replies", "They asked which brands.", "Hi Sam, ...")
    assert r["review"]["verdict"] == "mixed" and r["review"]["points"][0]["rule"] == "FND-WRITE-25"
    assert g.sent[0]["newChat"] is True and g.sent[0]["skills"] == ["gratovo-comms"] and g.sent[0]["thinking"] == "high"
    assert "COACH REVIEW" in g.sent[0]["text"] and "Hi Sam" in g.sent[0]["text"]


def test_an_answer_without_a_verdict_is_asked_again_once():
    g = FakeGemini("Here is my view: it is fine.", REVIEW)
    assert coach.review(g, "brand", "replies", "s", "d")["review"]["verdict"] == "mixed"
    assert len(g.sent) == 2 and g.sent[1]["newChat"] is False
    assert coach.parse('{"verdict": "great"}') is None


def test_agreement_counts_exact_bad_or_not_and_good_or_not(tmp_path):
    items = [{"idx": 1, "stage": "replies", "verdict": "bad"}, {"idx": 2, "stage": "replies", "verdict": "mixed"},
             {"idx": 3, "stage": "replies", "verdict": "good"}, {"idx": 4, "stage": "replies", "verdict": "bad"}]
    cal = tmp_path / "cal.json"
    cal.write_text(json.dumps(items), encoding="utf-8")
    (tmp_path / "answers").mkdir()
    for idx, ours in ((1, "bad"), (2, "bad"), (3, "good"), (4, "mixed")):
        (tmp_path / "answers" / f"cal-{idx}.json").write_text(json.dumps({"result": {"review": {"verdict": ours}}}), encoding="utf-8")
    rep = coach.agreement(tmp_path, cal)
    assert rep["reviewed"] == 4 and rep["exact"] == 50.0
    assert rep["bad_or_not"] == 50.0      # 1 right, 2 wrongly bad, 3 right, 4 missed
    assert rep["good_or_not"] == 100.0
    assert rep["table"]["bad"]["mixed"] == 1


def test_the_calibration_set_holds_out_the_skill_examples():
    from comms import playbook
    items = coach.calibration_items()
    assert len(items) == 120 and {i["verdict"] for i in items} == {"good", "mixed", "bad"}
    shown = {(e["call"], " ".join(e["student_email"].split()[:8]).lower()) for e in playbook.examples()}
    assert not any((i["call"], " ".join(i["student_email"].split()[:8]).lower()) in shown for i in items)


def test_compare_puts_runs_of_the_same_cases_side_by_side(tmp_path):
    case = {"side": "influencer", "stage": "contacted", "facts": {}, "counterpart": {"name": "Sam"},
            "thread": [{"from": "us", "body": "Hi Sam"}, {"from": "them", "subject": "Re: hi", "body": "Make me an offer."}]}
    entry = {"id": "c1", "kind": "reply", "type": "inf.asks_price_from_us", "expect": {}, "case": case}
    runs = []
    for name, body, verdict in (("base", "Hi Sam, " + "word " * 76, "mixed"), ("write", "Hi Sam,\n\nWhat do you charge?", "good")):
        run = tmp_path / name
        (run / "answers").mkdir(parents=True)
        (run / "coach" / "answers").mkdir(parents=True)
        (run / "cases.json").write_text(json.dumps([entry]), encoding="utf-8")
        result = {"status": "ready", "gates": [], "findings": [],
                  "proposal": {"situation": {"reply_type": "inf.asks_price_from_us"}, "decision": {"action": "send_message"},
                               "message": {"subject": "Re: hi", "body": body}}}
        (run / "answers" / "c1.json").write_text(json.dumps({"result": result}), encoding="utf-8")
        (run / "coach" / "answers" / "c1.json").write_text(json.dumps({"result": {"review": {"verdict": verdict}}}), encoding="utf-8")
        runs.append(run)
    out = coach.compare(runs)
    assert out["cases"] == 1 and out["by_case"]["c1"] == {"base": "mixed", "write": "good"}
    assert out["runs"]["write"]["good_pct"] == 100 and out["runs"]["base"]["coach"]["mixed"] == 1
    assert out["runs"]["base"]["length_vs_target_median"] == round(78 / 38, 2) and out["runs"]["write"]["length_vs_target_median"] < 0.2


def test_points_written_as_sentences_are_kept():
    # coach v2 (2026-10-16) wrote its points as sentences, like the coach verdicts it is shown
    data = coach.parse('JSON\n\n{"verdict": "mixed", "points": ["Cut the line about negotiating."], "summary": "s"}')
    assert data["verdict"] == "mixed" and data["points"][0]["problem"] == "Cut the line about negotiating."


def test_a_review_without_a_verdict_is_a_failed_send_not_a_disagreement(tmp_path):
    cal = tmp_path / "cal.json"
    items = [{"idx": 1, "stage": "s", "verdict": "bad"}, {"idx": 2, "stage": "s", "verdict": "good"}]
    cal.write_text(json.dumps(items), encoding="utf-8")
    (tmp_path / "answers").mkdir()
    (tmp_path / "answers" / "cal-1.json").write_text(json.dumps({"result": {"review": {"verdict": "bad"}}}), encoding="utf-8")
    (tmp_path / "answers" / "cal-2.json").write_text(json.dumps({"result": {"review": None}}), encoding="utf-8")
    rep = coach.agreement(tmp_path, cal)
    assert rep["reviewed"] == 1 and rep["exact"] == 100.0 and rep["no_verdict"] == [2]
