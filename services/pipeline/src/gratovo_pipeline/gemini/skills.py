"""Gemini skills (Gemini 4 Argon) -- package a skill folder, upload or replace it, turn it on or
off, read it back, delete it. The Skills page is `/u/N/customize/skills`.

A skill is a folder with `SKILL.md` at its root (YAML front matter: a kebab-case `name` and a
`description`) plus any reference files and scripts. What the page accepts, from Google's help
page and the live page (2026-10-14):

  * an upload is a `.zip` whose top folder holds SKILL.md; the folder tree is kept;
  * plain-text files (md, txt, py, sh, json, yaml, csv, html, css), PDFs and images; no Office
    files; 100 MB in all; stray binaries (.pyc, .DS_Store) can make the upload fail;
  * "Replace" swaps every file AND turns the skill off;
  * a skill **with scripts** is refused in a chat (files and all) and only works in a task; a
    skill of references alone works in both;
  * right after an upload a task once saw no files; a minute later they were there -- `probe()`
    checks that Gemini really reads the version just uploaded.

How an upload runs: this module opens the Skills page, the extension opens the upload dialog
(`skill_upload_open`), the background drops the zip from the page's own world (`drop_files`),
and the extension waits for the upload, checks the name the page read from SKILL.md, and saves
(`skill_upload_finish`). `deploy()` does all of it plus "on/off" and a read-back of the file list.
Wire shapes: PROTOCOL.md ("skills_* / skill_* methods") and DAEMON.md ("action.skill_*").
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from gratovo_pipeline.gemini.errors import BadParams, GeminiError, SkillInvalid, SkillVerifyFailed
from gratovo_pipeline.gemini.progress import Emit, emit_progress

if TYPE_CHECKING:  # pragma: no cover - typing only
    from gratovo_pipeline.gemini.client import Gemini

GEMINI_ORIGIN = "https://gemini.google.com"
SKILLS_PATH = "/customize/skills"

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_TOTAL_BYTES = 100 * 1024 * 1024
#: What the upload accepts (help page: plain text, PDF, images).
ALLOWED_SUFFIXES = frozenset(
    {
        ".md",
        ".txt",
        ".py",
        ".sh",
        ".json",
        ".yaml",
        ".yml",
        ".csv",
        ".tsv",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".toml",
        ".xml",
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
    }
)
#: Never packaged: caches, VCS, OS litter.
SKIPPED_DIRS = frozenset({"__pycache__", ".git", ".svn", ".idea", ".vscode", "node_modules"})
SKIPPED_FILES = frozenset({".DS_Store", "Thumbs.db", "desktop.ini"})
SCRIPT_SUFFIXES = frozenset({".py", ".sh"})
#: A fixed timestamp keeps the zip byte-identical for identical input (sha256 = version).
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

READ_TIMEOUT_S = 120.0
WRITE_TIMEOUT_S = 180.0


# --- packaging -----------------------------------------------------------------------


@dataclass
class SkillPackage:
    """A skill folder, checked and zipped the way the upload dialog wants it."""

    name: str
    description: str
    files: list[str]  # posix paths relative to the skill folder, SKILL.md first
    data: bytes  # the zip
    sha256: str
    total_bytes: int
    has_scripts: bool
    front_matter: dict[str, str] = field(default_factory=dict[str, str])

    @property
    def zip_name(self) -> str:
        return f"{self.name}.zip"

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "files": list(self.files),
            "sha256": self.sha256,
            "bytes": self.total_bytes,
            "zipBytes": len(self.data),
            "hasScripts": self.has_scripts,
        }


def front_matter(text: str) -> dict[str, str]:
    """The `key: value` lines between the opening `---` lines of SKILL.md (quotes stripped)."""
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return {}
    out: dict[str, str] = {}
    key: str | None = None
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        match = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if match:
            key = str(match.group(1))
            value = match.group(2).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            out[key] = value
        elif key and line.startswith((" ", "\t")) and line.strip():
            out[key] = (out[key] + " " + line.strip()).strip()  # folded continuation
    return {}  # no closing ---: not front matter


def _walk(folder: Path) -> list[Path]:
    out: list[Path] = []
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if any(part in SKIPPED_DIRS for part in rel.parts[:-1]) or (
            path.is_dir() and path.name in SKIPPED_DIRS
        ):
            continue
        if path.is_file():
            out.append(path)
    return out


def build(folder: Path | str) -> SkillPackage:
    """Checks `folder` against what the Skills page accepts and zips it.

    Raises `SKILL_INVALID` otherwise.
    """
    folder = Path(folder)
    problems: list[str] = []
    skill_md = folder / "SKILL.md"
    if not folder.is_dir():
        raise SkillInvalid(
            message=f"not a folder: {folder}",
            details={"problems": ["missing folder"], "path": str(folder)},
        )
    if not skill_md.is_file():
        raise SkillInvalid(
            message=f"{folder} has no SKILL.md at its root",
            details={"problems": ["SKILL.md missing at the root"], "path": str(folder)},
        )
    meta = front_matter(skill_md.read_text(encoding="utf-8-sig"))
    name = str(meta.get("name") or "").strip()
    description = str(meta.get("description") or "").strip()
    if not meta:
        problems.append("SKILL.md has no front matter (--- name: ... description: ... ---)")
    if not NAME_RE.match(name):
        problems.append(f"name {name!r} is not kebab-case (lowercase words joined by hyphens)")
    if not description:
        problems.append("description is empty")
    files: list[str] = []
    total = 0
    has_scripts = False
    for path in _walk(folder):
        rel = path.relative_to(folder).as_posix()
        if path.name in SKIPPED_FILES or path.suffix == ".pyc":
            continue
        if path.name.startswith("."):
            problems.append(f"hidden file {rel} (remove it; hidden files can make the upload fail)")
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES and path.name != "SKILL.md":
            problems.append(
                f"{rel}: {path.suffix or 'no extension'} files are not accepted "
                "(plain text, PDF or images only)"
            )
            continue
        total += path.stat().st_size
        has_scripts = (
            has_scripts or path.suffix.lower() in SCRIPT_SUFFIXES or rel.startswith("scripts/")
        )
        files.append(rel)
    if total > MAX_TOTAL_BYTES:
        problems.append(f"{total / 1e6:.1f} MB in all; the limit is 100 MB")
    if problems:
        raise SkillInvalid(
            message=f"{folder.name} is not a valid skill: " + "; ".join(problems),
            details={"problems": problems, "path": str(folder)},
        )
    files.sort(key=lambda p: (p != "SKILL.md", p))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            info = zipfile.ZipInfo(f"{name}/{rel}", date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (folder / rel).read_bytes())
    data = buffer.getvalue()
    return SkillPackage(
        name=name,
        description=description,
        files=files,
        data=data,
        sha256=hashlib.sha256(data).hexdigest(),
        total_bytes=total,
        has_scripts=has_scripts,
        front_matter=meta,
    )


# --- the page ------------------------------------------------------------------------


def _account_index(gemini: Gemini) -> int:
    index = gemini.call("get_url").get("accountIndex")
    return index if isinstance(index, int) and index >= 0 else 0


def open_page(gemini: Gemini, timeout: float = 45.0) -> str:
    """Loads the Skills page under the account the tab is on; returns where it landed."""
    url = f"{GEMINI_ORIGIN}/u/{_account_index(gemini)}{SKILLS_PATH}"
    landed = str(gemini.navigate(url, timeout=timeout).get("url") or "")
    if SKILLS_PATH not in landed:
        raise GeminiError(
            "SKILL_UI_NOT_FOUND",
            f"the Skills page did not open: asked for {url}, landed on {landed or 'nothing'}. "
            "Skills need a personal Google account with Keep Activity on.",
            {"element": "skillsPage", "url": landed, "requestedUrl": url},
        )
    return landed


def _on_page(gemini: Gemini) -> None:
    if SKILLS_PATH not in str(gemini.call("get_url").get("url") or ""):
        open_page(gemini)


def to_chat(gemini: Gemini, timeout: float = 45.0) -> None:
    """Back to a chat page when the tab is elsewhere (the Skills page has no prompt box)."""
    current = str(gemini.call("get_url").get("url") or "")
    if "/app" in current and SKILLS_PATH not in current:
        return
    gemini.navigate(f"{GEMINI_ORIGIN}/u/{_account_index(gemini)}/app", timeout=timeout)


def _ext(gemini: Gemini, method: str, params: dict[str, Any], timeout: float) -> Any:
    return gemini.call(method, {**params, "timeoutMs": int(timeout * 1000)}, timeout=timeout + 20)


def list_skills(gemini: Gemini) -> list[dict[str, Any]]:
    """`[{name, description, active, state}]` -- the account's own skills, not the templates."""
    _on_page(gemini)
    return list(_ext(gemini, "skills_list", {}, 30.0).get("skills") or [])


