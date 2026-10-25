"""The refetch job: handles read again, resolved, restored, cleaned by the rule, and how the run
ends. Over an in-memory YouTube; every line is checked against the protocol schema."""

import io
import sqlite3
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeSource, channel_info
from helpers import start_with

from gratovo_pipeline import protocol, run_control, store
from gratovo_pipeline.jobs import refetch as refetch_job
from gratovo_pipeline.protocol import Emitter, Start
from gratovo_pipeline.search.context import SearchBlockedError
from gratovo_pipeline.youtube import ChannelInfo, YouTubeError

CLEAN = {
    "enabled": True,
    "minSubscribers": 50000,
    "maxSubscribers": 2000000,
    "belowMin": "sweep",
    "aboveMax": "delay",
    "label": "inactive",
}


@pytest.fixture(autouse=True)
def fresh_stop() -> Iterator[None]:
    run_control.clear_stop()
    yield
    run_control.clear_stop()


class RefetchFake(FakeSource):
    """A FakeSource that also looks handles up."""

    def __init__(
        self,
        *,
        details: Sequence[ChannelInfo] = (),
        uploads: Mapping[str, Sequence[str]] | None = None,
        lookups: Sequence[ChannelInfo] = (),
    ) -> None:
        super().__init__(details=details, uploads=uploads)
        self.lookups = {i["Handle"]: i for i in lookups}
        self.lookup_calls: list[str] = []
        self.on_lookup: Callable[[str], None] | None = None

    def channel_for_handle(self, handle: str) -> tuple[str, ChannelInfo] | None:
        self.lookup_calls.append(handle)
        if self.on_lookup:
            self.on_lookup(handle)
        info = self.lookups.get(handle)
        return (info["Channel_ID"], info) if info else None


class Run:
    def __init__(self, check: Callable[[str], dict[str, Any]], data_dir: Path) -> None:
        self.out = io.StringIO()
        self.check = check
        self.data_dir = data_dir

    def messages(self) -> list[dict[str, Any]]:
        return [self.check(line) for line in self.out.getvalue().splitlines(keepends=True)]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [m for m in self.messages() if m["type"] == kind]

    def end(self) -> dict[str, Any]:
        last = self.messages()[-1]
        assert last["type"] == "end"
        return last

    def result(self) -> dict[str, Any]:
        (result,) = self.of("result")
        assert result["kind"] == "refetch"
        return result["data"]

    def outcomes(self) -> dict[str, str]:
        return {c["handle"]: c["outcome"] for c in self.of("channel")}

    def db(self) -> sqlite3.Connection:
        return store.get_connection(self.data_dir / "pipeline.db")


@pytest.fixture
def run(check_from_pipeline: Callable[[str], dict[str, Any]], tmp_path: Path) -> Run:
    return Run(check_from_pipeline, tmp_path / "data")


def start_for(
    run: Run,
    handles: list[str],
    *,
    auto_clean: object = None,
    keyword: str | None = None,
    **changes: object,
) -> Start:
    job: dict[str, object] = {"kind": "refetch", "handles": handles, "autoClean": auto_clean}
    if keyword is not None:
        job["keyword"] = keyword
    return start_with(source="live", dataDir=str(run.data_dir), job=job, settings={}, **changes)


def go(run: Run, start: Start, source: RefetchFake) -> None:
    refetch_job.run(start, Emitter(run.out), source=source)


def seed_known(run: Run, handle: str, channel_id: str, *, subscribers: str = "1000") -> None:
    """A channel an earlier search read in full."""
    run.data_dir.mkdir(parents=True, exist_ok=True)
    conn = run.db()
    try:
        store.init_db(conn)
        store.record_channel_discovery(conn, handle, channel_id, "ai agents")
        old = channel_info(handle, channel_id, subscribers=subscribers)
        store.save_channels(conn, {handle: old}, {handle: channel_id})
        store.mark_channels_videos_fetched(conn, [channel_id])
    finally:
        conn.close()


def channel_row(run: Run, channel_id: str) -> dict[str, Any] | None:
    conn = run.db()
    try:
        return store.get_channel_row(conn, channel_id)
    finally:
        conn.close()


def run_status(run: Run) -> str:
    conn = run.db()
    try:
        return str(conn.execute("SELECT status FROM runs").fetchone()["status"])
    finally:
        conn.close()


# --- known and unknown handles ---


