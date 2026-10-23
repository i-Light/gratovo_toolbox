"""The live case (plan step 6; 3e-3 plan D6, D10): what the Comms queue hands the engine -- the
creator's facts and latest video from pipeline.db, and from main's `facts` the thread, the deal,
the brand and the agency's own facts -- plus the policy the engine refuses on before asking Gemini
anything (HC-08, HC-09, BRD-PRES-15).

The old tests seeded the app's tables in the one local file; the app's side now comes in `facts`,
so each test builds that instead. The thread messages are invented, in the course's style: never
real mailbox content.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline import store
from gratovo_pipeline.comms import live_case, readiness

READY_KIT: dict[str, Any] = {
    "countries": [{"code": "US", "pct": 30}],
    "ageBand": "18-34",
    "rates": [{"format": "integration", "price": 900, "agreed": True}],
}

AGENCY: dict[str, Any] = {
    "name": "Gratovo",
    "sender": "Moustafa",
    "whatWeDo": "We find sponsors for AI creators.",
    "website": "https://gratovo.com",
    "trueClaims": ["We are a small agency."],
    "pastCampaigns": [],
    "incubator": True,
    "boycott": {"countries": ["IL"], "brands": ["Wix"]},
}

TODAY = "2026-10-18"


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(c)
    c.execute(
        "INSERT INTO channels (channel_id, handle, name, subscribers, country, first_seen_at, "
        "median_views_last_30, videos_last_30) VALUES "
        "('UC_a', '@aiguy', 'AI Guy', '120000', 'US', 'T', 90000, 4)"
    )
    c.execute(
        "INSERT INTO videos (video_id, channel_id, title, published_at, view_count, description) "
        "VALUES ('v1', 'UC_a', 'I tested every AI coding tool', '2026-10-10T00:00:00Z', '80000', "
        "'tools')"
    )
    c.commit()
    yield c
    c.close()


def facts(**fields: Any) -> dict[str, Any]:
    """Main's side of the case: the agency set up, nothing else, unless a test says so."""
    base: dict[str, Any] = {
        "agency": AGENCY,
        "thread": None,
        "creators": {},
        "brand": None,
        "deal": None,
        "recentOutbound": [],
    }
    base.update(fields)
    return base


def thread(
    tid: str,
    channel_id: str | None = None,
    brand_id: str | None = None,
    email: str | None = None,
    messages: tuple[tuple[str, str, str], ...] = (),
) -> dict[str, Any]:
    return {
        "id": tid,
        "channelId": channel_id,
        "brandId": brand_id,
        "contactEmail": email,
        "dealId": None,
        "messages": [
            {"direction": direction, "subject": "Your coding tool test", "body": body, "at": at}
            for direction, body, at in messages
        ],
    }


def state(
    stage: str | None = None, kit: dict[str, Any] | None = None, gender: str | None = None
) -> dict[str, Any]:
    return {"pipelineStage": stage, "mediaKit": kit, "creatorGender": gender}


def brand(brand_id: str, name: str, **fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": brand_id,
        "name": name,
        "website": None,
        "category": None,
        "country": None,
        "campaignBrief": None,
        "contactName": None,
        "contacts": [],
    }
    base.update(fields)
    return base


def test_a_first_email_to_a_creator(conn: sqlite3.Connection) -> None:
    moments = {"video_id": "v1", "moments": [{"at": "7:40", "quote": "Cursor won"}]}

    case = live_case.build_case(
        conn,
        {"kind": "first", "channelId": "UC_a"},
        facts(recentOutbound=["An email to someone else."]),
        today=TODAY,
        moments=moments,
    )

    assert case["side"] == "influencer"
    assert case["stage"] == "prospect"
    assert case["goal"].startswith("First email to this creator")
    assert case["counterpart"] == {
        "kind": "creator",
        "name": "AI Guy",
        "channel": "AI Guy",
        "handle": "@aiguy",
    }
    creator = case["facts"]["creator"]
    assert creator["subscribers"] == 120000
    assert creator["median_views_last_30_days"] == 90000
    assert creator["latest_video"]["title"] == "I tested every AI coding tool"
    assert creator["latest_video"]["moments"] == [{"at": "7:40", "quote": "Cursor won"}]
    assert case["facts"]["today"] == TODAY
    assert case["thread"] == []
    assert case["recent_messages"] == ["An email to someone else."]
    agency = case["agency"]
    assert agency["name"] == "Gratovo"
    assert agency["sender"] == "Moustafa"
    assert "We are a small agency." in agency["true_claims"]
    assert any("experienced agency owners" in claim for claim in agency["true_claims"]), "HC-07"
    assert "boycott" not in agency, "the boycott list is policy, not something to say"
    assert case["policy"]["creator_out_of_scope"] is False


