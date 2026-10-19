"""The live case (plan step 6): what the Comms queue hands the engine, built from gratovo.db -- the creator's facts and
latest video, the thread, the deal, the brand, the agency's own facts -- plus the policy the engine refuses on before
asking Gemini anything (HC-08, HC-09, BRD-PRES-15).

Run with:  python -m pytest tests/test_comms_live_case.py    (from pipeline/)
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comms import live_case, readiness  # noqa: E402
from gratovo import store  # noqa: E402

# The app's tables, as far as the case reads them (lib/core/sync/mirror_schema.dart).
APP_DDL = """
CREATE TABLE channel_state (channel_id TEXT PRIMARY KEY, handle TEXT, pipeline_stage TEXT, contacts TEXT,
  media_kit TEXT, creator_gender TEXT);
CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT, contact_name TEXT, contact_email TEXT, website TEXT,
  category TEXT, country TEXT, contacts TEXT, campaign_brief TEXT, budget REAL, budget_currency TEXT);
CREATE TABLE deals (id TEXT PRIMARY KEY, brand_id TEXT, channel_id TEXT, stage TEXT, brand_price REAL,
  influencer_payout REAL, currency TEXT, deliverables TEXT, deadline TEXT, payment_terms TEXT, created_at TEXT);
CREATE TABLE outreach_threads (id TEXT PRIMARY KEY, channel_id TEXT, deal_id TEXT, status TEXT, updated_at TEXT,
  brand_id TEXT, contact_email TEXT);
CREATE TABLE outreach_messages (id TEXT PRIMARY KEY, thread_id TEXT, direction TEXT, subject TEXT, body TEXT,
  at TEXT);