def test_a_known_handle_is_refreshed_and_stamped(run: Run) -> None:
    seed_known(run, "@aitoolsweekly", "UC1")
    fresh = channel_info("@aitoolsweekly", "UC1", subscribers="260000")
    source = RefetchFake(details=[fresh], uploads={"@aitoolsweekly": ["v1", "v2"]})

    go(run, start_for(run, ["@aitoolsweekly"]), source)

    assert source.lookup_calls == []
    assert source.channel_calls == [["@aitoolsweekly"]]
    assert source.read == ["@aitoolsweekly"]
    assert source.video_calls == [["v1", "v2"]]
    assert source.sweeps[0].closed
    row = channel_row(run, "UC1")
    assert row is not None
    assert (row["subscribers"], row["force_refetch"]) == ("260000", 0)
    assert row["videos_fetched_at"] is not None
    assert run.outcomes() == {"@aitoolsweekly": "kept"}
    (line,) = run.of("channel")
    assert (line["name"], line["subscribers"], line["country"]) == (
        "Aitoolsweekly",
        260000,
        "US",
    )
    assert run.result() == {
        "processed": 1,
        "swept": 0,
        "deferred": 0,
        "failedCount": 0,
        "failed": [],
    }
    end = run.end()
    assert (end["state"], end["at"], end["found"], end["kept"]) == ("done", 0, 0, 0)


def test_an_unknown_handle_is_resolved_and_saved(run: Run) -> None:
    info = channel_info("@newagentsdaily", "UC2")
    source = RefetchFake(lookups=[info], uploads={"@newagentsdaily": ["v3"]})

    go(run, start_for(run, ["@newagentsdaily"]), source)

    assert source.lookup_calls == ["@newagentsdaily"]
    row = channel_row(run, "UC2")
    assert row is not None
    assert (row["handle"], row["name"], row["last_fetch_status"]) == (
        "@newagentsdaily",
        "Newagentsdaily",
        "success",
    )
    assert row["videos_fetched_at"] is not None
    assert run.outcomes() == {"@newagentsdaily": "kept"}
    assert run.end()["state"] == "done"


def test_an_archived_handle_is_restored(run: Run) -> None:
    seed_known(run, "@oldaichannel", "UC3")
    conn = run.db()
    try:
        store.archive_channel_locally(conn, "UC3", "@oldaichannel", "inactive")
        assert store.is_archived(conn, "UC3")
    finally:
        conn.close()
    source = RefetchFake(lookups=[channel_info("@oldaichannel", "UC3")])

    go(run, start_for(run, ["@oldaichannel"]), source)

    conn = run.db()
    try:
        assert not store.is_archived(conn, "UC3")
    finally:
        conn.close()
    row = channel_row(run, "UC3")
    assert row is not None
    assert row["videos_fetched_at"] is not None
    assert run.outcomes() == {"@oldaichannel": "kept"}


def test_a_restored_handle_keeps_the_keywords_that_found_it(run: Run) -> None:
    # The old app deleted the tombstone and filed the channel under the refetch keyword only.
    seed_known(run, "@oldaichannel", "UC3")
    conn = run.db()
    try:
        conn.execute(
            "INSERT INTO channel_keywords (channel_id, keyword, discovered_at) "
            "VALUES ('UC3', 'claude code tutorial', '2026-02-02T00:00:00Z')"
        )
        conn.execute(
            "UPDATE channel_keywords SET discovered_at='2026-01-01T00:00:00Z' "
            "WHERE keyword='ai agents'"
        )
        conn.commit()
        store.archive_channel_locally(conn, "UC3", "@oldaichannel", "inactive")
    finally:
        conn.close()
    source = RefetchFake(lookups=[channel_info("@oldaichannel", "UC3")])

    go(run, start_for(run, ["@oldaichannel"]), source)

    conn = run.db()
    try:
        keywords = conn.execute(
            "SELECT keyword, discovered_at FROM channel_keywords WHERE channel_id='UC3' "
            "ORDER BY discovered_at"
        ).fetchall()
    finally:
        conn.close()
    assert [tuple(k) for k in keywords][:2] == [
        ("ai agents", "2026-01-01T00:00:00Z"),
        ("claude code tutorial", "2026-02-02T00:00:00Z"),
    ]
    assert [k[0] for k in keywords][2:] == [protocol.REFETCH_KEYWORD]


