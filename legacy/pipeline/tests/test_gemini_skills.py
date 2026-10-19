"""Tests for Gemini 4 Argon skills (gemini_bridge/skills.py) and the client's task/skill send options.

Run with:  python -m pytest -q tests/test_gemini_skills.py    (from pipeline/)

The extension is the scripted `FakeExtension`. What is pinned is Python's half:

  * packaging refuses what the Skills page refuses (no SKILL.md, a name that is not kebab-case,
    Office files, hidden files) and never ships caches; the zip's top folder is the skill's name and
    its bytes depend only on the input (sha256 = version);
  * an upload replaces when a skill of that name exists and creates otherwise, drops the zip on the
    exact zone the extension resolved, and waits for the page to take it;
  * deploy turns the skill to the asked state and fails loudly when the page's files are not the
    package's;
  * delete needs `confirm: true`; probe retries until Gemini quotes the expected text;
  * `send(mode=..., skills=[...])` reaches the extension as `mode` / `skills`.
"""

from __future__ import annotations

import base64
import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_gemini_bridge import Harness, WireError, harness, no_threads_left_behind  # noqa: E402,F401

from gemini_bridge import GeminiError, actions, skills  # noqa: E402


def make_skill(root: Path, name: str = "gratovo-comms", description: str = "Influencer and brand communication.",
               files: dict | None = None) -> Path:
    folder = root / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\n\n# Body\nDo the work.\n",
                                     encoding="utf-8")
    for rel, text in (files or {}).items():
        path = folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return folder


# --- packaging -------------------------------------------------------------------------

def test_build_zips_the_folder_under_its_name_skill_md_first(tmp_path):
    folder = make_skill(tmp_path, files={"references/playbook.md": "# Playbook", "references/cases/a.md": "A",
                                         "scripts/check.py": "print(1)"})
    pkg = skills.build(folder)
    assert pkg.name == "gratovo-comms"
    assert pkg.files == ["SKILL.md", "references/cases/a.md", "references/playbook.md", "scripts/check.py"]
    assert pkg.has_scripts is True
    with zipfile.ZipFile(io.BytesIO(pkg.data)) as z:
        assert z.namelist() == ["gratovo-comms/SKILL.md", "gratovo-comms/references/cases/a.md",
                                "gratovo-comms/references/playbook.md", "gratovo-comms/scripts/check.py"]
        assert z.read("gratovo-comms/references/playbook.md") == b"# Playbook"


def test_build_is_deterministic_and_the_hash_follows_the_content(tmp_path):
    folder = make_skill(tmp_path, files={"references/a.md": "one"})
    first, second = skills.build(folder), skills.build(folder)
    assert first.data == second.data and first.sha256 == second.sha256
    (folder / "references" / "a.md").write_text("two", encoding="utf-8")
    assert skills.build(folder).sha256 != first.sha256


def test_build_skips_caches_and_os_litter(tmp_path):
    folder = make_skill(tmp_path, files={"scripts/check.py": "print(1)"})
    (folder / "scripts" / "__pycache__").mkdir()
    (folder / "scripts" / "__pycache__" / "check.cpython-311.pyc").write_bytes(b"\0\0")
    (folder / ".DS_Store").write_bytes(b"\0")
    assert skills.build(folder).files == ["SKILL.md", "scripts/check.py"]


def test_a_references_only_skill_has_no_scripts(tmp_path):
    assert skills.build(make_skill(tmp_path, files={"references/a.md": "x"})).has_scripts is False


@pytest.mark.parametrize("name, description, extra, problem", [
    ("Gratovo Comms", "ok", {}, "kebab-case"),
    ("gratovo_comms", "ok", {}, "kebab-case"),
    ("gratovo-comms", "", {}, "description is empty"),
    ("gratovo-comms", "ok", {"references/brief.docx": "x"}, ".docx files are not accepted"),
    ("gratovo-comms", "ok", {"references/.secret": "x"}, "hidden file"),
])
def test_build_refuses_what_the_page_refuses(tmp_path, name, description, extra, problem):
    folder = tmp_path / "skill"
    folder.mkdir()
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\nbody\n", encoding="utf-8")
    for rel, text in extra.items():
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        (folder / rel).write_text(text, encoding="utf-8")
    with pytest.raises(GeminiError) as info:
        skills.build(folder)
    assert info.value.code == "SKILL_INVALID"
    assert any(problem in p for p in info.value.details["problems"]), info.value.details


def test_build_needs_skill_md_at_the_root(tmp_path):
    folder = tmp_path / "x"
    (folder / "inner").mkdir(parents=True)
    (folder / "inner" / "SKILL.md").write_text("---\nname: x\ndescription: y\n---\n", encoding="utf-8")
    with pytest.raises(GeminiError) as info:
        skills.build(folder)
    assert info.value.code == "SKILL_INVALID"


def test_front_matter_reads_quoted_and_folded_values():
    meta = skills.front_matter('---\nname: "my-skill"\ndescription: Use when\n  drafting replies.\n---\nbody')
    assert meta == {"name": "my-skill", "description": "Use when drafting replies."}
    assert skills.front_matter("no front matter") == {}
    assert skills.front_matter("---\nname: x\n(no closing line)") == {}


