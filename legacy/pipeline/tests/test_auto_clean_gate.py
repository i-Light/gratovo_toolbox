"""Tests for the auto-clean subscriber gate.

Run with:  python tests/test_auto_clean_gate.py    (from pipeline/)

Plain unittest, no network, real temporary SQLite -- same shape as
test_archive.py. The gate is the standing "Auto-clean results" rule's
subscriber decision, made inside a run *before* any videos are fetched:

  * inside the range           -> left alone, fetched now like always
  * below it (default 'sweep') -> archived locally, dropped from the run
  * above it (default 'delay') -> kept, videos deferred to the backlog
  * subscriber count unknown   -> left alone, never archived on a missing number
"""

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config, pipeline, store  # noqa: E402


def _cfg(*, enabled=True, lo=50_000, hi=5_000_000,
         below="sweep", above="delay", label="irrelevant", handles_limit=10):
    return types.SimpleNamespace(
        auto_clean_enabled=enabled,
        auto_clean_min_subscribers=lo,
        auto_clean_max_subscribers=hi,
        auto_clean_below_min_action=below,
        auto_clean_above_max_action=above,
        auto_clean_label=label,
        handles_limit=handles_limit,
        # run_manual_refetch paces between handles via CFG.delay(...); None means
        # "no range configured", which paced_delay treats as no wait.
        delay=lambda _key: None,
    )


class AutoCleanGateTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

        saved = pipeline.CFG
        self.addCleanup(lambda: setattr(pipeline, "CFG", saved))
        pipeline.CFG = _cfg()

    def _seed(self, handle, channel_id, subscribers):
        """A discovered channel with its metadata already saved, the state the
        gate sees it in (channel details fetched, videos not yet)."""
        store.record_channel_discovery(self.conn, handle, channel_id, "k1")
        self.conn.execute(
            "UPDATE channels SET subscribers=?, last_fetched_at='2026-09-01T00:00:00Z' "
            "WHERE channel_id=?",
            (subscribers, channel_id),
        )
        self.conn.commit()

    def _run_gate(self, discovered, info, keyword="k1"):
        return pipeline.apply_auto_clean_gate(self.conn, discovered, info, keyword)

    # ---- classification ----

    def test_in_range_channel_is_untouched(self):
        self._seed("@mid", "UC_mid", "250000")
        discovered = {"@mid": "UC_mid"}
        swept, delayed = self._run_gate(
            discovered, {"@mid": {"Subscribers": "250000"}})
        self.assertEqual((swept, delayed), (0, set()))
        self.assertEqual(discovered, {"@mid": "UC_mid"})
        self.assertIsNotNone(store.get_channel_row(self.conn, "UC_mid"))
        self.assertFalse(store.is_archived(self.conn, "UC_mid"))

    def test_below_minimum_is_swept(self):
        self._seed("@tiny", "UC_tiny", "1200")
        discovered = {"@tiny": "UC_tiny"}
        swept, delayed = self._run_gate(
            discovered, {"@tiny": {"Subscribers": "1200"}})
        self.assertEqual(swept, 1)
        self.assertEqual(delayed, set())
        # Gone from the working set and from the channels table; tombstoned.
        self.assertNotIn("@tiny", discovered)
        self.assertIsNone(store.get_channel_row(self.conn, "UC_tiny"))
        self.assertTrue(store.is_archived(self.conn, "UC_tiny"))

    def test_a_swept_tombstone_carries_the_count_and_label(self):
        self._seed("@tiny", "UC_tiny", "1200")
        self._run_gate({"@tiny": "UC_tiny"}, {"@tiny": {"Subscribers": "1200"}},
                       keyword="gambling tips")
        row = self.conn.execute(
            "SELECT label, subscribers, found_at, found_via FROM channel_archive "
            "WHERE channel_id='UC_tiny'").fetchone()
        self.assertEqual(row["label"], "irrelevant")
        self.assertEqual(row["subscribers"], "1200")
        self.assertIsNotNone(row["found_at"])
        found_via = json.loads(row["found_via"])
        self.assertEqual(len(found_via), 1)
        self.assertEqual(found_via[0]["keyword"], "gambling tips")
        self.assertEqual(found_via[0]["limit"], 10)
        self.assertIsNotNone(found_via[0]["discovered_at"])

    def test_above_maximum_is_deferred_not_archived(self):
        self._seed("@huge", "UC_huge", "9000000")
        discovered = {"@huge": "UC_huge"}
        swept, delayed = self._run_gate(
            discovered, {"@huge": {"Subscribers": "9000000"}})
        self.assertEqual(swept, 0)
        self.assertEqual(delayed, {"@huge"})
        # Still a live channel, still in the working set -- just not this run's
        # video work. Its videos_fetched_at is untouched, so the backlog owns it.
        self.assertIn("@huge", discovered)
        self.assertFalse(store.is_archived(self.conn, "UC_huge"))
        self.assertIsNone(
            store.get_channel_row(self.conn, "UC_huge")["videos_fetched_at"])

    def test_unknown_subscriber_count_is_left_alone(self):
        self._seed("@hidden", "UC_hidden", "Hidden")
        discovered = {"@hidden": "UC_hidden"}
        swept, delayed = self._run_gate(
            discovered, {"@hidden": {"Subscribers": "Hidden"}})
        self.assertEqual((swept, delayed), (0, set()))
        self.assertIn("@hidden", discovered)
        self.assertFalse(store.is_archived(self.conn, "UC_hidden"))

    def test_boundary_values_are_inside_the_range(self):
        # Inclusive bounds, matching BulkRejectionRequest.
        self._seed("@lo", "UC_lo", "50000")
        self._seed("@hi", "UC_hi", "5000000")
        discovered = {"@lo": "UC_lo", "@hi": "UC_hi"}
        swept, delayed = self._run_gate(discovered, {
            "@lo": {"Subscribers": "50000"},
            "@hi": {"Subscribers": "5000000"},
        })
        self.assertEqual((swept, delayed), (0, set()))
        self.assertEqual(len(discovered), 2)

    # ---- per-band action overrides ----

    def test_below_minimum_can_be_delay_instead_of_sweep(self):
        pipeline.CFG = _cfg(below="delay")
        self._seed("@tiny", "UC_tiny", "1200")
        discovered = {"@tiny": "UC_tiny"}
        swept, delayed = self._run_gate(
            discovered, {"@tiny": {"Subscribers": "1200"}})
        self.assertEqual(swept, 0)
        self.assertEqual(delayed, {"@tiny"})
        self.assertFalse(store.is_archived(self.conn, "UC_tiny"))

    def test_above_maximum_can_be_sweep_instead_of_delay(self):
        pipeline.CFG = _cfg(above="sweep")
        self._seed("@huge", "UC_huge", "9000000")
        discovered = {"@huge": "UC_huge"}
        swept, delayed = self._run_gate(
            discovered, {"@huge": {"Subscribers": "9000000"}})
        self.assertEqual(swept, 1)
        self.assertTrue(store.is_archived(self.conn, "UC_huge"))

    def test_off_leaves_a_band_completely_alone(self):
        pipeline.CFG = _cfg(below="off")
        self._seed("@tiny", "UC_tiny", "1200")
        discovered = {"@tiny": "UC_tiny"}
        swept, delayed = self._run_gate(
            discovered, {"@tiny": {"Subscribers": "1200"}})
        self.assertEqual((swept, delayed), (0, set()))
        self.assertIn("@tiny", discovered)
        self.assertFalse(store.is_archived(self.conn, "UC_tiny"))

    def test_an_open_lower_end_never_sweeps_below(self):
        pipeline.CFG = _cfg(lo=None)
        self._seed("@tiny", "UC_tiny", "5")
        discovered = {"@tiny": "UC_tiny"}
        swept, delayed = self._run_gate(
            discovered, {"@tiny": {"Subscribers": "5"}})
        self.assertEqual((swept, delayed), (0, set()))

    # ---- the off switch ----

    def test_a_disabled_rule_does_nothing(self):
        pipeline.CFG = _cfg(enabled=False)
        self._seed("@tiny", "UC_tiny", "1200")
        discovered = {"@tiny": "UC_tiny"}
        swept, delayed = self._run_gate(
            discovered, {"@tiny": {"Subscribers": "1200"}})
        self.assertEqual((swept, delayed), (0, set()))
        self.assertEqual(discovered, {"@tiny": "UC_tiny"})

    def test_no_cfg_at_all_does_nothing(self):
        pipeline.CFG = None
        swept, delayed = self._run_gate({"@a": "UC_a"}, {})
        self.assertEqual((swept, delayed), (0, set()))

    # ---- the tombstone is pushable ----

    def test_a_swept_channel_shows_up_for_the_next_push(self):
        self._seed("@tiny", "UC_tiny", "1200")
        self._run_gate({"@tiny": "UC_tiny"}, {"@tiny": {"Subscribers": "1200"}})
        changed = store.get_unannounced_archives(self.conn)
        self.assertEqual([r["channel_id"] for r in changed], ["UC_tiny"])
        self.assertEqual(changed[0]["subscribers"], "1200")


