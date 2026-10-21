"""A whole search run: the loop over keywords, the counts, stop and resume, how each failure
ends the run, and the real process on example data."""

import io
import json
import subprocess
import sys
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeSource
from helpers import changed, start_with

from gratovo_pipeline import example, run_control, store
from gratovo_pipeline.jobs import search as search_job
from gratovo_pipeline.protocol import Emitter, Start
from gratovo_pipeline.search.context import SearchBlockedError
from gratovo_pipeline.youtube import ChannelInfo, YouTubeError

KEYWORDS = list(example.KEYWORDS[:3])


@pytest.fixture(autouse=True)
def fresh_stop() -> Iterator[None]:
    run_control.clear_stop()
    yield
    run_control.clear_stop()


@pytest.fixture(autouse=True)
def no_example_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(example, "READ_PAUSE", 0.0)


def start_for(tmp_path: Path, **changes: object) -> Start:
    defaults: dict[str, object] = {
        "dataDir": str(tmp_path / "example-pipeline"),
        "job__keywords": KEYWORDS,
        "job__startAt": 0,
        "settings": {},
    }
    return start_with(**{**defaults, **changes})


class Run:
    def __init__(self, check: Callable[[str], dict[str, Any]]) -> None:
        self.out = io.StringIO()
        self.check = check

    def messages(self) -> list[dict[str, Any]]:
        return [self.check(line) for line in self.out.getvalue().splitlines(keepends=True)]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [m for m in self.messages() if m["type"] == kind]

    def end(self) -> dict[str, Any]:
        last = self.messages()[-1]
        assert last["type"] == "end"
        return last


@pytest.fixture
def run(check_from_pipeline: Callable[[str], dict[str, Any]]) -> Run:
    return Run(check_from_pipeline)


def go(run: Run, start: Start, source: Any = None) -> None:
    search_job.run(start, Emitter(run.out), source=source)


# --- a run on example data ---


def test_an_example_run_searches_every_keyword_and_ends_done(tmp_path: Path, run: Run) -> None:
    go(run, start_for(tmp_path))

    kinds = [m["type"] for m in run.messages()]
    assert kinds[0] == "log"  # where the run points
    assert kinds[1] == "run"
    assert run.of("run") == [{"type": "run", "state": "running", "total": 3, "startAt": 0}]
    states = [(k["index"], k["state"]) for k in run.of("keyword")]
    assert states == [
        (0, "started"),
        (0, "done"),
        (1, "started"),
        (1, "done"),
        (2, "started"),
        (2, "done"),
    ]
    done = [k for k in run.of("keyword") if k["state"] == "done"]
    end = run.end()
    assert (end["state"], end["at"]) == ("done", 3)
    assert end["found"] == sum(k["found"] for k in done) > 0
    assert end["kept"] == sum(k["kept"] for k in done) > 0
    assert end["kept"] == len([c for c in run.of("channel") if c["outcome"] == "kept"])
    # The example rule keeps, sweeps and delays some.
    assert {c["outcome"] for c in run.of("channel")} == {"kept", "swept", "delayed"}


def test_everything_lands_in_the_data_folder(tmp_path: Path, run: Run) -> None:
    go(run, start_for(tmp_path))

    conn = store.get_connection(tmp_path / "example-pipeline" / "pipeline.db")
    try:
        statuses = {r["keyword"]: r["status"] for r in conn.execute("SELECT * FROM keywords")}
        assert statuses == dict.fromkeys(KEYWORDS, "done")
        runs = list(conn.execute("SELECT status, keywords_done FROM runs"))
        assert [(r["status"], r["keywords_done"]) for r in runs] == [("done", 3)]
        assert conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0] > 0
    finally:
        conn.close()


def test_a_run_starts_at_start_at(tmp_path: Path, run: Run) -> None:
    go(run, start_for(tmp_path, job__startAt=2))

    assert {k["index"] for k in run.of("keyword")} == {2}
    assert run.of("run")[0]["startAt"] == 2
    assert run.end()["at"] == 3


def test_parallel_workers_finish_every_keyword(tmp_path: Path, run: Run) -> None:
    start = start_for(
        tmp_path,
        settings={"parallel": {"enabled": True, "maxWorkers": 3}},
        secrets__gatewayUrls=[
            f"https://g{i}.execute-api.us-east-1.amazonaws.com" for i in range(3)
        ],
    )
    go(run, start)

    assert sorted(k["index"] for k in run.of("keyword") if k["state"] == "done") == [0, 1, 2]
    assert (run.end()["state"], run.end()["at"]) == ("done", 3)


# --- stop and resume ---


