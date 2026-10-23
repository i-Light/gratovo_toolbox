"""A person checks video quotes by ear (comms/quote_review.py), 2026-10-15.

  * every video quote in the rules is listed; quotes nobody checked come first;
  * Done saves the words into the rules and marks the quote checked; the transcript is never changed and the
    original wording is kept, so Revert puts back exactly that quote;
  * a quote that changes later is new again; verify accepts a checked quote, also when its words were edited.

The tests build their own small playbook and video transcript in a temporary folder. The tool needs the
course and says so (exit code 2) when it is not named.
"""

# ruff: noqa: E501 - the docstrings keep the old tests' wording and line breaks

import dataclasses
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import (
    course,
    playbook,
    quote_review,
    review_claims,
    verify,
    video_check,
)

LESSON = "module 9 test/9.1. Talking to brands"
DOC = f"video:{LESSON}"
QUOTE = "When a brand says no, you never argue with them."
EDITED = "When a brand says no, you never argue with him."


def _never_checked(doc: str, quote: str) -> dict[str, Any] | None:
    return None


@pytest.fixture
def book(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    videos = tmp_path / "videos" / "Module 9"
    videos.mkdir(parents=True)
    (videos / "9.1. Talking to brands.mp4.json").write_text(
        json.dumps(
            {
                "video": "Module 9/9.1. Talking to brands.mp4",
                "lesson": LESSON,
                "duration": 120.0,
                "segments": [
                    {"start": 0.0, "end": 60.0, "text": "Today we talk about brands. " + QUOTE},
                    {"start": 60.0, "end": 120.0, "text": "You ask what would make it a yes."},
                ],
            }
        ),
        encoding="utf-8",
    )
    pb = tmp_path / "playbook"
    (pb / "rules").mkdir(parents=True)
    rule = {
        "id": "BRD-OBJ-01",
        "stage": "objections",
        "title": "t",
        "rule": "r",
        "level": "must",
        "src": [{"doc": DOC, "quote": QUOTE}],
    }
    other = dict(rule, id="BRD-OBJ-02")
    (pb / "rules" / "brand.rules.json").write_text(
        json.dumps({"area": "brand", "rules": [rule, other]}), encoding="utf-8"
    )
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    monkeypatch.setenv(playbook.PLAYBOOK_DIR_ENV, str(pb))
    monkeypatch.setattr(video_check, "cached", _never_checked)
    course.configure(tmp_path, tmp_path / "videos")
    yield pb
    course.configure(None, None)


def quotes(pb: Path) -> list[str]:
    return [s.quote for r in playbook.rules(pb) for s in r.src]


def test_a_quote_is_listed_once_with_its_rules_and_a_loop(book: Path) -> None:
    [it] = quote_review.items(book)
    assert it["rules"] == ["BRD-OBJ-01", "BRD-OBJ-02"]
    assert not it["checked"]
    assert it["found"]
    assert 0 <= it["start"] < it["end"] <= 120


def test_done_saves_the_edit_everywhere_and_revert_restores_only_that(book: Path) -> None:
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], EDITED, done=True, directory=book)
    assert quotes(book) == [EDITED] * 2
    [it] = quote_review.items(book)
    assert it["checked"]
    assert it["original"] == QUOTE
    quote_review.revert(it["key"], directory=book)
    assert quotes(book) == [QUOTE, QUOTE]
    assert quote_review.items(book)[0]["checked"]


def test_the_rule_files_are_written_with_lf_only(book: Path) -> None:
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], EDITED, done=True, directory=book)
    assert b"\r" not in (book / "rules" / "brand.rules.json").read_bytes()
    assert b"\r" not in quote_review.reviews_path(book).read_bytes()


def test_verify_accepts_a_checked_quote_even_when_edited(book: Path) -> None:
    info: dict[str, dict[str, Any]] = {LESSON: {"speakers": "single", "presenter": "Abu Lahya"}}
    src = playbook.Source(doc=DOC, quote=QUOTE)
    rule = playbook.rules(book)[0]
    assert any(
        "not checked by a person" in p
        for p in verify.video_problems("x", rule, src, info, {"Abu Lahya"}, quote_review.load(book))
    )
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], EDITED, done=True, directory=book)
    reviews = quote_review.load(book)
    edited = playbook.Source(doc=DOC, quote=EDITED)
    assert verify.video_problems("x", rule, edited, info, {"Abu Lahya"}, reviews) == []
    assert quote_review.original_of(DOC, edited.quote, reviews) == QUOTE


def test_a_quote_changed_later_is_new_again(book: Path) -> None:
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], QUOTE, done=True, directory=book)
    quote_review.replace_in_rules(DOC, QUOTE, "you never argue with them.", book)
    [it] = quote_review.items(book)
    assert not it["checked"]
    assert it["original"] == "you never argue with them."


def test_a_lease_keeps_others_out_until_released_or_expired(book: Path) -> None:
    assert review_claims.claim("k1", "person:a", 60, book)
    assert review_claims.claim("k1", "person:a", 60, book)  # renewing your own lease
    assert not review_claims.claim("k1", "whisper:1", 60, book)  # someone else is working on it
    review_claims.release("k1", "person:a", book)
    assert review_claims.claim("k1", "whisper:1", -1, book)  # a crashed worker's lease ...
    assert review_claims.claim("k1", "person:b", 60, book)  # ... has expired and frees the quote
    review_claims.release_all("person:b", book)
    assert review_claims.held(book) == {}


