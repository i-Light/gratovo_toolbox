"""A person checks video quotes by ear (comms/quote_review.py), 2026-10-15.

  * every video quote in the rules is listed; quotes nobody checked come first;
  * Done saves the words into the rules and marks the quote checked; the transcript is never changed and the
    original wording is kept, so Revert puts back exactly that quote;
  * a quote that changes later is new again; verify accepts a checked quote, also when its words were edited.
"""

import json

import pytest

from comms import course, playbook, quote_review, verify, video_check

LESSON = "module 9 test/9.1. Talking to brands"
DOC = f"video:{LESSON}"
QUOTE = "When a brand says no, you never argue with them."


@pytest.fixture
def book(tmp_path, monkeypatch):
    videos = tmp_path / "videos" / "Module 9"
    videos.mkdir(parents=True)
    (videos / "9.1. Talking to brands.mp4.json").write_text(json.dumps({
        "video": "Module 9/9.1. Talking to brands.mp4", "lesson": LESSON, "duration": 120.0,
        "segments": [{"start": 0.0, "end": 60.0, "text": "Today we talk about brands. " + QUOTE},
                     {"start": 60.0, "end": 120.0, "text": "You ask what would make it a yes."}]}), encoding="utf-8")
    pb = tmp_path / "playbook"
    (pb / "rules").mkdir(parents=True)
    rule = {"id": "BRD-OBJ-01", "stage": "objections", "title": "t", "rule": "r", "level": "must",
            "src": [{"doc": DOC, "quote": QUOTE}]}
    other = dict(rule, id="BRD-OBJ-02")
    (pb / "rules" / "brand.rules.json").write_text(json.dumps({"area": "brand", "rules": [rule, other]}), encoding="utf-8")
    monkeypatch.setenv("GRATOVO_VIDEO_DIR", str(tmp_path / "videos"))
    monkeypatch.setenv("GRATOVO_PLAYBOOK_DIR", str(pb))
    monkeypatch.setattr(video_check, "cached", lambda doc, quote: None)
    for fn in (course.videos, course._video_index, course._normed):
        fn.cache_clear()
    yield pb
    for fn in (course.videos, course._video_index, course._normed):
        fn.cache_clear()


def quotes(pb):
    return [s.quote for r in playbook.rules(pb) for s in r.src]


def test_a_quote_is_listed_once_with_its_rules_and_a_loop(book):
    [it] = quote_review.items(book)
    assert it["rules"] == ["BRD-OBJ-01", "BRD-OBJ-02"] and not it["checked"] and it["found"]
    assert 0 <= it["start"] < it["end"] <= 120


def test_done_saves_the_edit_everywhere_and_revert_restores_only_that(book):
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], "When a brand says no, you never argue with him.", done=True, directory=book)
    assert quotes(book) == ["When a brand says no, you never argue with him."] * 2
    [it] = quote_review.items(book)
    assert it["checked"] and it["original"] == QUOTE
    quote_review.revert(it["key"], directory=book)
    assert quotes(book) == [QUOTE, QUOTE]
    assert quote_review.items(book)[0]["checked"]


def test_verify_accepts_a_checked_quote_even_when_edited(book):
    info = {LESSON: {"speakers": "single", "presenter": "Abu Lahya"}}
    src = playbook.Source(doc=DOC, quote=QUOTE)
    rule = playbook.rules(book)[0]
    assert any("not checked by a person" in p for p in verify.video_problems("x", rule, src, info, {"Abu Lahya"}, quote_review.load(book)))
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], "When a brand says no, you never argue with him.", done=True, directory=book)
    reviews = quote_review.load(book)
    edited = playbook.Source(doc=DOC, quote="When a brand says no, you never argue with him.")
    assert verify.video_problems("x", rule, edited, info, {"Abu Lahya"}, reviews) == []
    assert quote_review.original_of(DOC, edited.quote, reviews) == QUOTE


def test_a_quote_changed_later_is_new_again(book):
    [it] = quote_review.items(book)
    quote_review.edit(it["key"], QUOTE, done=True, directory=book)
    quote_review.replace_in_rules(DOC, QUOTE, "you never argue with them.", book)
    [it] = quote_review.items(book)
    assert not it["checked"] and it["original"] == "you never argue with them."


def test_a_lease_keeps_others_out_until_released_or_expired(book):
    from comms import review_claims
    assert review_claims.claim("k1", "person:a", 60, book)
    assert review_claims.claim("k1", "person:a", 60, book)            # renewing your own lease
    assert not review_claims.claim("k1", "whisper:1", 60, book)       # someone else is working on it
    review_claims.release("k1", "person:a", book)
    assert review_claims.claim("k1", "whisper:1", -1, book)           # a crashed worker's lease ...
    assert review_claims.claim("k1", "person:b", 60, book)            # ... has expired and frees the quote
    review_claims.release_all("person:b", book)
    assert review_claims.held(book) == {}


def test_the_page_sees_a_quote_another_worker_holds_as_busy(book):
    from comms import review_claims
    [it] = quote_review.items(book)
    review_claims.claim(it["key"], "whisper:7", 60, book)
    assert quote_review.items(book, me="person:x")[0]["busy"] == "whisper:7"
    assert quote_review.items(book, me="whisper:7")[0]["busy"] is None


def test_a_flagged_quote_leaves_the_queue_and_fails_verify_until_it_changes(book):
    (book / "coaches.json").write_text(json.dumps({"coaches": {"Abu Lahya": ["Abu Lahya"]}}), encoding="utf-8")
    [it] = quote_review.items(book)
    quote_review.flag(it["key"], True, "the reason comes next", directory=book)
    [it] = quote_review.items(book)
    assert it["flagged"] and it["flag_note"] == "the reason comes next" and quote_review.load(book)["quotes"][it["key"]]["original"] == QUOTE
    flagged = [p for p in verify.check(book)["problems"] if "flagged on the review page" in p]
    assert len(flagged) == 2 and "the reason comes next" in flagged[0]   # both rules that cite it
    quote_review.flag(it["key"], False, directory=book)
    assert not quote_review.items(book)[0]["flagged"]
    quote_review.flag(it["key"], True, directory=book)
    quote_review.replace_in_rules(DOC, QUOTE, "Today we talk about brands. " + QUOTE, book)   # the whole point
    [it] = quote_review.items(book)
    assert not it["flagged"] and not any("flagged on the review page" in p for p in verify.check(book)["problems"])


def test_verify_wants_each_quote_to_make_its_point_alone(book):
    assert verify.stops_short("When you're selling something to someone, they need two things.")
    assert verify.stops_short("Run through all six before you press send:")
    assert not verify.stops_short("Should I bring someone like him or you want to see my alternatives? So you give them two options.")
    rule = playbook.rules(book)[0]
    cut = playbook.Rule(**{**rule.__dict__, "src": [playbook.Source(doc=DOC, quote="Today we talk about brands."),
                                                   playbook.Source(doc=DOC, quote=QUOTE)]})
    assert verify.split_quotes("x", cut, quote_review.load(book))
    far = playbook.Rule(**{**rule.__dict__, "src": [playbook.Source(doc=DOC, quote="Today we talk about brands."),
                                                   playbook.Source(doc=DOC, quote="You ask what would make it a yes.")]})
    assert verify.split_quotes("x", far, quote_review.load(book))   # still one passage: 48 characters apart
    assert verify.split_quotes("x", rule, quote_review.load(book)) == []
