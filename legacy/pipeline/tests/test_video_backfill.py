"""Tests for the video-backfill backlog query (see `gratovo.pipeline.backfill_missing_videos`).

Run with:  python tests/test_video_backfill.py    (from pipeline/)

Plain unittest against a real temporary SQLite database, for the same reason
test_archive.py is: the behaviour under test is the SQL predicate itself.

WHAT IS ACTUALLY BEING PINNED
-----------------------------
`get_channels_needing_videos` (tested in test_archive.py via
`PartitionDiscoveredTest`) only ever looks at the current run's own
`discovered` set. A channel that missed its turn -- the run that found it
crashed, hit `SearchBlocked`, or ran out of time before reaching it -- becomes
`known` on every later run and is never reconsidered by that function again.
`get_video_backfill_candidates` is the other half: it has to find that exact
channel by scanning the whole store, independent of any keyword's results,
which is what these tests check for -- including that it excludes anything
that does NOT belong in the backlog, so a fix here cannot turn into a
re-fetch-everything sweep.
"""

import sys
import tempfile
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import store  # noqa: E402


class VideoBackfillTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def _channel(self, channel_id, handle, first_seen_at="2026-01-01T00:00:00Z",
                 videos_fetched_at=None, force_refetch=0, country=None):
        self.conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at, "
            "videos_fetched_at, force_refetch, country) VALUES (?, ?, ?, ?, ?, ?)",
            (channel_id, handle, first_seen_at, videos_fetched_at, force_refetch, country),
        )
        self.conn.commit()

    # ---- who belongs in the backlog ----

    def test_a_channel_whose_videos_were_never_fetched_is_in_the_backlog(self):
        self._channel("UC_a", "@a", videos_fetched_at=None)
        candidates = store.get_video_backfill_candidates(self.conn, limit=10)
        self.assertEqual(candidates, {"@a": "UC_a"})

    def test_a_channel_with_videos_already_fetched_is_not_in_the_backlog(self):
        self._channel("UC_a", "@a", videos_fetched_at="2026-01-02T00:00:00Z")
        candidates = store.get_video_backfill_candidates(self.conn, limit=10)
        self.assertEqual(candidates, {})

    def test_a_forced_refetch_is_in_the_backlog_even_with_videos_already_fetched(self):
        # force_refetch=1 with a stamp already set is exactly what
        # `force_refetch_by_handle` -- no, `run_manual_refetch` -- leaves behind
        # for a channel nobody has revisited since it was flagged.
        self._channel("UC_a", "@a", videos_fetched_at="2026-01-02T00:00:00Z",
                       force_refetch=1)
        candidates = store.get_video_backfill_candidates(self.conn, limit=10)
        self.assertEqual(candidates, {"@a": "UC_a"})

    def test_marking_videos_fetched_clears_a_forced_refetch_from_the_backlog(self):
        # The bug: `mark_channels_videos_fetched` used to stamp
        # `videos_fetched_at` but leave `force_refetch=1`, so the channel came
        # straight back as a candidate on the next pass -- the catch-up sweep
        # re-fetched the same channels every app launch and never finished.
        self._channel("UC_a", "@a", videos_fetched_at=None, force_refetch=1)
        self.assertEqual(
            store.get_video_backfill_candidates(self.conn, limit=10),
            {"@a": "UC_a"},
        )

        store.mark_channels_videos_fetched(self.conn, ["UC_a"])

        self.assertEqual(store.get_video_backfill_candidates(self.conn, limit=10), {})
        self.assertEqual(store.count_channels_needing_videos(self.conn), 0)
        row = self.conn.execute(
            "SELECT force_refetch, videos_fetched_at FROM channels WHERE channel_id='UC_a'"
        ).fetchone()
        self.assertEqual(row["force_refetch"], 0)
        self.assertIsNotNone(row["videos_fetched_at"])

    def test_an_empty_store_asks_for_nothing(self):
        self.assertEqual(store.get_video_backfill_candidates(self.conn, limit=10), {})
        self.assertEqual(store.count_channels_needing_videos(self.conn), 0)

    # ---- ordering and the limit ----

    def test_the_oldest_discovered_channel_comes_first(self):
        # Newest inserted first, oldest first_seen_at last -- so a naive
        # "insertion order" implementation would get this backwards.
        self._channel("UC_new", "@new", first_seen_at="2026-03-01T00:00:00Z")
        self._channel("UC_old", "@old", first_seen_at="2026-01-01T00:00:00Z")
        self._channel("UC_mid", "@mid", first_seen_at="2026-02-01T00:00:00Z")

        ordered = list(store.get_video_backfill_candidates(self.conn, limit=10).items())
        self.assertEqual([h for h, _ in ordered], ["@old", "@mid", "@new"])

    def test_the_limit_takes_only_the_oldest_slice(self):
        for i in range(5):
            self._channel(f"UC_{i}", f"@{i}", first_seen_at=f"2026-01-0{i + 1}T00:00:00Z")

        candidates = store.get_video_backfill_candidates(self.conn, limit=2)
        self.assertEqual(set(candidates), {"@0", "@1"})

    # ---- the country scope ----

    def test_a_country_filter_narrows_the_backlog_to_that_country(self):
        self._channel("UC_us", "@us", country="US")
        self._channel("UC_eg", "@eg", country="EG")
        self._channel("UC_none", "@none", country=None)

        candidates = store.get_video_backfill_candidates(
            self.conn, limit=10, country_filter="US")
        self.assertEqual(candidates, {"@us": "UC_us"})

    def test_no_country_filter_sees_every_country(self):
        self._channel("UC_us", "@us", country="US")
        self._channel("UC_eg", "@eg", country="EG")

        candidates = store.get_video_backfill_candidates(self.conn, limit=10)
        self.assertEqual(set(candidates), {"@us", "@eg"})

    # ---- the count matches the candidates query ----

    def test_the_backlog_count_matches_what_the_candidates_query_would_return(self):
        self._channel("UC_a", "@a", videos_fetched_at=None)
        self._channel("UC_b", "@b", videos_fetched_at="2026-01-02T00:00:00Z")
        self._channel("UC_c", "@c", videos_fetched_at="2026-01-02T00:00:00Z", force_refetch=1)

        self.assertEqual(store.count_channels_needing_videos(self.conn), 2)
        self.assertEqual(
            len(store.get_video_backfill_candidates(self.conn, limit=100)), 2)

    def test_the_backlog_count_respects_the_same_country_filter(self):
        self._channel("UC_us", "@us", country="US")
        self._channel("UC_eg", "@eg", country="EG")

        self.assertEqual(
            store.count_channels_needing_videos(self.conn, country_filter="US"), 1)