def read(gemini: Gemini, name: str, contents: bool = False) -> dict[str, Any]:
    """The skill as its page shows it.

    `{name, description, instructions, active, files: [{path, kind, content?}]}`.
    """
    _on_page(gemini)
    return _ext(gemini, "skill_read", {"name": name, "contents": bool(contents)}, READ_TIMEOUT_S)


def set_active(gemini: Gemini, name: str, active: bool) -> dict[str, Any]:
    """Turns the skill on or off (only an active skill is used without being @-mentioned)."""
    _on_page(gemini)
    return _ext(gemini, "skill_set_active", {"name": name, "active": bool(active)}, 40.0)


def delete(gemini: Gemini, name: str) -> dict[str, Any]:
    """Deletes the skill for good (the page says it cannot be undone)."""
    _on_page(gemini)
    return _ext(gemini, "skill_delete", {"name": name}, 40.0)


def upload(
    gemini: Gemini,
    package: SkillPackage,
    timeout: float = WRITE_TIMEOUT_S,
    emit: Emit | None = None,
) -> dict[str, Any]:
    """Creates the skill, or replaces it when one of that name exists.

    Returns the page's answer + `mode`.
    """
    _on_page(gemini)
    names = {s.get("name") for s in list_skills(gemini)}
    replace = package.name in names
    emit_progress(
        emit, "skill_upload", 0, 3, ("replacing" if replace else "creating") + f" {package.name}"
    )
    opened = _ext(gemini, "skill_upload_open", {"replace": package.name} if replace else {}, 30.0)
    selector = opened.get("dropSelector") or "skill-folder-upload-modal .upload-area"
    emit_progress(emit, "skill_upload", 1, 3, f"uploading {len(package.data) / 1024:.0f} KB")
    gemini.call(
        "drop_files",
        {
            "selector": selector,
            "waitMs": 5000,
            "files": [
                {
                    "name": package.zip_name,
                    "type": "application/zip",
                    "base64": base64.b64encode(package.data).decode("ascii"),
                }
            ],
        },
        timeout=60.0,
    )
    emit_progress(emit, "skill_upload", 2, 3, "waiting for Gemini to take it")
    result = _ext(gemini, "skill_upload_finish", {"expectName": package.name}, timeout)
    emit_progress(emit, "skill_upload", 3, 3, "saved")
    return {**result, "mode": "replace" if replace else "create"}