CREATE TABLE agency_settings (id TEXT PRIMARY KEY, body TEXT, updated_at TEXT);
"""

READY_KIT = {"countries": [{"code": "US", "pct": 30}], "ageBand": "18-34",
             "rates": [{"format": "integration", "price": 900, "agreed": True}]}


@pytest.fixture
def conn():
    with tempfile.TemporaryDirectory() as tmp:
        c = store.get_connection(str(Path(tmp) / "t.db"))
        store.init_db(c)
        c.executescript(APP_DDL)
        c.execute("INSERT INTO channels (channel_id, handle, name, subscribers, country, first_seen_at, "
                  "median_views_last_30, videos_last_30) VALUES ('UC_a', '@aiguy', 'AI Guy', '120000', 'US', 'T', 90000, 4)")
        c.execute("INSERT INTO videos (video_id, channel_id, title, published_at, view_count, description) VALUES "
                  "('v1', 'UC_a', 'I tested every AI coding tool', '2026-10-10T00:00:00Z', '80000', 'tools')")
        c.execute("INSERT INTO agency_settings VALUES ('agency', ?, 'T')", (json.dumps({
            "name": "Gratovo", "sender": "Moustafa", "what_we_do": "We find sponsors for AI creators.",
            "website": "https://gratovo.com", "true_claims": ["We are a small agency."], "past_campaigns": [],
            "incubator": True, "boycott": {"countries": ["IL"], "brands": ["Wix"]}, "daily_target": 50}),))
        c.commit()
        yield c
        c.close()


def thread(c, tid, channel_id=None, brand_id=None, email=None, messages=()):
    c.execute("INSERT INTO outreach_threads (id, channel_id, brand_id, contact_email, status) VALUES (?, ?, ?, ?, 'awaitingReply')",
              (tid, channel_id, brand_id, email))
    for i, (direction, body, at) in enumerate(messages):
        c.execute("INSERT INTO outreach_messages (id, thread_id, direction, subject, body, at) VALUES (?, ?, ?, ?, ?, ?)",
                  (f"{tid}-{i}", tid, direction, "Your coding tool test", body, at))
    c.commit()


def test_a_first_email_to_a_creator(conn):
    thread(conn, "other", channel_id="UC_b", messages=[("outbound", "An email to someone else.", "2026-10-15T09:00:00Z")])
    moments = {"video_id": "v1", "moments": [{"at": "7:40", "quote": "Cursor won"}]}

    case = live_case.build_case(conn, {"kind": "first", "channelId": "UC_a"}, today="2026-10-18", moments=moments)

    assert case["side"] == "influencer" and case["stage"] == "prospect"
    assert case["goal"].startswith("First email to this creator")
    assert case["counterpart"] == {"kind": "creator", "name": "AI Guy", "channel": "AI Guy", "handle": "@aiguy"}
    creator = case["facts"]["creator"]
    assert creator["subscribers"] == 120000 and creator["median_views_last_30_days"] == 90000
    assert creator["latest_video"]["title"] == "I tested every AI coding tool"
    assert creator["latest_video"]["moments"] == [{"at": "7:40", "quote": "Cursor won"}]
    assert case["facts"]["today"] == "2026-10-18"
    assert case["thread"] == []
    assert case["recent_messages"] == ["An email to someone else."]
    agency = case["agency"]
    assert agency["name"] == "Gratovo" and agency["sender"] == "Moustafa"
    assert "We are a small agency." in agency["true_claims"]
    assert any("experienced agency owners" in claim for claim in agency["true_claims"]), "HC-07"
    assert "boycott" not in agency, "the boycott list is policy, not something to say"
    assert case["policy"]["creator_out_of_scope"] is False


def test_a_reply_carries_the_thread_oldest_first(conn):
    thread(conn, "t1", channel_id="UC_a", messages=[
        ("outbound", "Hi, saw your coding tool test.", "2026-10-14T09:00:00Z"),
        ("inbound", "Sure, what brand?", "2026-10-16T10:00:00Z")])

    case = live_case.build_case(conn, {"kind": "reply", "threadId": "t1"}, today="2026-10-18")

    assert case["stage"] == "replied"
    assert case["goal"].startswith("Decide the next step")
    assert [(m["from"], m["body"]) for m in case["thread"]] == [
        ("us", "Hi, saw your coding tool test."), ("them", "Sure, what brand?")]
    assert case["thread"][1]["at"] == "2026-10-16"
    assert case["recent_messages"] == [], "the thread's own emails are not 'other' messages"


def test_a_follow_up_says_which_one(conn):
    thread(conn, "t1", channel_id="UC_a", messages=[("outbound", "Hi.", "2026-10-14T09:00:00Z")])

    case = live_case.build_case(conn, {"kind": "followUp", "threadId": "t1", "followUpNumber": 2}, today="2026-10-18")

    assert case["stage"] == "contacted"
    assert "follow-up 2 of 3" in case["goal"]


def test_a_follow_up_without_its_number_counts_it_from_the_thread(conn):
    # A redo asks again without the number (final review I7): the opening email
    # and two follow-ups have gone, so this is the third and closing one.
    thread(conn, "t1", channel_id="UC_a", messages=[
        ("outbound", "Hi.", "2026-10-06T09:00:00Z"),
        ("outbound", "Following up.", "2026-10-09T09:00:00Z"),
        ("outbound", "One more note.", "2026-10-14T09:00:00Z"),
    ])

    case = live_case.build_case(conn, {"kind": "followUp", "threadId": "t1"}, today="2026-10-18")

    assert "follow-up 3 of 3" in case["goal"]


def test_a_follow_up_after_a_reply_counts_from_the_reply(conn):
    thread(conn, "t1", channel_id="UC_a", messages=[
        ("outbound", "Hi.", "2026-10-06T09:00:00Z"),
        ("outbound", "Following up.", "2026-10-09T09:00:00Z"),
        ("inbound", "Maybe later.", "2026-10-10T09:00:00Z"),
        ("outbound", "Sure, here is more.", "2026-10-11T09:00:00Z"),
    ])

    case = live_case.build_case(conn, {"kind": "followUp", "threadId": "t1"}, today="2026-10-18")

    assert "follow-up 1 of 3" in case["goal"]


def test_a_deal_and_its_terms_are_facts(conn):
    conn.execute("INSERT INTO brands (id, name, country) VALUES ('b1', 'Runway', 'US')")
    conn.execute("INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, influencer_payout, currency, "
                 "payment_terms, created_at) VALUES ('d1', 'b1', 'UC_a', 'negotiating', 3000, 2000, 'USD', "
                 "'50% upfront', '2026-10-17')")
    conn.execute("INSERT INTO channel_state (channel_id, handle, pipeline_stage) VALUES ('UC_a', '@aiguy', 'negotiating')")
    conn.commit()
    thread(conn, "t1", channel_id="UC_a", messages=[("inbound", "My rate is 2500.", "2026-10-17T10:00:00Z")])

    case = live_case.build_case(conn, {"kind": "reply", "threadId": "t1"}, today="2026-10-18")

    assert case["stage"] == "negotiating"
    deal = case["facts"]["deal"]
    assert deal["brand"] == "Runway" and deal["creator_receives"] == 2000 and deal["payment_terms"] == "50% upfront"
    assert "brand_pays" not in deal, "the brand's price is never shown to the creator side"


def test_an_out_of_scope_creator_is_policy(conn):
    conn.execute("INSERT INTO channel_state (channel_id, handle, creator_gender) VALUES ('UC_a', '@aiguy', 'couple')")
    conn.commit()

    case = live_case.build_case(conn, {"kind": "first", "channelId": "UC_a"}, today="2026-10-18")

    assert case["policy"]["creator_out_of_scope"] is True


def test_a_brand_pitch_names_who_is_ready(conn):
    conn.execute("INSERT INTO brands (id, name, website, category, country, contacts) VALUES "
                 "('b1', 'Runway', 'https://runwayml.com', 'AI video', 'US', ?)",
                 (json.dumps([{"name": "Jack", "email": "jack@runway.ml", "primary": True}]),))
    conn.execute("INSERT INTO channel_state (channel_id, handle, media_kit) VALUES ('UC_a', '@aiguy', ?)",
                 (json.dumps(READY_KIT),))
    conn.execute("INSERT INTO channels (channel_id, handle, name, first_seen_at) VALUES ('UC_b', '@notyet', 'Not Yet', 'T')")
    conn.commit()

    case = live_case.build_case(conn, {"kind": "first", "brandId": "b1", "contactEmail": "jack@runway.ml",
                                       "pitchChannelIds": ["UC_a", "UC_b"]}, today="2026-10-18")

    assert case["side"] == "brand" and case["stage"] == "prospect"
    assert case["counterpart"] == {"kind": "brand", "company": "Runway", "name": "Jack"}
    assert case["facts"]["brand"]["category"] == "AI video"
    assert [c["handle"] for c in case["facts"]["creators"]] == ["@aiguy", "@notyet"]
    assert case["facts"]["creators"][0]["audience"]["top_countries"] == [{"code": "US", "pct": 30}]
    assert case["policy"]["not_ready"] == ["@notyet"]
    assert case["policy"]["boycott"] is None


def test_a_boycotted_brand_is_policy(conn):
    conn.execute("INSERT INTO brands (id, name, country) VALUES ('b2', 'Some Startup', 'IL')")
    conn.execute("INSERT INTO brands (id, name, website) VALUES ('b3', 'Site Builder', 'https://www.wix.com')")
    conn.commit()

    il = live_case.build_case(conn, {"kind": "first", "brandId": "b2"}, today="2026-10-18")
    wix = live_case.build_case(conn, {"kind": "first", "brandId": "b3"}, today="2026-10-18")

    assert il["policy"]["boycott"] == "boycotted country IL"
    assert wix["policy"]["boycott"] == "on the boycott list (Wix)"


def test_the_steer_panel_and_the_cash_offer_switch(conn):
    case = live_case.build_case(conn, {
        "kind": "first", "channelId": "UC_a", "cashOffer": True,
        "steer": {"reader": "manager", "english": "nonnative", "note": "They sell a course too."}},
        today="2026-10-18")

    assert case["side"] == "manager"
    assert case["counterpart"]["kind"] == "manager"
    assert case["house_choices"] == {"HC-10": "yes"}
    assert "Their English: non-native" in case["employee_note"]
    assert "They sell a course too." in case["employee_note"]


def test_an_agency_with_no_facts_yet_gets_placeholders(conn):
    conn.execute("DELETE FROM agency_settings")
    conn.commit()

    case = live_case.build_case(conn, {"kind": "first", "channelId": "UC_a"}, today="2026-10-18")

    assert case["agency"]["name"] == "[Agency]" and case["agency"]["sender"] == "[Your name]"


def test_readiness_matches_the_app():
    assert readiness.missing(READY_KIT, None) == []
    assert readiness.missing(None, None) == ["analytics", "agreed rate"]
    assert readiness.missing(dict(READY_KIT, countries=[{"code": "IN", "pct": 70}]), None) == ["audience"]
    assert readiness.missing(READY_KIT, "female") == ["out of scope"]
