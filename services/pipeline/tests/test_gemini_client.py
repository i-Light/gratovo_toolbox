"""Tests for the `Gemini` client's send options and mode helpers (gemini/client.py).

Ported from the old test_gemini_skills: the three tests about the client itself rather than the
Skills page. The extension is the scripted fake on 127.0.0.1 (the `loopback` fixture).
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator

import pytest
from fake_extension import THREAD_PREFIXES, Harness

from gratovo_pipeline.gemini.errors import GeminiError


@pytest.fixture
def harness(loopback: None) -> Iterator[Harness]:
    h = Harness()
    try:
        yield h
    finally:
        h.close()


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    # Give the joins a moment; then anything of ours still alive is a leak.
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


def test_send_passes_mode_and_skills(harness: Harness) -> None:
    fake = harness.attach(
        {"send": {"text": "ok", "mode": "task", "task": {"done": True, "steps": []}}}
    )
    result = harness.gemini.send("Draft it.", mode="task", skills=["gratovo-comms"], timeout=30)
    assert result["mode"] == "task"
    sent = fake.calls("send")[0]
    assert sent["mode"] == "task"
    assert sent["skills"] == ["gratovo-comms"]
    assert sent["timeoutMs"] == 30000


def test_send_refuses_an_unknown_mode(harness: Harness) -> None:
    harness.attach({})
    with pytest.raises(GeminiError) as info:
        harness.gemini.send("x", mode="deep")
    assert info.value.code == "BAD_PARAMS"


def test_thinking_level_and_mode_helpers(harness: Harness) -> None:
    fake = harness.attach(
        {
            "get_mode": {"mode": "chat", "available": True},
            "set_mode": lambda p: {"mode": p["mode"], "changed": True},
            "list_thinking_levels": {
                "menu": "مستوى التفكير",
                "levels": [{"name": "منخفض"}, {"name": "مرتفع"}],
                "current": "منخفض",
            },
            "set_thinking_level": lambda p: {"level": p["level"], "changed": True},
        }
    )
    g = harness.gemini
    assert g.mode() == "chat"
    assert g.set_mode("task")["mode"] == "task"
    assert g.thinking_levels()["current"] == "منخفض"
    assert g.set_thinking_level("مرتفع", timeout=5)["level"] == "مرتفع"
    assert fake.calls("set_thinking_level")[0]["timeoutMs"] == 5000