# --- the page --------------------------------------------------------------------------

def skills_page(handlers: dict, account: int = 1, existing=("cold-email-drafter",), files_on_page=None) -> dict:
    state = {"url": f"https://gemini.google.com/u/{account}/app"}

    def navigate(p):
        state["url"] = p["url"]
        return {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]}

    base = {
        "get_url": lambda p: {"url": state["url"], "accountIndex": account},
        "navigate": navigate,
        "skills_list": {"skills": [{"name": n, "description": "d", "active": True, "state": "active"} for n in existing]},
        "skill_upload_open": lambda p: {"mode": "replace" if p.get("replace") else "create", "dropZone": True,
                                        "dropSelector": '[data-gb-drop="gbtest"]'},
        "drop_files": {"dropped": True, "files": 1, "bytes": 10, "target": "div.upload-area"},
        "skill_upload_finish": lambda p: {"mode": "create", "name": p["expectName"], "saved": True, "progress": [],
                                          "notice": "تم إنشاء المهارة"},
        "skill_set_active": lambda p: {"name": p["name"], "active": p["active"], "changed": True, "notice": None},
    }
    if files_on_page is not None:
        base["skill_read"] = lambda p: {"name": p["name"], "description": "Influencer and brand communication.",
                                        "instructions": "x", "active": False,
                                        "files": [{"path": f, "kind": "file"} for f in files_on_page]}
    base.update(handlers)
    return base


def test_upload_creates_when_the_name_is_new_and_drops_on_the_resolved_zone(harness: Harness, tmp_path):
    pkg = skills.build(make_skill(tmp_path, files={"references/a.md": "x"}))
    fake = harness.attach(skills_page({}))
    result = skills.upload(harness.gemini, pkg)
    assert result["mode"] == "create"
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/1/customize/skills"
    assert fake.calls("skill_upload_open")[0].get("replace") is None
    drop = fake.calls("drop_files")[0]
    assert drop["selector"] == '[data-gb-drop="gbtest"]'
    assert drop["files"][0]["name"] == "gratovo-comms.zip"
    assert base64.b64decode(drop["files"][0]["base64"]) == pkg.data
    assert fake.calls("skill_upload_finish")[0]["expectName"] == "gratovo-comms"


def test_upload_replaces_when_a_skill_of_that_name_exists(harness: Harness, tmp_path):
    pkg = skills.build(make_skill(tmp_path))
    fake = harness.attach(skills_page({}, existing=("gratovo-comms",)))
    assert skills.upload(harness.gemini, pkg)["mode"] == "replace"
    assert fake.calls("skill_upload_open")[0]["replace"] == "gratovo-comms"


def test_deploy_sets_the_state_and_verifies_the_files(harness: Harness, tmp_path):
    folder = make_skill(tmp_path, files={"references/a.md": "x"})
    fake = harness.attach(skills_page({}, files_on_page=["SKILL.md", "references/a.md"]))
    result = skills.deploy(harness.gemini, folder, active=True)
    assert result["verified"] is True and result["active"] is True
    assert fake.calls("skill_set_active")[0] == {"name": "gratovo-comms", "active": True, "timeoutMs": 40000}


def test_deploy_reloads_the_list_after_creating_before_turning_it_on(harness: Harness, tmp_path):
    # Live, 2026-10-18: right after Create saves, the Skills list does not show the new card yet, so turning it
    # on failed with SKILL_NOT_FOUND on both accounts although the skill had been created.
    folder = make_skill(tmp_path, files={"references/a.md": "x"})
    seen = {"reloaded": False, "created": False, "url": "https://gemini.google.com/u/1/app"}

    def finish(p):
        seen["created"] = True
        return {"mode": "create", "name": p["expectName"], "saved": True, "progress": [], "notice": None}

    def navigate(p):
        if seen["created"]:
            seen["reloaded"] = True
        seen["url"] = p["url"]
        return {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]}

    def set_active(p):
        if not seen["reloaded"]:
            raise WireError("SKILL_NOT_FOUND", 'No skill named "gratovo-comms" on the Skills page', {})
        return {"name": p["name"], "active": p["active"], "changed": True, "notice": None}

    harness.attach(skills_page({"skill_upload_finish": finish, "navigate": navigate,
                                "get_url": lambda p: {"url": seen["url"], "accountIndex": 1},
                                "skill_set_active": set_active},
                               files_on_page=["SKILL.md", "references/a.md"]))
    result = skills.deploy(harness.gemini, folder, active=True)
    assert result["mode"] == "create"
    assert result["active"] is True


def test_deploy_fails_when_the_page_has_other_files(harness: Harness, tmp_path):
    folder = make_skill(tmp_path, files={"references/a.md": "x", "references/b.md": "y"})
    harness.attach(skills_page({}, files_on_page=["SKILL.md", "references/a.md", "references/old.md"]))
    with pytest.raises(GeminiError) as info:
        skills.deploy(harness.gemini, folder)
    assert info.value.code == "SKILL_VERIFY_FAILED"
    assert info.value.details["missing"] == ["references/b.md"]
    assert info.value.details["extra"] == ["references/old.md"]