def test_a_reply_carries_the_thread_oldest_first(conn: sqlite3.Connection) -> None:
    t1 = thread(
        "t1",
        channel_id="UC_a",
        messages=(
            ("outbound", "Hi, saw your coding tool test.", "2026-10-14T09:00:00Z"),
            ("inbound", "Sure, what brand?", "2026-10-16T10:00:00Z"),
        ),
    )
    # Main's list of our sent bodies has this thread's own opening email in it too.
    sent = ["Hi, saw your coding tool test."]

    case = live_case.build_case(
        conn,
        {"kind": "reply", "threadId": "t1"},
        facts(thread=t1, recentOutbound=sent),
        today=TODAY,
    )

    assert case["stage"] == "replied"
    assert case["goal"].startswith("Decide the next step")
    assert [(m["from"], m["body"]) for m in case["thread"]] == [
        ("us", "Hi, saw your coding tool test."),
        ("them", "Sure, what brand?"),
    ]
    assert case["thread"][1]["at"] == "2026-10-16"
    assert case["recent_messages"] == [], "the thread's own emails are not 'other' messages"


def test_the_thread_is_put_in_order_whatever_order_it_comes_in(conn: sqlite3.Connection) -> None:
    t1 = thread(
        "t1",
        channel_id="UC_a",
        messages=(
            ("inbound", "Sure, what brand?", "2026-10-16T10:00:00Z"),
            ("outbound", "Hi, saw your coding tool test.", "2026-10-14T09:00:00Z"),
        ),
    )

    case = live_case.build_case(conn, {"kind": "reply", "threadId": "t1"}, facts(thread=t1))

    assert [m["from"] for m in case["thread"]] == ["us", "them"]


def test_a_thread_that_is_not_the_one_asked_for_is_not_used(conn: sqlite3.Connection) -> None:
    other = thread("t9", channel_id="UC_b", messages=(("inbound", "Who are you?", "2026-10-16"),))

    case = live_case.build_case(conn, {"kind": "reply", "threadId": "t1"}, facts(thread=other))

    assert case["thread"] == []
    assert case["side"] == "influencer"
    assert "creator" not in case["facts"]


def test_without_a_thread_id_the_creators_latest_thread_is_used(conn: sqlite3.Connection) -> None:
    t1 = thread("t1", channel_id="UC_a", messages=(("inbound", "Sure, what brand?", "2026-10-16"),))

    case = live_case.build_case(conn, {"kind": "reply", "channelId": "UC_a"}, facts(thread=t1))

    assert [m["body"] for m in case["thread"]] == ["Sure, what brand?"]


def test_a_follow_up_says_which_one(conn: sqlite3.Connection) -> None:
    t1 = thread("t1", channel_id="UC_a", messages=(("outbound", "Hi.", "2026-10-14T09:00:00Z"),))

    case = live_case.build_case(
        conn, {"kind": "followUp", "threadId": "t1", "followUpNumber": 2}, facts(thread=t1)
    )

    assert case["stage"] == "contacted"
    assert "follow-up 2 of 3" in case["goal"]


def test_a_follow_up_without_its_number_counts_it_from_the_thread(
    conn: sqlite3.Connection,
) -> None:
    # A redo asks again without the number (final review I7): the opening email
    # and two follow-ups have gone, so this is the third and closing one.
    t1 = thread(
        "t1",
        channel_id="UC_a",
        messages=(
            ("outbound", "Hi.", "2026-10-06T09:00:00Z"),
            ("outbound", "Following up.", "2026-10-09T09:00:00Z"),
            ("outbound", "One more note.", "2026-10-14T09:00:00Z"),
        ),
    )

    case = live_case.build_case(conn, {"kind": "followUp", "threadId": "t1"}, facts(thread=t1))

    assert "follow-up 3 of 3" in case["goal"]


