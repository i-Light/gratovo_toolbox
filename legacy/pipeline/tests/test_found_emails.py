"""Emails a creator publishes in their About text and video descriptions (fix #11).

Run with:  python -m pytest tests/test_found_emails.py    (from pipeline/)

Creators write their business address in deliberately awkward forms so that
scrapers miss it -- "name (at) gmail (dot) com", "name [at] gmail [dot] com",
"name at gmail dot com", spaced or full-width signs. Each of those must be
found and normalised to a plain address; ordinary English ("look at this") and
things that only look like addresses (a retina image name, an @handle) must
not be.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import found_emails, pipeline, store  # noqa: E402

find = found_emails.find_emails


class FindEmailsTest(unittest.TestCase):
    def test_a_plain_address(self):
        self.assertEqual(find("Business: Hello@StudioAI.io"), ["hello@studioai.io"])

    def test_spelled_out_with_brackets(self):
        self.assertEqual(find("contact: jane (at) gmail (dot) com"), ["jane@gmail.com"])
        self.assertEqual(find("jane [at] gmail [dot] com"), ["jane@gmail.com"])
        self.assertEqual(find("jane{at}gmail{dot}com"), ["jane@gmail.com"])
        self.assertEqual(find("jane(AT)gmail(DOT)com"), ["jane@gmail.com"])

    def test_spelled_out_in_plain_words(self):
        self.assertEqual(find("email me: jane at gmail dot com"), ["jane@gmail.com"])
        self.assertEqual(find("biz AT aiexplained DOT co DOT uk"), ["biz@aiexplained.co.uk"])

    def test_spaced_and_full_width_signs(self):
        self.assertEqual(find("jane @ gmail . com"), ["jane@gmail.com"])
        self.assertEqual(find("jane＠gmail．com"), ["jane@gmail.com"])

    def test_dots_inside_the_name_and_domain(self):
        self.assertEqual(find("first.last (at) mail (dot) studio (dot) io"),
                         ["first.last@mail.studio.io"])

    def test_trailing_punctuation_is_not_part_of_it(self):
        self.assertEqual(find("Write to a@b.com. Thanks!"), ["a@b.com"])
        self.assertEqual(find("(a@b.com)"), ["a@b.com"])

    def test_ordinary_english_is_not_an_address(self):
        self.assertEqual(find("Look at this dot product video"), [])
        self.assertEqual(find("I'm at home, dot your i's"), [])
        self.assertEqual(find("we met at the conference, more at our site"), [])

    def test_things_that_only_look_like_addresses(self):
        self.assertEqual(find("logo@2x.png banner@3x.jpg"), [])
        self.assertEqual(find("follow @aiexplained on X"), [])
        self.assertEqual(find("https://x.com/@aiexplained"), [])

    def test_a_handle_with_dots_is_a_mention_not_an_address(self):
        # Found on real channels: "thanks @Scott.Burchell for filming",
        # "Chappy Grey @maybulls.corral". A space before "@" and none after it
        # is how a mention is written -- so "jane @gmail.com" is one too.
        self.assertEqual(find("thanks @Scott.Burchell for helping film"), [])
        self.assertEqual(find("collaborators Chappy Grey @maybulls.corral !"), [])
        self.assertEqual(find("jane @gmail.com"), [])

    def test_a_line_break_does_not_join_a_handle_to_the_next_line(self):
        self.assertEqual(find("Thanks to @MinWin3D .\n\nAdd a texture"), [])

    def test_a_capitalised_word_glued_after_the_domain_is_not_part_of_it(self):
        self.assertEqual(find("contact: jane@gmail.com.Tags: ai, tools"), ["jane@gmail.com"])

    def test_machine_addresses_are_not_contacts(self):
        self.assertEqual(find("lore.kernel.org/lkml/abc@pop-os.localdomain/"), [])

    def test_first_seen_first_and_no_repeats(self):
        self.assertEqual(
            find("About: biz@a.io", "video: biz (at) a (dot) io and team@b.io", None, ""),
            ["biz@a.io", "team@b.io"],
        )

    def test_nothing_to_read(self):
        self.assertEqual(find(), [])
        self.assertEqual(find(None, ""), [])


class DeriveChannelSignalsTest(unittest.TestCase):
    """The derive step: sponsorship and found emails together, wherever a
    channel's About text or videos change -- a fetch, an R2 download, the
    one-off backfill."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.conn = store.get_connection(str(Path(self.dir.name) / "test.db"))
        self.addCleanup(self.conn.close)
        store.init_db(self.conn)

    def channel(self, channel_id, description=None):
        self.conn.execute(
            "INSERT INTO channels (channel_id, handle, description, first_seen_at) VALUES (?, ?, ?, ?)",
            (channel_id, "@" + channel_id, description, "2026-01-01T00:00:00Z"),
        )

    def video(self, video_id, channel_id, description):
        self.conn.execute(
            "INSERT INTO videos (video_id, channel_id, description, last_fetch_status) VALUES (?, ?, ?, 'success')",
            (video_id, channel_id, description),
        )

    def found(self, channel_id):
        row = self.conn.execute(
            "SELECT found_emails, sponsored_ratio FROM channels WHERE channel_id=?", (channel_id,)
        ).fetchone()
        return json.loads(row["found_emails"]) if row["found_emails"] else None, row["sponsored_ratio"]

    def test_about_text_first_then_videos(self):
        self.channel("UC_a", "For business: biz (at) ai (dot) studio")
        self.video("v1", "UC_a", "Sponsored by NordVPN. Questions? team@ai.studio")
        self.video("v2", "UC_a", "just a video")
        self.conn.commit()

        pipeline.derive_channel_signals(self.conn, ["UC_a"])

        emails, ratio = self.found("UC_a")
        self.assertEqual(emails, ["biz@ai.studio", "team@ai.studio"])
        self.assertEqual(ratio, 0.5)

    def test_a_channel_with_no_address_gets_an_empty_list(self):
        self.channel("UC_none", "Videos about AI.")
        self.conn.commit()

        pipeline.derive_channel_signals(self.conn, ["UC_none"])

        self.assertEqual(self.found("UC_none")[0], [])

    def test_a_downloaded_channel_gets_its_signals(self):
        # The R2 path: another machine scraped this channel; the object lands
        # here through apply_channel_blob, and the derived columns must not be
        # left empty just because no local fetch ran.
        blob = {
            "channel": {"channel_id": "UC_r2", "handle": "@r2",
                        "description": "mail: r2 [at] studio [dot] ai",
                        "videos_fetched_at": "2026-10-01T00:00:00Z"},
            "videos": [{"video_id": "r1", "description": "Use code AIGUY for 10% off"}],
        }
        store.apply_channel_blob(self.conn, blob, "2026-10-01T00:00:00Z")

        pipeline.derive_channel_signals(self.conn, ["UC_r2"])

        emails, ratio = self.found("UC_r2")
        self.assertEqual(emails, ["r2@studio.ai"])
        self.assertEqual(ratio, 1.0)

    def test_the_backfill_covers_every_channel(self):
        self.channel("UC_1", "a@one.io")
        self.channel("UC_2", "b (at) two (dot) io")
        self.conn.commit()

        count = pipeline.derive_all_channel_signals(self.conn, batch=1)

        self.assertEqual(count, 2)
        self.assertEqual(self.found("UC_1")[0], ["a@one.io"])
        self.assertEqual(self.found("UC_2")[0], ["b@two.io"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
