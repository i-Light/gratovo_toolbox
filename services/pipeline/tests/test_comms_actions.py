"""The daemon's Comms actions (plan step 6; 3e-3 plan D6, D10): `comms_propose` builds the live case
from main's `facts` and pipeline.db and asks the engine; `comms_check` re-checks text a person
edited before it goes, without Gemini.

The old tests seeded the app's tables and passed `dbPath`; now the app's side comes in `facts`, and
the bridge opens `pipeline.db` in its `--data-dir` (here a temporary folder). The thread messages
are invented, in the course's style: never real mailbox content. Nothing is ever sent: every
message waits for a person.
"""

from __future__ import annotations

import io
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from helpers import schema_errors

from gratovo_pipeline import store
from gratovo_pipeline.comms import course, engine, moments
from gratovo_pipeline.gemini import actions
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.daemon import Daemon, Out
from gratovo_pipeline.gemini.errors import GeminiError

GOOD = """```json
{"situation": {"side": "influencer", "stage": "replied", "reply_type": "inf.asks_price_from_us", "summary": "s"},
 "decision": {"action": "send_message", "why": "They asked what we pay; we ask their rate first.", "rules": ["INF-PRICE-09"]},
 "message": {"channel": "email", "subject": "Re: hi", "body": "Hi Sam,\\n\\nWhat do you usually charge for a sponsored segment?\\n\\nMoustafa"},
 "needs_human": [], "follow_up": {"in_working_days": 2, "note": null}, "facts_used": []}
```"""  # noqa: E501 - Gemini's answer as it comes

AGENCY: dict[str, Any] = {
    "name": "Gratovo",
    "sender": "Moustafa",
    "whatWeDo": "We find sponsors for AI creators.",
    "website": None,
    "trueClaims": [],
    "pastCampaigns": [],
    "incubator": True,
    "boycott": {"countries": ["IL"], "brands": []},
}

THREAD: dict[str, Any] = {
    "id": "t1",
    "channelId": "UC_a",
    "brandId": None,
    "contactEmail": "sam@example.com",
    "dealId": None,
    "messages": [
        {
            "direction": "outbound",
            "subject": "hi",
            "body": "Hi Sam, saw your test.",
            "at": "2026-10-14",
        },
        {
            "direction": "inbound",
            "subject": "Re: hi",
            "body": "What do you pay?",
            "at": "2026-10-16",
        },
    ],
}

REPLY = {"kind": "reply", "threadId": "t1"}


def facts(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "agency": AGENCY,
        "thread": THREAD,
        "creators": {},
        "brand": None,
        "deal": None,
        "recentOutbound": [{"threadId": "t7", "body": "Hi Sam, saw your test."}],
    }
    base.update(fields)
    return base


class FakeGemini:
    """Answers each send with the next text; records every call. `data_dir` is the bridge's
    `--data-dir`, where the actions open pipeline.db."""

    def __init__(self, data_dir: Path | None, *texts: str) -> None:
        self.data_dir = data_dir
        self.texts: list[str] = list(texts)
        self.sent: list[dict[str, Any]] = []
        self.calls: list[str] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        self.calls.append(method)
        if method == "get_conversation":  # the tab shows the last prompt sent, then its answer
            return [
                {"role": "user", "text": self.sent[-1]["text"]},
                {"role": "model", "text": "answer"},
            ]
        self.sent.append(params or {})
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


def run(gemini: FakeGemini, name: str, params: dict[str, Any]) -> dict[str, Any]:
    return actions.run_action(cast("Any", gemini), name, params)


@pytest.fixture(autouse=True)
def no_course() -> Iterator[None]:
    course.configure(None, None)
    yield
    course.configure(None, None)


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """The bridge's `--data-dir`, with a pipeline.db that knows Sam's channel and latest video."""
    folder = tmp_path / "pipeline"
    folder.mkdir()
    c = store.get_connection(folder / "pipeline.db")
    store.init_db(c)
    c.execute(
        "INSERT INTO channels (channel_id, handle, name, first_seen_at) "
        "VALUES ('UC_a', '@sam', 'Sam', 'T')"
    )
    c.execute(
        "INSERT INTO videos (video_id, channel_id, title, published_at, view_count) VALUES "
        "('vid00000001', 'UC_a', 'Claude Code vs Cursor for a real app', '2026-10-12', '41000')"
    )
    c.commit()
    c.close()
    return folder


