import io
import json
import socket
import threading
from collections.abc import Callable
from typing import Any

import pytest
from helpers import START, changed, schema_errors

from gratovo_pipeline import protocol
from gratovo_pipeline.protocol import BadStartError, Emitter, listen_for_stop, parse_start

Check = Callable[[str], dict[str, Any]]


def test_a_good_start_parses_to_the_same_values() -> None:
    assert parse_start(json.dumps(START)) == START


def test_settings_may_be_empty() -> None:
    assert parse_start(json.dumps(changed("settings", {})))["settings"] == {}


# Each of these breaks the schema, so the JSON Schema refuses it too.
SCHEMA_BREAKS: list[tuple[str, object]] = [
    ("type", "stop"),
    ("protocol", 2),
    ("source", "prod"),
    ("dataDir", ""),
    ("worker", "x" * 65),
    ("job.kind", "refetch"),
    ("job.keywords", []),
    ("job.keywords", ["x" * 201]),
    ("job.startAt", -1),
    ("job.startAt", 1.5),
    ("job.startAt", True),
    ("job.rules.countries", ["usa"]),
    ("job.rules.perKeyword", 0),
    ("job.rules.sortBy", "newest"),
    ("job.rules.autoClean.belowMin", "keep"),
    ("job.rules.autoClean.extra", 1),
    ("settings.pacing", "slow"),
    ("settings.parallel", {"enabled": True, "maxWorkers": 0}),
    ("secrets.youtubeKey", ""),
    ("secrets.proxyUrls", "http://a"),
    ("secrets", ...),
    ("extra", True),
]


@pytest.mark.parametrize(("path", "value"), SCHEMA_BREAKS)
def test_a_start_that_breaks_the_schema_is_refused(
    path: str, value: object, protocol_schema: dict[str, Any]
) -> None:
    bad = changed(path, value)
    assert schema_errors(protocol_schema["toPipeline"], bad) != []
    with pytest.raises(BadStartError):
        parse_start(json.dumps(bad))


# The checks JSON Schema can't express, which zod makes with refinements.
@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("job.startAt", 2),
        ("job.keywords", ["Claude Code", "claude code"]),
        ("job.keywords", [" ai "]),
    ],
)
def test_a_start_that_breaks_a_refinement_is_refused(path: str, value: object) -> None:
    with pytest.raises(BadStartError):
        parse_start(json.dumps(changed(path, value)))


@pytest.mark.parametrize("line", ["", "not json", "[]", "null", '{"type": "start"}'])
def test_a_start_line_that_is_not_a_start_is_refused(line: str) -> None:
    with pytest.raises(BadStartError):
        parse_start(line)


def test_the_refusal_never_repeats_a_secret() -> None:
    bad = changed("secrets.proxyUrls", ["http://user:hunter2@proxy.example:8080", 5])
    with pytest.raises(BadStartError) as refused:
        parse_start(json.dumps(bad))
    assert "hunter2" not in str(refused.value)


def test_every_message_the_emitter_writes_matches_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.ready()
    emit.run(total=2, start_at=0)
    emit.keyword(index=0, total=2, keyword="ai agents", state="started")
    emit.keyword(index=0, total=2, keyword="ai agents", state="done", found=9, kept=4)
    emit.keyword(index=1, total=2, keyword="ai news", state="failed", error="YouTube said no.")
    emit.channel(
        keyword="ai agents",
        channel_id="UCabc_123-x",
        handle="@aitoolsweekly",
        name="AI Tools Weekly",
        subscribers=184000,
        median_views=None,
        country=None,
        outcome="kept",
    )
    emit.log("info", 'Searching "ai agents" — 12 channels')
    emit.end(state="failed", at=1, found=9, kept=4, error=("quota", "The YouTube quota ran out."))
    emit.end(state="done", at=2, found=9, kept=4)

    messages = [check_from_pipeline(line) for line in out.getvalue().splitlines(keepends=True)]
    assert [m["type"] for m in messages] == [
        "ready",
        "run",
        "keyword",
        "keyword",
        "keyword",
        "channel",
        "log",
        "end",
        "end",
    ]
    assert messages[0]["protocol"] == protocol.PROTOCOL
    assert messages[5]["channelId"] == "UCabc_123-x"
    assert "—" in out.getvalue()  # written as UTF-8, not \u escapes


def test_long_text_is_cut_to_fit_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.log("warn", "x" * 2000)
    emit.end(state="failed", at=0, found=0, kept=0, error=("crash", "y" * 2000))
    first, second = out.getvalue().splitlines(keepends=True)
    assert len(check_from_pipeline(first)["text"]) == protocol.MAX_TEXT
    assert len(check_from_pipeline(second)["error"]["message"]) == protocol.MAX_TEXT


def test_lines_from_many_threads_never_interleave(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)

    def write(n: int) -> None:
        for i in range(200):
            emit.log("info", f"worker {n} line {i} " + "z" * 300)

    threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    lines = out.getvalue().splitlines(keepends=True)
    assert len(lines) == 1600
    for line in lines:
        check_from_pipeline(line)


def wait_for_stop(stream: io.StringIO) -> bool:
    stopped = threading.Event()
    listen_for_stop(stream, stopped.set).join(timeout=5)
    return stopped.is_set()


def test_a_stop_line_stops_the_run() -> None:
    assert wait_for_stop(io.StringIO('not json\n{"type": "other"}\n{"type": "stop"}\n'))


def test_the_app_closing_stdin_stops_the_run() -> None:
    assert wait_for_stop(io.StringIO(""))


def test_the_network_is_blocked_in_tests() -> None:
    with pytest.raises(RuntimeError, match="network"):
        socket.create_connection(("www.youtube.com", 443))