def test_a_skills_page_that_does_not_open_says_why(harness: Harness):
    harness.attach({"get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
                    "navigate": lambda p: {"tabId": 1, "url": "https://gemini.google.com/u/0/app", "redirected": True,
                                           "requestedUrl": p["url"]}})
    with pytest.raises(GeminiError) as info:
        skills.list_skills(harness.gemini)
    assert info.value.code == "SKILL_UI_NOT_FOUND"
    assert "personal Google account" in info.value.message


def test_the_extension_errors_come_through(harness: Harness):
    harness.attach(skills_page({"skill_set_active": WireError("SKILL_NOT_FOUND", "No skill named x",
                                                              {"available": ["a"]})}))
    with pytest.raises(GeminiError) as info:
        skills.set_active(harness.gemini, "x", True)
    assert info.value.code == "SKILL_NOT_FOUND"
    assert info.value.details["available"] == ["a"]


def test_delete_action_needs_confirm(harness: Harness):
    fake = harness.attach(skills_page({"skill_delete": lambda p: {"name": p["name"], "deleted": True, "notice": None}}))
    with pytest.raises(GeminiError) as info:
        actions.run_action(harness.gemini, "action.skill_delete", {"name": "old-skill"})
    assert info.value.code == "BAD_PARAMS"
    assert fake.calls("skill_delete") == []
    result = actions.run_action(harness.gemini, "action.skill_delete", {"name": "old-skill", "confirm": True})
    assert result["deleted"] is True


def test_deploy_action_reports_progress(harness: Harness, tmp_path):
    folder = make_skill(tmp_path)
    harness.attach(skills_page({}, files_on_page=["SKILL.md"]))
    events = []
    result = actions.run_action(harness.gemini, "action.skill_deploy", {"folder": str(folder)},
                                emit=lambda event, data: events.append(data))
    assert result["name"] == "gratovo-comms" and result["verified"] is True and result["active"] is False
    assert [e.get("done") for e in events if e.get("action") == "skill_upload"][-1] == 3


def test_probe_retries_until_the_answer_has_the_expected_text(harness: Harness, monkeypatch):
    answers = iter(["I could not find it.", "The build id is build-42."])
    fake = harness.attach({"get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
                           "send": lambda p: {"text": next(answers), "textRaw": None, "mode": p.get("mode")}})
    monkeypatch.setattr(skills.time, "sleep", lambda s: None)
    result = skills.probe(harness.gemini, "gratovo-comms", "Build id?", "build-42", attempts=3)
    assert result == {"ok": True, "attempts": 2, "answer": "The build id is build-42."}
    sent = fake.calls("send")
    assert sent[0]["skills"] == ["gratovo-comms"] and sent[0]["newChat"] is True and sent[0]["mode"] == "chat"


def test_probe_gives_up_with_the_last_answer(harness: Harness, monkeypatch):
    harness.attach({"get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
                    "send": {"text": "no idea", "textRaw": "no idea"}})
    monkeypatch.setattr(skills.time, "sleep", lambda s: None)
    with pytest.raises(GeminiError) as info:
        skills.probe(harness.gemini, "gratovo-comms", "Build id?", "build-42", attempts=2)
    assert info.value.code == "SKILL_VERIFY_FAILED"
    assert info.value.details["answer"] == "no idea"


# --- the client's Argon options --------------------------------------------------------

def test_send_passes_mode_and_skills(harness: Harness):
    fake = harness.attach({"send": {"text": "ok", "mode": "task", "task": {"done": True, "steps": []}}})
    result = harness.gemini.send("Draft it.", mode="task", skills=["gratovo-comms"], timeout=30)
    assert result["mode"] == "task"
    sent = fake.calls("send")[0]
    assert sent["mode"] == "task" and sent["skills"] == ["gratovo-comms"] and sent["timeoutMs"] == 30000


def test_send_refuses_an_unknown_mode(harness: Harness):
    harness.attach({})
    with pytest.raises(GeminiError) as info:
        harness.gemini.send("x", mode="deep")
    assert info.value.code == "BAD_PARAMS"


def test_thinking_level_and_mode_helpers(harness: Harness):
    fake = harness.attach({
        "get_mode": {"mode": "chat", "available": True},
        "set_mode": lambda p: {"mode": p["mode"], "changed": True},
        "list_thinking_levels": {"menu": "مستوى التفكير", "levels": [{"name": "منخفض"}, {"name": "مرتفع"}], "current": "منخفض"},
        "set_thinking_level": lambda p: {"level": p["level"], "changed": True},
    })
    g = harness.gemini
    assert g.mode() == "chat"
    assert g.set_mode("task")["mode"] == "task"
    assert g.thinking_levels()["current"] == "منخفض"
    assert g.set_thinking_level("مرتفع", timeout=5)["level"] == "مرتفع"
    assert fake.calls("set_thinking_level")[0]["timeoutMs"] == 5000