def test_a_reply_is_proposed_from_the_thread(data_dir: Path) -> None:
    gemini = FakeGemini(data_dir, GOOD)

    result = run(gemini, "comms_propose", {"request": REPLY, "facts": facts()})

    assert result["status"] == "ready"
    assert result["proposal"]["message"]["body"].startswith("Hi Sam")
    assert result["case"] == {
        "side": "influencer",
        "stage": "replied",
        "goal": "Decide the next step after their latest message and draft our reply if one is "
        "needed.",
    }
    assert "What do you pay?" in gemini.sent[0]["text"], "the thread reached the prompt"
    assert result["moments"] == []
    assert result["momentsNote"] is None


def test_an_out_of_scope_creator_is_refused_without_gemini(data_dir: Path) -> None:
    gemini = FakeGemini(data_dir)
    creators = {"UC_a": {"pipelineStage": None, "mediaKit": None, "creatorGender": "female"}}

    result = run(gemini, "comms_propose", {"request": REPLY, "facts": facts(creators=creators)})

    assert result["status"] == "blocked"
    assert result["findings"][0]["code"] == "HC08_OUT_OF_SCOPE"
    assert gemini.sent == []


def test_a_boycotted_brand_is_refused_without_gemini(data_dir: Path) -> None:
    gemini = FakeGemini(data_dir)
    brand: dict[str, Any] = {
        "id": "b2",
        "name": "Some Startup",
        "website": None,
        "category": "AI agents",
        "country": "IL",
        "campaignBrief": None,
        "contactName": None,
        "contacts": [],
    }

    result = run(
        gemini,
        "comms_propose",
        {"request": {"kind": "first", "brandId": "b2"}, "facts": facts(agency=None, brand=brand)},
    )

    assert result["status"] == "blocked"
    assert gemini.calls == []