def test_a_follow_up_after_a_reply_counts_from_the_reply(conn: sqlite3.Connection) -> None:
    t1 = thread(
        "t1",
        channel_id="UC_a",
        messages=(
            ("outbound", "Hi.", "2026-10-06T09:00:00Z"),
            ("outbound", "Following up.", "2026-10-09T09:00:00Z"),
            ("inbound", "Maybe later.", "2026-10-10T09:00:00Z"),
            ("outbound", "Sure, here is more.", "2026-10-11T09:00:00Z"),
        ),
    )

    case = live_case.build_case(conn, {"kind": "followUp", "threadId": "t1"}, facts(thread=t1))

    assert "follow-up 1 of 3" in case["goal"]


def test_a_deal_and_its_terms_are_facts(conn: sqlite3.Connection) -> None:
    deal = {
        "brandName": "Runway",
        "stage": "negotiating",
        "creatorReceives": 2000,
        "currency": "USD",
        "deliverables": None,
        "deadline": None,
        "paymentTerms": "50% upfront",
    }
    t1 = thread("t1", channel_id="UC_a", messages=(("inbound", "My rate is 2500.", "2026-10-17"),))

    case = live_case.build_case(
        conn,
        {"kind": "reply", "threadId": "t1"},
        facts(thread=t1, deal=deal, creators={"UC_a": state("negotiating")}),
        today=TODAY,
    )

    assert case["stage"] == "negotiating"
    assert case["facts"]["deal"] == {
        "brand": "Runway",
        "stage": "negotiating",
        "creator_receives": 2000,
        "currency": "USD",
        "payment_terms": "50% upfront",
    }
    assert "brand_pays" not in case["facts"]["deal"], "the brand's price is never shown"


def test_the_case_never_carries_the_brands_price(conn: sqlite3.Connection) -> None:
    # HC-04: the margin is the agency's. Main never sends the brand's price, and if a field of it
    # ever slipped into the deal, the case still takes only the creator's side of the terms.
    deal = {
        "brandName": "Higgsfield",
        "stage": "negotiating",
        "creatorReceives": 1200,
        "currency": "USD",
        "deliverables": "one 60-second integration",
        "deadline": "2026-11-02",
        "paymentTerms": "net 15",
        "brandPrice": 3170,
        "brand_price": 3170,
    }

    case = live_case.build_case(
        conn, {"kind": "decision", "channelId": "UC_a"}, facts(deal=deal), today=TODAY
    )

    assert case["facts"]["deal"]["creator_receives"] == 1200
    assert "3170" not in json.dumps(case)


def test_an_out_of_scope_creator_is_policy(conn: sqlite3.Connection) -> None:
    case = live_case.build_case(
        conn,
        {"kind": "first", "channelId": "UC_a"},
        facts(creators={"UC_a": state(gender="couple")}),
        today=TODAY,
    )

    assert case["policy"]["creator_out_of_scope"] is True


def test_a_brand_pitch_names_who_is_ready(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO channels (channel_id, handle, name, first_seen_at) "
        "VALUES ('UC_b', '@notyet', 'Not Yet', 'T')"
    )
    conn.commit()
    runway = brand(
        "b1",
        "Runway",
        website="https://runwayml.com",
        category="AI video",
        country="US",
        contacts=[{"name": "Jack", "email": "jack@runway.ml", "primary": True}],
    )

    case = live_case.build_case(
        conn,
        {
            "kind": "first",
            "brandId": "b1",
            "contactEmail": "jack@runway.ml",
            "pitchChannelIds": ["UC_a", "UC_b"],
        },
        facts(brand=runway, creators={"UC_a": state(kit=READY_KIT)}),
        today=TODAY,
    )

    assert case["side"] == "brand"
    assert case["stage"] == "prospect"
    assert case["counterpart"] == {"kind": "brand", "company": "Runway", "name": "Jack"}
    assert case["facts"]["brand"]["category"] == "AI video"
    assert [c["handle"] for c in case["facts"]["creators"]] == ["@aiguy", "@notyet"]
    assert case["facts"]["creators"][0]["audience"]["top_countries"] == [{"code": "US", "pct": 30}]
    assert case["policy"]["not_ready"] == ["@notyet"]
    assert case["policy"]["boycott"] is None


