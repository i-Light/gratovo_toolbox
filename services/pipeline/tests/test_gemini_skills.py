"""Tests for Gemini 4 Argon skills (gemini/skills.py), ported from the old test_gemini_skills.

The extension is a scripted fake `Gemini`. What is pinned is Python's half:

  * packaging refuses what the Skills page refuses (no SKILL.md, a name that is not kebab-case,
    Office files, hidden files) and never ships caches; the zip's top folder is the skill's name and
    its bytes depend only on the input (sha256 = version);
  * an upload replaces when a skill of that name exists and creates otherwise, drops the zip on the
    exact zone the extension resolved, and waits for the page to take it;
  * deploy turns the skill to the asked state and fails loudly when the page's files are not the
    package's;
  * delete needs `confirm: true`; probe retries until Gemini quotes the expected text.
"""

import base64
import io
import zipfile
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.gemini import skills
from gratovo_pipeline.gemini.errors import GeminiError, error_from_payload

# A result, a WireError, or a callable taking the params.
type Handler = Callable[[dict[str, Any]], Any] | Mapping[str, Any] | Exception


class WireError(Exception):
    """A scripted handler answers with `{ok: false, error: {...}}`."""

    def __init__(self, code: str, message: str = "", details: dict[str, Any] | None = None) -> None:
        super().__init__(code, message)
        self.code, self.message, self.details = code, message, details or {}


class FakeGemini:
    """Stands in for `Gemini`: scripted answers by method, and a record of every call."""

    def __init__(self, handlers: dict[str, Handler]) -> None:
        self.handlers = handlers
        self.log: list[tuple[str, dict[str, Any]]] = []

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        del timeout
        sent = dict(params or {})
        self.log.append((method, sent))
        handler = self.handlers.get(method)
        if handler is None:
            raise error_from_payload(
                {"code": "BAD_PARAMS", "message": f"unknown method {method!r}"}
            )
        if isinstance(handler, WireError):
            raise error_from_payload(
                {"code": handler.code, "message": handler.message, "details": handler.details}
            )
        return handler(sent) if callable(handler) else handler

    def navigate(self, url: str, timeout: float | None = None) -> Any:
        params: dict[str, Any] = {"url": url}
        if timeout is not None:
            params["timeoutMs"] = int(timeout * 1000)
        return self.call("navigate", params)

    def send(
        self,
        text: str,
        *,
        wait: bool = True,
        new_chat: bool = False,
        mode: str | None = None,
        skills: list[str] | None = None,
        timeout: float = 180.0,
    ) -> Any:
        params: dict[str, Any] = {
            "text": text,
            "wait": wait,
            "newChat": new_chat,
            "mode": mode,
            "skills": skills,
            "timeoutMs": int(timeout * 1000),
        }
        return self.call("send", params)

    def calls(self, method: str) -> list[dict[str, Any]]:
        return [params for name, params in self.log if name == method]


def fake_for(handlers: dict[str, Handler]) -> Any:
    """A `FakeGemini` typed loosely, so tests can pass it where a `Gemini` is expected."""
    return FakeGemini(handlers)


def make_skill(
    root: Path,
    name: str = "gratovo-comms",
    description: str = "Creator and brand communication.",
    files: dict[str, str] | None = None,
) -> Path:
    folder = root / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# Body\nDo the work.\n",
        encoding="utf-8",
    )
    for rel, text in (files or {}).items():
        path = folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return folder


# --- packaging -------------------------------------------------------------------------


def test_build_zips_the_folder_under_its_name_skill_md_first(tmp_path: Path) -> None:
    folder = make_skill(
        tmp_path,
        files={
            "references/playbook.md": "# Playbook",
            "references/cases/a.md": "A",
            "scripts/check.py": "print(1)",
        },
    )
    pkg = skills.build(folder)
    assert pkg.name == "gratovo-comms"
    assert pkg.files == [
        "SKILL.md",
        "references/cases/a.md",
        "references/playbook.md",
        "scripts/check.py",
    ]
    assert pkg.has_scripts is True
    with zipfile.ZipFile(io.BytesIO(pkg.data)) as z:
        assert z.namelist() == [
            "gratovo-comms/SKILL.md",
            "gratovo-comms/references/cases/a.md",
            "gratovo-comms/references/playbook.md",
            "gratovo-comms/scripts/check.py",
        ]
        assert z.read("gratovo-comms/references/playbook.md") == b"# Playbook"