class IncrementalStampingTest(unittest.TestCase):
    """`backfill_missing_videos` stamps `videos_fetched_at` per channel as it
    finishes, not once at the end.

    Why it matters: when `search.py --catch-up-videos` is the caller, the app
    terminates the process outright on Windows to hand the database to a
    search, so the function's `finally` is not guaranteed to run. If stamping
    only happened there, every kill would discard the whole in-flight batch and
    the next pass would re-read the same oldest-first channels -- on a machine
    someone searches from all day, the sweep could never persist anything.
    These tests pin that a channel is durable the moment its turn is over,
    before the loop moves on to the next one.
    """

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

        from gratovo import pipeline
        self.pipeline = pipeline
        # Bind just enough of the module for `backfill_missing_videos` to run
        # without a real API key or network: a CFG whose `.delay()` yields no
        # pacing sleep, a stub scrapetube session, and stubbed fetch calls.
        self._saved = {k: getattr(pipeline, k, None)
                       for k in ("CFG", "scrapetube", "get_recent_video_ids",
                                 "get_videos_data", "youtube_client_for_thread")}

        def _restore():
            for k, v in self._saved.items():
                setattr(pipeline, k, v)
        self.addCleanup(_restore)

        pipeline.CFG = types.SimpleNamespace(delay=lambda _key: None)
        pipeline.scrapetube = types.SimpleNamespace(
            get_session=lambda: types.SimpleNamespace(close=lambda: None))
        # The catch-up path fetches metadata on a pool; each worker asks for a
        # client. No network in the test -- the stubbed `get_videos_data`
        # ignores it.
        pipeline.youtube_client_for_thread = lambda: None
        pipeline.get_videos_data = lambda ids, youtube=None: {}

        self.run_id = store.start_run(self.conn, 0, kind="catch-up")

    def _channel(self, channel_id, handle, first_seen_at):
        self.conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at) "
            "VALUES (?, ?, ?)",
            (channel_id, handle, first_seen_at),
        )
        self.conn.commit()

    def _stamped_count(self):
        return self.conn.execute(
            "SELECT COUNT(*) FROM channels WHERE videos_fetched_at IS NOT NULL"
        ).fetchone()[0]

    def test_each_channel_is_persisted_before_the_next_one_is_read(self):
        for i, name in enumerate("abcde"):
            self._channel(f"UC_{name}", f"@{name}", f"2026-01-0{i + 1}T00:00:00Z")

        stamped_when_scanned = {}

        def fake_recent(handle, session=None):
            stamped_when_scanned[handle] = self._stamped_count()
            return []  # no readable uploads -> finished the instant it is scanned

        self.pipeline.get_recent_video_ids = fake_recent

        self.pipeline.backfill_missing_videos(
            self.conn, self.run_id, limit=10, emit_io=True)

        # Oldest-first, and each channel already stamped by the time the next
        # one's upload list is read.
        self.assertEqual(
            stamped_when_scanned,
            {"@a": 0, "@b": 1, "@c": 2, "@d": 3, "@e": 4},
        )
        self.assertEqual(self._stamped_count(), 5)
        self.assertEqual(store.count_channels_needing_videos(self.conn), 0)

    def test_a_crash_partway_keeps_every_channel_already_finished(self):
        for i, name in enumerate("abcde"):
            self._channel(f"UC_{name}", f"@{name}", f"2026-01-0{i + 1}T00:00:00Z")

        def fake_recent(handle, session=None):
            if handle == "@c":
                # A stand-in for the process being killed here: the first two
                # channels must already be on disk.
                self.assertEqual(self._stamped_count(), 2)
                raise KeyboardInterrupt
            return []

        self.pipeline.get_recent_video_ids = fake_recent

        with self.assertRaises(KeyboardInterrupt):
            self.pipeline.backfill_missing_videos(
                self.conn, self.run_id, limit=10, emit_io=True)

        # @a and @b are done; @c, @d, @e are untouched and still in the backlog
        # for the next pass -- not skipped as if they had been handled.
        self.assertEqual(
            set(store.get_video_backfill_candidates(self.conn, limit=10)),
            {"@c", "@d", "@e"},
        )

    def test_channels_with_uploads_are_stamped_once_their_metadata_lands(self):
        # Exercises the fetch pool: every channel has uploads, so each one goes
        # through submit -> reap -> write before it can be stamped.
        for i, name in enumerate("abcd"):
            self._channel(f"UC_{name}", f"@{name}", f"2026-01-0{i + 1}T00:00:00Z")

        self.pipeline.get_recent_video_ids = \
            lambda handle, session=None: [f"{handle}_v1", f"{handle}_v2"]
        self.pipeline.get_videos_data = lambda ids, youtube=None: {
            vid: {"Title": vid, "Tags": []} for vid in ids
        }

        self.pipeline.backfill_missing_videos(
            self.conn, self.run_id, limit=10, emit_io=True)

        self.assertEqual(self._stamped_count(), 4)
        self.assertEqual(store.count_channels_needing_videos(self.conn), 0)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0], 8)


