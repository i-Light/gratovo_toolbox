"""The engine's quick path (comms/engine.py): bounce, unsubscribe and out-of-office never reach Gemini.

Pinned 2026-10-16: an auto-reply naming a return date used to get "follow up in 2 working days" whatever the
date, so a Friday reply saying "back October 21" would have been followed up on the Tuesday, while the person
was still away. FND-WRITE-05: they get their first working day back, the follow-up comes after it.
"""

import pytest

from comms import engine
from gemini_bridge.errors import GeminiError


def case(body, today="2026-10-16", subject="Re: Zapier x Iswaryaa G P"):
    return {"side": "brand", "stage": "pitched", "facts": {"today": today},
            "thread": [{"from": "us", "body": "Hi Chris"}, {"from": "them", "subject": subject, "body": body}]}


def follow(body, today="2026-10-16"):
    result = engine.quick_path(case(body, today))
    assert result["proposal"]["situation"]["reply_type"] == "any.out_of_office"
    assert result["proposal"]["message"] is None
    return result["proposal"]["follow_up"]["in_working_days"]


def test_out_of_office_waits_for_a_working_day_after_the_return_date():
    # Friday 16 Oct; back Wednesday 21 Oct; Wednesday is their window, Thursday 22 is the 4th working day
    assert follow("I'm out of office until October 21 with limited access to email.") == 4
    assert follow("Out of office, back on 21st Oct.") == 4
    assert follow("Automatic reply: away until 10/21.") == 4


def test_a_return_on_a_weekend_counts_from_the_monday():
    # back Saturday 24 Oct -> Monday 26 is the window, Tuesday 27 is the 7th working day after Friday 16
    assert follow("Out of office until October 24.") == 7


def test_a_return_date_early_in_the_next_year():
    assert follow("On annual leave until January 5.", today="2026-12-18") > 5


def test_no_return_date_waits_a_working_week():
    assert follow("I'm on vacation with limited access to email.") == 5


def test_bounce_and_unsubscribe_close_without_a_message():
    bounce = engine.quick_path(case("Delivery Status Notification (Failure). Address not found."))
    assert bounce["proposal"]["decision"]["action"] == "close_lost" and bounce["proposal"]["message"] is None
    stop = engine.quick_path(case("Please remove me from your list."))
    assert stop["proposal"]["situation"]["reply_type"] == "any.unsubscribe" and stop["proposal"]["message"] is None


def test_a_real_reply_is_not_a_quick_path():
    assert engine.quick_path(case("Thanks, what are the creator's numbers?")) is None


class FakeGemini:
    """Answers each send with the next text; records what was sent."""

    def __init__(self, *texts):
        self.texts, self.sent = list(texts), []

    def call(self, method, params, timeout=None):
        if method == "get_conversation":   # the tab shows the last prompt sent, then its answer
            return [{"role": "user", "text": self.sent[-1]["text"]}, {"role": "model", "text": "answer"}]
        self.sent.append(params)
        return {"textRaw": self.texts.pop(0), "thinking": "High", "model": "Argon"}


GOOD = """```json
{"situation": {"side": "influencer", "stage": "contacted", "reply_type": "inf.asks_price_from_us", "summary": "s"},
 "decision": {"action": "send_message", "why": "w", "rules": ["INF-PRICE-09"]},
 "message": {"channel": "email", "subject": "Re: hi", "body": "Hi Sam,\n\nWhat do you usually charge for a sponsored segment?\n\nAdam"},
 "needs_human": [], "follow_up": {"in_working_days": 2, "note": null}, "facts_used": []}
```"""

# 2026-10-16 (run-01, inf-price-us-1): the reply came back in another shape and was filed as "no message"
OTHER_SHAPE = """```json
{"side": "influencer", "decision": "reply", "reply": {"subject": "Re: hi", "body": "Hi Sam, what do you charge?"}}
```"""

REPLY_CASE = {"side": "influencer", "stage": "contacted", "facts": {"today": "2026-10-16"},
              "thread": [{"from": "us", "body": "Hi Sam"}, {"from": "them", "subject": "Re: hi", "body": "Make me an offer."}]}


