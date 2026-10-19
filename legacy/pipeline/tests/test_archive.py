"""Tests for the pipeline's half of channel archiving.

Run with:  python tests/test_archive.py    (from pipeline/)

Plain unittest, no network, against a real temporary SQLite database rather
than a stub -- the behaviour under test is almost entirely SQL, so a fake store
would test the fake.

What matters here is the tombstone. When a channel is archived (see
backend/schema.sql), the row and every video on it are deleted centrally.
If the pipeline did not know that, the very next search for the same keyword
would find the channel again, add it back as brand new, spend API quota
fetching its videos, and hand it to somebody to vet a second time -- undoing
both the storage saving and the decision that caused it.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import store  # noqa: E402


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def _archive(self, channel_id, handle="@x", label="irrelevant"):
        store.apply_remote_archive(self.conn, {
            "channel_id": channel_id,
            "handle": handle,
            "label": label,
            "archived_at": "2026-08-01T00:00:00Z",
        })
        self.conn.commit()

    def test_a_new_channel_is_recorded(self):
        self.assertTrue(
            store.record_channel_discovery(self.conn, "@a", "UC_a", "k1"))
        self.assertIsNotNone(store.get_channel_row(self.conn, "UC_a"))

    def test_pulling_an_archive_row_deletes_the_local_channel(self):
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        self._archive("UC_a", "@a")
        self.assertIsNone(store.get_channel_row(self.conn, "UC_a"))
        self.assertTrue(store.is_archived(self.conn, "UC_a"))

    def test_pulling_an_archive_row_deletes_the_local_videos(self):
        # The videos are the storage the whole feature exists to reclaim, so a
        # local copy surviving the sweep would defeat the point of it.
        store.record_channel_discovery(self.conn, "@b", "UC_b", "k1")
        self.conn.execute(
            "INSERT INTO videos (video_id, channel_id) VALUES ('v1','UC_b')")
        self.conn.commit()
        self._archive("UC_b", "@b", "haramStuff")
        left = self.conn.execute(
            "SELECT count(*) c FROM videos WHERE channel_id='UC_b'"
        ).fetchone()["c"]
        self.assertEqual(left, 0)

    def test_a_rediscovered_archived_channel_is_skipped(self):
        self._archive("UC_a", "@a")
        self.assertFalse(
            store.record_channel_discovery(self.conn, "@a", "UC_a", "k2"))
        self.assertIsNone(store.get_channel_row(self.conn, "UC_a"))

    def test_a_skipped_channel_records_no_keyword_link_either(self):
        # Recording the link but not the channel would leave a foreign key
        # pointing at nothing, and would make the keyword look like it found
        # something it did not.
        self._archive("UC_a", "@a")
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k2")
        count = self.conn.execute(
            "SELECT count(*) c FROM channel_keywords WHERE channel_id='UC_a'"
        ).fetchone()["c"]
        self.assertEqual(count, 0)

    def test_archiving_locally_tombstones_and_clears_the_channel(self):
        # The auto-clean gate's write path: same shape as apply_remote_archive,
        # plus it records the subscriber count on the tombstone itself (there is
        # no channels row left to read it from once this returns).
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        self.conn.execute(
            "INSERT INTO videos (video_id, channel_id) VALUES ('v1','UC_a')")
        self.conn.commit()

        store.archive_channel_locally(
            self.conn, "UC_a", "@a", "irrelevant", subscribers=1234)

        self.assertTrue(store.is_archived(self.conn, "UC_a"))
        self.assertIsNone(store.get_channel_row(self.conn, "UC_a"))
        left = self.conn.execute(
            "SELECT count(*) c FROM videos WHERE channel_id='UC_a'"
        ).fetchone()["c"]
        self.assertEqual(left, 0)
        row = self.conn.execute(
            "SELECT subscribers, found_at FROM channel_archive "
            "WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(row["subscribers"], "1234")
        self.assertIsNotNone(row["found_at"])

    def test_unarchiving_lets_it_be_discovered_again(self):
        # The deliberate human override: a manual refetch, or re-adding the
        # channel by hand in the app. A search never does this on its own.
        self._archive("UC_a", "@a")
        store.unarchive(self.conn, "UC_a")
        self.assertTrue(
            store.record_channel_discovery(self.conn, "@a", "UC_a", "k3"))
        self.assertIsNotNone(store.get_channel_row(self.conn, "UC_a"))

    def test_an_unarchived_channel_is_not_skipped_by_a_stale_tombstone(self):
        self._archive("UC_a", "@a")
        store.unarchive(self.conn, "UC_a")
        self.assertFalse(store.is_archived(self.conn, "UC_a"))

    # ---- keyword notes on a tombstone -------------------------------------
    # A search that re-finds an archived channel still skips it, but the
    # keyword that surfaced it is worth keeping so the Keyword Evaluation card
    # scores that term on the archive too. It cannot go in `channel_keywords`
    # (no channels row, and that column is a foreign key to it), so it is
    # appended to the tombstone's `found_via` and queued for Supabase.

    def test_a_rediscovered_archived_channel_gets_the_keyword_on_its_tombstone(self):
        self._archive("UC_a", "@a")
        added = store.record_archive_keyword_links(
            self.conn, {"@a": "UC_a"}, "gambling tips", handles_limit=25)
        self.assertEqual(added, 1)
        entries = json.loads(self.conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id='UC_a'"
        ).fetchone()["found_via"])
        self.assertEqual([e["keyword"] for e in entries], ["gambling tips"])
        self.assertEqual(entries[0]["limit"], 25)

    def test_a_keyword_note_is_queued_for_supabase(self):
        self._archive("UC_a", "@a")
        store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1", 10)
        pending = store.get_archive_keyword_pending(self.conn)
        self.assertEqual(
            [(p["channel_id"], p["keyword"], p["handles_limit"]) for p in pending],
            [("UC_a", "k1", 10)])
        store.clear_archive_keyword_pending(self.conn, "UC_a", "k1")
        self.assertEqual(store.get_archive_keyword_pending(self.conn), [])

    def test_the_same_keyword_twice_on_a_tombstone_is_a_no_op(self):
        self._archive("UC_a", "@a")
        store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        added = store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        self.assertEqual(added, 0)
        entries = json.loads(self.conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id='UC_a'"
        ).fetchone()["found_via"])
        self.assertEqual(len(entries), 1)

    def test_a_second_keyword_accumulates_on_the_tombstone(self):
        self._archive("UC_a", "@a")
        store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k2")
        entries = json.loads(self.conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id='UC_a'"
        ).fetchone()["found_via"])
        self.assertEqual([e["keyword"] for e in entries], ["k1", "k2"])

    def test_a_keyword_note_does_not_move_archived_at(self):
        self._archive("UC_a", "@a")
        store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        self.assertEqual(
            self.conn.execute(
                "SELECT archived_at FROM channel_archive WHERE channel_id='UC_a'"
            ).fetchone()["archived_at"],
            "2026-08-01T00:00:00Z")

    def test_a_keyword_note_for_a_channel_that_is_not_archived_is_ignored(self):
        added = store.record_archive_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        self.assertEqual(added, 0)
        self.assertEqual(store.get_archive_keyword_pending(self.conn), [])

    # ---- what goes back up on a push -------------------------------------
    # Only tombstones this machine wrote (the auto-clean gate) are pushed.
    # A row that arrived by pull must never be re-sent: _archive_out would
    # rebuild it from local columns a mirrored row does not fully carry and
    # blank the real subscriber count on Supabase.

    def test_a_pulled_archive_row_is_not_pushed_back_even_if_newer(self):
        store.apply_remote_archive(self.conn, {
            "channel_id": "UC_a", "handle": "@a", "label": "irrelevant",
            "archived_at": "2026-08-01T00:00:00Z",
            "subscribers": 4321, "found_at": "2026-01-01T00:00:00Z",
        })
        self.conn.commit()
        self.assertEqual(store.get_unannounced_archives(self.conn), [])

    def test_a_pulled_archive_row_keeps_subscribers_and_found_at(self):
        store.apply_remote_archive(self.conn, {
            "channel_id": "UC_a", "handle": "@a", "label": "irrelevant",
            "archived_at": "2026-08-01T00:00:00Z",
            "subscribers": 4321, "found_at": "2026-01-01T00:00:00Z",
        })
        self.conn.commit()
        row = self.conn.execute(
            "SELECT subscribers, found_at, source FROM channel_archive "
            "WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(row["subscribers"], "4321")
        self.assertEqual(row["found_at"], "2026-01-01T00:00:00Z")
        self.assertEqual(row["source"], "remote")

    def test_a_locally_archived_row_is_pushed(self):
        store.archive_channel_locally(
            self.conn, "UC_a", "@a", "irrelevant", subscribers=1234)
        changed = store.get_unannounced_archives(self.conn)
        self.assertEqual([r["channel_id"] for r in changed], ["UC_a"])
        store.mark_archives_announced(self.conn, ["UC_a"])
        self.assertEqual(store.get_unannounced_archives(self.conn), [])


class PartitionDiscoveredTest(unittest.TestCase):
    """The handle-level gate: what a keyword run will and will not pay for.

    Everything past discovery costs quota or a scrape, so the interesting
    property of these tests is not what ends up in the database -- it is which
    handles reach the fetching code at all.
    """

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def test_an_unseen_channel_is_fresh(self):
        fresh, known, archived = store.partition_discovered(
            self.conn, {"@a": "UC_a"})
        self.assertEqual(fresh, {"@a": "UC_a"})
        self.assertEqual(known, {})
        self.assertEqual(archived, {})

    def test_a_channel_already_in_the_database_is_not_fetched_again(self):
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        fresh, known, archived = store.partition_discovered(
            self.conn, {"@a": "UC_a"})
        self.assertEqual(fresh, {})
        self.assertEqual(known, {"@a": "UC_a"})

    def test_an_archived_channel_is_not_fetched_again(self):
        store.apply_remote_archive(self.conn, {
            "channel_id": "UC_a", "handle": "@a", "label": "irrelevant",
            "archived_at": "2026-08-01T00:00:00Z",
        })
        fresh, known, archived = store.partition_discovered(
            self.conn, {"@a": "UC_a"})
        self.assertEqual(fresh, {})
        self.assertEqual(archived, {"@a": "UC_a"})

    def test_a_forced_refetch_overrides_the_known_skip(self):
        # The deliberate human override. Without this, --refetch and the app's
        # refresh action would both be silently ignored by the next search run.
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        store.force_refetch_by_handle(self.conn, "@a")
        fresh, known, _ = store.partition_discovered(self.conn, {"@a": "UC_a"})
        self.assertEqual(fresh, {"@a": "UC_a"})
        self.assertEqual(known, {})

    def test_the_archive_wins_over_a_local_row_that_has_not_caught_up(self):
        # apply_remote_archive deletes the channel row, so this only happens if
        # a tombstone arrives some other way -- and the newer decision is the
        # rejection, not the row that predates it.
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        self.conn.execute(
            "INSERT INTO channel_archive (channel_id, handle, label, archived_at) "
            "VALUES ('UC_a', '@a', 'irrelevant', '2026-08-01T00:00:00Z')")
        self.conn.commit()
        fresh, known, archived = store.partition_discovered(
            self.conn, {"@a": "UC_a"})
        self.assertEqual(fresh, {})
        self.assertEqual(known, {})
        self.assertEqual(archived, {"@a": "UC_a"})

    def test_a_mixed_batch_is_split_three_ways(self):
        store.record_channel_discovery(self.conn, "@known", "UC_known", "k1")
        store.apply_remote_archive(self.conn, {
            "channel_id": "UC_arch", "handle": "@arch", "label": "haramStuff",
            "archived_at": "2026-08-01T00:00:00Z",
        })
        fresh, known, archived = store.partition_discovered(self.conn, {
            "@new": "UC_new", "@known": "UC_known", "@arch": "UC_arch",
        })
        self.assertEqual(fresh, {"@new": "UC_new"})
        self.assertEqual(known, {"@known": "UC_known"})
        self.assertEqual(archived, {"@arch": "UC_arch"})

    def test_an_empty_discovery_asks_the_database_nothing(self):
        self.assertEqual(store.partition_discovered(self.conn, {}), ({}, {}, {}))

    def test_a_known_channel_still_records_the_new_keyword_link(self):
        # Skipping the FETCH must not lose the attribution: a channel that
        # surfaces under a second keyword really was found by that keyword.
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        _, known, _ = store.partition_discovered(self.conn, {"@a": "UC_a"})
        store.record_keyword_links(self.conn, known, "k2")
        rows = self.conn.execute(
            "SELECT keyword FROM channel_keywords WHERE channel_id='UC_a' "
            "ORDER BY keyword").fetchall()
        self.assertEqual([r["keyword"] for r in rows], ["k1", "k2"])

    def test_recording_a_link_twice_is_a_no_op(self):
        store.record_channel_discovery(self.conn, "@a", "UC_a", "k1")
        store.record_keyword_links(self.conn, {"@a": "UC_a"}, "k1")
        count = self.conn.execute(
            "SELECT count(*) c FROM channel_keywords WHERE channel_id='UC_a'"
        ).fetchone()["c"]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
