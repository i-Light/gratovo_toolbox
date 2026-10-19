"""Tests for scrapetube's AWS Gateway URL rewriting.

Run with:  python tests/test_scrapetube_gateway_routing.py    (from pipeline/)
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo.scrapetube.scrapetube import _route_through_gateway  # noqa: E402

GATEWAY = "https://abc.execute-api.us-east-1.amazonaws.com"


class RouteThroughGatewayTests(unittest.TestCase):
    def test_rewrites_lowercase_origin(self):
        self.assertEqual(
            _route_through_gateway(
                "https://www.youtube.com/results?search_query=x", GATEWAY),
            GATEWAY + "/results?search_query=x",
        )

    def test_rewrites_uppercase_origin(self):
        # `pipeline.get_recent_video_ids` (what backfill uses) builds channel
        # urls as `https://www.YOUTUBE.com/{handle}` -- an existing quirk a
        # case-sensitive match would silently miss, sending the request
        # direct while the pool still credited/blamed a gateway candidate
        # for it. See `_route_through_gateway`'s own doc comment.
        self.assertEqual(
            _route_through_gateway(
                "https://www.YOUTUBE.com/@romereports/videos?view=0", GATEWAY),
            GATEWAY + "/@romereports/videos?view=0",
        )

    def test_rewrites_mixed_case_origin(self):
        self.assertEqual(
            _route_through_gateway("https://www.YouTube.com/watch?v=abc", GATEWAY),
            GATEWAY + "/watch?v=abc",
        )

    def test_non_youtube_url_untouched(self):
        other = "https://example.com/whatever"
        self.assertEqual(_route_through_gateway(other, GATEWAY), other)


if __name__ == "__main__":
    unittest.main(verbosity=2)
