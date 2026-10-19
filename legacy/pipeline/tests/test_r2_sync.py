"""Tests for the R2 sync layer (`gratovo.sync`, `gratovo.store`'s R2 section).

Run with:  python -m pytest tests/test_r2_sync.py    (from pipeline/)

Plain unittest against real temporary SQLite databases and an in-memory fake
of the R2 client. What is pinned here is the contract between machines: what
one machine writes into the bucket, and what another machine ends up with in
its store after reading it -- including the things that must NOT happen
(an unfinished channel getting an object, a scrape being clobbered by an
older object, a found channel resurrecting an archived one).
"""

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import store, sync  # noqa: E402
from gratovo.r2 import R2Error  # noqa: E402


class FakeR2:
    """The `R2Client` surface, in a dict. `fail_keys` makes named keys raise,
    to test that one failure does not lose the rest."""

    def __init__(self):
        self.objects = {}
        self.fail_keys = set()
        self.puts = 0
        self.gets = 0
        self.heads = 0
        self.bucket = "fake"

    def _check(self, key):
        if key in self.fail_keys:
            raise R2Error(f"simulated failure on {key}")

    def head(self, key):
        self.heads += 1
        self._check(key)
        obj = self.objects.get(key)
        return None if obj is None else dict(obj[1])

    def put(self, key, data, metadata=None, content_type=None):
        self.puts += 1
        self._check(key)
        self.objects[key] = (bytes(data), dict(metadata or {}))

    def get(self, key):
        self.gets += 1
        self._check(key)
        obj = self.objects.get(key)
        return None if obj is None else (obj[0], dict(obj[1]))

    def delete(self, key):
        self.objects.pop(key, None)

    def delete_many(self, keys):
        keys = list(keys)
        for key in keys:
            self.delete(key)
        return len(keys)

    def list(self, prefix):
        return sorted(k for k in self.objects if k.startswith(prefix))


class Machine:
    """One machine's local store."""

    def __init__(self, case, name):
        self.name = name
        self.dir = tempfile.TemporaryDirectory()
        case.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / f"{name}.db"))
        case.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def scrape(self, channel_id, handle, keyword="kw", videos=(), finished=True,
               fetched_at="2026-03-01T10:00:00Z", subscribers="1000"):
        """A channel this machine found and read: the row, the keyword link,
        the videos, and (if [finished]) the video-pass stamp."""
        c = self.conn
        store.seed_keywords(c, [keyword])
        store.record_channel_discovery(c, handle, channel_id, keyword)
        c.execute(
            "UPDATE channels SET name=?, description=?, subscribers=?, profile_picture=?, "
            "  country='EG', last_fetched_at=?, last_fetch_status='success' WHERE channel_id=?",
            (f"Name {handle}", "a long description " * 20, subscribers,
             f"https://pic/{handle}", fetched_at, channel_id))
        for vid, published, views, ok in videos:
            if ok:
                c.execute(
                    "INSERT INTO videos (video_id, channel_id, title, description, tags, "
                    "  published_at, view_count, last_fetched_at, last_fetch_status) "
                    "VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 'success')",
                    (vid, channel_id, f"title {vid}", "d", published, views, fetched_at))
            else:
                c.execute(
                    "INSERT INTO videos (video_id, channel_id, last_fetched_at, "
                    "  last_fetch_status) VALUES (?, ?, ?, 'failed')",
                    (vid, channel_id, fetched_at))
        c.commit()
        if finished:
            c.execute("UPDATE channels SET videos_fetched_at=? WHERE channel_id=?",
                      (fetched_at, channel_id))
            store.compute_channel_rollups(c, [channel_id])
            c.commit()

    def row(self, channel_id):
        return store.get_channel_row(self.conn, channel_id)

    def videos(self, channel_id):
        return {r["video_id"]: dict(r) for r in self.conn.execute(
            "SELECT * FROM videos WHERE channel_id=?", (channel_id,)).fetchall()}


VIDEOS_A = (
    ("v1", "2026-02-25T00:00:00Z", "100", True),
    ("v2", "2026-02-20T00:00:00Z", "300", True),
    ("v3", "2026-02-10T00:00:00Z", None, True),     # no view count: excluded from the median
    ("v4", "2025-12-01T00:00:00Z", "9999", True),   # outside the 30-day window
    ("v5", None, None, False),                      # a failed fetch
)


class RollupTest(unittest.TestCase):
    def setUp(self):
        self.m = Machine(self, "a")

    def test_rollups_match_the_old_postgres_definition(self):
        self.m.scrape("UC_a", "@a", videos=VIDEOS_A)
        row = self.m.row("UC_a")
        # v1, v2, v3 are inside the window measured back from videos_fetched_at;
        # v4 is older; v5 has no date.
        self.assertEqual(row["videos_last_30"], 3)
        # Median of the counted views (100, 300); v3's null is excluded.
        self.assertEqual(row["median_views_last_30"], 200)
        self.assertEqual(row["latest_upload_at"], "2026-02-25T00:00:00Z")

    def test_a_channel_with_no_dated_videos_reads_zero_and_null(self):
        self.m.scrape("UC_b", "@b", videos=(("v9", None, None, False),))
        row = self.m.row("UC_b")
        self.assertEqual(row["videos_last_30"], 0)
        self.assertIsNone(row["median_views_last_30"])
        self.assertIsNone(row["latest_upload_at"])