class AutoCleanConfigTest(unittest.TestCase):
    """`run_config.json`'s `auto_clean` block -> resolved Config values,
    falling back to `settings.json`'s own `auto_clean` block when
    `run_config.json` doesn't carry one at all."""

    def _cfg_with(self, auto_clean, settings_auto_clean=None):
        cfg = config.Config.__new__(config.Config)
        cfg.run_config = {"auto_clean": auto_clean} if auto_clean is not None else {}
        cfg.settings = (
            {"auto_clean": settings_auto_clean}
            if settings_auto_clean is not None else {}
        )
        return cfg

    def test_a_full_block_resolves(self):
        cfg = self._cfg_with({
            "enabled": True, "min_subscribers": 50000,
            "max_subscribers": 5000000, "below_min_action": "sweep",
            "above_max_action": "delay", "label": "irrelevant",
        })
        self.assertTrue(cfg.auto_clean_enabled)
        self.assertEqual(cfg.auto_clean_min_subscribers, 50000)
        self.assertEqual(cfg.auto_clean_max_subscribers, 5000000)
        self.assertEqual(cfg.auto_clean_below_min_action, "sweep")
        self.assertEqual(cfg.auto_clean_above_max_action, "delay")

    def test_missing_block_is_off(self):
        cfg = self._cfg_with(None)
        self.assertFalse(cfg.auto_clean_enabled)
        self.assertIsNone(cfg.auto_clean_min_subscribers)
        # Bands still report their documented defaults.
        self.assertEqual(cfg.auto_clean_below_min_action, "sweep")
        self.assertEqual(cfg.auto_clean_above_max_action, "delay")

    def test_enabled_but_no_bounds_is_still_off(self):
        cfg = self._cfg_with({"enabled": True})
        self.assertFalse(cfg.auto_clean_enabled)

    def test_a_junk_action_falls_back_to_the_default(self):
        cfg = self._cfg_with({
            "enabled": True, "min_subscribers": 1,
            "below_min_action": "nonsense", "above_max_action": "",
        })
        self.assertEqual(cfg.auto_clean_below_min_action, "sweep")
        self.assertEqual(cfg.auto_clean_above_max_action, "delay")

    def test_a_label_outside_the_vocabulary_falls_back(self):
        cfg = self._cfg_with({
            "enabled": True, "min_subscribers": 1, "label": "qualified",
        })
        self.assertEqual(cfg.auto_clean_label, "irrelevant")

    def test_falls_back_to_settings_json_when_run_config_has_no_block(self):
        # A bare `python search.py` (or any run that skipped the app's Start
        # button) still gets the shared, committed default rule rather than
        # no rule at all.
        cfg = self._cfg_with(None, settings_auto_clean={
            "enabled": True, "min_subscribers": 50000,
            "max_subscribers": 2000000, "below_min_action": "sweep",
            "above_max_action": "delay", "label": "inactive",
        })
        self.assertTrue(cfg.auto_clean_enabled)
        self.assertEqual(cfg.auto_clean_min_subscribers, 50000)
        self.assertEqual(cfg.auto_clean_max_subscribers, 2000000)
        self.assertEqual(cfg.auto_clean_label, "inactive")

    def test_run_config_block_wins_over_settings_json_when_both_present(self):
        cfg = self._cfg_with(
            {"enabled": True, "min_subscribers": 1},
            settings_auto_clean={"enabled": True, "min_subscribers": 999},
        )
        self.assertEqual(cfg.auto_clean_min_subscribers, 1)

    def test_an_explicitly_empty_run_config_block_does_not_fall_back(self):
        # `{"auto_clean": {}}` is a real (if degenerate) block the app could
        # send -- distinct from the key being absent entirely. It should not
        # be treated as "nothing sent" and fall through to the settings.json
        # default; an app that explicitly forwarded an empty rule meant off.
        cfg = self._cfg_with({}, settings_auto_clean={
            "enabled": True, "min_subscribers": 999,
        })
        self.assertFalse(cfg.auto_clean_enabled)
        self.assertIsNone(cfg.auto_clean_min_subscribers)


class AutoCleanActionForSubscribersTest(unittest.TestCase):
    """`pipeline.auto_clean_action_for_subscribers` -- the shared band verdict
    both `apply_auto_clean_gate` and `run_manual_refetch`'s import gate call."""

    def setUp(self):
        saved = pipeline.CFG
        self.addCleanup(lambda: setattr(pipeline, "CFG", saved))
        pipeline.CFG = _cfg()

    def test_in_range_is_none(self):
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(250_000))

    def test_below_floor_is_sweep(self):
        self.assertEqual(
            pipeline.auto_clean_action_for_subscribers(1_200), "sweep")

    def test_above_ceiling_is_delay(self):
        self.assertEqual(
            pipeline.auto_clean_action_for_subscribers(9_000_000), "delay")

    def test_bounds_are_inclusive(self):
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(50_000))
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(5_000_000))

    def test_unknown_count_is_none(self):
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(None))

    def test_a_band_switched_off_is_none(self):
        pipeline.CFG = _cfg(below="off")
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(5))

    def test_an_open_lower_end_never_sweeps(self):
        pipeline.CFG = _cfg(lo=None)
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(5))

    def test_a_disabled_rule_is_none(self):
        pipeline.CFG = _cfg(enabled=False)
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(1_200))

    def test_no_cfg_at_all_is_none(self):
        pipeline.CFG = None
        self.assertIsNone(pipeline.auto_clean_action_for_subscribers(1_200))