def test_a_stop_before_anything_ran_ends_stopped_at_start_at(tmp_path: Path, run: Run) -> None:
    run_control.request_stop()
    go(run, start_for(tmp_path, job__startAt=1))

    end = run.end()
    assert (end["state"], end["at"], end["found"], end["kept"]) == ("stopped", 1, 0, 0)


def stop_when_reading(handle_index: int) -> FakeSource:
    """An example-like source that asks for a stop as the second keyword's first upload is
    read."""
    infos: list[ChannelInfo] = []
    results: dict[str, dict[str, str]] = {}
    for k, keyword in enumerate(KEYWORDS):
        results[keyword] = {}
        for i in range(2):
            handle, cid = f"@ai-creator-{k}-{i}", f"UC_{k}_{i}"
            results[keyword][handle] = cid
            infos.append(
                {
                    "Name": handle,
                    "Handle": handle,
                    "Link": "",
                    "Channel_ID": cid,
                    "Description": None,
                    "Subscribers": "250000",
                    "Profile_Picture": None,
                    "Banner": None,
                    "Country": "US",
                }
            )
    source = FakeSource(results=results, details=infos, uploads={i["Handle"]: ["v"] for i in infos})
    reads = 0

    def maybe_stop(_handle: str) -> None:
        nonlocal reads
        if reads == handle_index:
            run_control.request_stop()
            run_control.check_stop()
        reads += 1

    source.on_read = maybe_stop
    return source


def test_a_stop_mid_run_ends_stopped_at_the_keyword_in_progress(tmp_path: Path, run: Run) -> None:
    go(run, start_for(tmp_path, job__rules__autoClean__enabled=False), stop_when_reading(2))

    end = run.end()
    assert (end["state"], end["at"]) == ("stopped", 1)
    states = [(k["index"], k["state"]) for k in run.of("keyword")]
    assert states == [(0, "started"), (0, "done"), (1, "started")]
    # The stopped keyword's work so far is kept and counted.
    assert end["kept"] == 2 + 0
    conn = store.get_connection(tmp_path / "example-pipeline" / "pipeline.db")
    try:
        row = conn.execute("SELECT status FROM runs").fetchone()
        assert row["status"] == "interrupted"
    finally:
        conn.close()


def test_a_resume_finds_the_stopped_keywords_channels_as_known(tmp_path: Path, run: Run) -> None:
    source = stop_when_reading(3)  # the second keyword's second channel
    go(run, start_for(tmp_path), source)
    assert run.end()["at"] == 1

    run_control.clear_stop()
    source.on_read = None
    again = Run(run.check)
    go(again, start_for(tmp_path, job__startAt=1), source)

    assert (again.end()["state"], again.end()["at"]) == ("done", 3)
    first = next(k for k in again.of("keyword") if k["state"] == "done")
    # Both its channels were saved before the stop, so the resumed keyword finds them as known
    # and keeps none twice; the one never read is the backlog's (as in the old pipeline).
    assert (first["index"], first["found"], first["kept"]) == (1, 2, 0)
    assert "@ai-creator-1-1" in source.read
    conn = store.get_connection(tmp_path / "example-pipeline" / "pipeline.db")
    try:
        assert store.count_channels_needing_videos(conn) == 0
    finally:
        conn.close()


# --- failures ---


class Failing(FakeSource):
    def __init__(self, error: BaseException) -> None:
        super().__init__(results={KEYWORDS[0]: {"@ai-tools-weekly": "UC_mid"}})
        self.error = error

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        raise self.error


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (SearchBlockedError("YouTube is refusing requests"), "blocked"),
        (YouTubeError("quota", "The YouTube API quota for today is spent."), "quota"),
        (YouTubeError("network", "Couldn't reach YouTube's API."), "network"),
        (YouTubeError("no_youtube_key", "Google refused the YouTube API key."), "no_youtube_key"),
    ],
)
def test_a_failure_ends_the_run_with_its_code(
    tmp_path: Path, run: Run, error: BaseException, code: str
) -> None:
    go(run, start_for(tmp_path), Failing(error))

    end = run.end()
    assert (end["state"], end["at"], end["error"]["code"]) == ("failed", 0, code)
    failed = [k for k in run.of("keyword") if k["state"] == "failed"]
    assert [(k["index"], k["error"]) for k in failed] == [(0, end["error"]["message"])]