def test_build_is_deterministic_and_the_hash_follows_the_content(tmp_path: Path) -> None:
    folder = make_skill(tmp_path, files={"references/a.md": "one"})
    first, second = skills.build(folder), skills.build(folder)
    assert first.data == second.data
    assert first.sha256 == second.sha256
    (folder / "references" / "a.md").write_text("two", encoding="utf-8")
    assert skills.build(folder).sha256 != first.sha256


def test_build_skips_caches_and_os_litter(tmp_path: Path) -> None:
    folder = make_skill(tmp_path, files={"scripts/check.py": "print(1)"})
    (folder / "scripts" / "__pycache__").mkdir()
    (folder / "scripts" / "__pycache__" / "check.cpython-311.pyc").write_bytes(b"\0\0")
    (folder / ".DS_Store").write_bytes(b"\0")
    assert skills.build(folder).files == ["SKILL.md", "scripts/check.py"]


def test_a_references_only_skill_has_no_scripts(tmp_path: Path) -> None:
    assert skills.build(make_skill(tmp_path, files={"references/a.md": "x"})).has_scripts is False


@pytest.mark.parametrize(
    ("name", "description", "extra", "problem"),
    [
        ("Gratovo Comms", "ok", {}, "kebab-case"),
        ("gratovo_comms", "ok", {}, "kebab-case"),
        ("gratovo-comms", "", {}, "description is empty"),
        ("gratovo-comms", "ok", {"references/brief.docx": "x"}, ".docx files are not accepted"),
        ("gratovo-comms", "ok", {"references/.secret": "x"}, "hidden file"),
    ],
)
def test_build_refuses_what_the_page_refuses(
    tmp_path: Path, name: str, description: str, extra: dict[str, str], problem: str
) -> None:
    folder = tmp_path / "skill"
    folder.mkdir()
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\nbody\n", encoding="utf-8"
    )
    for rel, text in extra.items():
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        (folder / rel).write_text(text, encoding="utf-8")
    with pytest.raises(GeminiError) as info:
        skills.build(folder)
    assert info.value.code == "SKILL_INVALID"
    assert any(problem in p for p in info.value.details["problems"]), info.value.details


def test_build_needs_skill_md_at_the_root(tmp_path: Path) -> None:
    folder = tmp_path / "x"
    (folder / "inner").mkdir(parents=True)
    (folder / "inner" / "SKILL.md").write_text(
        "---\nname: x\ndescription: y\n---\n", encoding="utf-8"
    )
    with pytest.raises(GeminiError) as info:
        skills.build(folder)
    assert info.value.code == "SKILL_INVALID"


def test_front_matter_reads_quoted_and_folded_values() -> None:
    meta = skills.front_matter(
        '---\nname: "my-skill"\ndescription: Use when\n  drafting replies.\n---\nbody'
    )
    assert meta == {"name": "my-skill", "description": "Use when drafting replies."}
    assert skills.front_matter("no front matter") == {}
    assert skills.front_matter("---\nname: x\n(no closing line)") == {}


# --- the page --------------------------------------------------------------------------


def skills_page(
    handlers: dict[str, Handler],
    account: int = 1,
    existing: tuple[str, ...] = ("cold-email-drafter",),
    files_on_page: list[str] | None = None,
) -> Any:
    state = {"url": f"https://gemini.google.com/u/{account}/app"}

    def navigate(p: dict[str, Any]) -> dict[str, Any]:
        state["url"] = p["url"]
        return {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]}

    base: dict[str, Handler] = {
        "get_url": lambda _p: {"url": state["url"], "accountIndex": account},
        "navigate": navigate,
        "skills_list": {
            "skills": [
                {"name": n, "description": "d", "active": True, "state": "active"} for n in existing
            ]
        },
        "skill_upload_open": lambda p: {
            "mode": "replace" if p.get("replace") else "create",
            "dropZone": True,
            "dropSelector": '[data-gb-drop="gbtest"]',
        },
        "drop_files": {"dropped": True, "files": 1, "bytes": 10, "target": "div.upload-area"},
        "skill_upload_finish": lambda p: {
            "mode": "create",
            "name": p["expectName"],
            "saved": True,
            "progress": [],
            "notice": "تم إنشاء المهارة",
        },
        "skill_set_active": lambda p: {
            "name": p["name"],
            "active": p["active"],
            "changed": True,
            "notice": None,
        },
    }
    if files_on_page is not None:
        base["skill_read"] = lambda p: {
            "name": p["name"],
            "description": "Creator and brand communication.",
            "instructions": "x",
            "active": False,
            "files": [{"path": f, "kind": "file"} for f in files_on_page],
        }
    base.update(handlers)
    return fake_for(base)