def test_a_first_email_to_a_creator_carries_the_latest_videos_moments(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    found = {
        "video_id": "vid00000001",
        "title": "Claude Code vs Cursor for a real app",
        "published": "2026-10-12",
        "auto_subtitles": True,
        "moments": [{"at": "6:15", "quote": "Claude Code fixed the migration on the first try"}],
    }
    asked: list[tuple[str, int]] = []
    cases: list[dict[str, Any]] = []

    def latest(conn: Any, gemini: Any, channel_id: str, *, timeout_s: int = 300) -> Any:
        assert conn.execute("SELECT count(*) FROM channels").fetchone()[0] == 1
        asked.append((channel_id, timeout_s))
        return found

    def propose(gemini: Any, case: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        cases.append(case)
        return {"status": "ready", "proposal": {"message": {"body": "b"}}, "findings": []}

    monkeypatch.setattr(moments, "for_latest_video", latest)
    monkeypatch.setattr(engine, "propose", propose)

    result = run(
        FakeGemini(data_dir),
        "comms_propose",
        {"request": {"kind": "first", "channelId": "UC_a", "timeoutS": 120}, "facts": facts()},
    )

    assert asked == [("UC_a", 120)]
    assert cases[0]["facts"]["creator"]["latest_video"]["moments"] == found["moments"]
    assert result["moments"] == found["moments"]
    assert result["momentsNote"] is None
    assert result["case"]["stage"] == "prospect"


def test_moments_that_cannot_be_read_become_a_note(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("yt-dlp is not installed")

    def propose(_gemini: Any, _case: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
        return {"status": "ready", "proposal": None, "findings": [], "gates": []}

    monkeypatch.setattr(moments, "for_latest_video", broken)
    monkeypatch.setattr(engine, "propose", propose)

    result = run(
        FakeGemini(data_dir),
        "comms_propose",
        {"request": {"kind": "first", "channelId": "UC_a"}, "facts": facts()},
    )

    assert result["status"] == "ready"
    assert result["moments"] == []
    assert result["momentsNote"] == (
        "the latest video's moments could not be read: yt-dlp is not installed"
    )


@pytest.mark.parametrize(
    "request_",
    [REPLY, {"kind": "first", "brandId": "b1", "channelId": "UC_a"}, {"kind": "followUp"}],
)
def test_moments_are_only_read_for_a_first_email_to_a_creator(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch, request_: dict[str, Any]
) -> None:
    def never(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("moments were read")

    def propose(_gemini: Any, _case: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
        return {"status": "no_message", "proposal": None}

    monkeypatch.setattr(moments, "for_latest_video", never)
    monkeypatch.setattr(engine, "propose", propose)

    result = run(FakeGemini(data_dir), "comms_propose", {"request": request_, "facts": facts()})

    assert result["status"] == "no_message"
    assert result["findings"] == []
    assert result["gates"] == []


def test_edited_text_is_checked_again_before_it_goes(data_dir: Path) -> None:
    result = run(
        FakeGemini(data_dir),
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": "Hi Sam,\n\nWe can pay you $500 for one video.\n\nMoustafa",
        },
    )

    assert result["blocking"] is False
    assert any(g["what"] == "price" for g in result["gates"]), (
        "a price in the text waits for a person"
    )


def test_a_check_finds_what_blocks(data_dir: Path) -> None:
    result = run(
        FakeGemini(data_dir),
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": (
                "Hi Sam,\n\nThis is a guaranteed, risk-free, 100% free opportunity!!!\n\nMoustafa"
            ),
        },
    )

    assert result["blocking"] is True
    assert result["findings"]


def test_a_number_a_person_typed_is_a_warning_not_a_block(data_dir: Path) -> None:
    # FACT_NUMBER stops the model inventing a number; a number a person typed is theirs.
    result = run(
        FakeGemini(data_dir),
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": "Hi Sam,\n\nYour Cursor video passed 45,000 views fast.\n\nMoustafa",
        },
    )

    typed = [f for f in result["findings"] if f["code"] == "FACT_NUMBER"]
    assert typed
    assert all(f["severity"] == "warn" for f in typed)
    assert typed[0]["detail"].startswith("a number you typed: ")
    assert result["blocking"] is False


@pytest.mark.parametrize(
    "left_in", ["[Your name]", "[First name]", "[Agency]", "{creator_name}", "<Brand>"]
)
def test_an_unfilled_placeholder_blocks_the_send(data_dir: Path, left_in: str) -> None:
    # The engine leaves a placeholder when a fact is missing and asks a person
    # to fill it; confirming that gate must not send the placeholder itself.
    result = run(
        FakeGemini(data_dir),
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": f"Hi Sam,\n\nHappy to talk rates on a call.\n\n{left_in}",
        },
    )

    assert result["blocking"] is True
    assert any(f["code"] == "PLACEHOLDER" and f["severity"] == "block" for f in result["findings"])


def test_square_brackets_that_are_not_a_placeholder_pass(data_dir: Path) -> None:
    result = run(
        FakeGemini(data_dir),
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": "Hi Sam,\n\nHappy to talk rates on a call [2 min].\n\nMoustafa",
        },
    )

    assert not any(f["code"] == "PLACEHOLDER" for f in result["findings"])


def test_comms_check_makes_no_gemini_call(data_dir: Path) -> None:
    gemini = FakeGemini(data_dir)

    run(
        gemini,
        "comms_check",
        {
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": "Hi Sam,\n\nSure.\n\nMoustafa",
        },
    )

    assert gemini.calls == []


def test_comms_check_needs_no_gemini_page() -> None:
    assert "comms_check" in actions._OFF_PAGE_ACTIONS  # pyright: ignore[reportPrivateUsage]
    assert "comms_propose" not in actions._OFF_PAGE_ACTIONS  # pyright: ignore[reportPrivateUsage]


def test_missing_or_garbage_params_never_crash(data_dir: Path) -> None:
    # Main's schema stops these; the actions still answer rather than raise something else.
    for params in ({}, {"request": "reply", "facts": [1]}, {"request": REPLY, "facts": None}):
        checked = run(FakeGemini(data_dir), "comms_check", params)
        assert isinstance(checked["blocking"], bool)


@pytest.mark.parametrize("name", ["comms_propose", "comms_check"])
def test_without_a_data_dir_the_comms_actions_are_bad_params(name: str) -> None:
    with pytest.raises(GeminiError) as info:
        run(FakeGemini(None), name, {"request": REPLY, "facts": facts()})

    assert info.value.code == "BAD_PARAMS"
    assert info.value.message == "the bridge was started without --data-dir"


# --- every line the daemon writes for them fits main's schema (plan D4) ---------------------