def verify(gemini: Gemini, package: SkillPackage) -> dict[str, Any]:
    """Reads the skill back; `SKILL_VERIFY_FAILED` unless its files are exactly the package's."""
    page = read(gemini, package.name)
    page_files: list[dict[str, Any]] = page.get("files") or []
    on_page: list[str] = sorted(f["path"] for f in page_files if f.get("kind") == "file")
    wanted = sorted(package.files)
    missing = [p for p in wanted if p not in on_page]
    extra = [p for p in on_page if p not in wanted]
    if missing or extra:
        raise SkillVerifyFailed(
            message=f"{package.name} on the page does not match the upload "
            f"(missing {missing or 'none'}, extra {extra or 'none'})",
            details={"missing": missing, "extra": extra, "onPage": on_page},
        )
    if (
        page.get("description")
        and package.description
        and " ".join(page["description"].split()) != " ".join(package.description.split())
    ):
        raise SkillVerifyFailed(
            message=f"{package.name}: the page shows another description",
            details={"page": page.get("description"), "package": package.description},
        )
    return {"files": on_page, "active": bool(page.get("active"))}


def deploy(
    gemini: Gemini,
    folder: Path | str,
    active: bool = False,
    check: bool = True,
    emit: Emit | None = None,
) -> dict[str, Any]:
    """Builds `folder`, uploads it (create or replace), sets on/off, and reads it back.

    `active` False keeps it out of the user's other chats (it is still usable by @-mention, which
    is how the workflow calls it). Returns the package summary + `{mode, active, verified}`.
    """
    package = build(folder)
    result = upload(gemini, package, emit=emit)
    if result.get("mode") == "create":
        # The list does not show a just-created skill until the page is loaded again (live,
        # 2026-10-18: turning it on straight after Create failed with SKILL_NOT_FOUND although
        # the skill was there).
        open_page(gemini)
    state = set_active(gemini, package.name, active)
    verified = verify(gemini, package) if check else None
    return {
        **package.summary(),
        "mode": result.get("mode"),
        "notice": result.get("notice"),
        "active": state.get("active"),
        "verified": verified is not None,
        "onPage": verified["files"] if verified else None,
    }


