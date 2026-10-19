"""Tests for Config.country_filter -- the run's target-country set.

Run with:  python tests/test_country_filter.py    (from pipeline/)

The app now sends a `countries` list (multi-select). The property turns it into
a normalized set, still accepts the legacy single `country` string, and returns
None for "any country".
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config  # noqa: E402


class CountryFilterTest(unittest.TestCase):
    def _filter_for(self, run_config):
        cfg = config.Config()
        cfg.run_config = run_config
        return cfg.country_filter

    def test_countries_list_becomes_a_normalized_set(self):
        self.assertEqual(
            self._filter_for({"countries": [" us ", "gb", "ca"]}),
            {"US", "GB", "CA"},
        )

    def test_legacy_single_country_string_still_works(self):
        self.assertEqual(self._filter_for({"country": "eg"}), {"EG"})

    def test_countries_wins_over_legacy_country(self):
        self.assertEqual(
            self._filter_for({"countries": ["US"], "country": "EG"}),
            {"US"},
        )

    def test_empty_or_missing_means_any_country(self):
        self.assertIsNone(self._filter_for({}))
        self.assertIsNone(self._filter_for({"countries": []}))
        self.assertIsNone(self._filter_for({"countries": ["", "  "]}))
        self.assertIsNone(self._filter_for({"country": ""}))


if __name__ == "__main__":
    unittest.main()