def test_the_run_is_recorded_as_a_re_enrich_run(run: Run) -> None:
    seed_known(run, "@aitoolsweekly", "UC1")
    source = RefetchFake(details=[channel_info("@aitoolsweekly", "UC1")])

    go(run, start_for(run, ["@aitoolsweekly"]), source)

    conn = run.db()
    try:
        runs = [dict(r) for r in conn.execute("SELECT kind, status, keywords_total FROM runs")]
    finally:
        conn.close()
    assert runs == [{"kind": "re-enrich", "status": "done", "keywords_total": 1}]


# --- the auto-clean rule ---


def test_each_auto_clean_verdict(run: Run) -> None:
    small = channel_info("@tinyaichannel", "UC10", subscribers="12000")
    huge = channel_info("@hugeaichannel", "UC11", subscribers="5000000")
    mid = channel_info("@midaichannel", "UC12", subscribers="250000")
    hidden = channel_info("@hiddenaichannel", "UC13", subscribers="Hidden")
    source = RefetchFake(
        lookups=[small, huge, mid, hidden],
        uploads={"@midaichannel": ["v1"], "@hiddenaichannel": ["v2"]},
    )
    handles = ["@tinyaichannel", "@hugeaichannel", "@midaichannel", "@hiddenaichannel"]

    go(run, start_for(run, handles, auto_clean=CLEAN), source)

    assert run.outcomes() == {
        "@tinyaichannel": "swept",
        "@hugeaichannel": "delayed",
        "@midaichannel": "kept",
        "@hiddenaichannel": "kept",  # nothing is archived on a count the run doesn't have
    }
    assert source.read == ["@midaichannel", "@hiddenaichannel"]
    conn = run.db()
    try:
        assert store.is_archived(conn, "UC10")
        label = conn.execute("SELECT label FROM channel_archive WHERE channel_id='UC10'")
        assert label.fetchone()["label"] == "inactive"
        assert store.get_channel_row(conn, "UC10") is None
    finally:
        conn.close()
    huge_row = channel_row(run, "UC11")
    assert huge_row is not None
    assert huge_row["videos_fetched_at"] is None  # the backlog's
    assert huge_row["force_refetch"] == 0
    swept = next(c for c in run.of("channel") if c["outcome"] == "swept")
    assert (swept["name"], swept["subscribers"]) == ("Tinyaichannel", 12000)
    assert run.result() == {
        "processed": 2,
        "swept": 1,
        "deferred": 1,
        "failedCount": 0,
        "failed": [],
    }


def test_with_the_rule_off_a_small_channel_is_kept(run: Run) -> None:
    small = channel_info("@tinyaichannel", "UC10", subscribers="12000")
    source = RefetchFake(lookups=[small])

    go(run, start_for(run, ["@tinyaichannel"], auto_clean={**CLEAN, "enabled": False}), source)

    assert run.outcomes() == {"@tinyaichannel": "kept"}


# --- trouble ---


def test_a_failing_handle_does_not_stop_the_others(run: Run) -> None:
    seed_known(run, "@brokenanswer", "UC20")  # known, but the API returns nothing for it
    good = channel_info("@aitoolsweekly", "UC21")
    source = RefetchFake(lookups=[good], uploads={"@aitoolsweekly": ["v1"]})

    go(run, start_for(run, ["@ghosthandle", "@brokenanswer", "@aitoolsweekly"]), source)

    assert run.outcomes() == {"@aitoolsweekly": "kept"}
    assert run.result() == {
        "processed": 1,
        "swept": 0,
        "deferred": 0,
        "failedCount": 2,
        "failed": ["@ghosthandle", "@brokenanswer"],
    }
    assert any(m["level"] == "warn" and "@ghosthandle" in m["text"] for m in run.of("log"))
    assert run.end()["state"] == "done"
    row = channel_row(run, "UC20")
    assert row is not None
    assert row["last_fetch_status"] == "failed"


def test_an_unexpected_error_in_one_handle_is_a_failed_handle(run: Run) -> None:
    good = channel_info("@aitoolsweekly", "UC21")
    odd = channel_info("@oddaichannel", "UC22")
    source = RefetchFake(lookups=[odd, good])

    def explode(handle: str) -> None:
        if handle == "@oddaichannel":
            raise ValueError("a surprise")

    source.on_lookup = explode

    go(run, start_for(run, ["@oddaichannel", "@aitoolsweekly"]), source)

    assert run.result()["failed"] == ["@oddaichannel"]
    assert run.outcomes() == {"@aitoolsweekly": "kept"}
    assert run.end()["state"] == "done"