def probe(
    gemini: Gemini,
    name: str,
    question: str,
    expect: str,
    mode: str = "chat",
    timeout: float = 240.0,
    attempts: int = 3,
    wait_s: float = 45.0,
) -> dict[str, Any]:
    """Asks the skill `question` (by @-mention) until the answer contains `expect`.

    This is the end-to-end check that Gemini reads the version just uploaded (the build id in a
    reference file, say). Right after an upload the files can take a minute to reach Gemini, so a
    miss is retried after `wait_s`. `mode` "task" for a skill with scripts (chat refuses those).
    """
    last = ""
    to_chat(gemini)
    for attempt in range(1, attempts + 1):
        answer = gemini.send(
            question, wait=True, new_chat=True, mode=mode, skills=[name], timeout=timeout
        )
        last = str(answer.get("textRaw") or answer.get("text") or "")
        if expect in last:
            return {"ok": True, "attempts": attempt, "answer": last}
        if attempt < attempts:
            time.sleep(wait_s)
    raise SkillVerifyFailed(
        message=f"{name}: Gemini's answer never contained {expect!r}",
        details={"answer": last[:2000], "attempts": attempts},
    )


# --- daemon actions --------------------------------------------------------------------


def _name(params: dict[str, Any]) -> str:
    name = params.get("name")
    if not isinstance(name, str) or not name.strip():
        raise BadParams(message="this action needs the skill's `name`")
    return name.strip()


def action_list(gemini: Gemini, params: dict[str, Any]) -> dict[str, Any]:
    return {"skills": list_skills(gemini)}


def action_read(gemini: Gemini, params: dict[str, Any]) -> dict[str, Any]:
    return read(gemini, _name(params), contents=bool(params.get("contents")))


def action_set_active(gemini: Gemini, params: dict[str, Any]) -> dict[str, Any]:
    return set_active(gemini, _name(params), params.get("active") is not False)


def action_delete(gemini: Gemini, params: dict[str, Any]) -> dict[str, Any]:
    if params.get("confirm") is not True:
        raise BadParams(message="skill_delete cannot be undone; pass `confirm: true`")
    return delete(gemini, _name(params))


def action_deploy(
    gemini: Gemini, params: dict[str, Any], emit: Emit | None = None
) -> dict[str, Any]:
    folder = params.get("folder")
    if not isinstance(folder, str) or not folder.strip():
        raise BadParams(message="skill_deploy needs `folder` (a skill folder with SKILL.md)")
    return deploy(
        gemini,
        Path(folder),
        active=bool(params.get("active")),
        check=params.get("verify") is not False,
        emit=emit,
    )