class RunManualRefetchGateTest(unittest.TestCase):
    """The same gate, driven one handle at a time from `run_manual_refetch`
    (the path `tools/import_handles.py` takes) rather than over a whole
    keyword's finds. Every YouTube call is stubbed; only the DB is real."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

        saved_cfg = pipeline.CFG
        self.addCleanup(lambda: setattr(pipeline, "CFG", saved_cfg))
        pipeline.CFG = _cfg(label="inactive")

        # {handle: subscriber string} the stubbed channel fetch will report.
        self.subs = {}
        # Handles the stubbed upload scrape was asked for -- a swept or deferred
        # channel must never reach it.
        self.scraped = []

        def fake_get_channels_data(batch):
            return {h: {"Name": h.lstrip("@").title(),
                        "Subscribers": self.subs.get(h, "0"),
                        "Channel_ID": cid}
                    for h, cid in batch.items()}

        def fake_get_recent_video_ids(handle, limit=15, session=None):
            self.scraped.append(handle)
            return []

        for name, fn in (
            ("get_channels_data", fake_get_channels_data),
            ("get_recent_video_ids", fake_get_recent_video_ids),
            ("get_videos_data", lambda ids, youtube=None: {}),
        ):
            saved = getattr(pipeline, name)
            setattr(pipeline, name, fn)
            self.addCleanup(lambda n=name, s=saved: setattr(pipeline, n, s))

    def _known(self, handle, channel_id, subscribers):
        """A handle the store already knows, so `force_refetch_by_handle`
        resolves it without the API-lookup branch."""
        store.record_channel_discovery(self.conn, handle, channel_id, "k1")
        self.conn.execute("UPDATE channels SET subscribers=? WHERE channel_id=?",
                          (subscribers, channel_id))
        self.conn.commit()
        self.subs[handle] = subscribers

    def test_below_floor_is_swept_and_never_scraped(self):
        self._known("@tiny", "UC_tiny", "1200")
        result = pipeline.run_manual_refetch(
            self.conn, ["@tiny"], keyword="k1", auto_clean=True)
        self.assertEqual(result["swept"], ["@tiny"])
        self.assertEqual(result["processed"], [])
        self.assertTrue(store.is_archived(self.conn, "UC_tiny"))
        self.assertIsNone(store.get_channel_row(self.conn, "UC_tiny"))
        self.assertNotIn("@tiny", self.scraped)
        row = self.conn.execute(
            "SELECT label, subscribers, found_via FROM channel_archive "
            "WHERE channel_id='UC_tiny'").fetchone()
        self.assertEqual(row["label"], "inactive")
        self.assertEqual(row["subscribers"], "1200")
        self.assertEqual(json.loads(row["found_via"])[0]["keyword"], "k1")

    def test_above_ceiling_is_deferred_not_scraped_not_archived(self):
        self._known("@huge", "UC_huge", "9000000")
        result = pipeline.run_manual_refetch(
            self.conn, ["@huge"], keyword="k1", auto_clean=True)
        self.assertEqual(result["deferred"], ["@huge"])
        self.assertEqual(result["processed"], [])
        self.assertFalse(store.is_archived(self.conn, "UC_huge"))
        # Still a live channel, but with no uploads read -- so the video
        # backfill backlog owns it.
        self.assertIsNone(
            store.get_channel_row(self.conn, "UC_huge")["videos_fetched_at"])
        self.assertNotIn("@huge", self.scraped)

    def test_in_range_is_fetched_normally(self):
        self._known("@mid", "UC_mid", "250000")
        result = pipeline.run_manual_refetch(
            self.conn, ["@mid"], keyword="k1", auto_clean=True)
        self.assertEqual(result["processed"], ["@mid"])
        self.assertEqual((result["swept"], result["deferred"]), ([], []))
        self.assertIn("@mid", self.scraped)
        self.assertIsNotNone(
            store.get_channel_row(self.conn, "UC_mid")["videos_fetched_at"])

    def test_auto_clean_off_leaves_every_band_alone(self):
        self._known("@tiny", "UC_tiny", "1200")
        self._known("@huge", "UC_huge", "9000000")
        result = pipeline.run_manual_refetch(
            self.conn, ["@tiny", "@huge"], keyword="k1", auto_clean=False)
        self.assertEqual(sorted(result["processed"]), ["@huge", "@tiny"])
        self.assertEqual((result["swept"], result["deferred"]), ([], []))
        self.assertFalse(store.is_archived(self.conn, "UC_tiny"))
        self.assertEqual(sorted(self.scraped), ["@huge", "@tiny"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
