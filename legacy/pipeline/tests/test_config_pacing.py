"""Tests for Config.delay's Normal/Fast pacing-profile switch.

Run with:  python tests/test_config_pacing.py    (from pipeline/)

`Config()` reads real files at construction time (see test_country_filter.py
for the same pattern), so every test below builds one `cfg` from whatever is
on disk and then overwrites its already-loaded `settings`/`_fast_pacing`/
`_pacing_is_fast` attributes directly -- no real settings.json, proxies, or
AWS gateway file is touched.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config  # noqa: E402

NORMAL_JITTER = {"range": [2.5, 6.0]}
FAST_JITTER = {"range": [0.5, 1.5]}


class DelayFastProfileTest(unittest.TestCase):
    def _cfg(self, pacing_is_fast, fast_pacing=None):
        cfg = config.Config()
        cfg.settings = {}
        cfg._normal_pacing = {"jitter_delay": NORMAL_JITTER}
        cfg._fast_pacing = fast_pacing or {}
        cfg._pacing_is_fast = pacing_is_fast
        return cfg

    def test_normal_profile_when_rotation_inactive(self):
        cfg = self._cfg(False, {"jitter_delay": FAST_JITTER})
        self.assertEqual(cfg.delay("jitter_delay"), NORMAL_JITTER)

    def test_fast_profile_when_rotation_active(self):
        cfg = self._cfg(True, {"jitter_delay": FAST_JITTER})
        self.assertEqual(cfg.delay("jitter_delay"), FAST_JITTER)

    def test_fast_profile_missing_key_falls_back_to_normal(self):
        # A fast profile that only overrides some fields (e.g. saved before
        # every field had a fast override) shouldn't blank out the rest.
        cfg = self._cfg(True, {"human_scroll_delay": {"range": [0.3, 0.8]}})
        self.assertEqual(cfg.delay("jitter_delay"), NORMAL_JITTER)

    def test_empty_fast_profile_behaves_like_rotation_off(self):
        cfg = self._cfg(True, {})
        self.assertEqual(cfg.delay("jitter_delay"), NORMAL_JITTER)


class ProxyRotationActiveTest(unittest.TestCase):
    def test_disabled_flag_means_inactive_even_with_a_list(self):
        self.assertFalse(config._proxy_rotation_active(
            {"enabled": False, "list": [{"host": "1.2.3.4", "enabled": True}]}))

    def test_enabled_with_no_usable_entries_is_inactive(self):
        self.assertFalse(config._proxy_rotation_active(
            {"enabled": True, "list": []}))
        self.assertFalse(config._proxy_rotation_active(
            {"enabled": True, "list": [{"host": "", "enabled": True}]}))
        self.assertFalse(config._proxy_rotation_active(
            {"enabled": True, "list": [{"host": "1.2.3.4", "enabled": False}]}))

    def test_enabled_with_one_usable_entry_is_active(self):
        self.assertTrue(config._proxy_rotation_active(
            {"enabled": True, "list": [{"host": "1.2.3.4", "enabled": True}]}))

    def test_entry_defaults_to_enabled_when_key_missing(self):
        self.assertTrue(config._proxy_rotation_active(
            {"enabled": True, "list": [{"host": "1.2.3.4"}]}))

    def test_none_or_empty_setting_is_inactive(self):
        self.assertFalse(config._proxy_rotation_active({}))
        self.assertFalse(config._proxy_rotation_active(None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
