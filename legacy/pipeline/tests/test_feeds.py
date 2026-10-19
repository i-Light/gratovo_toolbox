"""Tests for gratovo.feeds -- the RSS/Atom parser.

Run with:  python tests/test_feeds.py    (from pipeline/)

Plain unittest and no network. The fixtures below are cut down from the shapes
real trade-press feeds actually send, including the awkward parts: Atom's
namespaced tags and href links, RSS dates with a timezone name rather than an
offset, summaries containing inline HTML, and items with no date or no id at
all. Those irregularities are the entire reason this parser exists, so they are
what it is tested against.
"""

import gzip
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import feeds  # noqa: E402


RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Trade Press</title>
    <item>
      <title>Creator fund doubles</title>
      <link>https://example.com/a</link>
      <guid isPermaLink="false">post-1</guid>
      <pubDate>Mon, 05 Jan 2026 10:00:00 +0000</pubDate>
      <dc:creator>A Reporter</dc:creator>
      <description>Some &lt;b&gt;bold&lt;/b&gt; news about &amp; things.</description>
    </item>
    <item>
      <title>Timezone named, not offset</title>
      <link>https://example.com/b</link>
      <guid>post-2</guid>
      <pubDate>Tue, 06 Jan 2026 09:30:00 GMT</pubDate>
    </item>
    <item>
      <title>No date at all</title>
      <link>https://example.com/c</link>
      <guid>post-3</guid>
    </item>
    <item>
      <title>No guid, falls back to the link</title>
      <link>https://example.com/d</link>
    </item>
    <item>
      <link>https://example.com/e</link>
      <guid>post-5</guid>
    </item>
    <item>
      <title>No identity at all</title>
    </item>
  </channel>
</rss>
"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:media="http://search.yahoo.com/mrss/">
  <title>Example Atom Feed</title>
  <entry>
    <title>Platform changes its rules</title>
    <link rel="alternate" href="https://example.org/one"/>
    <id>tag:example.org,2026:1</id>
    <published>2026-01-05T10:00:00Z</published>
    <summary>A summary with an <a href="https://x.test">inline link</a> in it.</summary>
    <media:thumbnail url="https://example.org/one.jpg"/>
  </entry>
  <entry>
    <title>Updated only, never published</title>
    <link rel="alternate" href="https://example.org/two"/>
    <id>tag:example.org,2026:2</id>
    <updated>2026-01-06T08:00:00+02:00</updated>
  </entry>