class BlobTest(unittest.TestCase):
    def setUp(self):
        self.r2 = FakeR2()
        self.a = Machine(self, "a")

    def test_only_finished_channels_get_an_object(self):
        self.a.scrape("UC_done", "@done", videos=VIDEOS_A, finished=True)
        self.a.scrape("UC_pending", "@pending", videos=(), finished=False)
        uploaded, skipped = sync.push_blobs(self.a.conn, self.r2)
        self.assertEqual((uploaded, skipped), (1, 0))
        self.assertIn(sync.channel_key("UC_done"), self.r2.objects)
        self.assertNotIn(sync.channel_key("UC_pending"), self.r2.objects)

    def test_the_object_holds_scraped_facts_and_nothing_derived(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        sync.push_blobs(self.a.conn, self.r2)
        data, meta = self.r2.objects[sync.channel_key("UC_a")]
        blob = sync.decode_blob(data)
        self.assertEqual(meta["fetched-at"], "2026-03-01T10:00:00Z")
        self.assertEqual(blob["channel"]["name"], "Name @a")
        self.assertIn("description", blob["channel"])
        for derived in ("videos_last_30", "median_views_last_30", "latest_upload_at",
                        "blob_uploaded_at", "announced_at"):
            self.assertNotIn(derived, blob["channel"])
        self.assertEqual({v["video_id"] for v in blob["videos"]}, {"v1", "v2", "v3", "v4"})
        self.assertEqual(blob["failed_video_ids"], ["v5"])

    def test_uploads_run_in_a_pool_and_one_failure_stamps_only_the_rest(self):
        for i in range(20):
            self.a.scrape(f"UC_{i:02d}", f"@h{i:02d}", videos=(
                (f"v{i:02d}", "2026-02-25T00:00:00Z", "100", True),))
        self.r2.fail_keys.add(sync.channel_key("UC_07"))
        uploaded, skipped = sync.push_blobs(self.a.conn, self.r2, log=lambda *_: None)
        self.assertEqual((uploaded, skipped), (19, 0))
        self.assertIsNone(self.a.row("UC_07")["blob_uploaded_at"])
        self.assertIsNotNone(self.a.row("UC_08")["blob_uploaded_at"])
        self.r2.fail_keys.clear()
        self.assertEqual(sync.push_blobs(self.a.conn, self.r2), (1, 0))

    def test_a_push_reports_its_position_as_it_goes(self):
        # The app's catch-up panel reads these (`video_catchup_controller.dart`):
        # a push of thousands between two backlog batches must say so, not
        # sit silent looking like a sweep frozen on its last channel.
        for i in range(60):
            self.a.scrape(f"UC_{i:02d}", f"@h{i:02d}", videos=(
                (f"v{i:02d}", "2026-02-25T00:00:00Z", "100", True),))
        lines = []
        sync.push_blobs(self.a.conn, self.r2, log=lines.append)
        progress = [l for l in lines if l.startswith("[sync-io] ")]
        self.assertEqual(progress, [
            "[sync-io] shared=0 of=60",
            "[sync-io] shared=25 of=60",
            "[sync-io] shared=50 of=60",
            "[sync-io] shared=60 of=60",
        ])

    def test_a_push_of_a_few_says_where_it_started_and_that_it_finished(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        lines = []
        sync.push_blobs(self.a.conn, self.r2, log=lines.append)
        self.assertEqual(lines, ["[sync-io] shared=0 of=1", "[sync-io] shared=1 of=1"])

    def test_nothing_to_push_prints_nothing(self):
        lines = []
        sync.push_blobs(self.a.conn, self.r2, log=lines.append)
        self.assertEqual(lines, [])

    def test_a_second_share_uploads_nothing(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        sync.push_blobs(self.a.conn, self.r2)
        self.assertEqual(sync.push_blobs(self.a.conn, self.r2), (0, 0))
        self.assertEqual(self.r2.puts, 1)

    def test_a_newer_object_in_the_bucket_is_not_overwritten(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A, fetched_at="2026-03-01T10:00:00Z")
        self.r2.objects[sync.channel_key("UC_a")] = (
            b"newer", {"fetched-at": "2026-03-05T00:00:00Z"})
        uploaded, skipped = sync.push_blobs(self.a.conn, self.r2)
        self.assertEqual((uploaded, skipped), (0, 1))
        self.assertEqual(self.r2.objects[sync.channel_key("UC_a")][0], b"newer")

    def test_a_refetch_moves_the_stamp_and_re_uploads(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        sync.push_blobs(self.a.conn, self.r2)
        store.mark_channels_videos_fetched(self.a.conn, ["UC_a"])   # stamps now()
        uploaded, _ = sync.push_blobs(self.a.conn, self.r2)
        self.assertEqual(uploaded, 1)
        self.assertEqual(self.r2.puts, 2)

    def test_an_upload_failure_is_retried_next_time_and_does_not_block_the_rest(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.a.scrape("UC_b", "@b", videos=(("v9", "2026-02-25T00:00:00Z", "1", True),))
        self.r2.fail_keys.add(sync.channel_key("UC_a"))
        uploaded, _ = sync.push_blobs(self.a.conn, self.r2, log=lambda *_: None)
        self.assertEqual(uploaded, 1)
        self.r2.fail_keys.clear()
        uploaded, _ = sync.push_blobs(self.a.conn, self.r2)
        self.assertEqual(uploaded, 1)


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.r2 = FakeR2()
        self.a = Machine(self, "a")
        self.b = Machine(self, "b")

    def share(self, m):
        sync.push_blobs(m.conn, self.r2)
        return sync.write_segment(m.conn, self.r2, m.name)

    def pull(self, m):
        segs, counts = sync.pull_catalog(m.conn, self.r2)
        applied, missing, failed = sync.pull_blobs(m.conn, self.r2)
        return segs, counts, applied

    def test_nothing_to_say_writes_no_segment(self):
        self.assertEqual(sync.write_segment(self.a.conn, self.r2, "a"), 0)
        self.assertEqual(self.r2.objects, {})

    def test_segment_keys_are_per_worker_and_sortable(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        keys = self.r2.list(sync.CATALOG_PREFIX)
        self.assertEqual(len(keys), 1)
        self.assertTrue(keys[0].startswith("catalog/a/"))
        self.assertTrue(keys[0].endswith("-000.jsonl.zst"))

    def test_what_a_segment_carries(self):
        self.a.scrape("UC_a", "@a", keyword="cats", videos=VIDEOS_A)
        store.mark_keyword_done(self.a.conn, "cats", 1)
        self.share(self.a)
        key = self.r2.list(sync.CATALOG_PREFIX)[0]
        ops = sync.decode_segment(self.r2.objects[key][0])
        kinds = sorted(op["op"] for op in ops)
        self.assertEqual(kinds, ["found", "keyword", "link"])
        keyword = next(op for op in ops if op["op"] == "keyword")
        self.assertEqual((keyword["keyword"], keyword["status"]), ("cats", "done"))
        found = next(op for op in ops if op["op"] == "found")["channel"]
        self.assertEqual(found["channel_id"], "UC_a")
        self.assertEqual(found["blob_version"], "2026-03-01T10:00:00Z")
        self.assertNotIn("description", found)
        self.assertNotIn("videos_last_30", found)

    def test_the_second_machine_ends_up_with_the_channel_and_its_videos(self):
        self.a.scrape("UC_a", "@a", keyword="cats", videos=VIDEOS_A)
        self.share(self.a)
        segs, counts, applied = self.pull(self.b)
        self.assertEqual((segs, applied), (1, 1))
        row = self.b.row("UC_a")
        self.assertEqual(row["name"], "Name @a")
        self.assertTrue(row["description"].startswith("a long description"))
        self.assertEqual(row["videos_fetched_at"], "2026-03-01T10:00:00Z")
        self.assertEqual(row["blob_applied_version"], "2026-03-01T10:00:00Z")
        self.assertEqual(set(self.b.videos("UC_a")), {"v1", "v2", "v3", "v4", "v5"})
        self.assertEqual(self.b.videos("UC_a")["v5"]["last_fetch_status"], "failed")
        # Derived locally, from the videos that arrived -- not copied.
        self.assertEqual(row["videos_last_30"], 3)
        self.assertEqual(row["median_views_last_30"], 200)
        # The keyword link and the keyword came too.
        self.assertEqual(
            [r["keyword"] for r in self.b.conn.execute(
                "SELECT keyword FROM channel_keywords WHERE channel_id='UC_a'")], ["cats"])
        self.assertEqual(store.get_keyword(self.b.conn, "cats")["source"], "remote")

    def test_a_pulled_channel_gets_its_signals_derived_here(self):
        # Sponsorship and found emails are derived on every machine from what
        # arrived, like the rollups -- never left empty because the channel
        # was downloaded rather than fetched here (fix #11).
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.a.conn.execute(
            "UPDATE channels SET description='biz (at) a (dot) io' WHERE channel_id='UC_a'")
        self.a.conn.execute("UPDATE videos SET description='Sponsored by NordVPN' WHERE video_id='v1'")
        self.a.conn.commit()
        self.share(self.a)
        self.pull(self.b)
        row = self.b.conn.execute(
            "SELECT found_emails, sponsored_ratio, seen_brands FROM channels WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(json.loads(row["found_emails"]), ["biz@a.io"])
        self.assertEqual(row["sponsored_ratio"], 0.2)  # one of five stored videos
        self.assertEqual(json.loads(row["seen_brands"]), ["NordVPN"])

    def test_a_pulled_channel_is_not_in_the_video_backlog_and_not_re_announced(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        self.assertEqual(store.count_channels_needing_videos(self.b.conn), 0)
        # B has nothing of its own to say: no `found` for a channel it learned.
        self.assertEqual(sync.write_segment(self.b.conn, self.r2, "b"), 0)
        # And B does not re-upload A's object.
        self.assertEqual(sync.push_blobs(self.b.conn, self.r2), (0, 0))

    def test_pulling_twice_is_a_no_op(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        gets = self.r2.gets
        segs, _, applied = self.pull(self.b)
        self.assertEqual((segs, applied), (0, 0))
        self.assertEqual(self.r2.gets, gets)

    def test_the_writer_does_not_re_read_its_own_segment(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        segs, _, _ = self.pull(self.a)
        self.assertEqual(segs, 0)

    def test_an_own_scrape_is_not_clobbered_by_an_older_object(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A, fetched_at="2026-03-01T10:00:00Z")
        self.share(self.a)
        self.b.scrape("UC_a", "@a", videos=(("v7", "2026-03-09T00:00:00Z", "5", True),),
                      fetched_at="2026-03-10T10:00:00Z")
        self.pull(self.b)
        row = self.b.row("UC_a")
        self.assertEqual(row["videos_fetched_at"], "2026-03-10T10:00:00Z")
        self.assertEqual(set(self.b.videos("UC_a")), {"v7"})
        # But B's newer version now goes up, and A gets it.
        self.share(self.b)
        self.pull(self.a)
        self.assertEqual(self.a.row("UC_a")["videos_fetched_at"], "2026-03-10T10:00:00Z")
        self.assertEqual(set(self.a.videos("UC_a")), {"v7"})

    def test_a_refetch_is_announced_as_a_blob_op_and_picked_up(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        self.a.conn.execute("DELETE FROM videos WHERE channel_id='UC_a'")
        self.a.conn.execute(
            "INSERT INTO videos (video_id, channel_id, title, published_at, view_count, "
            "  last_fetched_at, last_fetch_status) "
            "VALUES ('v8', 'UC_a', 'new', '2026-03-20T00:00:00Z', '7', "
            "  '2026-03-21T00:00:00Z', 'success')")
        self.a.conn.commit()
        store.mark_channels_videos_fetched(self.a.conn, ["UC_a"])
        self.share(self.a)
        keys = self.r2.list(sync.CATALOG_PREFIX)
        self.assertEqual(len(keys), 2)
        ops = sync.decode_segment(self.r2.objects[keys[-1]][0])
        self.assertEqual([op["op"] for op in ops], ["blob"])
        self.pull(self.b)
        self.assertEqual(set(self.b.videos("UC_a")), {"v8"})

    def test_a_found_channel_cannot_resurrect_an_archived_one(self):
        self.b.conn.execute(
            "INSERT INTO channel_archive (channel_id, handle, label, archived_at, source) "
            "VALUES ('UC_a', '@a', 'irrelevant', '2026-02-01T00:00:00Z', 'remote')")
        self.b.conn.commit()
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        self.assertIsNone(self.b.row("UC_a"))

    def test_archiving_deletes_the_object_and_the_other_machine_follows(self):
        self.a.scrape("UC_a", "@a", keyword="cats", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        n = sync.archive_channels(self.a.conn, self.r2, "a",
                                  [{"channel_id": "UC_a", "label": "haramStuff"}])
        self.assertEqual(n, 1)
        self.assertNotIn(sync.channel_key("UC_a"), self.r2.objects)
        self.assertIsNone(self.a.row("UC_a"))
        self.pull(self.b)
        self.assertIsNone(self.b.row("UC_a"))
        self.assertEqual(self.b.videos("UC_a"), {})
        archived = self.b.conn.execute(
            "SELECT * FROM channel_archive WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(archived["label"], "haramStuff")
        self.assertEqual(json.loads(archived["found_via"])[0]["keyword"], "cats")

    def test_relabelling_keeps_the_tombstone_and_reannounces(self):
        # The app writes its own tombstone (with the facts only the channels
        # row could supply) before it asks the pipeline for the R2 side; a
        # relabel from the Archive page arrives the same way.
        self.a.scrape("UC_a", "@a", keyword="cats", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        self.a.conn.execute(
            "INSERT OR REPLACE INTO channel_archive (channel_id, handle, label, "
            "  archived_at, subscribers, found_at, found_via, source, announced) "
            "VALUES ('UC_a', '@a', 'irrelevant', '2026-03-02T00:00:00Z', '1000', "
            "  '2026-03-01T00:00:00Z', '[{\"keyword\": \"cats\"}]', 'local', 1)")
        for table in ("videos", "channel_keywords", "channels"):
            self.a.conn.execute(f"DELETE FROM {table} WHERE channel_id='UC_a'")
        self.a.conn.commit()
        sync.archive_channels(self.a.conn, self.r2, "a",
                              [{"channel_id": "UC_a", "label": "inactive"}])
        self.assertNotIn(sync.channel_key("UC_a"), self.r2.objects)
        self.pull(self.b)
        archived = self.b.conn.execute(
            "SELECT * FROM channel_archive WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(archived["label"], "inactive")
        self.assertEqual(archived["archived_at"], "2026-03-02T00:00:00Z")
        self.assertEqual(archived["subscribers"], "1000")
        self.assertEqual(json.loads(archived["found_via"])[0]["keyword"], "cats")
        # A second relabel goes through too.
        sync.archive_channels(self.a.conn, self.r2, "a",
                              [{"channel_id": "UC_a", "label": "haramStuff"}])
        self.pull(self.b)
        archived = self.b.conn.execute(
            "SELECT label FROM channel_archive WHERE channel_id='UC_a'").fetchone()
        self.assertEqual(archived["label"], "haramStuff")

    def test_unarchiving_brings_it_back_flagged_for_a_refetch_everywhere(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        sync.archive_channels(self.a.conn, self.r2, "a", [{"channel_id": "UC_a"}])
        self.pull(self.b)
        sync.unarchive_channels(self.b.conn, self.r2, "b", ["UC_a"])
        self.assertFalse(store.is_archived(self.b.conn, "UC_a"))
        self.assertEqual(self.b.row("UC_a")["force_refetch"], 1)
        self.pull(self.a)
        self.assertFalse(store.is_archived(self.a.conn, "UC_a"))
        self.assertEqual(self.a.row("UC_a")["force_refetch"], 1)
        # And it is back in the backlog on both.
        self.assertEqual(store.count_channels_needing_videos(self.a.conn), 1)

    def test_an_archive_link_reaches_the_other_tombstone(self):
        self.a.scrape("UC_a", "@a", keyword="cats", videos=VIDEOS_A)
        self.share(self.a)
        self.pull(self.b)
        sync.archive_channels(self.a.conn, self.r2, "a", [{"channel_id": "UC_a"}])
        self.pull(self.b)
        # A keyword on B re-finds the archived channel.
        store.record_archive_keyword_links(self.b.conn, {"@a": "UC_a"}, "dogs", 200)
        self.share(self.b)
        self.pull(self.a)
        via = json.loads(self.a.conn.execute(
            "SELECT found_via FROM channel_archive WHERE channel_id='UC_a'").fetchone()["found_via"])
        self.assertEqual([e["keyword"] for e in via], ["cats", "dogs"])

    def test_a_failed_segment_write_is_said_again_next_time(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        sync.push_blobs(self.a.conn, self.r2)
        real_put = self.r2.put

        def failing_put(key, *args, **kwargs):
            if key.startswith(sync.CATALOG_PREFIX):
                raise R2Error("down")
            return real_put(key, *args, **kwargs)
        self.r2.put = failing_put
        with self.assertRaises(R2Error):
            sync.write_segment(self.a.conn, self.r2, "a")
        self.r2.put = real_put
        self.assertEqual(sync.write_segment(self.a.conn, self.r2, "a"), 3)  # found + link + keyword

    def test_bootstrap_announces_everything_and_is_re_runnable(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        self.a.scrape("UC_b", "@b", videos=(), finished=False)
        result = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(result["uploaded"], 1)
        self.assertEqual(result["unfinished"], 1)
        self.assertEqual(result["ops"], 5)  # 2 found + 2 link + 1 keyword
        again = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(again["uploaded"], 0)
        self.assertEqual(again["ops"], 0)
        self.pull(self.b)
        self.assertIsNotNone(self.b.row("UC_a"))
        # The unfinished one is known but has no object: it sits in B's
        # backlog as a channel somebody still has to read.
        self.assertIsNotNone(self.b.row("UC_b"))
        self.assertEqual(store.count_channels_needing_videos(self.b.conn), 1)

    def test_bootstrap_announces_the_archive_the_old_database_left_as_remote(self):
        # Pre-migration state: the archive was pulled from Supabase, so the
        # rows say `remote`, and the export file names the same channels.
        store.apply_remote_archive(self.a.conn, {
            "channel_id": "UC_old", "handle": "@old", "label": "irrelevant",
            "archived_at": "2026-01-01T00:00:00Z", "subscribers": "10"})
        self.a.conn.execute("UPDATE channel_archive SET announced=0")
        self.a.conn.commit()
        migration = Path(self.a.dir.name) / "migration"
        migration.mkdir()
        (migration / "channel_archive.jsonl").write_text(json.dumps({
            "channel_id": "UC_old", "handle": "@old", "label": "haramStuff",
            "archived_at": "2026-01-01T00:00:00Z", "subscribers": 10,
            "median_views_last_30": 4200, "videos_found": ["v1", "v2"], "videos_found_count": 2,
            "found_via": ["kw"]}) + "\n", encoding="utf-8")
        result = sync.bootstrap(self.a.conn, self.r2, "a", migration_dir=migration,
                                log=lambda *_: None)
        self.assertEqual(result["ops"], 1)
        segment = sync.decode_segment(self.r2.get(self.r2.list(sync.CATALOG_PREFIX)[0])[0])
        self.assertEqual([op["op"] for op in segment], ["archived"])
        self.assertEqual(segment[0]["label"], "haramStuff")  # the export wins
        self.assertEqual(segment[0]["median_views_last_30"], 4200)
        self.assertEqual(segment[0]["videos_found_count"], 2)
        self.assertNotIn("videos_found", segment[0])  # the id list stays behind
        # The import is part of every bootstrap; running it again over the
        # same file must not announce the archive a second time.
        again = sync.bootstrap(self.a.conn, self.r2, "a", migration_dir=migration,
                               log=lambda *_: None)
        self.assertEqual(again["ops"], 0)
        self.pull(self.b)
        self.assertTrue(store.is_archived(self.b.conn, "UC_old"))

    def test_bootstrap_reclaims_remote_rows_no_export_names(self):
        store.apply_remote_archive(self.a.conn, {
            "channel_id": "UC_r", "handle": "@r", "label": "inactive",
            "archived_at": "2026-01-01T00:00:00Z"})
        self.a.conn.execute("UPDATE channel_archive SET announced=0")
        self.a.conn.commit()
        result = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(result["reclaimed"]["channel_archive"], 1)
        self.assertEqual(result["ops"], 1)
        # ...and, once announced, a second bootstrap has nothing to reclaim.
        again = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(sum(again["reclaimed"].values()), 0)
        self.assertEqual(again["ops"], 0)

    def test_bootstrap_second_machine_does_not_repeat_the_first(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        # B pulled the old shared table too: it knows UC_a, stamped, no videos.
        self.b.scrape("UC_a", "@a", videos=())
        result = sync.bootstrap(self.b.conn, self.r2, "b", log=lambda *_: None)
        self.assertEqual(result["segments"], 1)
        self.assertEqual(result["uploaded"], 0)
        # A's object was applied on B during the bootstrap, videos and all,
        # so B's stamp is real now and nothing was cleared.
        self.assertEqual(result["inherited"], 0)
        self.assertEqual(set(self.b.videos("UC_a")), {"v1", "v2", "v3", "v4", "v5"})
        # B announced only its link to the keyword (A's found op covered
        # the channel) -- nothing about the object, which is A's.
        keys = self.r2.list(sync.CATALOG_PREFIX)
        ops = sync.decode_segment(self.r2.get(keys[-1])[0])
        self.assertNotIn("blob", {op["op"] for op in ops})
        self.assertNotIn("found", {op["op"] for op in ops})

    def test_bootstrap_drops_an_inherited_stamp_and_its_empty_object(self):
        # The old shared `channels` table carried `videos_fetched_at`; the
        # videos behind it were on another machine. A stamped, video-less
        # channel must not become an empty object that blocks the real one.
        self.a.scrape("UC_x", "@x", videos=(), fetched_at="2026-03-01T10:00:00Z")
        first = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        # (The un-fixed behaviour, reproduced: before the stamp check ran the
        # first bootstrap on this machine uploaded the empty object. Simulate
        # that state so the re-run has something to clean up.)
        self.a.conn.execute(
            "UPDATE channels SET videos_fetched_at='2026-03-01T10:00:00Z', "
            "  blob_uploaded_at='2026-03-01T10:00:00Z' WHERE channel_id='UC_x'")
        self.a.conn.commit()
        self.r2.put(sync.channel_key("UC_x"), b"", metadata={"fetched-at": "2026-03-01T10:00:00Z"})
        result = sync.bootstrap(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(first["inherited"], 1)
        self.assertEqual(result["inherited"], 1)
        self.assertIsNone(self.r2.head(sync.channel_key("UC_x")))
        row = self.a.row("UC_x")
        self.assertIsNone(row["videos_fetched_at"])
        self.assertIsNone(row["blob_uploaded_at"])
        # Not in the backlog -- somebody read it; their copy is expected --
        # so the app's catch-up spends no quota on it...
        self.assertEqual(store.count_channels_needing_videos(self.a.conn), 0)
        self.assertEqual(store.count_channels_awaiting_peers(self.a.conn), 1)
        # ...unless nobody delivers for a month.
        later = time.time() + (store.AWAITING_PEER_DAYS + 1) * 86400
        self.assertEqual(store.count_channels_needing_videos(self.a.conn, now=later), 1)
        self.assertEqual(store.count_channels_awaiting_peers(self.a.conn, now=later), 0)
        # The machine that really read it uploads unopposed, and A applies.
        self.b.scrape("UC_x", "@x", videos=VIDEOS_A, fetched_at="2026-03-01T10:00:00Z")
        self.assertEqual(sync.push_blobs(self.b.conn, self.r2), (1, 0))
        self.share(self.b)
        self.pull(self.a)
        self.assertEqual(set(self.a.videos("UC_x")), {"v1", "v2", "v3", "v4", "v5"})
        self.assertEqual(store.count_channels_needing_videos(self.a.conn), 0)
        self.assertEqual(store.count_channels_awaiting_peers(self.a.conn), 0)

    def test_a_missing_object_is_forgotten_not_applied(self):
        # A announces a version, but the object is not there (deleted, or
        # never uploaded). B must download it once it does appear -- at the
        # SAME version, which is the case for a stamp both machines share.
        self.a.scrape("UC_m", "@m", videos=VIDEOS_A)
        self.share(self.a)
        self.r2.delete(sync.channel_key("UC_m"))
        segs, counts, applied = self.pull(self.b)
        self.assertEqual(applied, 0)
        self.assertIsNone(self.b.row("UC_m")["blob_version"])
        self.assertEqual(sync.pull_blobs(self.b.conn, self.r2), (0, 0, 0))  # no retry storm
        # The object turns up; the catalog names the same version again.
        self.a.conn.execute("UPDATE channels SET blob_uploaded_at=NULL WHERE channel_id='UC_m'")
        self.a.conn.commit()
        self.assertEqual(sync.push_blobs(self.a.conn, self.r2), (1, 0))
        self.a.conn.execute(
            "UPDATE channels SET blob_announced_version=NULL WHERE channel_id='UC_m'")
        self.a.conn.commit()
        self.assertEqual(self.share(self.a), 1)
        segs, counts, applied = self.pull(self.b)
        self.assertEqual(applied, 1)
        self.assertEqual(set(self.b.videos("UC_m")), {"v1", "v2", "v3", "v4", "v5"})

    def test_an_empty_object_at_the_same_stamp_does_not_wipe_local_videos(self):
        # The old shared table stamped every machine; the videos stayed on
        # the one that read them. A machine that never had them and shared
        # before bootstrapping put an EMPTY object in the bucket under the
        # real read's stamp. Applying that here must not delete the videos
        # this machine actually holds.
        self.b.scrape("UC_e", "@e", videos=VIDEOS_A, fetched_at="2026-03-01T10:00:00Z")
        self.a.scrape("UC_e", "@e", videos=(), fetched_at="2026-03-01T10:00:00Z")
        self.assertEqual(sync.push_blobs(self.a.conn, self.r2), (1, 0))
        self.share(self.a)
        self.pull(self.b)
        self.assertEqual(set(self.b.videos("UC_e")), {"v1", "v2", "v3", "v4", "v5"})
        # A genuinely newer empty read is different news, and replaces.
        self.a.scrape("UC_e", "@e", videos=(), fetched_at="2026-04-01T10:00:00Z")
        self.a.conn.execute("UPDATE channels SET blob_uploaded_at=NULL, "
                            "blob_announced_version=NULL WHERE channel_id='UC_e'")
        self.a.conn.commit()
        self.assertEqual(sync.push_blobs(self.a.conn, self.r2), (1, 0))
        self.share(self.a)
        self.pull(self.b)
        self.assertEqual(self.b.videos("UC_e"), {})

    def test_ensure_bootstrapped_runs_once_per_store(self):
        self.a.scrape("UC_a", "@a", videos=VIDEOS_A)
        first = sync.ensure_bootstrapped(self.a.conn, self.r2, "a", log=lambda *_: None)
        self.assertEqual(first["uploaded"], 1)
        self.assertTrue(store.is_bootstrapped(self.a.conn))
        self.assertIsNone(sync.ensure_bootstrapped(self.a.conn, self.r2, "a",
                                                   log=lambda *_: None))
        self.assertEqual(len(self.r2.list(sync.CATALOG_PREFIX)), 1)

    def test_a_second_process_waits_for_the_first_bootstrap_and_skips(self):
        import threading
        self.a.scrape("UC_l", "@l", videos=VIDEOS_A)
        path = Path(self.a.dir.name) / "a.db"
        real_put = self.r2.put
        started = threading.Event()
        release = threading.Event()

        def slow_put(key, *args, **kwargs):
            real_put(key, *args, **kwargs)
            if key.startswith(sync.CHANNEL_PREFIX):
                started.set()
                release.wait(5)
        self.r2.put = slow_put
        results, said = {}, []

        def runner(name):
            conn = store.get_connection(str(path))
            try:
                results[name] = sync.ensure_bootstrapped(conn, self.r2, "a", log=said.append)
            finally:
                conn.close()
        first = threading.Thread(target=runner, args=("first",))
        first.start()
        self.assertTrue(started.wait(5))
        second = threading.Thread(target=runner, args=("second",))
        second.start()
        second.join(0.5)
        self.assertTrue(second.is_alive())  # waiting on the lock, not bootstrapping
        release.set()
        first.join(5)
        second.join(5)
        self.assertEqual(results["first"]["uploaded"], 1)
        self.assertIsNone(results["second"])
        self.assertEqual(len(self.r2.list(sync.CATALOG_PREFIX)), 1)
        self.assertIn("[bootstrap] finished by another process while this one waited.", said)

    def test_two_sharers_of_one_store_write_one_segment(self):
        import threading
        self.a.scrape("UC_l", "@l", videos=VIDEOS_A)
        sync.push_blobs(self.a.conn, self.r2)
        path = Path(self.a.dir.name) / "a.db"
        real_put = self.r2.put
        started = threading.Event()
        release = threading.Event()

        def slow_put(key, *args, **kwargs):
            # The first sharer sits inside its upload while the second tries.
            real_put(key, *args, **kwargs)
            if key.startswith(sync.CATALOG_PREFIX):
                started.set()
                release.wait(5)
        self.r2.put = slow_put
        results = {}

        def sharer(name):
            # Each "process" on its own connection, as sqlite3 requires.
            conn = store.get_connection(str(path))
            try:
                results[name] = sync.write_segment(conn, self.r2, "a")
            finally:
                conn.close()
        first = threading.Thread(target=sharer, args=("first",))
        first.start()
        self.assertTrue(started.wait(5))
        second = threading.Thread(target=sharer, args=("second",))
        second.start()
        second.join(0.5)
        self.assertTrue(second.is_alive())  # waiting on the lock, not writing
        release.set()
        first.join(5)
        second.join(5)
        self.assertEqual(results, {"first": 3, "second": 0})
        self.assertEqual(len(self.r2.list(sync.CATALOG_PREFIX)), 1)


class ArchiveNumbersTest(unittest.TestCase):
    """The two derived numbers the archive freezes, across machines.

    `median_views_last_30` and `videos_found_count` are the only facts in this
    system that cannot be recovered once written wrong: the sweep that writes
    them deletes the videos behind them, here and in the bucket. And the sweep
    runs on whichever machine's sync tick comes round first, which is very
    often one that pulled the channel from the catalog and never downloaded a
    single one of its videos. Everything below is that situation.
    """

    def setUp(self):
        self.r2 = FakeR2()
        self.holder = Machine(self, "holder")    # scraped it; has the videos
        self.other = Machine(self, "other")      # pulled it; has no videos

    def share(self, machine):
        sync.write_segment(machine.conn, self.r2, machine.name, log=lambda *_: None)

    def pull(self, machine):
        sync.pull_catalog(machine.conn, self.r2, log=lambda *_: None)

    def tombstone(self, machine, channel_id="UC_a"):
        row = machine.conn.execute(
            "SELECT * FROM channel_archive WHERE channel_id=?", (channel_id,)).fetchone()
        return dict(row) if row else None

    def seed(self, videos=VIDEOS_A):
        """The holder scrapes and shares; the other machine pulls the catalog
        but never the object, so it holds the row and none of the videos."""
        self.holder.scrape("UC_a", "@a", videos=videos)
        sync.push_blobs(self.holder.conn, self.r2, log=lambda *_: None)
        self.share(self.holder)
        self.pull(self.other)
        self.assertEqual(len(self.other.videos("UC_a")), 0)

    def test_a_machine_without_the_videos_says_unknown_not_zero(self):
        self.seed()
        store.archive_channel_locally(self.other.conn, "UC_a", "@a", "inactive")

        row = self.tombstone(self.other)
        # Not 0. Nobody counted anything -- and "we looked and there were
        # none" is a finding this machine is in no position to report.
        self.assertIsNone(row["videos_found_count"])
        self.assertIsNone(row["median_views_last_30"])

    def test_the_blank_tombstone_does_not_blank_the_machine_that_has_them(self):
        self.seed()
        store.archive_channel_locally(self.other.conn, "UC_a", "@a", "inactive")
        self.share(self.other)

        self.pull(self.holder)

        row = self.tombstone(self.holder)
        # 200 is the median of VIDEOS_A's 30-day window (100 and 300).
        self.assertEqual(row["median_views_last_30"], 200)
        self.assertEqual(row["median_basis"], "window30")
        self.assertEqual(row["videos_found_count"], 5)
        # And the videos really are gone, so this was the last chance to read
        # them -- which is the whole point of measuring on the way past.
        self.assertEqual(self.holder.videos("UC_a"), {})

    def test_the_numbers_travel_back_to_the_machine_that_lacked_them(self):
        self.seed()
        store.archive_channel_locally(self.other.conn, "UC_a", "@a", "inactive")
        self.share(self.other)
        self.pull(self.holder)

        # The holder has something of its own to say now, so it says it.
        self.share(self.holder)
        self.pull(self.other)

        row = self.tombstone(self.other)
        self.assertEqual(row["median_views_last_30"], 200)
        self.assertEqual(row["videos_found_count"], 5)

    def test_the_exchange_stops_after_one_round(self):
        self.seed()
        store.archive_channel_locally(self.other.conn, "UC_a", "@a", "inactive")
        self.share(self.other)
        self.pull(self.holder)
        self.share(self.holder)
        self.pull(self.other)

        # Neither machine can improve on the other's row any more, so neither
        # has anything left to announce. Without that, two machines would
        # trade the same numbers back and forth on every tick forever.
        before = len(self.r2.list(sync.CATALOG_PREFIX))
        self.share(self.other)
        self.share(self.holder)
        self.assertEqual(len(self.r2.list(sync.CATALOG_PREFIX)), before)

    def test_an_inactive_channel_keeps_a_median_over_everything_it_posted(self):
        # Nothing inside the 30 days before the read, which is what "inactive"
        # means and therefore what most of this table looks like. The rollup
        # is null for exactly that reason, and the tombstone used to freeze
        # "4 videos, median unknown".
        old = (
            ("v1", "2025-01-01T00:00:00Z", "100", True),
            ("v2", "2025-01-02T00:00:00Z", "300", True),
            ("v3", "2025-01-03T00:00:00Z", "500", True),
            ("v4", "2025-01-04T00:00:00Z", None, True),
        )
        self.holder.scrape("UC_a", "@a", videos=old)
        self.assertIsNone(self.holder.row("UC_a")["median_views_last_30"])

        store.archive_channel_locally(self.holder.conn, "UC_a", "@a", "inactive")

        row = self.tombstone(self.holder)
        self.assertEqual(row["median_views_last_30"], 300)
        # Labelled, because it is not the number the influencer list shows and
        # must not be read as if it were.
        self.assertEqual(row["median_basis"], "lifetime")
        self.assertEqual(row["videos_found_count"], 4)

    def test_the_auto_clean_gate_records_that_nothing_was_ever_fetched(self):
        # The gate archives on the subscriber count during a search, before a
        # single video is fetched. There is no median to lose, and the row
        # says so rather than claiming the channel posted nothing.
        store.seed_keywords(self.holder.conn, ["kw"])
        store.record_channel_discovery(self.holder.conn, "@a", "UC_a", "kw")
        store.archive_channel_locally(
            self.holder.conn, "UC_a", "@a", "irrelevant", subscribers="12")

        row = self.tombstone(self.holder)
        self.assertIsNone(row["videos_found_count"])
        self.assertIsNone(row["median_views_last_30"])
        self.assertEqual(row["subscribers"], "12")

    def test_a_relabel_from_the_app_keeps_the_numbers(self):
        self.seed()
        store.archive_channel_locally(self.holder.conn, "UC_a", "@a", "inactive")

        sync.archive_channels(self.holder.conn, self.r2, self.holder.name,
                              [{"channel_id": "UC_a", "label": "haramStuff"}],
                              log=lambda *_: None)

        row = self.tombstone(self.holder)
        self.assertEqual(row["label"], "haramStuff")
        self.assertEqual(row["median_views_last_30"], 200)
        self.assertEqual(row["videos_found_count"], 5)


class MergeArchiveNumbersTest(unittest.TestCase):
    """The rule itself: a tombstone can only ever be improved."""

    def setUp(self):
        self.m = Machine(self, "m")
        self.m.conn.execute(
            "INSERT INTO channel_archive (channel_id, handle, label, archived_at, "
            "  source, announced, median_views_last_30, median_basis, videos_found_count) "
            "VALUES ('UC_a', '@a', 'inactive', 'T', 'remote', 1, ?, ?, ?)",
            (200, "window30", 5))
        self.m.conn.commit()

    def row(self):
        return dict(self.m.conn.execute(
            "SELECT * FROM channel_archive WHERE channel_id='UC_a'").fetchone())

    def merge(self, *args, **kwargs):
        changed = store.merge_archive_numbers(self.m.conn, "UC_a", *args, **kwargs)
        self.m.conn.commit()
        return changed

    def test_nothing_known_changes_nothing(self):
        self.assertFalse(self.merge(None, None, None))
        self.assertEqual(self.row()["median_views_last_30"], 200)

    def test_a_weaker_observation_loses(self):
        self.assertFalse(self.merge(9, "window30", 1))
        self.assertEqual(self.row()["median_views_last_30"], 200)
        self.assertEqual(self.row()["videos_found_count"], 5)

    def test_a_stronger_observation_wins_and_takes_its_median_with_it(self):
        self.assertTrue(self.merge(50, "lifetime", 9))
        row = self.row()
        self.assertEqual(row["median_views_last_30"], 50)
        # The basis travels with the median. A 'lifetime' number sitting under
        # a 'window30' label is the one shape of wrong this column exists to
        # prevent.
        self.assertEqual(row["median_basis"], "lifetime")
        self.assertEqual(row["videos_found_count"], 9)

    def test_a_real_zero_beats_never_having_counted(self):
        self.m.conn.execute(
            "UPDATE channel_archive SET median_views_last_30=NULL, median_basis=NULL, "
            "  videos_found_count=NULL WHERE channel_id='UC_a'")
        self.assertTrue(self.merge(None, None, 0))
        self.assertEqual(self.row()["videos_found_count"], 0)
        # ...and is still beaten by a count.
        self.assertTrue(self.merge(7, "window30", 3))
        self.assertEqual(self.row()["videos_found_count"], 3)

    def test_an_improvement_is_queued_to_go_back_out(self):
        self.m.conn.execute(
            "UPDATE channel_archive SET median_views_last_30=NULL, "
            "  videos_found_count=NULL WHERE channel_id='UC_a'")
        self.assertTrue(self.merge(50, "window30", 9))
        row = self.row()
        # Only 'local' rows are announced, and this machine does now have
        # something of its own to say about a row it merely pulled.
        self.assertEqual(row["source"], "local")
        self.assertEqual(row["announced"], 0)

    def test_applying_what_arrived_is_not_something_to_announce_back(self):
        self.m.conn.execute(
            "UPDATE channel_archive SET median_views_last_30=NULL, "
            "  videos_found_count=NULL WHERE channel_id='UC_a'")
        self.assertTrue(self.merge(50, "window30", 9, announce=False))
        row = self.row()
        self.assertEqual(row["median_views_last_30"], 50)
        self.assertEqual(row["source"], "remote")
        self.assertEqual(row["announced"], 1)


class SegmentEncodingTest(unittest.TestCase):
    def test_round_trip(self):
        ops = [{"op": "found", "channel": {"channel_id": "UC_x", "name": "ç∂é"}},
               {"op": "link", "channel_id": "UC_x", "keyword": "k"}]
        self.assertEqual(sync.decode_segment(sync.encode_segment(ops)), ops)

    def test_a_bad_line_does_not_sink_the_segment(self):
        from gratovo.r2 import compress
        data = compress(b'{"op":"link","channel_id":"a","keyword":"k"}\nnot json\n')
        self.assertEqual(len(sync.decode_segment(data)), 1)

    def test_worker_names_are_key_safe(self):
        self.assertEqual(sync.segment_key("Moustafa's PC/2", "S", 3),
                         "catalog/Moustafa-s-PC-2/S-003.jsonl.zst")


if __name__ == "__main__":
    unittest.main()