def test_a_brand_contact_is_found_by_the_address_written_to(conn: sqlite3.Connection) -> None:
    wispr = brand(
        "b4",
        "Wispr Flow",
        contactName="Partnerships",
        contacts=[
            {"name": "Ana", "email": "ana@wisprflow.ai", "primary": True},
            {"name": "Omar", "email": "omar@wisprflow.ai"},
        ],
    )
    t4 = thread("t4", brand_id="b4", email="Omar@WisprFlow.ai")

    by_thread = live_case.build_case(
        conn, {"kind": "reply", "threadId": "t4"}, facts(brand=wispr, thread=t4)
    )
    by_primary = live_case.build_case(conn, {"kind": "first", "brandId": "b4"}, facts(brand=wispr))
    by_name = live_case.build_case(
        conn, {"kind": "first", "brandId": "b4"}, facts(brand=dict(wispr, contacts=[]))
    )

    assert by_thread["counterpart"]["name"] == "Omar"
    assert by_primary["counterpart"]["name"] == "Ana"
    assert by_name["counterpart"]["name"] == "Partnerships"


def test_a_boycotted_brand_is_policy(conn: sqlite3.Connection) -> None:
    il = live_case.build_case(
        conn,
        {"kind": "first", "brandId": "b2"},
        facts(brand=brand("b2", "Some Startup", country="IL")),
        today=TODAY,
    )
    wix = live_case.build_case(
        conn,
        {"kind": "first", "brandId": "b3"},
        facts(brand=brand("b3", "Site Builder", website="https://www.wix.com")),
        today=TODAY,
    )

    assert il["policy"]["boycott"] == "boycotted country IL"
    assert wix["policy"]["boycott"] == "on the boycott list (Wix)"


def test_the_boycott_country_default_holds_without_agency_facts(conn: sqlite3.Connection) -> None:
    # No agency set up yet (facts.agency null): IL is boycotted by default, as before.
    il = brand("b2", "Some Startup", country="il")

    case = live_case.build_case(
        conn, {"kind": "first", "brandId": "b2"}, facts(agency=None, brand=il)
    )
    no_list = live_case.build_case(
        conn, {"kind": "first", "brandId": "b2"}, facts(agency=dict(AGENCY, boycott=None), brand=il)
    )
    switched_off = live_case.build_case(
        conn,
        {"kind": "first", "brandId": "b2"},
        facts(agency=dict(AGENCY, boycott={"countries": [], "brands": []}), brand=il),
    )

    assert case["policy"]["boycott"] == "boycotted country IL"
    assert no_list["policy"]["boycott"] == "boycotted country IL"
    assert switched_off["policy"]["boycott"] is None, "an empty list is the owner's choice"


def test_a_listed_brand_is_found_by_its_words_and_its_site(conn: sqlite3.Connection) -> None:
    agency = dict(AGENCY, boycott={"countries": [], "brands": ["Zapier"]})
    by_word = brand("b5", "Zapier Agents", country="US")
    by_site = brand("b6", "Automation Co", website="https://zapier.com/agents")
    clean = brand("b7", "invideo", website="https://invideo.io", country="US")

    def boycott(b: dict[str, Any]) -> object:
        request = {"kind": "first", "brandId": b["id"]}
        return live_case.build_case(conn, request, facts(agency=agency, brand=b))["policy"][
            "boycott"
        ]

    assert boycott(by_word) == "on the boycott list (Zapier)"
    assert boycott(by_site) == "on the boycott list (Zapier)"
    assert boycott(clean) is None


