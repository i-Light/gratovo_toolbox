"""Tests for sponsorship detection (see `gratovo.pipeline.compute_channel_sponsorship`).

Run with:  python tests/test_sponsorship.py    (from pipeline/)

Plain unittest against a real temporary SQLite database, for the same reason
test_archive.py and test_video_backfill.py are: the behaviour under test is
mostly "read these stored rows, write these two derived columns", and a fake
store would only test the fake. No network -- the pass is a plain keyword/regex
scan over `videos.description`, nothing YouTube-shaped is involved.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import pipeline, store  # noqa: E402


class ChannelSponsorshipTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def _channel(self, channel_id, handle="@x"):
        self.conn.execute(
            "INSERT INTO channels (channel_id, handle, first_seen_at) VALUES (?, ?, ?)",
            (channel_id, handle, "2026-01-01T00:00:00Z"),
        )
        self.conn.commit()

    def _video(self, video_id, channel_id, description=None, failed=False):
        if failed:
            self.conn.execute(
                "INSERT INTO videos (video_id, channel_id, last_fetched_at, last_fetch_status) "
                "VALUES (?, ?, '2026-01-02T00:00:00Z', 'failed')",
                (video_id, channel_id),
            )
        else:
            self.conn.execute(
                "INSERT INTO videos (video_id, channel_id, description, "
                "  last_fetched_at, last_fetch_status) "
                "VALUES (?, ?, ?, '2026-01-02T00:00:00Z', 'success')",
                (video_id, channel_id, description),
            )
        self.conn.commit()

    def _row(self, channel_id):
        return self.conn.execute(
            "SELECT sponsored_ratio, seen_brands FROM channels WHERE channel_id=?",
            (channel_id,),
        ).fetchone()

    # ---- the ratio ----

    def test_ratio_counts_only_videos_with_a_sponsorship_signal(self):
        self._channel("UC_a")
        self._video("v1", "UC_a", "This video is sponsored by NordVPN, check them out.")
        self._video("v2", "UC_a", "Use code SAVE20 for 20% off at checkout.")
        self._video("v3", "UC_a", "Just a normal vlog, nothing to see here.")
        self._video("v4", "UC_a", "Another regular upload about my day.")

        pipeline.compute_channel_sponsorship(self.conn, ["UC_a"])

        row = self._row("UC_a")
        self.assertAlmostEqual(row["sponsored_ratio"], 0.5)

    def test_a_channel_with_no_sponsorship_signals_gets_a_zero_ratio(self):
        self._channel("UC_clean")
        self._video("v1", "UC_clean", "A regular gameplay video, no ads today.")
        self._video("v2", "UC_clean", "Just talking about my week.")

        pipeline.compute_channel_sponsorship(self.conn, ["UC_clean"])

        row = self._row("UC_clean")
        self.assertEqual(row["sponsored_ratio"], 0.0)
        self.assertEqual(json.loads(row["seen_brands"]), [])

    def test_a_channel_that_is_always_sponsored_gets_a_ratio_of_one(self):
        self._channel("UC_full")
        self._video("v1", "UC_full", "#ad this episode is paid partnership with Acme Corp.")
        self._video("v2", "UC_full", "Affiliate link in the description, as always.")

        pipeline.compute_channel_sponsorship(self.conn, ["UC_full"])

        row = self._row("UC_full")
        self.assertEqual(row["sponsored_ratio"], 1.0)

    def test_a_failed_video_fetch_counts_toward_the_denominator_not_the_match(self):
        # A failed metadata fetch has no description at all -- it is still a
        # stored video, and it must not silently vanish from the ratio, nor
        # count as a sponsorship match.
        self._channel("UC_b")
        self._video("v1", "UC_b", "Sponsored by Acme, use code ACME10.")
        self._video("v2", "UC_b", failed=True)

        pipeline.compute_channel_sponsorship(self.conn, ["UC_b"])

        row = self._row("UC_b")
        self.assertAlmostEqual(row["sponsored_ratio"], 0.5)

    # ---- zero stored videos: must not crash ----

    def test_a_channel_with_zero_stored_videos_gets_a_null_ratio_not_an_exception(self):
        self._channel("UC_empty")

        pipeline.compute_channel_sponsorship(self.conn, ["UC_empty"])

        row = self._row("UC_empty")
        self.assertIsNone(row["sponsored_ratio"])
        self.assertEqual(json.loads(row["seen_brands"]), [])

    def test_an_empty_channel_id_list_is_a_no_op(self):
        # Must not raise on the empty-IN-clause edge case.
        pipeline.compute_channel_sponsorship(self.conn, [])

    def test_a_channel_id_not_in_the_store_is_skipped_without_raising(self):
        pipeline.compute_channel_sponsorship(self.conn, ["UC_missing"])

    # ---- brand extraction: confident patterns only ----

    def test_sponsored_by_extracts_the_brand_that_follows(self):
        is_sponsored, brands = pipeline._detect_sponsorship(
            "This video is sponsored by NordVPN. Stay safe online.")
        self.assertTrue(is_sponsored)
        self.assertEqual(brands, ["NordVPN"])

    def test_in_partnership_with_extracts_the_brand_that_follows(self):
        is_sponsored, brands = pipeline._detect_sponsorship(
            "Made in partnership with Raycon Audio for this unboxing.")
        self.assertTrue(is_sponsored)
        self.assertEqual(brands, ["Raycon Audio"])

    def test_use_code_extracts_the_code_as_a_brand_signal(self):
        is_sponsored, brands = pipeline._detect_sponsorship(
            "Get 15% off with use code MKBHD at checkout.")
        self.assertTrue(is_sponsored)
        self.assertEqual(brands, ["MKBHD"])

    def test_a_sponsorship_signal_with_no_confident_brand_pattern_stays_empty(self):
        # "sponsored" fires the ratio, but nothing here matches any of the
        # narrow brand patterns -- no guessing from stray capitals.
        is_sponsored, brands = pipeline._detect_sponsorship(
            "This video is Sponsored. Thanks for watching!")
        self.assertTrue(is_sponsored)
        self.assertEqual(brands, [])

    def test_capitalized_words_with_no_sponsorship_signal_extract_no_brands(self):
        is_sponsored, brands = pipeline._detect_sponsorship(
            "I Went To New York City And It Was Amazing, Highly Recommend It.")
        self.assertFalse(is_sponsored)
        self.assertEqual(brands, [])

    def test_a_blank_description_is_neither_sponsored_nor_a_brand_source(self):
        self.assertEqual(pipeline._detect_sponsorship(None), (False, []))
        self.assertEqual(pipeline._detect_sponsorship(""), (False, []))

    def test_brands_are_deduplicated_and_written_as_json(self):
        self._channel("UC_dupe")
        self._video("v1", "UC_dupe", "Sponsored by Acme -- Acme makes great gear.")
        self._video("v2", "UC_dupe", "This one is also sponsored by Acme again.")

        pipeline.compute_channel_sponsorship(self.conn, ["UC_dupe"])

        row = self._row("UC_dupe")
        self.assertEqual(json.loads(row["seen_brands"]), ["Acme"])


if __name__ == "__main__":
    unittest.main()