class VideoBacklogSyncTest(unittest.TestCase):
    """The catch-up stamp has to reach the bucket and survive the next pull,
    or the backlog never clears across app restarts -- it "finishes, then
    starts over". `mark_channels_videos_fetched` moves only
    `videos_fetched_at` (and `force_refetch`), so both the upload candidates
    and the catalog-apply merge have to account for that column specifically.
    """

    # Older than any cursor the tests use, so a row only comes back through the
    # column under test, never through `first_seen_at`.
    OLD = "2020-01-01T00:00:00Z"

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def _channel(self, channel_id, handle, videos_fetched_at=None):
        self.conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at, "
            "videos_fetched_at) VALUES (?, ?, ?, ?)",
            (channel_id, handle, self.OLD, videos_fetched_at),
        )
        self.conn.commit()

    def test_stamping_videos_fetched_makes_the_channel_due_for_upload(self):
        self._channel("UC_a", "@a")
        self.assertEqual(store.get_blob_upload_candidates(self.conn), [])

        store.mark_channels_videos_fetched(self.conn, ["UC_a"])

        changed = store.get_blob_upload_candidates(self.conn)
        self.assertEqual([r["channel_id"] for r in changed], ["UC_a"])

    def test_a_pull_does_not_wipe_a_local_videos_fetched_stamp(self):
        self._channel("UC_a", "@a", videos_fetched_at="2026-09-01T00:00:00Z")

        # The `found` op a teammate whose machine never ran the sweep writes.
        store.apply_catalog_channel(self.conn, {
            "channel_id": "UC_a", "handle": "@a", "first_seen_at": self.OLD,
            "videos_fetched_at": None, "blob_version": None,
        }, store._now())
        self.conn.commit()

        row = self.conn.execute(
            "SELECT videos_fetched_at FROM channels WHERE channel_id='UC_a'"
        ).fetchone()
        self.assertEqual(row["videos_fetched_at"], "2026-09-01T00:00:00Z")
        self.assertEqual(store.get_video_backfill_candidates(self.conn, limit=10), {})

    def test_an_unarchive_reopens_a_stamped_channel(self):
        self._channel("UC_a", "@a", videos_fetched_at="2026-09-01T00:00:00Z")

        # The one remote op that asks for a fresh scrape: an un-archive, whose
        # object was deleted when the channel was archived.
        store.apply_catalog_unarchived(self.conn, "UC_a", "@a")
        self.conn.commit()

        self.assertEqual(
            set(store.get_video_backfill_candidates(self.conn, limit=10)), {"@a"})


if __name__ == "__main__":
    unittest.main()