def test_blocked_ends_failed_with_no_result(run: Run) -> None:
    source = RefetchFake(lookups=[channel_info("@aitoolsweekly", "UC21")])

    def blocked(_handle: str) -> None:
        raise SearchBlockedError("blocked")

    source.on_read = blocked

    go(run, start_for(run, ["@aitoolsweekly", "@second"]), source)

    assert run.of("result") == []
    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "blocked")
    assert run_status(run) == "interrupted"


def test_a_sweep_that_cannot_open_still_ends(run: Run) -> None:
    class NoSweep(RefetchFake):
        def sweep(self) -> Any:
            raise OSError("disk")

    go(run, start_for(run, ["@aitoolsweekly"]), NoSweep())

    assert run.of("result") == []
    assert (run.end()["state"], run.end()["error"]["code"]) == ("failed", "crash")
    assert run_status(run) == "interrupted"


def test_a_spent_quota_ends_failed_as_quota(run: Run) -> None:
    source = RefetchFake()

    def quota(_handle: str) -> None:
        raise YouTubeError("quota", "The YouTube API quota for today is spent.")

    source.on_lookup = quota

    go(run, start_for(run, ["@aitoolsweekly"]), source)

    assert run.of("result") == []
    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "quota")


def test_a_stop_keeps_what_landed_and_sends_a_partial_result(run: Run) -> None:
    first = channel_info("@aitoolsweekly", "UC21")
    second = channel_info("@agentsdaily", "UC22")
    source = RefetchFake(lookups=[first, second], uploads={"@aitoolsweekly": ["v1"]})
    source.on_read = lambda _handle: run_control.request_stop()

    go(run, start_for(run, ["@aitoolsweekly", "@agentsdaily"]), source)

    assert run.outcomes() == {"@aitoolsweekly": "kept"}
    assert run.result() == {
        "processed": 1,
        "swept": 0,
        "deferred": 0,
        "failedCount": 0,
        "failed": [],
    }
    assert run.end()["state"] == "stopped"
    assert source.lookup_calls == ["@aitoolsweekly"]
    assert source.sweeps[0].closed
    row = channel_row(run, "UC21")
    assert row is not None
    assert row["videos_fetched_at"] is not None
    assert run_status(run) == "interrupted"


def test_a_long_failed_list_is_cut(run: Run) -> None:
    handles = [f"@missing{i}" for i in range(protocol.MAX_FAILED_HANDLES + 5)]

    go(run, start_for(run, handles), RefetchFake())

    data = run.result()
    assert data["failedCount"] == len(handles)
    assert len(data["failed"]) == protocol.MAX_FAILED_HANDLES


# --- provenance and the key ---


def test_each_channel_is_recorded_under_the_default_keyword(run: Run) -> None:
    seed_known(run, "@aitoolsweekly", "UC1")
    source = RefetchFake(
        details=[channel_info("@aitoolsweekly", "UC1")],
        lookups=[channel_info("@newagentsdaily", "UC2")],
    )

    go(run, start_for(run, ["@aitoolsweekly", "@newagentsdaily"]), source)

    conn = run.db()
    try:
        links = {
            (r["channel_id"], r["keyword"])
            for r in conn.execute("SELECT channel_id, keyword FROM channel_keywords")
        }
    finally:
        conn.close()
    assert links == {
        ("UC1", "ai agents"),
        ("UC1", protocol.REFETCH_KEYWORD),
        ("UC2", protocol.REFETCH_KEYWORD),
    }
    assert {c["keyword"] for c in run.of("channel")} == {protocol.REFETCH_KEYWORD}


def test_the_job_keyword_is_the_provenance(run: Run) -> None:
    source = RefetchFake(lookups=[channel_info("@newagentsdaily", "UC2")])

    go(run, start_for(run, ["@newagentsdaily"], keyword="import 2026-10"), source)

    conn = run.db()
    try:
        keywords = [r["keyword"] for r in conn.execute("SELECT keyword FROM channel_keywords")]
    finally:
        conn.close()
    assert keywords == ["import 2026-10"]
    assert [c["keyword"] for c in run.of("channel")] == ["import 2026-10"]


def test_no_key_ends_failed_as_no_youtube_key(run: Run) -> None:
    refetch_job.run(start_for(run, ["@aitoolsweekly"], secrets__youtubeKey=None), Emitter(run.out))

    assert run.of("result") == []
    end = run.end()
    assert (end["state"], end["error"]["code"]) == ("failed", "no_youtube_key")
