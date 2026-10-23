"""Pairwise coach judgments (comms/pairwise.py): which of two drafts the coaches would rather see
sent.

Pinned 2026-10-16: absolute verdicts agreed with the coaches only half the time; a pair is
calibrated on a student's email against the coach's own rewrite (the rewrite should win), with the
order fixed per item by a hash.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import example_bank, pairwise


class FakeGemini:
    def __init__(self, *texts: str) -> None:
        self.texts: list[str] = list(texts)
        self.sent: list[dict[str, Any]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        if method == "get_conversation":
            return [
                {"role": "user", "text": self.sent[-1]["text"]},
                {"role": "model", "text": "answer"},
            ]
        self.sent.append(params or {})
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


def test_a_comparison_is_one_fresh_chat_with_both_drafts_and_parses() -> None:
    g = FakeGemini(
        '```json\n{"better": "B", "why": "B asks one easy question", '
        '"rules": ["INF-FIRST-05"]}\n```'
    )
    r = pairwise.choose(
        g, "influencer", "replies", "They asked which brands.", "Draft one", "Draft two"
    )
    assert r["pair"]["better"] == "B"
    assert g.sent[0]["newChat"] is True
    assert g.sent[0]["skills"] == ["gratovo-comms"]
    assert "DRAFT A:\n```\nDraft one" in g.sent[0]["text"]
    assert "DRAFT B:\n```\nDraft two" in g.sent[0]["text"]
    assert pairwise.parse('{"better": "maybe"}') is None


def test_the_coachs_rewrite_is_a_or_b_by_the_items_hash_and_is_what_should_win() -> None:
    it = {"student_email": "student", "rewrite": "coach"}
    orders = {
        k: pairwise._calibration_order(k, it)  # pyright: ignore[reportPrivateUsage]
        for k in (f"pair-{i}" for i in range(40))
    }
    assert {o[2] for o in orders.values()} == {"A", "B"}
    assert all((o[0] if o[2] == "A" else o[1]) == "coach" for o in orders.values())


def test_accuracy_counts_the_rewrite_chosen_and_reports_ties_and_failures_apart(
    tmp_path: Path,
) -> None:
    (tmp_path / "answers").mkdir()
    for key, expected, got in (
        ("pair-1", "A", "A"),
        ("pair-2", "B", "A"),
        ("pair-3", "B", "same"),
        ("pair-4", "A", None),
    ):
        res = {"expected": expected, "pair": {"better": got} if got else None}
        (tmp_path / "answers" / f"{key}.json").write_text(
            json.dumps({"result": res}), encoding="utf-8"
        )
    rep = pairwise.accuracy(tmp_path)
    assert rep["judged"] == 2
    assert rep["right"] == 1
    assert rep["right_pct"] == 50.0
    assert rep["same"] == 1
    assert rep["failed"] == 1


def test_a_head_to_head_report_names_the_winning_run_whatever_the_order(tmp_path: Path) -> None:
    (tmp_path / "answers").mkdir()
    (tmp_path / "runs.json").write_text(json.dumps({"A": "run-x", "B": "run-y"}), encoding="utf-8")
    for key, a_first, got in (
        ("c1", True, "A"),
        ("c2", False, "A"),
        ("c3", False, "B"),
        ("c4", True, "same"),
    ):
        res = {"run_a_first": a_first, "pair": {"better": got}}
        (tmp_path / "answers" / f"{key}.json").write_text(
            json.dumps({"result": res}), encoding="utf-8"
        )
    rep = pairwise.report(tmp_path)
    assert rep["cases"] == {"c1": "A", "c2": "B", "c3": "A", "c4": "same"}
    assert rep["wins_a"] == 2
    assert rep["wins_b"] == 1
    assert rep["same"] == 1


def test_a_case_judged_in_both_orders_counts_only_when_the_two_agree(tmp_path: Path) -> None:
    # two decent drafts are a hard call; a verdict that flips with the order is the judge not
    # knowing
    (tmp_path / "answers").mkdir()
    (tmp_path / "runs.json").write_text(
        json.dumps({"A": "run-base", "B": "run-write"}), encoding="utf-8"
    )
    for key, a_first, got in (
        ("c1", True, "B"),
        ("c1~swap", False, "A"),  # run B both times
        ("c2", True, "A"),
        ("c2~swap", False, "A"),  # run A, then run B: split
    ):
        (tmp_path / "answers" / f"{key}.json").write_text(
            json.dumps({"result": {"run_a_first": a_first, "pair": {"better": got}}}),
            encoding="utf-8",
        )
    rep = pairwise.report(tmp_path)
    assert rep["cases"] == {"c1": "B", "c2": "split"}
    assert rep["wins_b"] == 1
    assert rep["split"] == 1
    assert rep["wins_a"] == 0


def test_the_calibration_pairs_are_real_emails_the_coach_rewrote(tmp_path: Path) -> None:
    # invented roasts (AI creators and AI tool brands): the pairs keep only a rewrite that is a
    # whole email, half per side
    def roast(side: str, n: int) -> dict[str, Any]:
        return {
            "kind": "roast",
            "side": side,
            "stage": "replies",
            "verdict": "bad",
            "situation": "An AI creator asked who the brand is.",
            "advice": "answer the question first",
            "student_email": " ".join(f"word{n}-{i}" for i in range(30)),
            "rewrite": " ".join(f"better{n}-{i}" for i in range(40)),
        }

    items = [roast("influencer" if i % 2 else "brand", i) for i in range(12)]
    items.append({**roast("brand", 99), "rewrite": "too short"})
    (tmp_path / example_bank.MINED_NAME).write_text(json.dumps({"items": items}), encoding="utf-8")
    pairs = pairwise.calibration_pairs(8, mined=tmp_path / example_bank.MINED_NAME)
    assert len(pairs) == 8
    assert "pair-12" not in pairs
    assert {it["side"] for it in pairs.values()} == {"influencer", "brand"}


def test_the_command_line_names_the_mined_folder_when_it_is_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv(example_bank.MINED_DIR_ENV, raising=False)
    assert pairwise.main(["calibrate", str(tmp_path / "out")]) == 2
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "--mined-dir" in err[0]
    assert example_bank.MINED_DIR_ENV in err[0]
