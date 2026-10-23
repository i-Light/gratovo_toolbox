"""Deterministic message checks (comms/checks.py), 2026-10-15: a long dash blocks (FND-FMT-04), a
hyphen does not.

The copy check (FND-WRITE-15) reads the course from the owner's folder (plan D8). These tests never
use the real course: by default there is none, and the tests that need course text point it at the
invented course in `tests/course_fixture/`."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import checks, course, playbook

FIXTURE = Path(__file__).parent / "course_fixture"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv("GRATOVO_COURSE_DIR", raising=False)
    monkeypatch.delenv("GRATOVO_VIDEO_DIR", raising=False)
    course.configure(None, None)
    yield
    course.configure(None, None)


@pytest.fixture
def fixture_course() -> None:
    course.configure(FIXTURE / "course", FIXTURE / "videos")


def codes(body: str, subject: str = "", case: dict[str, Any] | None = None) -> set[str]:
    case = case or {
        "side": "brand",
        "stage": "negotiating",
        "thread": [{"from": "them", "body": "Send us the rate."}],
    }
    return {f["code"] for f in checks.check(case, {"message": {"subject": subject, "body": body}})}


def test_a_long_dash_blocks_in_the_body_or_the_subject() -> None:
    assert "EM_DASH" in codes("Thanks for the reply \u2014 the rate holds for March.")
    assert "EM_DASH" in codes("Thanks for the reply.", subject="March \u2014 rate")
    blocking = checks.blocking(
        checks.check(
            {"thread": [{"from": "them", "body": "x"}], "stage": "negotiating"},
            {"message": {"body": "Fine \u2014 done."}},
        )
    )
    assert any(f["rule"] == "FND-FMT-04" for f in blocking)


def test_a_hyphen_is_fine() -> None:
    assert "EM_DASH" not in codes("A follow-up on the long-form video, as discussed.")


def test_sender_centred_openers_block() -> None:
    # The old OPENERS held backspace characters where `\b` was meant: only the first one matched.
    for body in (
        "Hope this email finds you well.",
        "My name is Adam and I find sponsors for AI channels.",
        "I run an influencer marketing agency for AI creators.",
        "Just reaching out about your Zapier video.",
    ):
        assert "OPENER" in codes(body), body
    assert "OPENER" not in codes("Your Zapier agent video ran long, and it held up.")


FIRST: dict[str, Any] = {"side": "influencer", "stage": "prospect", "thread": []}
OPENER = "Hi Sam, a thought on your AI agent videos. Open to it?"


def test_overused_course_subjects_and_lines_block() -> None:
    assert "SUBJECT_PATTERN" in codes(OPENER, "Partnership request", FIRST)
    assert "SUBJECT_PATTERN" in codes(OPENER, "Quick question", FIRST)
    assert "SUBJECT_PATTERN" not in codes(OPENER, "Quick question about your Cursor setup", FIRST)
    assert "COURSE_PHRASE" in codes("Just checking if you had a chance to read my note.")


def test_a_fake_reply_subject_blocks_only_without_a_real_thread() -> None:
    assert "FAKE_REPLY" in codes(OPENER, "RE: your AI agent videos", FIRST)
    real = {
        "stage": "negotiating",
        "thread": [{"from": "them", "subject": "Rates", "body": "Here are my rates."}],
    }
    assert "FAKE_REPLY" not in codes("Thanks, that works.", "Re: Rates", real)


def test_the_cta_check_follows_house_choice_hc20() -> None:
    body = (
        "Hi Sam, your Higgsfield review was sharp.\nWe find brands for AI video channels.\n"
        "Let me know and I'll send a few names over."
    )
    assert "CTA" in codes(body, "Higgsfield talk", dict(FIRST))
    assert "CTA" not in codes(
        body, "Higgsfield talk", dict(FIRST, house_choices={"HC-20": "statement"})
    )


def test_a_case_number_rounded_the_usual_way_is_a_fact_but_a_new_number_is_not() -> None:
    # 2026-10-16: "about 63k views" for a median of 63,244 was blocked as an invented number
    case = {
        "side": "brand",
        "stage": "pitched",
        "thread": [{"from": "them", "body": "Tell me more."}],
        "facts": {"creator": {"median_views_last_30_days": 63244, "subscribers": 1830000}},
    }
    assert "FACT_NUMBER" not in codes(
        "They average about 63k views a video, with 1.8M subscribers.", case=case
    )
    assert "FACT_NUMBER" in codes("They average about 90k views a video.", case=case)
    assert "FACT_NUMBER" in codes("They average about 70k views a video.", case=case)


def test_a_segment_length_we_propose_is_not_an_invented_number() -> None:
    # 2026-10-16: asking a creator their rate "for a 60-90 second integration" (INF-PRICE-09) was
    # blocked
    case = {
        "side": "influencer",
        "stage": "contacted",
        "thread": [{"from": "them", "body": "Make me an offer."}],
        "facts": {"creator": {"median_views_last_30_days": 61725}},
    }
    for body in (
        "What would you charge for a 60-90 second integration?",
        "What is your rate for a 60 to 90 second segment?",
        "Would a 90-second integration work?",
        "A 60\u201390 sec mention, roughly?",
        "What would an integration of about 60 to 90 seconds cost?",
    ):
        assert "FACT_NUMBER" not in codes(body, case=case), body
    # a number that is not the length of a deliverable still has to come from the case
    assert "FACT_NUMBER" in codes("Your last video held viewers for 90 seconds.", case=case)
    assert "FACT_NUMBER" in codes("We can do a 600 second integration.", case=case)


def test_a_quoted_video_title_is_not_our_wording() -> None:
    # 2026-10-16: "Why Is ChatGPT OBSESSED with Goblins?" read as fan language and as a second
    # question
    case = dict(
        FIRST, facts={"creator": {"recent_videos": ["Why Is ChatGPT OBSESSED with Goblins?"]}}
    )
    body = (
        'Hi Sam,\n\n"Why Is ChatGPT OBSESSED with Goblins?" kept it light.\n\n'
        "We're thinking of pairing you with Wispr Flow.\n\nOpen to hearing more?"
    )
    found = codes(body, "goblins", case)
    assert "FAN" not in found
    assert "QUESTIONS" not in found
    # our own words are still checked
    assert "FAN" in codes(
        body.replace("kept it light", "I'm obsessed with your channel"), "goblins", case
    )


def test_a_message_reusing_a_roast_example_is_rejected_like_course_wording() -> None:
    """2026-10-16: the roast examples are 'learn from, never copy' (FND-WRITE-15). They are in the
    repository, so they are checked with no course on this computer."""
    ex = playbook.examples()[0]
    words = ex["student_email"].replace("\n", " ").split()
    lifted = " ".join(words[:12])
    assert "COPY_COURSE" in codes(f"Hi Sam, {lifted}. Open to it?", "your Cursor setup", FIRST)


def test_a_message_built_on_a_recent_message_frame_is_templated_even_with_new_names() -> None:
    # 2026-10-16 run-01: four first emails shared one frame and only the names changed
    # (FND-WRITE-01)
    earlier = (
        "Hi Leon,\n\nYour latest title on the simplest way to use Claude AI stood out.\n\n"
        "Speaking of simple setups, we're onboarding AI creators for upcoming outreach. "
        "We're looking into pitching GoDaddy and Higgsfield. Your content could be a good fit.\n\n"
        "Are you open to brand sponsorships like these?\n\nBest,\nAdam"
    )
    case = dict(
        FIRST,
        agency={"sender": "Adam", "name": "Gratovo"},
        counterpart={"name": "Sam", "channel": "Codesistency"},
        facts={"brands_in_mind": [{"name": "Zapier"}, {"name": "Vanta"}]},
        recent_messages=[earlier],
    )
    same_frame = (
        "Hi Sam,\n\nThree mobile apps in one bootcamp is a lot of value.\n\n"
        "Speaking of apps, we're onboarding AI creators for upcoming outreach. "
        "We're looking into pitching Zapier and Vanta. Your content could be a good fit.\n\n"
        "Are you open to brand sponsorships like these?\n\nBest,\nAdam"
    )
    assert "TEMPLATED" in codes(same_frame, "three apps", case)
    fresh = (
        "Hi Sam,\n\nThree mobile apps in one bootcamp is a lot of value.\n\n"
        "We set up paid sponsor slots for builders, and Zapier or Vanta would sit well next to "
        "tutorials like that.\n\nWant the details?\n\nAdam"
    )
    assert "TEMPLATED" not in codes(fresh, "three apps", case)


def test_without_recent_messages_nothing_is_templated() -> None:
    assert "TEMPLATED" not in codes(OPENER, "your Cursor setup", FIRST)


def test_view_counts_and_audience_shares_are_not_money_but_amounts_are() -> None:
    # run-01 (2026-10-16): "53k median views" and a title's "90% of people" put a price gate on
    # seven first emails
    for text in (
        "He pulls 61k median views",
        "180k views in 30 days",
        "41% of your viewers in the US, plus 12% in the UK",
        "Your title on ChatGPT settings 90% of people miss stood out",
    ):
        assert checks.money(text) is None, text
    for text in (
        "If $5k is firm",
        "5k is firm for us",
        "a small fee with your 20% code",
        "50% upfront",
        "our cut is 15%",
    ):
        assert checks.money(text), text
    # run-02 base: the second figure of "hit 850k views, past your usual 590k" is views too; a price
    # beside views is not
    assert checks.money("Your jury video hit 850k views, past your usual 590k.") is None
    assert checks.money("Your 63k viewers would love it, and 2.5k per video works for us") == "2.5k"
    # gradbar-01 (2026-10-17): "220K+ views per video" and "130K+ viewers" were gated as prices
    for text in (
        "They get 220K+ views per video on YouTube",
        "Andy reaches 130K+ viewers, mostly men in the US",
        "Each gets 200k+ views, mostly from the US",
    ):
        assert checks.money(text) is None, text
    assert checks.money("Our rate is 3k+ for a dedicated video")


def test_a_draft_greeting_someone_else_is_blocked() -> None:
    # run-01 (2026-10-16): the Matt Loui case came back with the answer written to "Mo", another
    # creator of the run
    case: dict[str, Any] = {
        "side": "influencer",
        "stage": "prospect",
        "counterpart": {"kind": "creator", "name": "Matt", "channel": "Matt Loui"},
        "facts": {},
        "thread": [],
    }
    wrong = {
        "message": {
            "subject": "x",
            "body": "Hey Mo, the jury angle stood out.\n\nAre you open to it?\n\nAdam",
        }
    }
    right = {
        "message": {
            "subject": "x",
            "body": "Hi Matt Loui,\n\nThe one-prompt advert stood out.\n\nAre you open to "
            "it?\n\nAdam",
        }
    }
    anyone = {
        "message": {
            "subject": "x",
            "body": "Hi there,\n\nThe one-prompt advert stood out.\n\nAre you open to it?\n\nAdam",
        }
    }
    assert "WRONG_PERSON" in {f["code"] for f in checks.check(case, wrong)}
    assert "WRONG_PERSON" not in {f["code"] for f in checks.check(case, right)} | {
        f["code"] for f in checks.check(case, anyone)
    }
    # a manager who answered in the thread may be greeted
    managed = dict(
        case,
        thread=[
            {"from": "us", "body": "Hi Matt"},
            {"from": "them", "body": "Hi, I'm Sarah, Matt's manager."},
        ],
    )
    to_sarah = {
        "message": {"subject": "x", "body": "Hi Sarah,\n\nThanks. What are his rates?\n\nAdam"}
    }
    assert "WRONG_PERSON" not in {f["code"] for f in checks.check(managed, to_sarah)}


def test_betting_that_does_not_call_itself_betting_raises_the_ethics_gate() -> None:
    # run-01 (2026-10-16): Kalshi's description never says "betting", and no gate was raised
    # (FND-ETH-05)
    case = {
        "facts": {
            "brand": {
                "name": "Kalshi",
                "about": "an exchange where people buy and sell contracts that pay out on "
                "the outcome of real events such as elections and sports results",
            }
        }
    }
    gates = checks.gates(case, {"needs_human": [], "message": {"body": "Hi Eli"}})
    assert "ethics" in {g["what"] for g in gates}


def test_wording_the_outbox_keeps_repeating_is_learned_and_blocked() -> None:
    # run-01 (2026-10-16): 16 of 25 first emails reused "we are onboarding", "your content could be
    # a good fit" and "are you open to"; FND-WRITE-03 asks every send to vary its sentences
    history = [
        f"Hi {n},\n\nYour {t} video stood out. We are onboarding creators for brand outreach. "
        f"Your content could be a good fit.\n\nAre you open to sponsorships?\n\nAdam"
        for n, t in (
            ("Sam", "robot"),
            ("Lee", "coding"),
            ("Ana", "editing"),
            ("Bo", "prompting"),
            ("Kai", "agents"),
        )
    ]
    phrases = checks.overused_phrases(history)
    assert any("could be a good fit" in p for p in phrases)
    assert any("onboarding creators" in p for p in phrases)
    case = {
        "side": "influencer",
        "stage": "prospect",
        "facts": {},
        "thread": [],
        "overused_phrases": phrases,
        "counterpart": {"name": "Jo"},
    }
    framed = {
        "message": {
            "subject": "x",
            "body": "Hi Jo,\n\nThe fix in your last video was neat. We are onboarding creators "
            "for brand outreach and your content could be a good fit.\n\nInterested?\n\nAdam",
        }
    }
    fresh = {
        "message": {
            "subject": "x",
            "body": "Hi Jo,\n\nThe fix in your last video was neat. I line up paid brand deals for "
            "AI channels, and yours might suit two tools I pitch.\n\nAre you open to it?\n\nAdam",
        }
    }
    assert "OVERUSED" in {f["code"] for f in checks.check(case, framed)}
    # one repeated phrase alone passes
    assert "OVERUSED" not in {f["code"] for f in checks.check(case, fresh)}
    replies = [
        "Hi Sam,\n\nThanks, $1,200 works.\n\nAdam",
        "Hi Lee,\n\nThe draft looks good, one change.\n\nAdam",
        "Hi Ana,\n\nSure, here are the dates.\n\nAdam",
    ]
    assert checks.overused_phrases(replies) == []  # too few repeats to call it a tic


NEGOTIATING: dict[str, Any] = {
    "side": "brand",
    "stage": "negotiating",
    "facts": {"deal": {"creator_rate": 2000}},
    "counterpart": {"name": "Kevin"},
    "thread": [
        {"from": "us", "body": "Hi Kevin"},
        {"from": "them", "subject": "Re: x", "body": "Our budget is $8,000."},
    ],
}


def test_a_price_in_words_is_read_as_a_price_and_asked_for_in_digits() -> None:
    # run-02 examples (2026-10-16): a $3,000 quote blocked as "not in the facts" came back as "three
    # thousand USD"
    words: dict[str, Any] = {
        "message": {
            "subject": "Re: x",
            "body": "Hi Kevin,\n\nOne integration for three thousand USD.\n\nDoes that "
            "work?\n\nAdam",
        },
        "needs_human": [],
    }
    found = {f["code"] for f in checks.check(NEGOTIATING, words)}
    assert {"NUMBER_WORDS", "FACT_NUMBER"} <= found
    assert "price" in {g["what"] for g in checks.gates(NEGOTIATING, words)}


def test_a_price_we_propose_is_allowed_when_the_price_gate_is_raised() -> None:
    body = "Hi Kevin,\n\nOne integration is $3,000.\n\nDoes that work?\n\nAdam"
    gated = {
        "message": {"subject": "Re: x", "body": body},
        "needs_human": [{"what": "price", "detail": "confirm $3,000"}],
    }
    ungated: dict[str, Any] = {"message": {"subject": "Re: x", "body": body}, "needs_human": []}
    assert "FACT_NUMBER" not in {f["code"] for f in checks.check(NEGOTIATING, gated)}
    assert "FACT_NUMBER" in {f["code"] for f in checks.check(NEGOTIATING, ungated)}


def test_a_title_with_a_number_in_words_is_the_creators_not_ours() -> None:
    case: dict[str, Any] = {
        "side": "influencer",
        "stage": "prospect",
        "counterpart": {"name": "Sam"},
        "thread": [],
        "facts": {"creator": {"recent_videos": ["One Hundred Days of Claude Code"]}},
    }
    draft = {
        "message": {
            "subject": "x",
            "body": "Hi Sam,\n\nOne Hundred Days of Claude Code was a fun watch.\n\nOpen to "
            "it?\n\nAdam",
        }
    }
    assert not {"NUMBER_WORDS", "FACT_NUMBER"} & {f["code"] for f in checks.check(case, draft)}


# --- the course on this computer, or not (plan D8) ---

CLEAN = "Hi Sam,\n\nYour Zapier agent walkthrough was clear.\n\nOpen to a sponsor for the next one?"


def test_without_the_course_the_copy_check_says_it_was_skipped_and_never_blocks() -> None:
    findings = checks.check(FIRST, {"message": {"subject": "Zapier agents", "body": CLEAN}})
    skipped = [f for f in findings if f["code"] == "COURSE_CHECK_SKIPPED"]
    assert skipped == [
        {
            "code": "COURSE_CHECK_SKIPPED",
            "severity": "warn",
            "rule": "FND-WRITE-15",
            "detail": "The course wasn't on this computer, so wording copied from it wasn't "
            "checked.",
        }
    ]
    assert checks.blocking(findings) == []


def test_with_the_course_nothing_is_skipped(fixture_course: None) -> None:
    findings = checks.check(FIRST, {"message": {"subject": "Zapier agents", "body": CLEAN}})
    assert findings == []


def test_no_message_no_findings_with_or_without_the_course() -> None:
    assert checks.check(FIRST, {"message": None}) == []


def test_a_draft_copying_eight_words_of_a_lesson_is_blocked(fixture_course: None) -> None:
    # the invented lesson says "The creator should feel that a real person watched the whole video
    # before writing to them."
    body = (
        "Hi Sam,\n\nI promise a real person watched the whole video before writing this.\n\n"
        "Open to a sponsor for the next one?"
    )
    copied = [
        f
        for f in checks.check(FIRST, {"message": {"subject": "x", "body": body}})
        if f["code"] == "COPY_COURSE"
    ]
    assert copied
    assert copied[0]["severity"] == "block"
    assert copied[0]["rule"] == "FND-WRITE-15"
    # seven words in a row are fine
    seven = body.replace(
        "watched the whole video before writing this", "watched the whole video, then wrote"
    )
    assert "COPY_COURSE" not in codes(seven, "x", FIRST)


def test_a_draft_copying_eight_words_of_a_lesson_video_is_blocked(fixture_course: None) -> None:
    # the invented video says "Today we write to creators who test AI video tools every week."
    body = (
        "Hi Sam,\n\nYou are one of the creators who test AI video tools every week.\n\nOpen to it?"
    )
    assert "COPY_COURSE" in codes(body, "x", FIRST)


def test_without_the_course_lesson_wording_is_not_caught() -> None:
    body = (
        "Hi Sam,\n\nI promise a real person watched the whole video before writing this.\n\n"
        "Open to a sponsor for the next one?"
    )
    found = codes(body, "x", FIRST)
    assert "COPY_COURSE" not in found
    assert "COURSE_CHECK_SKIPPED" in found


def test_the_rule_quotes_are_checked_with_no_course() -> None:
    quote = next(s.quote for r in playbook.rules() for s in r.src if len(s.quote.split()) >= 12)
    lifted = " ".join(quote.split()[:10])
    found = codes(f"Hi Sam,\n\n{lifted}\n\nOpen to it?", "x", FIRST)
    assert "COPY_COURSE" in found
    assert "COURSE_CHECK_SKIPPED" in found


def test_the_shingles_follow_the_course_folder() -> None:
    without = checks.course_shingles()
    course.configure(FIXTURE / "course", FIXTURE / "videos")
    with_course = checks.course_shingles()
    assert without < with_course
    assert "a real person watched the whole video before" in with_course