def test_the_leases_live_in_the_playbook_folder(book: Path) -> None:
    assert review_claims.db_path() == book / "review_claims.sqlite3"
    assert review_claims.db_path(None).parent == playbook.playbook_dir()


def test_the_page_sees_a_quote_another_worker_holds_as_busy(book: Path) -> None:
    [it] = quote_review.items(book)
    review_claims.claim(it["key"], "whisper:7", 60, book)
    assert quote_review.items(book, me="person:x")[0]["busy"] == "whisper:7"
    assert quote_review.items(book, me="whisper:7")[0]["busy"] is None


def test_a_quote_whisper_heard_differently_comes_first_with_what_it_heard(book: Path) -> None:
    other = "You ask what would make it a yes."
    rules_file = book / "rules" / "brand.rules.json"
    data = json.loads(rules_file.read_text(encoding="utf-8"))
    data["rules"][1]["src"][0]["quote"] = other
    rules_file.write_text(json.dumps(data), encoding="utf-8")
    heard = {
        "doc": DOC,
        "quote": other,
        "heard": "you ask what would make it a no",
        "ok": True,
        "match": 1.0,
    }
    video_check.save_cache({"checks": {video_check.key(DOC, other): heard}})
    first, second = quote_review.items(book)
    assert first["current"] == other
    assert first["whisper"] == "disagreed"
    assert first["heard"] == "you ask what would make it a no"
    assert second["whisper"] is None


def test_a_flagged_quote_leaves_the_queue_and_fails_verify_until_it_changes(book: Path) -> None:
    (book / "coaches.json").write_text(
        json.dumps({"coaches": {"Abu Lahya": ["Abu Lahya"]}}), encoding="utf-8"
    )
    [it] = quote_review.items(book)
    quote_review.flag(it["key"], True, "the reason comes next", directory=book)
    [it] = quote_review.items(book)
    assert it["flagged"]
    assert it["flag_note"] == "the reason comes next"
    assert quote_review.load(book)["quotes"][it["key"]]["original"] == QUOTE
    flagged = [p for p in verify.check(book)["problems"] if "flagged on the review page" in p]
    assert len(flagged) == 2  # both rules that cite it
    assert "the reason comes next" in flagged[0]
    quote_review.flag(it["key"], False, directory=book)
    assert not quote_review.items(book)[0]["flagged"]
    quote_review.flag(it["key"], True, directory=book)
    quote_review.replace_in_rules(DOC, QUOTE, "Today we talk about brands. " + QUOTE, book)
    [it] = quote_review.items(book)  # the whole point
    assert not it["flagged"]
    assert not any("flagged on the review page" in p for p in verify.check(book)["problems"])


def test_verify_wants_each_quote_to_make_its_point_alone(book: Path) -> None:
    assert verify.stops_short("When you're selling something to someone, they need two things.")
    assert verify.stops_short("Run through all six before you press send:")
    assert not verify.stops_short(
        "Should I bring someone like him or you want to see my alternatives? So you give them two options."
    )
    rule = playbook.rules(book)[0]
    cut = dataclasses.replace(
        rule,
        src=[
            playbook.Source(doc=DOC, quote="Today we talk about brands."),
            playbook.Source(doc=DOC, quote=QUOTE),
        ],
    )
    assert verify.split_quotes("x", cut, quote_review.load(book))
    far = dataclasses.replace(
        rule,
        src=[
            playbook.Source(doc=DOC, quote="Today we talk about brands."),
            playbook.Source(doc=DOC, quote="You ask what would make it a yes."),
        ],
    )
    assert verify.split_quotes(
        "x", far, quote_review.load(book)
    )  # still one passage: 48 characters apart
    assert verify.split_quotes("x", rule, quote_review.load(book)) == []


def test_verify_on_a_small_playbook_reports_what_the_invented_course_lacks(book: Path) -> None:
    (book / "coaches.json").write_text(
        json.dumps({"coaches": {"Abu Lahya": ["Abu Lahya"]}}), encoding="utf-8"
    )
    (book / "videos.json").write_text(
        json.dumps({"videos": {LESSON: {"speakers": "single", "presenter": "Abu Lahya"}}}),
        encoding="utf-8",
    )
    result = verify.check(book)
    assert result["rules"] == 2
    assert result["lessons"] == 0  # this course has videos but no lesson pages
    problems = result["problems"]
    assert not any("quote not found" in p for p in problems)
    assert sum("not checked by a person" in p for p in problems) == 2
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], QUOTE, done=True, directory=book)
    assert verify.check(book)["problems"] == []


def test_the_review_page_ships_beside_the_tool() -> None:
    assert quote_review.PAGE.is_file()
    assert "<html" in quote_review.PAGE.read_text(encoding="utf-8").lower()


def test_the_review_tool_without_the_course_stops_with_code_2(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(course.COURSE_DIR_ENV, raising=False)
    monkeypatch.delenv(course.VIDEO_DIR_ENV, raising=False)
    course.configure(None, None)
    try:
        assert quote_review.main(["--no-browser"]) == 2
    finally:
        course.configure(None, None)
    out = capsys.readouterr()
    assert out.out == ""
    [line] = out.err.splitlines()
    assert "--course-dir" in line
    assert "GRATOVO_COURSE_DIR" in line
