"""The bridge's error classes, and their codes against the protocol main checks."""

from typing import Any

import pytest

from gratovo_pipeline.gemini import errors
from gratovo_pipeline.gemini.progress import emit_progress


def _wire_codes(gemini_schema: dict[str, Any]) -> set[str]:
    for branch in gemini_schema["fromGemini"]["anyOf"]:
        error = branch["properties"].get("error")
        if error is not None:
            return set(error["properties"]["code"]["enum"])
    raise AssertionError("no error branch in gemini.schema.json")


def test_every_code_python_can_raise_is_one_main_accepts(gemini_schema: dict[str, Any]) -> None:
    assert _wire_codes(gemini_schema) == errors.ERROR_CODES


def test_a_payload_becomes_its_subclass() -> None:
    err = errors.error_from_payload(
        {"code": "ELEMENT_NOT_FOUND", "message": "no prompt box", "details": {"element": "input"}}
    )
    assert isinstance(err, errors.ElementNotFound)
    assert err.to_payload() == {
        "code": "ELEMENT_NOT_FOUND",
        "message": "no prompt box",
        "details": {"element": "input"},
    }


def test_a_gem_editor_miss_is_still_an_element_not_found() -> None:
    err = errors.error_from_payload({"code": "GEM_UI_NOT_FOUND"})
    assert isinstance(err, errors.ElementNotFound)
    assert err.code == "GEM_UI_NOT_FOUND"


@pytest.mark.parametrize("payload", [None, "boom", 3, {"message": "no code"}])
def test_a_malformed_payload_is_unknown_never_a_second_error(payload: object) -> None:
    err = errors.error_from_payload(payload)
    assert type(err) is errors.GeminiError
    assert err.code == "UNKNOWN"


def test_an_unknown_code_is_kept_in_details_and_sent_as_unknown() -> None:
    err = errors.error_from_payload({"code": "NEW_THING", "message": "m", "details": "x"})
    assert err.code == "UNKNOWN"
    assert err.details == {"raw": "x", "code": "NEW_THING"}


def test_a_class_fills_in_its_own_code() -> None:
    assert errors.Busy(message="still answering").code == "BUSY"
    assert str(errors.Busy()) == "BUSY"


def test_account_not_found_lists_the_accounts_tried() -> None:
    err = errors.AccountNotFound(message="no match", tried=[(0, {"name": "Studio"})])
    assert err.details["tried"] == [{"index": 0, "account": {"name": "Studio"}}]


def test_job_failed_hands_back_the_job() -> None:
    assert errors.JobFailed(details={"job": {"id": "j1"}}).job == {"id": "j1"}
    assert errors.JobFailed().job is None


def test_progress_is_advisory() -> None:
    seen: list[tuple[str, dict[str, Any]]] = []
    emit_progress(
        lambda e, d: seen.append((e, d)), "generate_keywords", 2, 4, "chat 2 of 4", keywords=9
    )
    assert seen == [
        (
            "progress",
            {
                "action": "generate_keywords",
                "done": 2,
                "total": 4,
                "message": "chat 2 of 4",
                "keywords": 9,
            },
        )
    ]

    def broken(_event: str, _data: dict[str, Any]) -> None:
        raise OSError("main went away")

    emit_progress(broken, "generate_keywords", 1, 1)
    emit_progress(None, "generate_keywords", 1, 1)
