"""Cross-references inside the playbook (comms/verify.py), 2026-10-15.

A rule may point at another rule ("see FND-CALL-06") or at an owner decision ("house choice HC-15"); each
house choice lists the rules behind its options. A reference to something that does not exist fails.
"""

from comms import playbook, verify


def rule(rid, text, **extra):
    return playbook.Rule(id=rid, area="brand", stage="offer", title="t", rule=text, level="should", src=[],
                         file="brand.rules.json", **extra)


def choice(cid, default="a", pick=None, sources=("BRD-OFFER-01",)):
    return {"id": cid, "options": [{"key": "a", "sources": list(sources)}, {"key": "b", "sources": []}],
            "default": default, "pick": pick}


def test_existing_references_pass():
    rules = [rule("BRD-OFFER-01", "Offer it."), rule("BRD-OFFER-02", "Like BRD-OFFER-01; house choice HC-01.")]
    assert verify.reference_problems(rules, [choice("HC-01")]) == []


def test_a_missing_rule_or_choice_fails_also_in_the_lists():
    rules = [rule("BRD-OFFER-01", "See BRD-OFFER-09.", dont=["Ignore HC-07"])]
    problems = verify.reference_problems(rules, [])
    assert any("BRD-OFFER-09" in p for p in problems)
    assert any("HC-07" in p for p in problems)


def test_a_choice_needs_a_real_default_pick_and_sources():
    rules = [rule("BRD-OFFER-01", "Offer it.")]
    problems = verify.reference_problems(rules, [choice("HC-01", default="z", pick="y", sources=["INF-NEG-99"])])
    assert len(problems) == 3
