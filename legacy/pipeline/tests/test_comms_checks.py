"""Deterministic message checks (comms/checks.py), 2026-10-15: a long dash blocks (FND-FMT-04), a hyphen does not."""

from comms import checks


def codes(body, subject="", case=None):
    case = case or {"side": "brand", "stage": "negotiating", "thread": [{"from": "them", "body": "Send us the rate."}]}
    return {f["code"] for f in checks.check(case, {"message": {"subject": subject, "body": body}})}


def test_a_long_dash_blocks_in_the_body_or_the_subject():
    assert "EM_DASH" in codes("Thanks for the reply \u2014 the rate holds for March.")
    assert "EM_DASH" in codes("Thanks for the reply.", subject="March \u2014 rate")
    blocking = checks.blocking(checks.check({"thread": [{"from": "them", "body": "x"}], "stage": "negotiating"},
                                            {"message": {"body": "Fine \u2014 done."}}))
    assert any(f["rule"] == "FND-FMT-04" for f in blocking)


def test_a_hyphen_is_fine():
    assert "EM_DASH" not in codes("A follow-up on the long-form video, as discussed.")


FIRST = {"side": "influencer", "stage": "prospect", "thread": []}


def test_overused_course_subjects_and_lines_block():
    assert "SUBJECT_PATTERN" in codes("Hi Sam, a thought on your gear videos. Open to it?", "Partnership request", FIRST)
    assert "SUBJECT_PATTERN" in codes("Hi Sam, a thought on your gear videos. Open to it?", "Quick question", FIRST)
    assert "SUBJECT_PATTERN" not in codes("Hi Sam, a thought on your gear videos. Open to it?", "Quick question about your tripod", FIRST)
    assert "COURSE_PHRASE" in codes("Just checking if you had a chance to read my note.")


def test_a_fake_reply_subject_blocks_only_without_a_real_thread():
    assert "FAKE_REPLY" in codes("Hi Sam, a thought on your gear videos. Open to it?", "RE: your gear videos", FIRST)
    real = {"stage": "negotiating", "thread": [{"from": "them", "subject": "Rates", "body": "Here are my rates."}]}
    assert "FAKE_REPLY" not in codes("Thanks, that works.", "Re: Rates", real)


def test_the_cta_check_follows_house_choice_hc20():
    body = "Hi Sam, your tripod review was sharp.\nWe find brands for gear channels.\nLet me know and I'll send a few names over."
    assert "CTA" in codes(body, "Tripod talk", dict(FIRST))
    assert "CTA" not in codes(body, "Tripod talk", dict(FIRST, house_choices={"HC-20": "statement"}))


def test_a_case_number_rounded_the_usual_way_is_a_fact_but_a_new_number_is_not():
    # 2026-10-16: "about 63k views" for a median of 63,244 was blocked as an invented number
    case = {"side": "brand", "stage": "pitched", "thread": [{"from": "them", "body": "Tell me more."}],
            "facts": {"creator": {"median_views_last_30_days": 63244, "subscribers": 1830000}}}
    assert "FACT_NUMBER" not in codes("They average about 63k views a video, with 1.8M subscribers.", case=case)
    assert "FACT_NUMBER" in codes("They average about 90k views a video.", case=case)
    assert "FACT_NUMBER" in codes("They average about 70k views a video.", case=case)


def test_a_segment_length_we_propose_is_not_an_invented_number():
    # 2026-10-16: asking a creator their rate "for a 60-90 second integration" (INF-PRICE-09) was blocked
    case = {"side": "influencer", "stage": "contacted", "thread": [{"from": "them", "body": "Make me an offer."}],
            "facts": {"creator": {"median_views_last_30_days": 61725}}}
    for body in ("What would you charge for a 60-90 second integration?",
                 "What is your rate for a 60 to 90 second segment?",
                 "Would a 90-second integration work?", "A 60–90 sec mention, roughly?",
                 "What would an integration of about 60 to 90 seconds cost?"):
        assert "FACT_NUMBER" not in codes(body, case=case), body
    # a number that is not the length of a deliverable still has to come from the case
    assert "FACT_NUMBER" in codes("Your last video held viewers for 90 seconds.", case=case)
    assert "FACT_NUMBER" in codes("We can do a 600 second integration.", case=case)


def test_a_quoted_video_title_is_not_our_wording():
    # 2026-10-16: "Why Is ChatGPT OBSESSED with Goblins?" read as fan language and as a second question
    case = dict(FIRST, facts={"creator": {"recent_videos": ["Why Is ChatGPT OBSESSED with Goblins?"]}})
    body = "Hi Sam,\n\n\"Why Is ChatGPT OBSESSED with Goblins?\" kept it light.\n\nWe're thinking of pairing you with Wispr Flow.\n\nOpen to hearing more?"
    found = codes(body, "goblins", case)
    assert "FAN" not in found and "QUESTIONS" not in found
    # our own words are still checked
    assert "FAN" in codes(body.replace("kept it light", "I'm obsessed with your channel"), "goblins", case)