def test_the_steer_panel_and_the_cash_offer_switch(conn: sqlite3.Connection) -> None:
    case = live_case.build_case(
        conn,
        {
            "kind": "first",
            "channelId": "UC_a",
            "cashOffer": True,
            "steer": {
                "reader": "manager",
                "english": "nonnative",
                "note": "They sell a course too.",
            },
        },
        facts(),
        today=TODAY,
    )

    assert case["side"] == "manager"
    assert case["counterpart"]["kind"] == "manager"
    assert case["house_choices"] == {"HC-10": "yes"}
    assert "Their English: non-native" in case["employee_note"]
    assert "They sell a course too." in case["employee_note"]


def test_an_agency_with_no_facts_yet_gets_placeholders(conn: sqlite3.Connection) -> None:
    case = live_case.build_case(
        conn, {"kind": "first", "channelId": "UC_a"}, facts(agency=None), today=TODAY
    )

    assert case["agency"]["name"] == "[Agency]"
    assert case["agency"]["sender"] == "[Your name]"
    assert live_case.INCUBATOR_CLAIM in case["agency"]["true_claims"], "HC-07's default"


def test_the_incubator_claim_can_be_turned_off(conn: sqlite3.Connection) -> None:
    case = live_case.build_case(
        conn, {"kind": "first", "channelId": "UC_a"}, facts(agency=dict(AGENCY, incubator=False))
    )

    assert case["agency"]["true_claims"] == ["We are a small agency."]


def test_the_policy_never_reaches_the_prompt(conn: sqlite3.Connection) -> None:
    from gratovo_pipeline.comms import engine

    case = live_case.build_case(
        conn,
        {"kind": "first", "brandId": "b2"},
        facts(brand=brand("b2", "Some Startup", country="IL")),
    )

    assert "policy" in case
    assert "policy" not in engine.CASE_FIELDS


@pytest.mark.parametrize(
    "garbage",
    [
        None,
        {},
        {
            "agency": "Gratovo",
            "thread": ["t1"],
            "creators": "UC_a",
            "brand": 7,
            "deal": "big",
            "recentOutbound": "Hi there",
        },
        {
            "agency": {
                "name": 5,
                "sender": ["Moustafa"],
                "whatWeDo": {},
                "website": 1,
                "trueClaims": "We are small.",
                "pastCampaigns": "lots",
                "incubator": "yes",
                "boycott": {"countries": "IL", "brands": [None, 3]},
            },
            "thread": {"id": "t1", "messages": [None, {"direction": 3, "body": 9, "at": 1}]},
            "creators": {
                "UC_a": {"mediaKit": "not a kit", "creatorGender": 1, "pipelineStage": ["x"]}
            },
            "brand": {"id": "b1", "name": None, "contacts": "jack@runway.ml", "country": 44},
            "deal": {"brandName": 1, "creatorReceives": "a lot", "stage": None},
            "recentOutbound": [None, 7, "Hi there"],
        },
    ],
)
def test_missing_or_garbage_facts_never_raise(conn: sqlite3.Connection, garbage: Any) -> None:
    for request in (
        {"kind": "reply", "threadId": "t1", "channelId": "UC_a"},
        {"kind": "first", "brandId": "b1", "pitchChannelIds": ["UC_a", "UC_none"]},
        {"kind": "followUp", "channelId": "UC_a"},
        {"kind": "decision", "channelId": "UC_none"},
    ):
        case = live_case.build_case(conn, request, garbage, today=TODAY)
        assert case["agency"]["sender"] == "[Your name]"
        assert case["goal"]


def test_a_request_with_garbage_in_it_never_raises(conn: sqlite3.Connection) -> None:
    case = live_case.build_case(
        conn,
        {
            "kind": 5,
            "channelId": "UC_a",
            "followUpNumber": "two",
            "pitchChannelIds": "UC_a",
            "steer": {"stage": ["x"], "reader": {}, "channel": 3, "note": 7},
        },
        facts(),
    )

    assert case["side"] == "influencer"
    assert case["channel"] == "email"
    assert case["employee_note"] == ""


def test_readiness_matches_the_app() -> None:
    assert readiness.missing(READY_KIT, None) == []
    assert readiness.missing(None, None) == ["analytics", "agreed rate"]
    assert readiness.missing(dict(READY_KIT, countries=[{"code": "IN", "pct": 70}]), None) == [
        "audience"
    ]
    assert readiness.missing(READY_KIT, "female") == ["out of scope"]
