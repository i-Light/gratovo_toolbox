"""The scenario suite (comms/scenarios.py), offline: how a proposal is graded, and that every case
builds.

Pinned 2026-10-16: the agency works the AI niche, so every test creator is an AI channel; an
invented client, case study or brand fails a case even when the checks let the message through.
The channels database is invented here (AI creators, written for the tests): the real one is not in
the repository.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline import paths, store
from gratovo_pipeline.comms import engine, playbook, scenarios

BRANDS = ["Zapier", "Wispr Flow", "Vanta"]

DESCRIPTION = (
    "Build 3 real mobile apps from scratch with Claude Code in this complete 12-hour bootcamp.\n\n"
    "Source Code:\nTrip planner: https://example.com/code6\n\n"
    "Try Sentry for FREE: https://example.com/sentry ($80 FREE Credits)\n"
    "Try Neon for FREE: https://example.com/neon\n"
    "Grab HubSpot's free Guide to ChatGPT Work:\nhttps://example.com/x\n"
    "#claudecode #reactnative #expo"
)


@pytest.fixture(autouse=True)
def no_channels(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(scenarios.CHANNELS_DB_ENV, raising=False)
    scenarios.configure(None)
    yield
    scenarios.configure(None)


def all_handles() -> list[str]:
    data = json.loads((paths.COMMS_TESTS_DIR / "scenarios.json").read_text(encoding="utf-8"))
    handles = set(data["creators"])
    handles |= {b["seen_on"] for b in data["brands"].values() if b.get("seen_on")}
    return sorted(handles)


@pytest.fixture
def channels_db(tmp_path: Path) -> Path:
    """A pipeline.db holding an invented AI channel for every handle the cases name."""
    path = tmp_path / "pipeline.db"
    conn: sqlite3.Connection = store.get_connection(path)
    store.init_db(conn)
    for i, handle in enumerate(all_handles()):
        cid = f"UC{i:04d}"
        conn.execute(
            "insert into channels (channel_id, handle, name, subscribers, country, first_seen_at, "
            "videos_last_30, median_views_last_30, sponsored_ratio, seen_brands) "
            "values (?, ?, ?, ?, 'US', '2026-10-01', 6, ?, 0.25, '[\"Zapier\"]')",
            (cid, handle, handle.lstrip("@") + " AI", str(50_000 + i * 1000), 20_000 + i),
        )
        conn.execute(
            "insert into videos (video_id, channel_id, title, description, published_at, "
            "view_count) values (?, ?, ?, ?, '2026-10-10T00:00:00Z', '12345')",
            (f"v{i}", cid, f"Claude Code tutorial {i}", DESCRIPTION),
        )
    conn.commit()
    conn.close()
    return path


def entry(
    expect: dict[str, Any], case: dict[str, Any] | None = None, kind: str = "reply"
) -> dict[str, Any]:
    case = case or {
        "side": "brand",
        "stage": "pitched",
        "facts": {"brand": {"name": "Zapier"}},
        "thread": [{"from": "them", "body": "Tell me about your agency."}],
    }
    return {"id": "x", "kind": kind, "type": "brd.about_agency", "expect": expect, "case": case}


def result(
    body: str | None = "Hi Chris, happy to share more. Would numbers on the creator help?",
    action: str = "send_message",
    reply_type: str = "brd.about_agency",
    gates: tuple[str, ...] = (),
    status: str = "ready",
) -> dict[str, Any]:
    return {
        "status": status,
        "gates": [{"what": g} for g in gates],
        "findings": [],
        "rounds": 1,
        "proposal": {
            "situation": {"reply_type": reply_type},
            "decision": {"action": action},
            "message": {"subject": "Re: hi", "body": body} if body else None,
        },
    }


def test_a_proposal_that_meets_every_expectation_passes() -> None:
    g = scenarios.grade_one(
        entry({"reply_type": ["brd.about_agency"], "action": ["send_message"]}), result(), BRANDS
    )
    assert g["pass"], g["reasons"]


def test_wrong_type_wrong_action_and_a_missing_gate_each_fail() -> None:
    g = scenarios.grade_one(
        entry({"reply_type": ["brd.asks_rates"], "action": ["ask_user"], "gates": ["price"]}),
        result(),
        BRANDS,
    )
    assert not g["pass"]
    assert len(g["reasons"]) == 3


def test_an_invented_client_or_a_brand_the_case_never_names_fails() -> None:
    g = scenarios.grade_one(
        entry({}), result(body="We've worked with Vanta before, happy to share."), BRANDS
    )
    assert any("we've worked with" in r.lower() for r in g["reasons"])
    assert any("Vanta" in r for r in g["reasons"])


def test_saying_honestly_that_there_are_no_case_studies_is_not_a_claim() -> None:
    # 2026-10-16 (brd-agency-1): the honest answer to "do you have case studies?" failed the grader
    honest = (
        "We have not run brand campaigns yet, so we have no past clients or case studies to share."
    )
    assert scenarios.grade_one(entry({}), result(body=honest), BRANDS)["pass"]
    assert scenarios.grade_one(entry({}), result(body="We don't have a track record yet."), BRANDS)[
        "pass"
    ]
    g = scenarios.grade_one(
        entry({}), result(body="No problem. Our case studies show strong results."), BRANDS
    )
    assert any("case studies" in r for r in g["reasons"])


def test_a_blocked_proposal_fails_and_no_message_is_enforced() -> None:
    assert not scenarios.grade_one(entry({}), result(status="blocked"), BRANDS)["pass"]
    g = scenarios.grade_one(entry({"no_message": True}), result(), BRANDS)
    assert "wrote a message where none should be sent" in g["reasons"]


def test_an_out_of_office_case_fails_when_the_follow_up_comes_before_they_are_back() -> None:
    # 2026-10-16: "back October 21" on a Friday was followed up in 2 working days and still passed
    ooo = result(
        body=None, action="schedule_follow_up", reply_type="any.out_of_office", status="no_message"
    )
    ooo["proposal"]["follow_up"] = {"in_working_days": 2}
    g = scenarios.grade_one(entry({"no_message": True, "follow_up_min_days": 4}), ooo, BRANDS)
    assert g["reasons"] == ["follows up in 2 working days, at least 4 expected"]
    ooo["proposal"]["follow_up"] = {"in_working_days": 4}
    assert scenarios.grade_one(entry({"no_message": True, "follow_up_min_days": 4}), ooo, BRANDS)[
        "pass"
    ]


def test_the_engine_quick_path_passes_the_shipped_out_of_office_case() -> None:
    case = next(c for c in scenarios.cases() if c["id"] == "any-ooo-1")
    quick = engine.quick_path(case["case"])
    assert quick is not None
    g = scenarios.grade_one(case, quick, BRANDS)
    assert g["pass"], g["reasons"]


def test_a_german_reply_must_be_in_german() -> None:
    case = {
        "side": "influencer",
        "stage": "contacted",
        "facts": {"brands_in_mind": ["Zapier", "Wispr Flow"]},
        "thread": [{"from": "them", "body": "Um welche Marken geht es?"}],
    }
    g = scenarios.grade_one(
        entry({"language": "de"}, case),
        result(body="Hi Julian, the brands are Zapier and Wispr Flow."),
        BRANDS,
    )
    assert g["reasons"] == ["not answered in German"]
    g = scenarios.grade_one(
        entry({"language": "de"}, case),
        result(
            body="Hallo Julian, es geht um Zapier und Wispr Flow. "
            "Ich schicke dir gerne die Details."
        ),
        BRANDS,
    )
    assert g["pass"], g["reasons"]


def test_numbers_are_written_the_way_people_write_them() -> None:
    assert [scenarios.short(n) for n in (950, 63244, 230000, 1830000, 2000000)] == [
        "950",
        "63k",
        "230k",
        "1.8M",
        "2M",
    ]


def test_every_case_builds_with_no_placeholder_left(channels_db: Path) -> None:
    scenarios.configure(channels_db)
    cs = scenarios.cases()
    assert len({c["id"] for c in cs}) == len(cs) >= 70
    text = json.dumps([c["case"] for c in cs], ensure_ascii=False)
    assert "{" not in "".join(
        m.get("body", "") + m.get("subject", "") for c in cs for m in c["case"]["thread"]
    )
    assert "Gratovo" in text
    assert all(c["case"]["facts"]["today"] for c in cs)


def test_the_cases_build_without_a_channels_database_from_the_handles_alone() -> None:
    # `list` and the tests are offline; only a live run needs the channels' numbers
    assert not scenarios.have_channels()
    cs = scenarios.cases()
    assert len(cs) >= 70
    case = next(c["case"] for c in cs if c["id"] == "inf-counter-1")
    assert case["facts"]["creator"]["subscribers"] == 0
    assert case["thread"]


def test_a_missing_channels_database_is_named_for_a_live_run(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    assert scenarios.main(["run", str(tmp_path / "out")]) == 2
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "--channels-db" in err[0]
    assert scenarios.CHANNELS_DB_ENV in err[0]
    assert not (tmp_path / "out").exists()


def test_the_environment_names_the_channels_database(
    channels_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(scenarios.CHANNELS_DB_ENV, os.fspath(channels_db))
    scenarios.configure(None)
    assert scenarios.channels_db() == channels_db
    facts = scenarios.channel(all_handles()[0])
    assert facts["subscribers"] >= 50_000


def test_recent_drafts_are_the_latest_bodies_of_the_same_kind(tmp_path: Path) -> None:
    def answer(name: str, body: str | None, t: float) -> None:
        p = tmp_path / f"{name}.json"
        p.write_text(
            json.dumps({"result": {"proposal": {"message": {"body": body} if body else None}}}),
            encoding="utf-8",
        )
        os.utime(p, (t, t))

    answer("inf-first-a", "first A", 100)
    answer("brd-first-b", "first B", 200)
    answer("inf-vague-1", "reply C", 300)
    answer("any-ooo-1", None, 400)
    answer("inf-first-me", "mine", 500)
    assert scenarios.recent_drafts(tmp_path, "first", exclude="inf-first-me") == [
        "first B",
        "first A",
    ]
    assert scenarios.recent_drafts(tmp_path, "reply") == ["reply C"]
    # tics are per side
    assert scenarios.recent_drafts(tmp_path, "first", exclude="inf-first-me", side="inf") == [
        "first A"
    ]


def test_a_description_gives_its_prose_and_the_tools_it_promotes() -> None:
    # 2026-10-16: a graduate reads the latest video's description before writing, and sees who the
    # creator already promotes
    assert (
        scenarios._about(DESCRIPTION)  # pyright: ignore[reportPrivateUsage]
        == "Build 3 real mobile apps from scratch with Claude Code in this complete 12-hour "
        "bootcamp."
    )
    assert scenarios._linked_tools([DESCRIPTION]) == [  # pyright: ignore[reportPrivateUsage]
        "Sentry",
        "Neon",
        "HubSpot",
    ]


def test_every_case_carries_the_latest_video_of_its_creator(channels_db: Path) -> None:
    scenarios.configure(channels_db)
    case = next(c["case"] for c in scenarios.cases() if c["id"] == "inf-vague-1")
    latest = case["facts"]["creator"]["latest_video"]
    assert latest["title"]
    assert latest["views"] > 0
    assert "Claude Code" in latest.get("about", "")


def test_the_grade_counts_the_reply_types_key_rules_the_decision_cites() -> None:
    # plan §7b machine tier: every key rule of the situation is in reach, so each one not followed
    # is counted
    keys = playbook.key_rules("brd.about_agency")
    r = result()
    r["proposal"]["decision"]["rules"] = keys[:1]
    g = scenarios.grade_one(entry({}), r, BRANDS)
    assert keys
    assert g["key_rules"] == len(keys)
    assert g["key_rules_cited"] == 1
    assert g["key_rules_missed"] == keys[1:]


def test_stopping_to_ask_about_an_open_house_choice_is_a_deferral_not_a_failure() -> None:
    # HC-08 (female and couple creators) has no owner pick yet; asking is right whatever the case
    # expected
    r = result(action="ask_user")
    r["gates"] = [
        {"what": "ethics", "detail": "female creator; per FND-ETH-07 and HC-08 the owner decides"}
    ]
    g = scenarios.grade_one(entry({"action": ["send_message"], "no_gates": ["ethics"]}), r, BRANDS)
    assert g["pass"]
    assert g["deferred"] == "HC-08"
    r["gates"] = [{"what": "ethics", "detail": "a betting brand (FND-ETH-05)"}]
    assert not scenarios.grade_one(
        entry({"action": ["send_message"], "no_gates": ["ethics"]}), r, BRANDS
    )["pass"]
