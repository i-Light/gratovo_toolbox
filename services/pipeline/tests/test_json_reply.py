"""Reading a JSON object out of Gemini's reply (moved out of the old actions.py)."""

import pytest

from gratovo_pipeline.gemini.errors import ActionParseFailed
from gratovo_pipeline.gemini.json_reply import extract_json, parse_json_reply


def test_a_fenced_object_wins() -> None:
    assert extract_json('Sure!\n```json\n{"a": 1}\n```\nDone.') == {"a": 1}


def test_else_the_first_balanced_object_braces_in_strings_included() -> None:
    reply = 'Here you go: {"niche": "AI {coding} tools", "fit": 4} and that is all.'
    assert extract_json(reply) == {"niche": "AI {coding} tools", "fit": 4}


def test_a_broken_object_is_skipped_for_the_next_one() -> None:
    assert extract_json('{"a": oops} then {"b": 2}') == {"b": 2}


def test_raw_line_breaks_in_strings_need_strict_off() -> None:
    reply = '{"body": "line one\nline two"}'
    assert extract_json(reply) is None
    assert extract_json(reply, strict=False) == {"body": "line one\nline two"}


@pytest.mark.parametrize("reply", [None, 3, "", "no object here", "[1, 2]"])
def test_no_object_is_none(reply: object) -> None:
    assert extract_json(reply) is None


def test_parse_json_reply_raises_with_the_raw_reply() -> None:
    with pytest.raises(ActionParseFailed) as caught:
        parse_json_reply("I can't do that.", "classify")
    assert caught.value.details == {"raw": "I can't do that."}