def test_an_unexpected_error_ends_as_crash_naming_only_its_kind(
    tmp_path: Path, run: Run, capsys: pytest.CaptureFixture[str]
) -> None:
    go(run, start_for(tmp_path), Failing(RuntimeError("https://user:secret@proxy.example")))

    end = run.end()
    assert end["error"] == {
        "code": "crash",
        "message": "The search stopped on an unexpected error (RuntimeError).",
    }
    assert "secret" not in run.out.getvalue()
    assert "secret" not in capsys.readouterr().err  # the traceback names frames, not the message


def test_a_live_run_without_a_key_ends_before_any_request(tmp_path: Path, run: Run) -> None:
    go(run, start_for(tmp_path, source="live", secrets__youtubeKey=None))

    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "no_youtube_key")
    assert run.of("keyword") == []


def test_a_newer_database_is_refused(tmp_path: Path, run: Run) -> None:
    folder = tmp_path / "example-pipeline"
    folder.mkdir()
    conn = store.get_connection(folder / "pipeline.db")
    conn.execute("PRAGMA user_version = 99")
    conn.close()

    go(run, start_for(tmp_path))

    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "crash")
    assert "newer" in end["error"]["message"]


# --- the real process ---


def launch(tmp_path: Path) -> subprocess.Popen[bytes]:
    return subprocess.Popen(  # our own interpreter and module
        [sys.executable, "-I", "-u", "-m", "gratovo_pipeline"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=tmp_path,
    )


def lines_of(raw: bytes, check: Callable[[str], dict[str, Any]]) -> list[dict[str, Any]]:
    text = raw.decode("utf-8")
    assert "\r" not in text  # plain \n line ends, even on Windows
    return [check(line) for line in text.splitlines(keepends=True)]


def start_line(tmp_path: Path, **changes: object) -> bytes:
    message = changed("dataDir", str(tmp_path / "example-pipeline"))
    message = changed("job.keywords", KEYWORDS[:2], message)
    message = changed("job.startAt", 0, message)
    for path, value in changes.items():
        message = changed(path, value, message)
    return (json.dumps(message, ensure_ascii=False) + "\n").encode()


def test_the_process_runs_an_example_search(
    tmp_path: Path, check_from_pipeline: Callable[[str], dict[str, Any]]
) -> None:
    # stdin stays open while the run goes: closing it means the app is gone, which stops it.
    process = launch(tmp_path)
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(start_line(tmp_path))
    process.stdin.flush()
    lines: list[bytes] = []
    while not lines or b'"type":"end"' not in lines[-1]:
        line = process.stdout.readline()
        assert line, "the process ended without an end line"
        lines.append(line)
    raw = b"".join(lines)
    process.stdin.close()
    assert process.wait(timeout=60) == 0

    messages = lines_of(raw, check_from_pipeline)
    assert messages[0]["type"] == "ready"
    assert messages[0]["protocol"] == 1
    assert (messages[-1]["type"], messages[-1]["state"]) == ("end", "done")


def test_a_bad_start_line_ends_as_bad_start(
    tmp_path: Path, check_from_pipeline: Callable[[str], dict[str, Any]]
) -> None:
    process = launch(tmp_path)
    out, _ = process.communicate(b'{"type":"start","protocol":1}\n', timeout=60)

    messages = lines_of(out, check_from_pipeline)
    assert process.returncode == 0
    assert [m["type"] for m in messages] == ["ready", "end"]
    assert messages[-1]["error"]["code"] == "bad_start"


def test_closing_stdin_stops_the_process(
    tmp_path: Path, check_from_pipeline: Callable[[str], dict[str, Any]]
) -> None:
    process = launch(tmp_path)
    assert process.stdin is not None
    process.stdin.write(start_line(tmp_path, **{"job.keywords": list(example.KEYWORDS)}))
    process.stdin.write(b'{"type":"stop"}\n')
    process.stdin.close()
    assert process.stdout is not None
    out = process.stdout.read()
    process.wait(timeout=60)

    messages = lines_of(out, check_from_pipeline)
    assert (messages[-1]["type"], messages[-1]["state"]) == ("end", "stopped")
    assert process.returncode == 0


def test_example_data_is_only_about_ai() -> None:
    words = ("ai", "gpt", "claude", "llm", "agent", "prompt", "model", "neural", "machine")
    for keyword in example.KEYWORDS:
        assert any(w in keyword.lower() for w in words), keyword
    for channel in example.CHANNELS:
        text = f"{channel.name} {channel.description}".lower()
        assert any(w in text for w in words), channel.name


def test_a_keyword_outside_the_fixture_still_finds_the_same_channels_every_time() -> None:
    source = example.ExampleSource()
    first = source.find_channels("gemini for spreadsheets", limit=200)
    assert first == source.find_channels("gemini for spreadsheets", limit=200)
    assert 3 <= len(first) <= 6