@pytest.fixture
def daemon(data_dir: Path) -> tuple[Daemon, io.StringIO]:
    """An in-process daemon over an in-memory stdout; its server never starts."""
    stream = io.StringIO()
    paths = BrowserPaths(profile_dir=data_dir / "profile", extension_dir=data_dir / "extension")
    d = Daemon(port=0, data_dir=data_dir, out=Out(stream), paths=paths)
    return d, stream


def answered(
    daemon: tuple[Daemon, io.StringIO],
    check: Callable[[str], dict[str, Any]],
    schema: dict[str, Any],
    method: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    d, stream = daemon
    start = len(stream.getvalue())
    d.handle({"id": "c1", "method": method, "params": params})
    written = stream.getvalue()[start:].splitlines(keepends=True)
    assert len(written) == 1, written
    message = check(written[0])
    if message["ok"]:
        assert schema_errors(schema["results"][method], message["result"]) == []
    return message


def test_every_comms_line_the_daemon_writes_fits_mains_schema(
    daemon: tuple[Daemon, io.StringIO],
    monkeypatch: pytest.MonkeyPatch,
    check_from_gemini: Callable[[str], dict[str, Any]],
    gemini_schema: dict[str, Any],
) -> None:
    d, _ = daemon
    fake = FakeGemini(None, GOOD)
    monkeypatch.setattr(d.gemini, "call", fake.call)

    def reply(**fields: Any) -> dict[str, Any]:
        return answered(daemon, check_from_gemini, gemini_schema, **fields)

    ready = reply(method="action.comms_propose", params={"request": REPLY, "facts": facts()})
    assert ready["result"]["status"] == "ready", ready

    out_of_scope = {"UC_a": {"pipelineStage": None, "mediaKit": None, "creatorGender": "couple"}}
    blocked = reply(
        method="action.comms_propose",
        params={"request": REPLY, "facts": facts(creators=out_of_scope)},
    )
    assert blocked["result"]["status"] == "blocked"

    # An unsubscribe takes the engine's quick path: no message, no Gemini call.
    unsubscribe = dict(
        THREAD,
        messages=[
            *THREAD["messages"],
            {
                "direction": "inbound",
                "subject": "Re: hi",
                "body": "Please unsubscribe me.",
                "at": "2026-10-17",
            },
        ],
    )
    quick = reply(
        method="action.comms_propose", params={"request": REPLY, "facts": facts(thread=unsubscribe)}
    )
    assert quick["result"]["status"] in ("no_message", "needs_human")

    checked = reply(
        method="action.comms_check",
        params={
            "request": REPLY,
            "facts": facts(),
            "subject": "Re: hi",
            "body": "Hi Sam,\n\nWe can pay you $500 for one video.\n\n[Your name]",
        },
    )
    assert checked["result"]["blocking"] is True

    d.gemini.data_dir = None
    missing = reply(method="action.comms_check", params={"request": REPLY, "facts": facts()})
    assert missing["error"]["code"] == "BAD_PARAMS"
    assert fake.texts == [], "only the ready proposal asked Gemini"


def test_a_check_reads_the_store_without_writing_or_upgrading_it(tmp_path: Path) -> None:
    import sqlite3

    from gratovo_pipeline import store

    db = tmp_path / "pipeline.db"
    old = sqlite3.connect(db)
    old.execute("CREATE TABLE channels (channel_id TEXT PRIMARY KEY)")
    old.execute("PRAGMA user_version=1")
    old.commit()
    old.close()
    before = db.read_bytes()

    gemini = _BridgeOnly(tmp_path)
    conn = actions._comms_db(gemini, write=False)  # pyright: ignore[reportPrivateUsage, reportArgumentType]
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("CREATE TABLE written (x)")
    finally:
        conn.close()
    assert db.read_bytes() == before, "a check never migrates the search job's file"
    assert store.SCHEMA_VERSION == 3


def test_a_check_with_no_store_yet_creates_none(tmp_path: Path) -> None:
    gemini = _BridgeOnly(tmp_path)
    conn = actions._comms_db(gemini, write=False)  # pyright: ignore[reportPrivateUsage, reportArgumentType]
    conn.close()
    assert not (tmp_path / "pipeline.db").exists()


class _BridgeOnly:
    """Just the bridge's data folder, which is all `_comms_db` reads."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
