"""The coach (comms/coach.py, plan §7b step 1): parsing, the calibration agreement, judging a
scenario run.

Pinned 2026-10-16: a draft is judged in a fresh chat by the skill's coach-review mode; its verdicts
are compared with the coaches' own on held-out roasts before they grade anything.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import coach, example_bank, playbook


class FakeGemini:
    def __init__(self, *texts: str) -> None:
        self.texts: list[str] = list(texts)
        self.sent: list[dict[str, Any]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        params = params or {}
        if method == "get_conversation":  # the tab shows the last prompt sent, then its answer
            return [
                {"role": "user", "text": self.sent[-1]["text"]},
                {"role": "model", "text": "answer"},
            ]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


REVIEW = (
    '```json\n{"verdict": "mixed", "points": [{"rule": "FND-WRITE-25", "problem": "too long", '
    '"fix": "three lines"}], "summary": "cut it"}\n```'
)


def test_a_review_is_one_fresh_chat_with_the_skill_and_parses() -> None:
    g = FakeGemini(REVIEW)
    r = coach.review(g, "influencer", "replies", "They asked which brands.", "Hi Sam, ...")
    assert r["review"]["verdict"] == "mixed"
    assert r["review"]["points"][0]["rule"] == "FND-WRITE-25"
    assert g.sent[0]["newChat"] is True
    assert g.sent[0]["skills"] == ["gratovo-comms"]
    assert g.sent[0]["thinking"] == "high"
    assert "COACH REVIEW" in g.sent[0]["text"]
    assert "Hi Sam" in g.sent[0]["text"]


def test_an_answer_without_a_verdict_is_asked_again_once() -> None:
    g = FakeGemini("Here is my view: it is fine.", REVIEW)
    assert coach.review(g, "brand", "replies", "s", "d")["review"]["verdict"] == "mixed"
    assert len(g.sent) == 2
    # One prompt per fresh chat (plan D6a): the re-ask repeats the review and shows the answer.
    again = g.sent[1]
    assert again["newChat"] is True
    assert again["skills"] == ["gratovo-comms"]
    assert again["text"].startswith(coach.prompt("brand", "replies", "s", "d", 1))
    assert "Your previous answer was:\n```\nHere is my view: it is fine.\n```" in again["text"]
    assert "ONLY the coach-review JSON" in again["text"]
    assert coach.parse('{"verdict": "great"}') is None


def test_agreement_counts_exact_bad_or_not_and_good_or_not(tmp_path: Path) -> None:
    items = [
        {"idx": 1, "stage": "replies", "verdict": "bad"},
        {"idx": 2, "stage": "replies", "verdict": "mixed"},
        {"idx": 3, "stage": "replies", "verdict": "good"},
        {"idx": 4, "stage": "replies", "verdict": "bad"},
    ]
    cal = tmp_path / "cal.json"
    cal.write_text(json.dumps(items), encoding="utf-8")
    (tmp_path / "answers").mkdir()
    for idx, ours in ((1, "bad"), (2, "bad"), (3, "good"), (4, "mixed")):
        (tmp_path / "answers" / f"cal-{idx}.json").write_text(
            json.dumps({"result": {"review": {"verdict": ours}}}), encoding="utf-8"
        )
    rep = coach.agreement(tmp_path, cal)
    assert rep["reviewed"] == 4
    assert rep["exact"] == 50.0
    assert rep["bad_or_not"] == 50.0  # 1 right, 2 wrongly bad, 3 right, 4 missed
    assert rep["good_or_not"] == 100.0
    assert rep["table"]["bad"]["mixed"] == 1


def test_the_calibration_set_holds_out_the_skill_examples() -> None:
    path = example_bank.calibration_file()
    if path is None or not path.exists():
        pytest.skip("mined calls not on this machine (set GRATOVO_MINED_DIR)")
    items = coach.calibration_items()
    assert len(items) == 120
    assert {i["verdict"] for i in items} == {"good", "mixed", "bad"}
    shown = {
        (e["call"], " ".join(e["student_email"].split()[:8]).lower()) for e in playbook.examples()
    }
    assert not any(
        (i["call"], " ".join(i["student_email"].split()[:8]).lower()) in shown for i in items
    )


def test_the_calibration_set_is_named_by_the_mined_folder_never_a_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(example_bank.MINED_DIR_ENV, raising=False)
    with pytest.raises(FileNotFoundError, match=example_bank.MINED_DIR_ENV):
        coach.calibration_items()


def test_compare_puts_runs_of_the_same_cases_side_by_side(tmp_path: Path) -> None:
    case = {
        "side": "influencer",
        "stage": "contacted",
        "facts": {},
        "counterpart": {"name": "Sam"},
        "thread": [
            {"from": "us", "body": "Hi Sam"},
            {"from": "them", "subject": "Re: hi", "body": "Make me an offer."},
        ],
    }
    entry = {
        "id": "c1",
        "kind": "reply",
        "type": "inf.asks_price_from_us",
        "expect": {},
        "case": case,
    }
    runs: list[Path] = []
    for name, body, verdict in (
        ("base", "Hi Sam, " + "word " * 76, "mixed"),
        ("write", "Hi Sam,\n\nWhat do you charge?", "good"),
    ):
        run = tmp_path / name
        (run / "answers").mkdir(parents=True)
        (run / "coach" / "answers").mkdir(parents=True)
        (run / "cases.json").write_text(json.dumps([entry]), encoding="utf-8")
        result: dict[str, Any] = {
            "status": "ready",
            "gates": [],
            "findings": [],
            "proposal": {
                "situation": {"reply_type": "inf.asks_price_from_us"},
                "decision": {"action": "send_message"},
                "message": {"subject": "Re: hi", "body": body},
            },
        }
        (run / "answers" / "c1.json").write_text(json.dumps({"result": result}), encoding="utf-8")
        (run / "coach" / "answers" / "c1.json").write_text(
            json.dumps({"result": {"review": {"verdict": verdict}}}), encoding="utf-8"
        )
        runs.append(run)
    out = coach.compare(runs)
    assert out["cases"] == 1
    assert out["by_case"]["c1"] == {"base": "mixed", "write": "good"}
    assert out["runs"]["write"]["good_pct"] == 100
    assert out["runs"]["base"]["coach"]["mixed"] == 1
    assert out["runs"]["base"]["length_vs_target_median"] == round(78 / 38, 2)
    assert out["runs"]["write"]["length_vs_target_median"] < 0.2


def test_points_written_as_sentences_are_kept() -> None:
    # coach v2 (2026-10-16) wrote its points as sentences, like the coach verdicts it is shown
    data = coach.parse(
        'JSON\n\n{"verdict": "mixed", "points": ["Cut the line about negotiating."], '
        '"summary": "s"}'
    )
    assert data is not None
    assert data["verdict"] == "mixed"
    assert data["points"][0]["problem"] == "Cut the line about negotiating."


def test_a_review_without_a_verdict_is_a_failed_send_not_a_disagreement(tmp_path: Path) -> None:
    cal = tmp_path / "cal.json"
    items = [
        {"idx": 1, "stage": "s", "verdict": "bad"},
        {"idx": 2, "stage": "s", "verdict": "good"},
    ]
    cal.write_text(json.dumps(items), encoding="utf-8")
    (tmp_path / "answers").mkdir()
    (tmp_path / "answers" / "cal-1.json").write_text(
        json.dumps({"result": {"review": {"verdict": "bad"}}}), encoding="utf-8"
    )
    (tmp_path / "answers" / "cal-2.json").write_text(
        json.dumps({"result": {"review": None}}), encoding="utf-8"
    )
    rep = coach.agreement(tmp_path, cal)
    assert rep["reviewed"] == 1
    assert rep["exact"] == 100.0
    assert rep["no_verdict"] == [2]


def test_the_command_line_stops_with_one_line_when_the_calibration_set_is_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv(example_bank.MINED_DIR_ENV, raising=False)
    assert coach.main(["calibrate", str(tmp_path / "out")]) == 2
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "--mined-dir" in err[0]
    assert example_bank.MINED_DIR_ENV in err[0]
