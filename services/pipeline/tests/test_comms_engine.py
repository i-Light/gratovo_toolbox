"""The engine's quick path (comms/engine.py): bounce, unsubscribe and out-of-office never reach
Gemini.

Pinned 2026-10-16: an auto-reply naming a return date used to get "follow up in 2 working days"
whatever the date, so a Friday reply saying "back October 21" would have been followed up on the
Tuesday, while the person was still away. FND-WRITE-05: they get their first working day back, the
follow-up comes after it."""

import inspect
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import course, engine
from gratovo_pipeline.gemini.errors import GeminiError

FIXTURE = Path(__file__).parent / "course_fixture"


@pytest.fixture(autouse=True)
def no_course(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv("GRATOVO_COURSE_DIR", raising=False)
    monkeypatch.delenv("GRATOVO_VIDEO_DIR", raising=False)
    course.configure(None, None)
    yield
    course.configure(None, None)


def case(
    body: str, today: str = "2026-10-16", subject: str = "Re: Zapier x Iswaryaa G P"
) -> dict[str, Any]:
    return {
        "side": "brand",
        "stage": "pitched",
        "facts": {"today": today},
        "thread": [
            {"from": "us", "body": "Hi Chris"},
            {"from": "them", "subject": subject, "body": body},
        ],
    }


def quick(body: str, today: str = "2026-10-16") -> dict[str, Any]:
    result = engine.quick_path(case(body, today))
    assert result is not None
    return result


def follow(body: str, today: str = "2026-10-16") -> int:
    result = quick(body, today)
    assert result["proposal"]["situation"]["reply_type"] == "any.out_of_office"
    assert result["proposal"]["message"] is None
    days: int = result["proposal"]["follow_up"]["in_working_days"]
    return days


def test_out_of_office_waits_for_a_working_day_after_the_return_date() -> None:
    # Friday 16 Oct; back Wednesday 21 Oct; Wednesday is their window, Thursday 22 is the 4th
    # working day
    assert follow("I'm out of office until October 21 with limited access to email.") == 4
    assert follow("Out of office, back on 21st Oct.") == 4
    assert follow("Automatic reply: away until 10/21.") == 4


def test_a_return_on_a_weekend_counts_from_the_monday() -> None:
    # back Saturday 24 Oct -> Monday 26 is the window, Tuesday 27 is the 7th working day after
    # Friday 16
    assert follow("Out of office until October 24.") == 7


def test_a_return_date_early_in_the_next_year() -> None:
    assert follow("On annual leave until January 5.", today="2026-12-18") > 5


def test_no_return_date_waits_a_working_week() -> None:
    assert follow("I'm on vacation with limited access to email.") == 5


def test_bounce_and_unsubscribe_close_without_a_message() -> None:
    bounce = quick("Delivery Status Notification (Failure). Address not found.")
    assert bounce["proposal"]["decision"]["action"] == "close_lost"
    assert bounce["proposal"]["message"] is None
    stop = quick("Please remove me from your list.")
    assert stop["proposal"]["situation"]["reply_type"] == "any.unsubscribe"
    assert stop["proposal"]["message"] is None


def test_a_real_reply_is_not_a_quick_path() -> None:
    assert engine.quick_path(case("Thanks, what are the creator's numbers?")) is None


class FakeGemini:
    """Answers each send with the next text; records what was sent."""

    def __init__(self, *texts: str) -> None:
        self.texts: list[str] = list(texts)
        self.sent: list[dict[str, Any]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        if method == "get_conversation":  # the tab shows the last prompt sent, then its answer
            return [
                {"role": "user", "text": self.sent[-1]["text"]},
                {"role": "model", "text": "answer"},
            ]
        self.sent.append(params or {})
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


GOOD = (
    "```json\n"
    '{"situation": {"side": "influencer", "stage": "contacted", "reply_type": '
    '"inf.asks_price_from_us", "summary": "s"},\n'
    ' "decision": {"action": "send_message", "why": "w", "rules": '
    '["INF-PRICE-09"]},\n'
    ' "message": {"channel": "email", "subject": "Re: hi", "body": "Hi Sam,\n'
    "\n"
    "What do you usually charge for a sponsored segment?\n"
    "\n"
    'Adam"},\n'
    ' "needs_human": [], "follow_up": {"in_working_days": 2, "note": null}, '
    '"facts_used": []}\n'
    "```"
)

# 2026-10-16 (run-01, inf-price-us-1): the reply came back in another shape and was filed as "no
# message"
OTHER_SHAPE = (
    "```json\n"
    '{"side": "influencer", "decision": "reply", "reply": {"subject": "Re: hi", '
    '"body": "Hi Sam, what do you charge?"}}\n'
    "```"
)

REPLY_CASE: dict[str, Any] = {
    "side": "influencer",
    "stage": "contacted",
    "facts": {"today": "2026-10-16"},
    "thread": [
        {"from": "us", "body": "Hi Sam"},
        {"from": "them", "subject": "Re: hi", "body": "Make me an offer."},
    ],
}


def test_an_answer_in_another_shape_is_asked_again_with_the_format_spelled_out() -> None:
    g = FakeGemini(OTHER_SHAPE, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready"
    assert result["proposal"]["message"]["body"].startswith("Hi Sam")
    assert len(g.sent) == 2
    assert "not in the required format" in g.sent[1]["text"]
    assert g.sent[1]["newChat"] is False


def test_an_answer_that_stays_in_another_shape_is_blocked_not_silently_empty() -> None:
    g = FakeGemini(OTHER_SHAPE, OTHER_SHAPE, OTHER_SHAPE, OTHER_SHAPE)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "blocked"
    assert result["findings"][0]["code"] == "UNPARSED"
    assert "decision" in result["findings"][0]["detail"]
    assert [s["newChat"] for s in g.sent] == [
        True,
        False,
        True,
        False,
    ]  # the case asked again in a fresh chat


def test_a_chat_stuck_in_another_shape_gets_the_case_once_more_in_a_fresh_chat() -> None:
    # run-03 (2026-10-17): a bare {subject, body} twice in one chat, though the format was spelled
    # out between
    g = FakeGemini(OTHER_SHAPE, OTHER_SHAPE, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] != "blocked"
    assert result["rounds"] == 3
    assert g.sent[2]["newChat"] is True
    refs = [s["text"].rsplit("(case ref ", 1)[1] for s in g.sent]
    assert refs[0] == refs[1] != refs[2]


def test_shape_problems_names_what_is_wrong() -> None:
    assert engine.shape_problems(
        {"situation": {}, "decision": {"action": "send_message"}, "message": None}
    ) == ["decision.action is send_message but 'message' is null"]
    problems = engine.shape_problems(
        {"situation": {}, "decision": {"action": "reply"}, "message": None}
    )
    assert any("not one of" in p for p in problems)


def test_the_write_variant_rewrites_the_message_in_the_same_chat_and_keeps_the_action() -> None:
    rewritten = (
        GOOD.replace(
            "What do you usually charge for a sponsored segment?", "What's your rate for a segment?"
        )
        .replace('"action": "send_message"', '"action": "close_lost"')
        .replace('"rules": ["INF-PRICE-09"]', '"rules": ["FND-WRITE-25"]')
    )
    g = FakeGemini(GOOD, rewritten)
    result = engine.propose(g, REPLY_CASE, variant="write")
    assert "What's your rate" in result["proposal"]["message"]["body"]
    assert (
        result["proposal"]["decision"]["action"] == "send_message"
    )  # the action stays the first pass's
    assert result["proposal"]["decision"]["rules"] == ["INF-PRICE-09", "FND-WRITE-25"]
    assert result["first_draft"]["body"].endswith("Adam")
    assert result["variant"] == "write"
    assert len(g.sent) == 2
    assert g.sent[1]["newChat"] is False
    assert "About" in g.sent[1]["text"]


def test_auto_writes_a_first_message_twice_and_answers_a_reply_in_one_pass() -> None:
    # run-03 (2026-10-17): write won first emails 7-1, base won replies 7-4
    rewritten = GOOD.replace(
        "What do you usually charge for a sponsored segment?", "What's your rate for a segment?"
    )
    g = FakeGemini(
        GOOD, rewritten, rewritten, rewritten
    )  # spares: a reply-shaped answer to a first message is repaired
    first = engine.propose(g, dict(REPLY_CASE, thread=[]), variant="auto")
    assert first["variant"] == "write"
    assert g.sent[1]["newChat"] is False
    assert "About" in g.sent[1]["text"]
    g = FakeGemini(GOOD)
    reply = engine.propose(g, REPLY_CASE, variant="auto")
    assert len(g.sent) == 1
    assert reply["variant"] == "base"


def test_the_write_pass_sees_the_reply_types_key_rules_and_may_add_a_gate() -> None:
    # plan §7b machine tier: the rules the situations map names for the reply type are looked up,
    # not recalled
    gated = GOOD.replace(
        '"needs_human": []', '"needs_human": [{"what": "price", "detail": "confirm the offer"}]'
    )
    g = FakeGemini(GOOD, gated)
    result = engine.propose(g, REPLY_CASE, variant="write")
    assert "KEY RULES FOR inf.asks_price_from_us" in g.sent[1]["text"]
    assert "INF-PRICE-09 (" in g.sent[1]["text"]
    assert result["proposal"]["needs_human"][0]["what"] == "price"


def test_every_send_carries_the_calls_ref() -> None:
    g = FakeGemini(OTHER_SHAPE, GOOD)
    engine.propose(g, REPLY_CASE)
    refs = {t["text"].rsplit("(case ref ", 1)[1] for t in g.sent}
    assert len(g.sent) == 2
    assert len(refs) == 1


class MisfiledGemini(FakeGemini):
    """The tab shows another case's prompt: a send reported refused had gone through (run-01,
    2026-10-16)."""

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        if method == "get_conversation":
            return [
                {"role": "user", "text": "CASE: ... (case ref 0123456789)"},
                {"role": "model", "text": "Hi Maya"},
            ]
        return super().call(method, params, timeout)


def test_an_answer_under_another_prompt_is_refused() -> None:
    with pytest.raises(GeminiError) as caught:
        engine.propose(MisfiledGemini(GOOD), REPLY_CASE)
    assert caught.value.code == "WRONG_CHAT"


def test_the_examples_variant_shows_the_closest_coach_moves_before_the_case() -> None:
    g = FakeGemini(GOOD)
    engine.propose(g, REPLY_CASE, variant="examples")
    text = g.sent[0]["text"]
    assert text.startswith("HOW COACHES ANSWERED")
    assert text.index("CASE:") > text.index("Coach's verdict")


def test_reply_length_follows_the_message_it_answers() -> None:
    assert engine.target_words({"thread": []}) == (60, 0)
    assert engine.target_words(REPLY_CASE) == (38, 4)  # "Make me an offer."
    long = dict(REPLY_CASE, thread=[{"from": "them", "body": "word " * 80}])
    assert engine.target_words(long) == (130, 80)


def test_a_no_gets_a_reconnect_in_the_calendar_not_only_in_a_note() -> None:
    # run-01 (2026-10-16): "reconnect in a future quarter" with in_working_days 0 would never come
    # back (INF-FU-06)
    no = GOOD.replace("inf.asks_price_from_us", "inf.not_interested").replace(
        '"in_working_days": 2', '"in_working_days": 0'
    )
    result = engine.propose(FakeGemini(no), REPLY_CASE)
    assert result["proposal"]["follow_up"]["in_working_days"] == engine.RECONNECT_DAYS
    assert "INF-FU-06" in result["proposal"]["follow_up"]["note"]
    named = GOOD.replace("inf.asks_price_from_us", "inf.later").replace(
        '"in_working_days": 2', '"in_working_days": 45'
    )
    assert (
        engine.propose(FakeGemini(named), REPLY_CASE)["proposal"]["follow_up"]["in_working_days"]
        == 45
    )


def test_a_later_with_no_follow_up_is_dated_from_the_month_they_named() -> None:
    later = GOOD.replace("inf.asks_price_from_us", "inf.later").replace(
        '"in_working_days": 2', '"in_working_days": 0'
    )
    later_case = dict(
        REPLY_CASE,
        thread=[
            {"from": "us", "body": "Hi Sam"},
            {
                "from": "them",
                "subject": "Re: hi",
                "body": "Fully booked this month, maybe reach out again in November?",
            },
        ],
    )
    fu = engine.propose(FakeGemini(later), later_case)["proposal"]["follow_up"]
    assert fu["in_working_days"] == 11
    assert fu["set_by"] == "engine"


def test_a_no_is_not_chased_days_later_unless_they_named_the_time() -> None:
    # run-03 (2026-10-17): "Not interested at this time, thanks." got a follow-up in 3 working days
    # (BRD-FU-05)
    soon = GOOD.replace("inf.asks_price_from_us", "inf.not_interested").replace(
        '"in_working_days": 2', '"in_working_days": 3'
    )
    fu = engine.propose(FakeGemini(soon), REPLY_CASE)["proposal"]["follow_up"]
    assert fu["in_working_days"] == engine.RECONNECT_DAYS
    assert "BRD-FU-05" in fu["note"]
    assert fu["set_by"] == "engine"
    # "ping me next week" is their own time: the model's few days stand
    later = GOOD.replace("inf.asks_price_from_us", "inf.later").replace(
        '"in_working_days": 2', '"in_working_days": 5'
    )
    next_week = dict(
        REPLY_CASE,
        thread=[
            {"from": "us", "body": "Hi Sam"},
            {"from": "them", "subject": "Re: hi", "body": "Busy this week, ping me next week?"},
        ],
    )
    assert (
        engine.propose(FakeGemini(later), next_week)["proposal"]["follow_up"]["in_working_days"]
        == 5
    )
    # with no date from the model, "in two weeks" is dated from their message: Fri 16 Oct -> Fri 30
    # Oct
    none = later.replace('"in_working_days": 5', '"in_working_days": 0')
    two_weeks = dict(
        next_week,
        thread=[
            next_week["thread"][0],
            dict(next_week["thread"][1], body="Try me again in two weeks."),
        ],
    )
    assert (
        engine.propose(FakeGemini(none), two_weeks)["proposal"]["follow_up"]["in_working_days"]
        == 10
    )


def test_the_prompt_names_the_overused_phrases_only_when_there_are_some() -> None:
    assert "overused_phrases" not in engine.case_prompt(REPLY_CASE)
    text = engine.case_prompt(
        dict(REPLY_CASE, overused_phrases=["your content could be a good fit"])
    )
    assert "use none of them" in text
    assert "your content could be a good fit" in text


GOOD_REVIEW = '```json\n{"verdict": "good", "points": [], "summary": "send it"}\n```'
MIXED_REVIEW = (
    '```json\n{"verdict": "mixed", "points": [{"rule": "FND-WRITE-25", '
    '"problem": "longer than their line", "fix": "one short question"}], "summary": "cut it"}\n```'
)


def test_a_draft_the_coach_calls_good_is_kept_as_it_is() -> None:
    g = FakeGemini(GOOD, GOOD_REVIEW)
    result = engine.propose(g, REPLY_CASE, coach_rounds=1)
    assert result["coach"][0]["verdict"] == "good"
    assert result["before_coach"] is None
    assert len(g.sent) == 2
    assert "COACH REVIEW" in g.sent[1]["text"]
    assert g.sent[1]["newChat"] is True


def test_a_draft_the_coach_objects_to_is_rewritten_once_in_a_fresh_chat_against_its_points() -> (
    None
):
    # plan §7b step 4: draft, coach critique, one rewrite; the person approving sees the final draft
    # and the notes
    revised = GOOD.replace(
        "What do you usually charge for a sponsored segment?", "What's your rate?"
    ).replace('"action": "send_message"', '"action": "close_lost"')
    g = FakeGemini(GOOD, MIXED_REVIEW, revised)
    result = engine.propose(g, REPLY_CASE, coach_rounds=1)
    third = g.sent[2]
    assert third["newChat"] is True
    assert "CASE:" in third["text"]
    assert "[FND-WRITE-25] longer than their line" in third["text"]
    assert result["proposal"]["message"]["body"].startswith("Hi Sam,\n\nWhat's your rate?")
    assert (
        result["proposal"]["decision"]["action"] == "send_message"
    )  # the action stays the first pass's
    assert "usually charge" in result["before_coach"]["body"]
    assert result["coach"][0]["verdict"] == "mixed"


def test_an_empty_first_answer_is_sent_again_in_a_fresh_chat() -> None:
    # 2026-10-16: answers that were only the skill header ("Skills: gratovo-comms"): the prompt
    # never reached the model
    g = FakeGemini("Skills: gratovo-comms", GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready"
    assert len(g.sent) == 2
    assert g.sent[1]["newChat"] is True
    assert g.sent[1]["text"] == g.sent[0]["text"]


def test_an_error_given_as_the_answer_is_raised_for_the_pool() -> None:
    with pytest.raises(GeminiError) as caught:
        engine.propose(
            FakeGemini("Sorry, something went wrong. Please try your request again."), REPLY_CASE
        )
    assert caught.value.code == "GEMINI_ERROR"


def test_a_reply_type_outside_the_situations_map_is_asked_again_with_the_ids() -> None:
    # run-02 examples (2026-10-16): "rate_quote", "budget_inquiry", "positive" in place of the map's
    # ids
    invented = GOOD.replace("inf.asks_price_from_us", "budget_inquiry")
    g = FakeGemini(invented, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready"
    assert result["proposal"]["situation"]["reply_type"] == "inf.asks_price_from_us"
    assert "'budget_inquiry' is not an id" in g.sent[1]["text"]
    assert "inf.asks_price_from_us" in g.sent[1]["text"]


def test_a_rewrite_that_relabels_the_situation_keeps_the_first_pass_label() -> None:
    relabelled = GOOD.replace("inf.asks_price_from_us", "price_question").replace(
        "What do you usually charge for a sponsored segment?", "What's your rate?"
    )
    result = engine.propose(FakeGemini(GOOD, relabelled), REPLY_CASE, variant="write")
    assert result["proposal"]["situation"]["reply_type"] == "inf.asks_price_from_us"
    assert "What's your rate?" in result["proposal"]["message"]["body"]


def test_auto_is_the_default_variant() -> None:
    # the owner's decision on the workflow map, 2026-10-18
    assert inspect.signature(engine.propose).parameters["variant"].default == "auto"


def test_policy_is_refused_before_gemini_is_asked() -> None:
    """HC-08, HC-09 and BRD-PRES-15 are not the model's to weigh: the live case marks them, and the
    engine stops there -- no Gemini call, a blocked status, and the reason a person can read."""
    policies: tuple[tuple[dict[str, Any], str], ...] = (
        ({"creator_out_of_scope": True}, "HC08_OUT_OF_SCOPE"),
        ({"boycott": "boycotted country IL"}, "HC09_BOYCOTT"),
        ({"not_ready": ["@notyet"]}, "PITCH_NOT_READY"),
    )
    for policy, code in policies:
        gemini = FakeGemini()
        result = engine.propose(gemini, dict(REPLY_CASE, policy=policy))
        assert result["status"] == "blocked", code
        assert result["findings"][0]["code"] == code
        assert gemini.sent == [], "nothing is sent to Gemini"


def test_a_clean_policy_lets_the_case_through() -> None:
    gemini = FakeGemini(GOOD)
    clean = dict(
        REPLY_CASE, policy={"creator_out_of_scope": False, "boycott": None, "not_ready": []}
    )
    result = engine.propose(gemini, clean, variant="base")
    assert result["status"] != "blocked" or result["findings"][0]["code"] not in (
        "HC08_OUT_OF_SCOPE",
        "HC09_BOYCOTT",
        "PITCH_NOT_READY",
    )
    assert len(gemini.sent) >= 1


# --- the course on this computer, or not (plan D8) ---


def test_without_the_course_the_proposal_is_still_ready_and_says_the_copy_check_was_skipped() -> (
    None
):
    result = engine.propose(FakeGemini(GOOD), REPLY_CASE)
    assert result["status"] == "ready"
    skipped = [f for f in result["findings"] if f["code"] == "COURSE_CHECK_SKIPPED"]
    assert len(skipped) == 1
    assert skipped[0]["severity"] == "warn"
    assert result["repairs"] == 0  # a warning is never sent back to Gemini to repair


def test_with_the_course_the_copy_check_runs_and_nothing_is_skipped() -> None:
    course.configure(FIXTURE / "course", FIXTURE / "videos")
    result = engine.propose(FakeGemini(GOOD), REPLY_CASE)
    assert result["status"] == "ready"
    assert result["findings"] == []


def test_a_draft_copying_a_lesson_is_sent_back_to_be_repaired() -> None:
    # the invented lesson says "a real person watched the whole video before writing to them"
    course.configure(FIXTURE / "course", FIXTURE / "videos")
    copied = GOOD.replace(
        "What do you usually charge for a sponsored segment?",
        "A real person watched the whole video before writing to you. What do you charge?",
    )
    g = FakeGemini(copied, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert "FND-WRITE-15" in g.sent[1]["text"]
    assert "COPY_COURSE" in g.sent[1]["text"]
    assert result["status"] == "ready"
    assert result["repairs"] == 1