def test_an_answer_in_another_shape_is_asked_again_with_the_format_spelled_out():
    g = FakeGemini(OTHER_SHAPE, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready" and result["proposal"]["message"]["body"].startswith("Hi Sam")
    assert len(g.sent) == 2 and "not in the required format" in g.sent[1]["text"] and g.sent[1]["newChat"] is False


def test_an_answer_that_stays_in_another_shape_is_blocked_not_silently_empty():
    g = FakeGemini(OTHER_SHAPE, OTHER_SHAPE, OTHER_SHAPE, OTHER_SHAPE)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "blocked"
    assert result["findings"][0]["code"] == "UNPARSED" and "decision" in result["findings"][0]["detail"]
    assert [s["newChat"] for s in g.sent] == [True, False, True, False]   # the case asked again in a fresh chat


def test_a_chat_stuck_in_another_shape_gets_the_case_once_more_in_a_fresh_chat():
    # run-03 (2026-10-17): a bare {subject, body} twice in one chat, though the format was spelled out between
    g = FakeGemini(OTHER_SHAPE, OTHER_SHAPE, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] != "blocked" and result["rounds"] == 3 and g.sent[2]["newChat"] is True
    refs = [s["text"].rsplit("(case ref ", 1)[1] for s in g.sent]
    assert refs[0] == refs[1] != refs[2]


def test_shape_problems_names_what_is_wrong():
    assert engine.shape_problems({"situation": {}, "decision": {"action": "send_message"}, "message": None}) == [
        "decision.action is send_message but 'message' is null"]
    assert any("not one of" in p for p in engine.shape_problems({"situation": {}, "decision": {"action": "reply"}, "message": None}))


def test_the_write_variant_rewrites_the_message_in_the_same_chat_and_keeps_the_action():
    rewritten = GOOD.replace("What do you usually charge for a sponsored segment?", "What's your rate for a segment?") \
                    .replace('"action": "send_message"', '"action": "close_lost"') \
                    .replace('"rules": ["INF-PRICE-09"]', '"rules": ["FND-WRITE-25"]')
    g = FakeGemini(GOOD, rewritten)
    result = engine.propose(g, REPLY_CASE, variant="write")
    assert "What's your rate" in result["proposal"]["message"]["body"]
    assert result["proposal"]["decision"]["action"] == "send_message"     # the action stays the first pass's
    assert result["proposal"]["decision"]["rules"] == ["INF-PRICE-09", "FND-WRITE-25"]
    assert result["first_draft"]["body"].endswith("Adam") and result["variant"] == "write"
    assert len(g.sent) == 2 and g.sent[1]["newChat"] is False and "About" in g.sent[1]["text"]


def test_auto_writes_a_first_message_twice_and_answers_a_reply_in_one_pass():
    # run-03 (2026-10-17): write won first emails 7-1, base won replies 7-4
    rewritten = GOOD.replace("What do you usually charge for a sponsored segment?", "What's your rate for a segment?")
    g = FakeGemini(GOOD, rewritten, rewritten, rewritten)   # spares: a reply-shaped answer to a first message is repaired
    first = engine.propose(g, dict(REPLY_CASE, thread=[]), variant="auto")
    assert first["variant"] == "write" and g.sent[1]["newChat"] is False and "About" in g.sent[1]["text"]
    g = FakeGemini(GOOD)
    reply = engine.propose(g, REPLY_CASE, variant="auto")
    assert len(g.sent) == 1 and reply["variant"] == "base"


def test_the_write_pass_sees_the_reply_types_key_rules_and_may_add_a_gate():
    # plan §7b machine tier: the rules the situations map names for the reply type are looked up, not recalled
    gated = GOOD.replace('"needs_human": []', '"needs_human": [{"what": "price", "detail": "confirm the offer"}]')
    g = FakeGemini(GOOD, gated)
    result = engine.propose(g, REPLY_CASE, variant="write")
    assert "KEY RULES FOR inf.asks_price_from_us" in g.sent[1]["text"] and "INF-PRICE-09 (" in g.sent[1]["text"]
    assert result["proposal"]["needs_human"][0]["what"] == "price"


def test_every_send_carries_the_calls_ref():
    g = FakeGemini(OTHER_SHAPE, GOOD)
    engine.propose(g, REPLY_CASE)
    refs = {t["text"].rsplit("(case ref ", 1)[1] for t in g.sent}
    assert len(g.sent) == 2 and len(refs) == 1


class MisfiledGemini(FakeGemini):
    """The tab shows another case's prompt: a send reported refused had gone through (run-01, 2026-10-16)."""

    def call(self, method, params, timeout=None):
        if method == "get_conversation":
            return [{"role": "user", "text": "CASE: ... (case ref 0123456789)"}, {"role": "model", "text": "Hi Maya"}]
        return super().call(method, params, timeout)


def test_an_answer_under_another_prompt_is_refused():
    with pytest.raises(GeminiError) as caught:
        engine.propose(MisfiledGemini(GOOD), REPLY_CASE)
    assert caught.value.code == "WRONG_CHAT"


def test_the_examples_variant_shows_the_closest_coach_moves_before_the_case():
    g = FakeGemini(GOOD)
    engine.propose(g, REPLY_CASE, variant="examples")
    text = g.sent[0]["text"]
    assert text.startswith("HOW COACHES ANSWERED") and text.index("CASE:") > text.index("Coach's verdict")


def test_reply_length_follows_the_message_it_answers():
    assert engine.target_words({"thread": []}) == (60, 0)
    assert engine.target_words(REPLY_CASE) == (38, 4)   # "Make me an offer."
    long = dict(REPLY_CASE, thread=[{"from": "them", "body": "word " * 80}])
    assert engine.target_words(long) == (130, 80)


def test_a_no_gets_a_reconnect_in_the_calendar_not_only_in_a_note():
    # run-01 (2026-10-16): "reconnect in a future quarter" with in_working_days 0 would never come back (INF-FU-06)
    no = GOOD.replace("inf.asks_price_from_us", "inf.not_interested").replace('"in_working_days": 2', '"in_working_days": 0')
    result = engine.propose(FakeGemini(no), REPLY_CASE)
    assert result["proposal"]["follow_up"]["in_working_days"] == engine.RECONNECT_DAYS
    assert "INF-FU-06" in result["proposal"]["follow_up"]["note"]
    named = GOOD.replace("inf.asks_price_from_us", "inf.later").replace('"in_working_days": 2', '"in_working_days": 45')
    assert engine.propose(FakeGemini(named), REPLY_CASE)["proposal"]["follow_up"]["in_working_days"] == 45


def test_a_later_with_no_follow_up_is_dated_from_the_month_they_named():
    later = GOOD.replace("inf.asks_price_from_us", "inf.later").replace('"in_working_days": 2', '"in_working_days": 0')
    case = dict(REPLY_CASE, thread=[{"from": "us", "body": "Hi Sam"},
                                    {"from": "them", "subject": "Re: hi", "body": "Fully booked this month, maybe reach out again in November?"}])
    fu = engine.propose(FakeGemini(later), case)["proposal"]["follow_up"]
    assert fu["in_working_days"] == 11 and fu["set_by"] == "engine"     # Fri 16 Oct -> Mon 2 Nov


def test_a_no_is_not_chased_days_later_unless_they_named_the_time():
    # run-03 (2026-10-17): "Not interested at this time, thanks." got a follow-up in 3 working days (BRD-FU-05)
    soon = GOOD.replace("inf.asks_price_from_us", "inf.not_interested").replace('"in_working_days": 2', '"in_working_days": 3')
    fu = engine.propose(FakeGemini(soon), REPLY_CASE)["proposal"]["follow_up"]
    assert fu["in_working_days"] == engine.RECONNECT_DAYS and "BRD-FU-05" in fu["note"] and fu["set_by"] == "engine"
    # "ping me next week" is their own time: the model's few days stand
    later = GOOD.replace("inf.asks_price_from_us", "inf.later").replace('"in_working_days": 2', '"in_working_days": 5')
    case = dict(REPLY_CASE, thread=[{"from": "us", "body": "Hi Sam"},
                                    {"from": "them", "subject": "Re: hi", "body": "Busy this week, ping me next week?"}])
    assert engine.propose(FakeGemini(later), case)["proposal"]["follow_up"]["in_working_days"] == 5
    # with no date from the model, "in two weeks" is dated from their message: Fri 16 Oct -> Fri 30 Oct
    none = later.replace('"in_working_days": 5', '"in_working_days": 0')
    case2 = dict(case, thread=[case["thread"][0], dict(case["thread"][1], body="Try me again in two weeks.")])
    assert engine.propose(FakeGemini(none), case2)["proposal"]["follow_up"]["in_working_days"] == 10


def test_the_prompt_names_the_overused_phrases_only_when_there_are_some():
    assert "overused_phrases" not in engine.case_prompt(REPLY_CASE)
    text = engine.case_prompt(dict(REPLY_CASE, overused_phrases=["your content could be a good fit"]))
    assert "use none of them" in text and "your content could be a good fit" in text


GOOD_REVIEW = '```json\n{"verdict": "good", "points": [], "summary": "send it"}\n```'
MIXED_REVIEW = ('```json\n{"verdict": "mixed", "points": [{"rule": "FND-WRITE-25", "problem": "longer than their line", '
                '"fix": "one short question"}], "summary": "cut it"}\n```')


def test_a_draft_the_coach_calls_good_is_kept_as_it_is():
    g = FakeGemini(GOOD, GOOD_REVIEW)
    result = engine.propose(g, REPLY_CASE, coach_rounds=1)
    assert result["coach"][0]["verdict"] == "good" and result["before_coach"] is None
    assert len(g.sent) == 2 and "COACH REVIEW" in g.sent[1]["text"] and g.sent[1]["newChat"] is True


def test_a_draft_the_coach_objects_to_is_rewritten_once_in_a_fresh_chat_against_its_points():
    # plan §7b step 4: draft, coach critique, one rewrite; the person approving sees the final draft and the notes
    revised = GOOD.replace("What do you usually charge for a sponsored segment?", "What's your rate?") \
                  .replace('"action": "send_message"', '"action": "close_lost"')
    g = FakeGemini(GOOD, MIXED_REVIEW, revised)
    result = engine.propose(g, REPLY_CASE, coach_rounds=1)
    third = g.sent[2]
    assert third["newChat"] is True and "CASE:" in third["text"] and "[FND-WRITE-25] longer than their line" in third["text"]
    assert result["proposal"]["message"]["body"].startswith("Hi Sam,\n\nWhat's your rate?")
    assert result["proposal"]["decision"]["action"] == "send_message"          # the action stays the first pass's
    assert "usually charge" in result["before_coach"]["body"] and result["coach"][0]["verdict"] == "mixed"


def test_an_empty_first_answer_is_sent_again_in_a_fresh_chat():
    # 2026-10-16: answers that were only the skill header ("Skills: gratovo-comms"): the prompt never reached the model
    g = FakeGemini("Skills: gratovo-comms", GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready" and len(g.sent) == 2
    assert g.sent[1]["newChat"] is True and g.sent[1]["text"] == g.sent[0]["text"]


def test_an_error_given_as_the_answer_is_raised_for_the_pool():
    with pytest.raises(GeminiError) as caught:
        engine.propose(FakeGemini("Sorry, something went wrong. Please try your request again."), REPLY_CASE)
    assert caught.value.code == "GEMINI_ERROR"


def test_a_reply_type_outside_the_situations_map_is_asked_again_with_the_ids():
    # run-02 examples (2026-10-16): "rate_quote", "budget_inquiry", "positive" in place of the map's ids
    invented = GOOD.replace("inf.asks_price_from_us", "budget_inquiry")
    g = FakeGemini(invented, GOOD)
    result = engine.propose(g, REPLY_CASE)
    assert result["status"] == "ready" and result["proposal"]["situation"]["reply_type"] == "inf.asks_price_from_us"
    assert "'budget_inquiry' is not an id" in g.sent[1]["text"] and "inf.asks_price_from_us" in g.sent[1]["text"]


def test_a_rewrite_that_relabels_the_situation_keeps_the_first_pass_label():
    relabelled = GOOD.replace("inf.asks_price_from_us", "price_question") \
                     .replace("What do you usually charge for a sponsored segment?", "What's your rate?")
    result = engine.propose(FakeGemini(GOOD, relabelled), REPLY_CASE, variant="write")
    assert result["proposal"]["situation"]["reply_type"] == "inf.asks_price_from_us"
    assert "What's your rate?" in result["proposal"]["message"]["body"]


def test_auto_is_the_default_variant():
    # the owner's decision on the workflow map, 2026-10-18
    import inspect
    assert inspect.signature(engine.propose).parameters["variant"].default == "auto"


def test_policy_is_refused_before_gemini_is_asked():
    """HC-08, HC-09 and BRD-PRES-15 are not the model's to weigh: the live case marks them, and the engine stops
    there -- no Gemini call, a blocked status, and the reason a person can read."""
    for policy, code in (({"creator_out_of_scope": True}, "HC08_OUT_OF_SCOPE"),
                         ({"boycott": "boycotted country IL"}, "HC09_BOYCOTT"),
                         ({"not_ready": ["@notyet"]}, "PITCH_NOT_READY")):
        gemini = FakeGemini()
        result = engine.propose(gemini, dict(REPLY_CASE, policy=policy))
        assert result["status"] == "blocked", code
        assert result["findings"][0]["code"] == code
        assert gemini.sent == [], "nothing is sent to Gemini"


def test_a_clean_policy_lets_the_case_through():
    gemini = FakeGemini(GOOD)
    result = engine.propose(gemini, dict(REPLY_CASE, policy={"creator_out_of_scope": False, "boycott": None,
                                                              "not_ready": []}), variant="base")
    assert result["status"] != "blocked" or result["findings"][0]["code"] not in (
        "HC08_OUT_OF_SCOPE", "HC09_BOYCOTT", "PITCH_NOT_READY")
    assert len(gemini.sent) >= 1