</feed>
"""


class ParseDateTests(unittest.TestCase):
    def test_rfc3339_with_z(self):
        parsed = feeds.parse_date("2026-01-05T10:00:00Z")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.year, 2026)
        self.assertIsNotNone(parsed.tzinfo)

    def test_rfc3339_with_offset(self):
        parsed = feeds.parse_date("2026-01-06T08:00:00+02:00")
        self.assertEqual(parsed.hour, 8)
        self.assertIsNotNone(parsed.tzinfo)

    def test_rfc822_with_offset(self):
        parsed = feeds.parse_date("Mon, 05 Jan 2026 10:00:00 +0000")
        self.assertEqual(parsed.day, 5)
        self.assertIsNotNone(parsed.tzinfo)

    def test_rfc822_with_timezone_name(self):
        # The shape that produces a NAIVE datetime on some interpreters, which
        # would then compare-fail against every aware one it is sorted with.
        parsed = feeds.parse_date("Tue, 06 Jan 2026 09:30:00 GMT")
        self.assertIsNotNone(parsed)
        self.assertIsNotNone(parsed.tzinfo)

    def test_unparseable_is_none_not_now(self):
        # The important one. Stamping an unreadable date with the current time
        # would sort a years-old item to the top of the page, and it would stay
        # there, re-stamped, after every refresh.
        for value in ("", None, "last Tuesday", "0000-00-00"):
            self.assertIsNone(feeds.parse_date(value), value)


class ParseRssTests(unittest.TestCase):
    def setUp(self):
        self.title, self.items = feeds.parse(RSS, "https://example.com/feed")
        self.by_guid = {item["guid"]: item for item in self.items}

    def test_reads_the_feed_title(self):
        self.assertEqual(self.title, "Example Trade Press")

    def test_skips_items_with_no_title(self):
        titles = [item["title"] for item in self.items]
        self.assertNotIn(None, titles)
        # 'post-5' has a link and a guid but no title, and 'No identity at all'
        # has a title but neither link nor guid.
        self.assertNotIn("post-5", self.by_guid)
        self.assertEqual(len(self.items), 4)

    def test_falls_back_to_the_link_as_identity(self):
        self.assertIn("https://example.com/d", self.by_guid)

    def test_unescapes_and_strips_html_from_the_summary(self):
        summary = self.by_guid["post-1"]["summary"]
        self.assertIn("bold", summary)
        self.assertNotIn("<b>", summary)
        self.assertNotIn("&lt;", summary)
        self.assertIn("&", summary)

    def test_reads_the_author(self):
        self.assertEqual(self.by_guid["post-1"]["author"], "A Reporter")

    def test_keeps_a_dateless_item_dateless(self):
        self.assertIsNone(self.by_guid["post-3"]["published_at"])
        self.assertIsNotNone(self.by_guid["post-1"]["published_at"])


class ParseAtomTests(unittest.TestCase):
    def setUp(self):
        self.title, self.items = feeds.parse(ATOM, "https://example.org/feed")
        self.by_guid = {item["guid"]: item for item in self.items}

    def test_reads_namespaced_entries(self):
        self.assertEqual(self.title, "Example Atom Feed")
        self.assertEqual(len(self.items), 2)

    def test_takes_the_link_from_the_href_attribute(self):
        item = self.by_guid["tag:example.org,2026:1"]
        self.assertEqual(item["link"], "https://example.org/one")

    def test_keeps_text_after_an_inline_element(self):
        # .text alone stops at the first child, which would truncate this
        # summary at "A summary with an".
        summary = self.by_guid["tag:example.org,2026:1"]["summary"]
        self.assertIn("inline link", summary)
        self.assertIn("in it", summary)

    def test_reads_a_media_thumbnail(self):
        item = self.by_guid["tag:example.org,2026:1"]
        self.assertEqual(item["image_url"], "https://example.org/one.jpg")

    def test_falls_back_from_published_to_updated(self):
        item = self.by_guid["tag:example.org,2026:2"]
        self.assertIsNotNone(item["published_at"])


class DecompressTests(unittest.TestCase):
    """A real feed (Tubefilter) gzips its response without being asked to and
    without always saying so, which reached the XML parser as binary and failed
    at column 0 with an error pointing nowhere near the cause."""

    def test_passes_plain_bytes_through(self):
        self.assertEqual(feeds._decompress(b"<rss/>", None), b"<rss/>")

    def test_gunzips_when_the_header_says_so(self):
        packed = gzip.compress(b"<rss/>")
        self.assertEqual(feeds._decompress(packed, "gzip"), b"<rss/>")

    def test_gunzips_when_the_header_does_not_say_so(self):
        # The case that actually happens. A server that gzips without being
        # asked is the same server that omits the header.
        packed = gzip.compress(b"<rss/>")
        self.assertEqual(feeds._decompress(packed, None), b"<rss/>")

    def test_inflates_deflate(self):
        self.assertEqual(
            feeds._decompress(zlib.compress(b"<rss/>"), "deflate"), b"<rss/>")

    def test_inflates_raw_deflate_without_a_zlib_header(self):
        compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        raw = compressor.compress(b"<rss/>") + compressor.flush()
        self.assertEqual(feeds._decompress(raw, "deflate"), b"<rss/>")

    def test_corrupt_gzip_reports_a_readable_reason(self):
        with self.assertRaises(feeds.FeedError) as caught:
            feeds._decompress(b"\x1f\x8b\x08garbage", "gzip")
        self.assertIn("gzipped", str(caught.exception))


class MalformedTests(unittest.TestCase):
    def test_non_xml_raises_a_readable_error(self):
        with self.assertRaises(feeds.FeedError) as caught:
            feeds.parse(b"<html>not a feed", "https://example.com/feed")
        self.assertIn("not valid XML", str(caught.exception))

    def test_an_empty_but_valid_feed_is_not_an_error(self):
        title, items = feeds.parse(
            '<?xml version="1.0"?><rss version="2.0"><channel>'
            "<title>Quiet</title></channel></rss>",
            "https://example.com/feed")
        self.assertEqual(title, "Quiet")
        self.assertEqual(items, [])

    def test_a_very_long_summary_is_trimmed(self):
        long_feed = (
            '<?xml version="1.0"?><rss version="2.0"><channel><item>'
            "<title>Long</title><guid>g</guid>"
            "<description>%s</description>"
            "</item></channel></rss>" % ("word " * 5000)
        )
        _, items = feeds.parse(long_feed, "https://example.com/feed")
        self.assertLessEqual(len(items[0]["summary"]), 1000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
