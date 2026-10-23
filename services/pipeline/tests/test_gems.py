"""Tests for `action.gem_create|gem_update|gem_read` (gemini/gems.py), from the old test_gems.

The extension is a scripted fake `Gemini`; what is pinned is Python's half: which editor page is
opened under which account, what the extension is asked, what comes back, and a gem that does not
open being reported as such.
"""

from collections.abc import Callable, Mapping
from typing import Any

import pytest

from gratovo_pipeline.gemini import gems
from gratovo_pipeline.gemini.errors import GeminiError, error_from_payload

# A result, a WireError, or a callable taking the params.
type Handler = Callable[[dict[str, Any]], Any] | Mapping[str, Any] | Exception


class WireError(Exception):
    """A scripted handler answers with `{ok: false, error: {...}}`."""

    def __init__(self, code: str, message: str = "", details: dict[str, Any] | None = None) -> None:
        super().__init__(code, message)
        self.code, self.message, self.details = code, message, details or {}


class FakeGemini:
    """Stands in for `Gemini`: scripted answers by method, and a record of every call."""

    def __init__(self, handlers: dict[str, Handler]) -> None:
        self.handlers = handlers
        self.log: list[tuple[str, dict[str, Any]]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        del timeout
        sent = dict(params or {})
        self.log.append((method, sent))
        handler = self.handlers.get(method)
        if handler is None:
            raise error_from_payload(
                {"code": "BAD_PARAMS", "message": f"unknown method {method!r}"}
            )
        if isinstance(handler, WireError):
            raise error_from_payload(
                {"code": handler.code, "message": handler.message, "details": handler.details}
            )
        return handler(sent) if callable(handler) else handler

    def navigate(self, url: str, timeout: float | None = None) -> Any:
        params: dict[str, Any] = {"url": url}
        if timeout is not None:
            params["timeoutMs"] = int(timeout * 1000)
        return self.call("navigate", params)

    def calls(self, method: str) -> list[dict[str, Any]]:
        return [params for name, params in self.log if name == method]


def navigate_to(landing: str | None = None) -> Callable[[dict[str, Any]], dict[str, Any]]:
    return lambda p: {
        "tabId": 7,
        "url": landing or p["url"],
        "redirected": landing is not None,
        "requestedUrl": p["url"],
    }


def editor(
    fake_handlers: dict[str, Handler], account: int = 2, landing: str | None = None
) -> FakeGemini:
    return FakeGemini(
        {
            "get_url": {
                "url": f"https://gemini.google.com/u/{account}/app",
                "accountIndex": account,
            },
            "navigate": navigate_to(landing),
            **fake_handlers,
        }
    )


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("abc123def", "abc123def"),
        ("https://gemini.google.com/gem/abc123def", "abc123def"),
        ("https://gemini.google.com/u/3/gem/abc123def?usp=sharing", "abc123def"),
        ("https://gemini.google.com/gems/edit/abc123def", "abc123def"),
    ],
)
def test_gem_id_accepts_urls_and_bare_ids(given: str, expected: str) -> None:
    assert gems.gem_id(given) == expected


@pytest.mark.parametrize("given", ["", None, "https://gemini.google.com/gems/create", "a b", "abc"])
def test_gem_id_rejects_anything_else(given: str | None) -> None:
    with pytest.raises(GeminiError) as info:
        gems.gem_id(given)
    assert info.value.code == "BAD_PARAMS"


def test_create_opens_the_create_page_on_the_current_account_and_fills_it() -> None:
    fake = editor(
        {
            "gem_create": lambda p: {
                "url": "https://gemini.google.com/gem/newgem123",
                "gemId": "newgem123",
                "name": p["name"],
            }
        }
    )
    events: list[dict[str, Any]] = []
    # Was `actions.run_action(..., "action.gem_create", ...)`: calls the module directly.
    result = gems.gem_create(
        fake,  # pyright: ignore[reportArgumentType]
        {"name": "Drafter", "description": "Covers AI tools", "instructions": "Be brief."},
        emit=lambda _event, data: events.append(data),
    )
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/2/gems/create"
    sent = fake.calls("gem_create")[0]
    assert {k: sent[k] for k in ("name", "description", "instructions")} == {
        "name": "Drafter",
        "description": "Covers AI tools",
        "instructions": "Be brief.",
    }
    assert sent["timeoutMs"] == 180000
    assert result == {
        "url": "https://gemini.google.com/gem/newgem123",
        "gemId": "newgem123",
        "name": "Drafter",
    }
    assert [(e["done"], e["total"]) for e in events] == [(0, 2), (1, 2), (2, 2)]


def test_create_needs_a_name_and_sends_nothing_without_one() -> None:
    fake = editor({})
    with pytest.raises(GeminiError) as info:
        gems.gem_create(fake, {"name": "  "})  # pyright: ignore[reportArgumentType]
    assert info.value.code == "BAD_PARAMS"
    assert fake.calls("navigate") == []


def test_update_sends_only_the_given_fields_to_the_gems_edit_page() -> None:
    fake = editor(
        {
            "gem_update": lambda _p: {
                "url": "https://gemini.google.com/gem/abc123def",
                "gemId": "abc123def",
                "name": "Drafter",
                "changed": ["instructions"],
            }
        },
        account=0,
    )
    result = gems.gem_update(
        fake,  # pyright: ignore[reportArgumentType]
        {
            "gem": "https://gemini.google.com/gem/abc123def",
            "instructions": "New rules",
            "timeoutS": 30,
        },
    )
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/0/gems/edit/abc123def"
    assert fake.calls("gem_update")[0] == {"instructions": "New rules", "timeoutMs": 30000}
    assert result["changed"] == ["instructions"]
    assert result["gemId"] == "abc123def"


def test_read_returns_the_fields_verbatim() -> None:
    instructions = "Line one\n\n  indented line\nلغة عربية"
    fake = editor(
        {
            "gem_read": {
                "url": "https://gemini.google.com/gem/abc123def",
                "gemId": "abc123def",
                "name": "Drafter",
                "description": "",
                "instructions": instructions,
            }
        }
    )
    result = gems.gem_read(fake, {"gem": "abc123def"})  # pyright: ignore[reportArgumentType]
    assert result == {
        "url": "https://gemini.google.com/gem/abc123def",
        "gemId": "abc123def",
        "name": "Drafter",
        "description": "",
        "instructions": instructions,
    }


def test_a_gem_that_does_not_open_is_reported_before_the_extension_is_asked() -> None:
    fake = editor({"gem_read": {}}, landing="https://gemini.google.com/u/2/gems/view")
    with pytest.raises(GeminiError) as info:
        gems.gem_read(fake, {"gem": "missing123"})  # pyright: ignore[reportArgumentType]
    assert info.value.code == "GEM_UI_NOT_FOUND"
    assert info.value.details["url"] == "https://gemini.google.com/u/2/gems/view"
    assert fake.calls("gem_read") == []


def test_extension_errors_pass_through_with_their_code() -> None:
    refused = WireError(
        "GEM_SAVE_FAILED",
        "refused",
        {"reason": "field errors", "fieldErrors": ["Name is required"]},
    )
    fake = editor({"gem_create": refused})
    with pytest.raises(GeminiError) as info:
        gems.gem_create(fake, {"name": "X"})  # pyright: ignore[reportArgumentType]
    assert info.value.code == "GEM_SAVE_FAILED"
    assert info.value.details["fieldErrors"] == ["Name is required"]
