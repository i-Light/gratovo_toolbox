"""The graduate bar (comms/gradbar.py): the engine's draft against the coach's rewrite of a student's email.

Pinned 2026-10-17: cases hold only what the student knew; the engine's draft is A or B by a hash and judged in both
orders against the coach (a flip is a split) and once against the student; a subject line shows only when the
other draft has one.
"""

import json

import pytest

from comms import engine, example_bank, gradbar


def test_every_item_is_an_engine_case_with_the_students_facts_only():
    cs = gradbar.cases()
    assert len(cs) >= 30 and len({c["id"] for c in cs}) == len(cs)
    assert {c["set"] for c in cs} == {"ai", "tech"} and sum(c["set"] == "ai" for c in cs) >= 14
    for c in cs:
        case = c["case"]
        assert set(case) <= set(engine.CASE_FIELDS) and case["side"] in ("influencer", "brand")
        assert case["facts"]["today"] and case["agency"]["true_claims"] and "{niche}" not in case["agency"]["what_we_do"]
        assert engine.case_prompt(case) and not engine.quick_path(case)
        # the coach's rewrite is the answer key: it is never inside the case
        if example_bank.MINED.exists():
            rewrite = gradbar._mined()[c["idx"]]["rewrite"]
            assert not rewrite or rewrite[:60] not in json.dumps(case, ensure_ascii=False)


def test_a_thread_is_dated_back_from_the_items_day():
    item = {"idx": 1, "set": "ai", "kind": "reply", "side": "influencer", "today": "2026-08-20", "niche": "AI",
            "counterpart": {"kind": "creator", "name": None}, "facts": {},
            "thread": [{"from": "us", "days_ago": 6, "subject": "Hi", "body": "one"}, {"from": "them", "days_ago": 0, "body": "two"}]}
    case = gradbar.case_of(item)
    assert [m["at"] for m in case["thread"]] == ["2026-08-14", "2026-08-20"]
    assert case["thread"][1]["subject"] == "Re: Hi" and case["stage"] == "contacted"


def test_the_engine_is_a_or_b_by_hash_and_the_swap_flips_it():
    ids = [f"gb-{i}" for i in range(40)]
    firsts = [gradbar.engine_first(f"{i}~coach") for i in ids]
    assert set(firsts) == {True, False}
    assert all(gradbar.engine_first(f"{i}~coach~swap") != gradbar.engine_first(f"{i}~coach") for i in ids)
    assert {gradbar.engine_first(f"{i}~student") for i in ids} == {True, False}


def test_the_subject_line_shows_only_when_the_other_draft_has_one():
    draft = "Subject: Your LLM video\n\nHey Jack, ..."
    assert gradbar.shown(draft, "Hey Jack, a spoken rewrite") == "Hey Jack, ..."
    assert gradbar.shown(draft, "Subject: Jack, quick one\nHey Jack") == draft


def _answer(out, key, engine_first, better):
    res = {"engine_first": engine_first, "pair": {"better": better} if better else None}
    (out / "answers" / f"{key}.json").write_text(json.dumps({"result": res}), encoding="utf-8")


def test_the_report_counts_wins_ties_and_splits_per_set(tmp_path):
    run = tmp_path / "run"
    (run / "answers").mkdir(parents=True)
    entries = [{"id": "gb-1", "set": "ai"}, {"id": "gb-2", "set": "ai"}, {"id": "gb-3", "set": "tech"}, {"id": "gb-4", "set": "tech"}]
    (run / "cases.json").write_text(json.dumps(entries), encoding="utf-8")
    for e in entries[:3]:   # gb-4 never got a draft
        msg = {"result": {"proposal": {"message": {"subject": "s", "body": "b"}}}}
        (run / "answers" / f"{e['id']}.json").write_text(json.dumps(msg), encoding="utf-8")
    out = tmp_path / "judge"
    (out / "answers").mkdir(parents=True)
    (out / "run.json").write_text(json.dumps({"run": str(run)}), encoding="utf-8")
    _answer(out, "gb-1~coach", True, "A"); _answer(out, "gb-1~coach~swap", False, "B")      # engine both times
    _answer(out, "gb-1~student", False, "B")                                                 # engine over the student
    _answer(out, "gb-2~coach", True, "B"); _answer(out, "gb-2~coach~swap", False, "B")      # coach, then engine: split
    _answer(out, "gb-2~student", True, "B")                                                  # the student won
    _answer(out, "gb-3~coach", False, "A"); _answer(out, "gb-3~coach~swap", True, "same")   # coach, then same: split
    _answer(out, "gb-3~student", True, None)                                                 # failed send
    rep = gradbar.report(out)
    assert rep["cases"]["gb-1"] == {"set": "ai", "bar": "rewrite", "coach": "engine", "student": "engine"}
    assert rep["cases"]["gb-2"]["coach"] == "split" and rep["cases"]["gb-2"]["student"] == "other"
    assert rep["cases"]["gb-3"] == {"set": "tech", "bar": "rewrite", "coach": "split", "student": None}
    assert rep["no_draft"] == ["gb-4"]
    assert rep["ai"]["coach"]["engine"] == 1 and rep["ai"]["coach"]["split"] == 1 and rep["ai"]["coach"]["tie_or_win_pct"] == 100.0
    assert rep["all"]["coach"]["win_pct"] == pytest.approx(33.3) and rep["all"]["student"]["failed"] == 1


def test_a_good_email_is_the_graduates_answer_judged_in_both_orders(tmp_path):
    # v2 (2026-10-18): the coach's rewrite was an unfair yardstick (incomplete, other facts); a good email is whole
    good = [c for c in gradbar.cases() if c["bar"] == "good"]
    assert len(good) >= 20 and all(c["case"]["facts"]["today"] for c in good)
    assert gradbar._keys("gb-924", "good") == ["gb-924~grad", "gb-924~grad~swap"]
    assert gradbar.engine_first("gb-924~grad") != gradbar.engine_first("gb-924~grad~swap")
    run = tmp_path / "run"
    (run / "answers").mkdir(parents=True)
    (run / "cases.json").write_text(json.dumps([{"id": "gb-9", "set": "ai", "bar": "good"}]), encoding="utf-8")
    (run / "answers" / "gb-9.json").write_text(json.dumps({"result": {"proposal": {"message": {"body": "b"}}}}), encoding="utf-8")
    out = tmp_path / "judge"
    (out / "answers").mkdir(parents=True)
    (out / "run.json").write_text(json.dumps({"run": str(run)}), encoding="utf-8")
    _answer(out, "gb-9~grad", True, "B"); _answer(out, "gb-9~grad~swap", False, "A")      # the good email both times
    rep = gradbar.report(out)
    assert rep["cases"]["gb-9"] == {"set": "ai", "bar": "good", "graduate": "other"}
    assert rep["all"]["graduate"]["other"] == 1 and rep["all"]["graduate"]["tie_or_win_pct"] == 0.0
    assert rep["all"]["coach"]["cases"] == 0


def test_a_case_without_a_day_takes_the_calls_date():
    if not example_bank.MINED.exists():
        pytest.skip("mined calls not on this machine")
    item = {"idx": 924, "set": "ai", "kind": "first", "side": "brand", "niche": "AI", "counterpart": {}, "facts": {},
            "past_campaigns": ["one real campaign"]}
    case = gradbar.case_of(item)
    assert case["facts"]["today"] == gradbar._mined()[924]["date"] and case["agency"]["past_campaigns"] == ["one real campaign"]