def test_upload_creates_when_the_name_is_new_and_drops_on_the_resolved_zone(tmp_path: Path) -> None:
    pkg = skills.build(make_skill(tmp_path, files={"references/a.md": "x"}))
    fake = skills_page({})
    result = skills.upload(fake, pkg)
    assert result["mode"] == "create"
    assert fake.calls("navigate")[0]["url"] == "https://gemini.google.com/u/1/customize/skills"
    assert fake.calls("skill_upload_open")[0].get("replace") is None
    drop = fake.calls("drop_files")[0]
    assert drop["selector"] == '[data-gb-drop="gbtest"]'
    assert drop["files"][0]["name"] == "gratovo-comms.zip"
    assert base64.b64decode(drop["files"][0]["base64"]) == pkg.data
    assert fake.calls("skill_upload_finish")[0]["expectName"] == "gratovo-comms"


def test_upload_replaces_when_a_skill_of_that_name_exists(tmp_path: Path) -> None:
    pkg = skills.build(make_skill(tmp_path))
    fake = skills_page({}, existing=("gratovo-comms",))
    assert skills.upload(fake, pkg)["mode"] == "replace"
    assert fake.calls("skill_upload_open")[0]["replace"] == "gratovo-comms"


def test_deploy_sets_the_state_and_verifies_the_files(tmp_path: Path) -> None:
    folder = make_skill(tmp_path, files={"references/a.md": "x"})
    fake = skills_page({}, files_on_page=["SKILL.md", "references/a.md"])
    result = skills.deploy(fake, folder, active=True)
    assert result["verified"] is True
    assert result["active"] is True
    assert fake.calls("skill_set_active")[0] == {
        "name": "gratovo-comms",
        "active": True,
        "timeoutMs": 40000,
    }


def test_deploy_reloads_the_list_after_creating_before_turning_it_on(tmp_path: Path) -> None:
    # Live, 2026-10-18: right after Create saves, the Skills list does not show the new card yet,
    # so turning it on failed with SKILL_NOT_FOUND on both accounts although the skill had been
    # created.
    folder = make_skill(tmp_path, files={"references/a.md": "x"})
    seen: dict[str, Any] = {
        "reloaded": False,
        "created": False,
        "url": "https://gemini.google.com/u/1/app",
    }

    def finish(p: dict[str, Any]) -> dict[str, Any]:
        seen["created"] = True
        return {
            "mode": "create",
            "name": p["expectName"],
            "saved": True,
            "progress": [],
            "notice": None,
        }

    def navigate(p: dict[str, Any]) -> dict[str, Any]:
        if seen["created"]:
            seen["reloaded"] = True
        seen["url"] = p["url"]
        return {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]}

    def set_active(p: dict[str, Any]) -> dict[str, Any]:
        if not seen["reloaded"]:
            raise error_from_payload(
                {
                    "code": "SKILL_NOT_FOUND",
                    "message": 'No skill named "gratovo-comms" on the Skills page',
                }
            )
        return {"name": p["name"], "active": p["active"], "changed": True, "notice": None}

    fake = skills_page(
        {
            "skill_upload_finish": finish,
            "navigate": navigate,
            "get_url": lambda _p: {"url": seen["url"], "accountIndex": 1},
            "skill_set_active": set_active,
        },
        files_on_page=["SKILL.md", "references/a.md"],
    )
    result = skills.deploy(fake, folder, active=True)
    assert result["mode"] == "create"
    assert result["active"] is True


