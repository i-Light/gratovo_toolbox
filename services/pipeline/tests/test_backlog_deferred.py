"""Plan D45: every channel still missing its uploads gets them read, deferred and restored ones
included, and none stays unread for good. Each test names the way the old app lost a channel."""

import sqlite3
import time
from collections.abc import Sequence

import pytest
from fakes import FakeSource, channel_info, make_search

from gratovo_pipeline import store
from gratovo_pipeline.search import backfill, keyword
from gratovo_pipeline.search.context import (
    ChannelUnreadableError,
    Search,
    SearchBlockedError,
)

KW = "best ai video editor 2026"
HUGE = channel_info("@ai-news-giant", "UC_huge", "9000000", "GB")  # above the max: delayed


def add_channels(conn: sqlite3.Connection, names: str) -> None:
    for i, name in enumerate(names):
        conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
            (f"UC_{name}", f"@{name}", f"2026-01-{i + 1:02d}T00:00:00Z"),
        )
    conn.commit()


def iso(at: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))


def row(conn: sqlite3.Connection, channel_id: str) -> sqlite3.Row:
    found = conn.execute("SELECT * FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
    assert found is not None
    return found


class FailingSource(FakeSource):
    """Reads of the handles in `unreadable` fail the way a bad channel page does."""

    def __init__(self, unreadable: set[str], **kwargs: Sequence[str]) -> None:
        super().__init__(uploads=kwargs)
        self.unreadable = unreadable
        self.on_read = self._fail

    def _fail(self, handle: str) -> None:
        if handle in self.unreadable:
            raise ChannelUnreadableError(handle)


def test_a_delayed_channel_is_read_on_the_next_keywords_slice_and_leaves_the_backlog(
    conn: sqlite3.Connection,
) -> None:
    source = FakeSource(
        results={KW: {"@ai-news-giant": "UC_huge"}},
        details=[HUGE],
        uploads={"@ai-news-giant": ["huge_v1", "huge_v2"]},
    )
    search = make_search(conn, source)

    result = keyword.process_keyword(search, KW)

    assert result.delayed == 1
    assert source.read == []  # the keyword left it alone
    assert store.get_video_backfill_candidates(conn, 10) == {"@ai-news-giant": "UC_huge"}

    keyword.after_keyword(search)  # the slice after the keyword

    assert source.read == ["@ai-news-giant"]
    channel = row(conn, "UC_huge")
    assert channel["videos_fetched_at"] is not None
    assert channel["videos_last_30"] == 2
    assert channel["median_views_last_30"] == 1000
    assert store.get_video_backfill_candidates(conn, 10) == {}
    assert store.count_channels_needing_videos(conn) == 0


def test_a_channel_brought_back_from_a_tombstone_is_a_backlog_candidate(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "a")
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive", subscribers=1200)
    assert store.get_video_backfill_candidates(conn, 10) == {}

    assert store.restore_channel_locally(conn, "UC_a") == "@a"

    assert row(conn, "UC_a")["videos_fetched_at"] is None
    assert row(conn, "UC_a")["force_refetch"] == 1
    assert store.get_video_backfill_candidates(conn, 10) == {"@a": "UC_a"}
    source = FakeSource(uploads={"@a": ["a_v1"]})
    assert backfill.backfill_missing_videos(make_search(conn, source), limit=10) == 1
    assert row(conn, "UC_a")["force_refetch"] == 0
    assert store.get_video_backfill_candidates(conn, 10) == {}


def test_a_failed_read_is_not_stamped_as_zero_uploads_and_comes_back_later(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "ab")
    source = FailingSource({"@a"}, **{"@b": ["b_v1"]})
    search = make_search(conn, source)

    assert backfill.backfill_missing_videos(search, limit=10) == 1  # @b only

    assert row(conn, "UC_a")["videos_fetched_at"] is None  # not "read, zero uploads"
    assert row(conn, "UC_b")["videos_fetched_at"] is not None
    assert store.get_video_backfill_candidates(conn, 10) == {}  # stepped aside for a day
    assert store.count_channels_needing_videos(conn) == 0

    later = time.time() + 2 * 86400  # the back-off ends by itself
    assert store.get_video_backfill_candidates(conn, 10, now=later) == {"@a": "UC_a"}
    conn.execute("UPDATE channels SET unreadable_until='2020-01-01T00:00:00Z'")  # a day on
    source.unreadable.clear()
    source.uploads["@a"] = ["a_v1"]
    assert backfill.backfill_missing_videos(search, limit=10) == 1
    assert row(conn, "UC_a")["videos_fetched_at"] is not None
    assert row(conn, "UC_a")["unreadable_until"] is None


def test_a_block_mid_slice_leaves_the_rest_in_the_backlog_unhidden(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "abcd")
    source = FakeSource()

    def blocked_at_c(handle: str) -> None:
        if handle == "@c":
            raise SearchBlockedError("blocked")

    source.on_read = blocked_at_c
    with pytest.raises(SearchBlockedError):
        backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert set(store.get_video_backfill_candidates(conn, 10)) == {"@c", "@d"}


def test_a_channel_with_no_uploads_is_read_once_not_every_slice(conn: sqlite3.Connection) -> None:
    add_channels(conn, "a")
    source = FakeSource()  # @a has no uploads
    search = make_search(conn, source)

    assert backfill.backfill_missing_videos(search, limit=10) == 1
    assert backfill.backfill_missing_videos(search, limit=10) == 0

    assert source.read == ["@a"]
    assert row(conn, "UC_a")["videos_fetched_at"] is not None  # read, zero uploads
    assert row(conn, "UC_a")["videos_last_30"] == 0


def test_a_tombstoned_channel_is_never_a_candidate(conn: sqlite3.Connection) -> None:
    add_channels(conn, "ab")
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive")

    assert store.get_video_backfill_candidates(conn, 10) == {"@b": "UC_b"}
    assert store.count_channels_needing_videos(conn) == 1


def test_always_failing_channels_cannot_starve_the_ones_behind_them(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "abcdefgh")
    source = FailingSource({"@a", "@b", "@c"}, **{f"@{n}": [f"{n}_v1"] for n in "defgh"})
    search: Search = make_search(conn, source)

    # Slice of 3 over 8 channels, the 3 oldest always fail: without a back-off every slice
    # would be the same three. With it, everyone else is reached in a bounded number of slices.
    for _ in range(3):
        backfill.backfill_missing_videos(search, limit=3)

    unread = {
        r["handle"]
        for r in conn.execute("SELECT handle FROM channels WHERE videos_fetched_at IS NULL")
    }
    assert unread == {"@a", "@b", "@c"}


def test_a_dropped_video_batch_leaves_its_channels_unstamped(conn: sqlite3.Connection) -> None:
    # Legacy stamped every touched channel in a `finally`, even when its videos never saved.
    # Here only a channel with every upload saved is stamped.
    add_channels(conn, "a")
    source = FakeSource(uploads={"@a": ["a_v1"]})

    def fail(_ids: Sequence[str]) -> None:
        raise RuntimeError("dropped")

    source.on_videos = fail
    with pytest.raises(RuntimeError):
        backfill.backfill_missing_videos(make_search(conn, source), limit=10)

    assert row(conn, "UC_a")["videos_fetched_at"] is None
    assert store.get_video_backfill_candidates(conn, 10) == {"@a": "UC_a"}


# --- a channel that never reads (review R5): counted, backed off, then given up ---


def test_each_failed_read_backs_off_longer_and_the_third_gives_up(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "a")
    now = time.time()
    for failures, days in enumerate(store.READ_BACKOFF_DAYS, 1):
        store.defer_unreadable_channel(conn, "UC_a", now=now)
        channel = row(conn, "UC_a")
        assert channel["read_failures"] == failures
        assert channel["unreadable_until"] == iso(now + days * 86400)
        just_after = now + days * 86400 + 60
        expected = {} if failures >= store.READ_GIVE_UP else {"@a": "UC_a"}
        assert store.get_video_backfill_candidates(conn, 10, now=just_after) == expected
    assert store.READ_BACKOFF_DAYS == (1, 3, 7)
    assert store.READ_GIVE_UP == 3
    a_year_on = now + 365 * 86400
    assert store.get_video_backfill_candidates(conn, 10, now=a_year_on) == {}
    assert store.count_channels_needing_videos(conn, now=a_year_on) == 0
    assert row(conn, "UC_a")["videos_fetched_at"] is None  # given up, not "read, zero uploads"


def test_an_always_failing_channel_is_asked_three_times_then_never_again(
    conn: sqlite3.Connection,
) -> None:
    add_channels(conn, "a")
    source = FakeSource()
    asked: list[str] = []

    def always_fails(handle: str) -> None:
        asked.append(handle)
        raise ChannelUnreadableError(handle)

    source.on_read = always_fails
    search = make_search(conn, source)
    for _ in range(6):
        backfill.backfill_missing_videos(search, limit=10)
        conn.execute("UPDATE channels SET unreadable_until='2020-01-01T00:00:00Z'")  # time passes
        conn.commit()

    assert asked == ["@a"] * 3
    assert row(conn, "UC_a")["read_failures"] == 3


def test_a_read_that_works_clears_the_failures(conn: sqlite3.Connection) -> None:
    add_channels(conn, "a")
    store.defer_unreadable_channel(conn, "UC_a")
    store.defer_unreadable_channel(conn, "UC_a")

    store.mark_channels_videos_fetched(conn, ["UC_a"])

    channel = row(conn, "UC_a")
    assert (channel["read_failures"], channel["unreadable_until"]) == (0, None)


def test_a_manual_refetch_gives_a_given_up_channel_another_try(conn: sqlite3.Connection) -> None:
    add_channels(conn, "a")
    for _ in range(store.READ_GIVE_UP):
        store.defer_unreadable_channel(conn, "UC_a")
    later = time.time() + 30 * 86400
    assert store.get_video_backfill_candidates(conn, 10, now=later) == {}

    assert store.force_refetch_by_handle(conn, "@a") == "UC_a"

    channel = row(conn, "UC_a")
    assert (channel["read_failures"], channel["unreadable_until"]) == (0, None)
    assert store.get_video_backfill_candidates(conn, 10) == {"@a": "UC_a"}


def test_bring_back_gives_a_given_up_channel_another_try(conn: sqlite3.Connection) -> None:
    add_channels(conn, "ab")
    for _ in range(store.READ_GIVE_UP):
        store.defer_unreadable_channel(conn, "UC_a")
        store.defer_unreadable_channel(conn, "UC_b")
    store.archive_channel_locally(conn, "UC_a", "@a", "inactive")
    store.restore_channel_locally(conn, "UC_a")
    # UC_b: a tombstone beside its own given-up row (as an import can leave it).
    conn.execute(
        "INSERT INTO channel_archive (channel_id, handle, label) VALUES ('UC_b', '@b', 'inactive')"
    )
    conn.commit()
    store.restore_channel_locally(conn, "UC_b")

    for channel_id in ("UC_a", "UC_b"):
        channel = row(conn, channel_id)
        assert (channel["read_failures"], channel["unreadable_until"]) == (0, None), channel_id
    assert store.get_video_backfill_candidates(conn, 10) == {"@a": "UC_a", "@b": "UC_b"}