def test_a_message_reusing_a_roast_example_is_rejected_like_course_wording():
    """2026-10-16: the roast examples are 'learn from, never copy' (FND-WRITE-15)."""
    from comms import playbook
    ex = playbook.examples()[0]
    words = ex["student_email"].replace("\n", " ").split()
    lifted = " ".join(words[:12])
    assert "COPY_COURSE" in codes(f"Hi Sam, {lifted}. Open to it?", "your tripod", FIRST)


def test_a_message_built_on_a_recent_message_frame_is_templated_even_with_new_names():
    # 2026-10-16 run-01: four first emails shared one frame and only the names changed (FND-WRITE-01)
    earlier = ("Hi Leon,\n\nYour latest title on the simplest way to use Claude AI stood out.\n\nSpeaking of simple setups, we're onboarding "
               "AI creators for upcoming outreach. We're looking into pitching GoDaddy and Higgsfield. Your content could be a good fit.\n\n"
               "Are you open to brand sponsorships like these?\n\nBest,\nAdam")
    case = dict(FIRST, agency={"sender": "Adam", "name": "Gratovo"}, counterpart={"name": "Sam", "channel": "Codesistency"},
                facts={"brands_in_mind": [{"name": "Zapier"}, {"name": "Vanta"}]}, recent_messages=[earlier])
    same_frame = ("Hi Sam,\n\nThree mobile apps in one bootcamp is a lot of value.\n\nSpeaking of apps, we're onboarding AI creators for "
                  "upcoming outreach. We're looking into pitching Zapier and Vanta. Your content could be a good fit.\n\n"
                  "Are you open to brand sponsorships like these?\n\nBest,\nAdam")
    assert "TEMPLATED" in codes(same_frame, "three apps", case)
    fresh = ("Hi Sam,\n\nThree mobile apps in one bootcamp is a lot of value.\n\nWe set up paid sponsor slots for builders, and Zapier "
             "or Vanta would sit well next to tutorials like that.\n\nWant the details?\n\nAdam")
    assert "TEMPLATED" not in codes(fresh, "three apps", case)


def test_without_recent_messages_nothing_is_templated():
    assert "TEMPLATED" not in codes("Hi Sam, a thought on your gear videos. Open to it?", "your tripod", FIRST)


def test_view_counts_and_audience_shares_are_not_money_but_amounts_are():
    # run-01 (2026-10-16): "53k median views" and a title's "90% of people" put a price gate on seven first emails
    for text in ("He pulls 61k median views", "180k views in 30 days", "41% of your viewers in the US, plus 12% in the UK",
                 "Your title on ChatGPT settings 90% of people miss stood out"):
        assert checks.money(text) is None, text
    for text in ("If $5k is firm", "5k is firm for us", "a small fee with your 20% code", "50% upfront", "our cut is 15%"):
        assert checks.money(text), text
    # run-02 base: the second figure of "hit 850k views, past your usual 590k" is views too; a price beside views is not
    assert checks.money("Your jury video hit 850k views, past your usual 590k.") is None
    assert checks.money("Your 63k viewers would love it, and 2.5k per video works for us") == "2.5k"
    # gradbar-01 (2026-10-17): "220K+ views per video" and "130K+ viewers" were gated as prices
    for text in ("They get 220K+ views per video on YouTube", "Andy reaches 130K+ viewers, mostly men in the US",
                 "Each gets 200k+ views, mostly from the US"):
        assert checks.money(text) is None, text
    assert checks.money("Our rate is 3k+ for a dedicated video")


def test_a_draft_greeting_someone_else_is_blocked():
    # run-01 (2026-10-16): the Matt Loui case came back with the answer written to "Mo", another creator of the run
    case = {"side": "influencer", "stage": "prospect", "counterpart": {"kind": "creator", "name": "Matt", "channel": "Matt Loui"},
            "facts": {}, "thread": []}
    wrong = {"message": {"subject": "x", "body": "Hey Mo, the jury angle stood out.\n\nAre you open to it?\n\nAdam"}}
    right = {"message": {"subject": "x", "body": "Hi Matt Loui,\n\nThe one-prompt advert stood out.\n\nAre you open to it?\n\nAdam"}}
    anyone = {"message": {"subject": "x", "body": "Hi there,\n\nThe one-prompt advert stood out.\n\nAre you open to it?\n\nAdam"}}
    assert "WRONG_PERSON" in {f["code"] for f in checks.check(case, wrong)}
    assert "WRONG_PERSON" not in {f["code"] for f in checks.check(case, right)} | {f["code"] for f in checks.check(case, anyone)}
    # a manager who answered in the thread may be greeted
    managed = dict(case, thread=[{"from": "us", "body": "Hi Matt"}, {"from": "them", "body": "Hi, I'm Sarah, Matt's manager."}])
    to_sarah = {"message": {"subject": "x", "body": "Hi Sarah,\n\nThanks. What are his rates?\n\nAdam"}}
    assert "WRONG_PERSON" not in {f["code"] for f in checks.check(managed, to_sarah)}