def test_deploy_fails_when_the_page_has_other_files(tmp_path: Path) -> None:
    folder = make_skill(tmp_path, files={"references/a.md": "x", "references/b.md": "y"})
    fake = skills_page({}, files_on_page=["SKILL.md", "references/a.md", "references/old.md"])
    with pytest.raises(GeminiError) as info:
        skills.deploy(fake, folder)
    assert info.value.code == "SKILL_VERIFY_FAILED"
    assert info.value.details["missing"] == ["references/b.md"]
    assert info.value.details["extra"] == ["references/old.md"]


def test_a_skills_page_that_does_not_open_says_why() -> None:
    fake = fake_for(
        {
            "get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
            "navigate": lambda p: {
                "tabId": 1,
                "url": "https://gemini.google.com/u/0/app",
                "redirected": True,
                "requestedUrl": p["url"],
            },
        }
    )
    with pytest.raises(GeminiError) as info:
        skills.list_skills(fake)
    assert info.value.code == "SKILL_UI_NOT_FOUND"
    assert "personal Google account" in info.value.message


def test_the_extension_errors_come_through() -> None:
    fake = skills_page(
        {"skill_set_active": WireError("SKILL_NOT_FOUND", "No skill named x", {"available": ["a"]})}
    )
    with pytest.raises(GeminiError) as info:
        skills.set_active(fake, "x", True)
    assert info.value.code == "SKILL_NOT_FOUND" or info.value.details["code"] == "SKILL_NOT_FOUND"
    assert info.value.details["available"] == ["a"]


def test_delete_action_needs_confirm() -> None:
    fake = skills_page(
        {"skill_delete": lambda p: {"name": p["name"], "deleted": True, "notice": None}}
    )
    # Was `actions.run_action(..., "action.skill_delete", ...)`: calls the module's action directly.
    with pytest.raises(GeminiError) as info:
        skills.action_delete(fake, {"name": "old-skill"})
    assert info.value.code == "BAD_PARAMS"
    assert fake.calls("skill_delete") == []
    result = skills.action_delete(fake, {"name": "old-skill", "confirm": True})
    assert result["deleted"] is True


def test_deploy_action_reports_progress(tmp_path: Path) -> None:
    folder = make_skill(tmp_path)
    fake = skills_page({}, files_on_page=["SKILL.md"])
    events: list[dict[str, Any]] = []
    # Was `actions.run_action(..., "action.skill_deploy", ...)`: calls the module's action directly.
    result = skills.action_deploy(
        fake, {"folder": str(folder)}, emit=lambda _event, data: events.append(data)
    )
    assert result["name"] == "gratovo-comms"
    assert result["verified"] is True
    assert result["active"] is False
    assert [e.get("done") for e in events if e.get("action") == "skill_upload"][-1] == 3


def test_list_action_wraps_the_skills() -> None:
    fake = skills_page({})
    result = skills.action_list(fake, {})
    assert [s["name"] for s in result["skills"]] == ["cold-email-drafter"]


def no_sleep(_seconds: float) -> None:
    return None


def test_probe_retries_until_the_answer_has_the_expected_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answers = iter(["I could not find it.", "The build id is build-42."])
    fake = fake_for(
        {
            "get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
            "send": lambda p: {"text": next(answers), "textRaw": None, "mode": p.get("mode")},
        }
    )
    monkeypatch.setattr(skills.time, "sleep", no_sleep)
    result = skills.probe(fake, "gratovo-comms", "Build id?", "build-42", attempts=3)
    assert result == {"ok": True, "attempts": 2, "answer": "The build id is build-42."}
    sent = fake.calls("send")
    assert sent[0]["skills"] == ["gratovo-comms"]
    assert sent[0]["newChat"] is True
    assert sent[0]["mode"] == "chat"


def test_probe_gives_up_with_the_last_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = fake_for(
        {
            "get_url": {"url": "https://gemini.google.com/u/0/app", "accountIndex": 0},
            "send": {"text": "no idea", "textRaw": "no idea"},
        }
    )
    monkeypatch.setattr(skills.time, "sleep", no_sleep)
    with pytest.raises(GeminiError) as info:
        skills.probe(fake, "gratovo-comms", "Build id?", "build-42", attempts=2)
    assert info.value.code == "SKILL_VERIFY_FAILED"
    assert info.value.details["answer"] == "no idea"
