"""The example bank (comms/example_bank.py, plan §7b step 3), 2026-10-16: 992 coach verdicts and rewrites from the
calls against the 33 the skill ships; a case is shown the closest few; nothing that teaches a forbidden tactic."""

from comms import example_bank, scenarios


def test_the_bank_is_large_checked_and_clean():
    bank = example_bank.entries()
    assert len(bank) > 850   # 897 on 2026-10-17, after the graduate bar's 32 were held out
    assert all(e["quote"]["quote"] and e["quote"]["doc"].startswith("call:") for e in bank)
    assert not any(example_bank.UNETHICAL.search(" ".join(str(e.get(k) or "") for k in ("situation", "points", "rewrite")))
                   for e in bank)
    assert not any(example_bank.INVENTED.search(e.get("rewrite") or "") for e in bank)


def test_a_case_gets_close_entries_of_its_side_and_stage_one_per_call():
    case = next(c["case"] for c in scenarios.cases() if c["id"] == "inf-counter-1")
    found = example_bank.for_case(case, k=4)
    assert len(found) == 4
    assert all(e["side"] in ("influencer", "both") and e["stage"] in example_bank.CASE_STAGES["negotiating"] for e in found)
    assert len({e["quote"]["doc"] for e in found}) == 4
    assert "Coach's verdict" in example_bank.render(found)


def test_the_filter_drops_invented_scarcity():
    it = {"kind": "roast", "verdict": "good", "rewrite": "We're only onboarding 10 creators, last round.", "student_email": "x " * 20,
          "situation": "s", "advice": "inject FOMO"}
    assert not example_bank._ok(it)


def test_the_coachs_calibration_roasts_never_enter_the_bank():
    # 2026-10-16: 64 of the 120 held-out roasts were in the bank; a coach shown the bank would have seen their verdicts
    import json
    import pytest
    if not example_bank.CALIBRATION.exists() or not example_bank.BANK.exists():
        pytest.skip("mined calls not on this machine")
    held = {it["idx"] for it in json.loads(example_bank.CALIBRATION.read_text(encoding="utf-8"))}
    assert not held & {int(e["id"].split("-")[1]) for e in example_bank.entries()}


def test_the_graduate_bars_roasts_never_enter_the_bank():
    # 2026-10-17: the engine is judged against these coach rewrites; the write variant must never be shown one
    import json
    held = {it["idx"] for it in json.loads(example_bank.GRADBAR.read_text(encoding="utf-8"))["items"]}
    assert len(held) >= 30
    assert not held & {int(e["id"].split("-")[1]) for e in example_bank.entries()}