def test_betting_that_does_not_call_itself_betting_raises_the_ethics_gate():
    # run-01 (2026-10-16): Kalshi's description never says "betting", and no gate was raised (FND-ETH-05)
    case = {"facts": {"brand": {"name": "Kalshi", "about": "an exchange where people buy and sell contracts that pay out on "
                                                         "the outcome of real events such as elections and sports results"}}}
    assert "ethics" in {g["what"] for g in checks.gates(case, {"needs_human": [], "message": {"body": "Hi Eli"}})}


def test_wording_the_outbox_keeps_repeating_is_learned_and_blocked():
    # run-01 (2026-10-16): 16 of 25 first emails reused "we are onboarding", "your content could be a good fit" and
    # "are you open to"; FND-WRITE-03 asks every send to vary its sentences
    history = [f"Hi {n},\n\nYour {t} video stood out. We are onboarding creators for brand outreach. "
               f"Your content could be a good fit.\n\nAre you open to sponsorships?\n\nAdam"
               for n, t in (("Sam", "robot"), ("Lee", "coding"), ("Ana", "editing"), ("Bo", "prompting"), ("Kai", "agents"))]
    phrases = checks.overused_phrases(history)
    assert any("could be a good fit" in p for p in phrases) and any("onboarding creators" in p for p in phrases)
    case = {"side": "influencer", "stage": "prospect", "facts": {}, "thread": [], "overused_phrases": phrases,
            "counterpart": {"name": "Jo"}}
    framed = {"message": {"subject": "x", "body": "Hi Jo,\n\nThe fix in your last video was neat. We are onboarding creators "
                                                  "for brand outreach and your content could be a good fit.\n\nInterested?\n\nAdam"}}
    fresh = {"message": {"subject": "x", "body": "Hi Jo,\n\nThe fix in your last video was neat. I line up paid brand deals for "
                                                 "AI channels, and yours might suit two tools I pitch.\n\nAre you open to it?\n\nAdam"}}
    assert "OVERUSED" in {f["code"] for f in checks.check(case, framed)}
    assert "OVERUSED" not in {f["code"] for f in checks.check(case, fresh)}       # one repeated phrase alone passes
    replies = ["Hi Sam,\n\nThanks, $1,200 works.\n\nAdam", "Hi Lee,\n\nThe draft looks good, one change.\n\nAdam",
               "Hi Ana,\n\nSure, here are the dates.\n\nAdam"]
    assert checks.overused_phrases(replies) == []                                # too few repeats to call it a tic


def test_a_price_in_words_is_read_as_a_price_and_asked_for_in_digits():
    # run-02 examples (2026-10-16): a $3,000 quote blocked as "not in the facts" came back as "three thousand USD"
    case = {"side": "brand", "stage": "negotiating", "facts": {"deal": {"creator_rate": 2000}}, "counterpart": {"name": "Kevin"},
            "thread": [{"from": "us", "body": "Hi Kevin"}, {"from": "them", "subject": "Re: x", "body": "Our budget is $8,000."}]}
    words = {"message": {"subject": "Re: x", "body": "Hi Kevin,\n\nOne integration for three thousand USD.\n\nDoes that work?\n\nAdam"},
             "needs_human": []}
    codes = {f["code"] for f in checks.check(case, words)}
    assert {"NUMBER_WORDS", "FACT_NUMBER"} <= codes
    assert "price" in {g["what"] for g in checks.gates(case, words)}


def test_a_price_we_propose_is_allowed_when_the_price_gate_is_raised():
    case = {"side": "brand", "stage": "negotiating", "facts": {"deal": {"creator_rate": 2000}}, "counterpart": {"name": "Kevin"},
            "thread": [{"from": "us", "body": "Hi Kevin"}, {"from": "them", "subject": "Re: x", "body": "Our budget is $8,000."}]}
    body = "Hi Kevin,\n\nOne integration is $3,000.\n\nDoes that work?\n\nAdam"
    gated = {"message": {"subject": "Re: x", "body": body}, "needs_human": [{"what": "price", "detail": "confirm $3,000"}]}
    ungated = {"message": {"subject": "Re: x", "body": body}, "needs_human": []}
    assert "FACT_NUMBER" not in {f["code"] for f in checks.check(case, gated)}
    assert "FACT_NUMBER" in {f["code"] for f in checks.check(case, ungated)}


def test_a_title_with_a_number_in_words_is_the_creators_not_ours():
    case = {"side": "influencer", "stage": "prospect", "counterpart": {"name": "Sam"}, "thread": [],
            "facts": {"creator": {"recent_videos": ["One Hundred Days of Claude Code"]}}}
    draft = {"message": {"subject": "x", "body": "Hi Sam,\n\nOne Hundred Days of Claude Code was a fun watch.\n\nOpen to it?\n\nAdam"}}
    assert not {"NUMBER_WORDS", "FACT_NUMBER"} & {f["code"] for f in checks.check(case, draft)}
