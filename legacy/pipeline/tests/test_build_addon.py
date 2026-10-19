"""Tests for `pipeline/gemini_extension/tools/build_addon.py` (the Firefox add-on packer).

Run with:  python -m pytest -q tests/test_build_addon.py    (from pipeline/)

The packer's promises, pinned here:

  * the Firefox manifest is derived from the Chrome/Edge MV3 manifest by a pure function, in both
    flavours (MV2 persistent background page / MV3 event page), and is valid for Firefox: the
    gecko id, the minimum version, `data_collection_permissions`, no `update_url` unless asked for;
  * a build contains exactly the shipped files: no tests, tooling, docs or dependencies;
  * the same source always gives the same bytes (sorted entries, fixed timestamps, LF text),
    whichever checkout line endings, file times or output path;
  * a broken source (missing referenced file, bad version) is refused with a message that says
    what to fix, instead of producing an add-on that fails silently in the browser.

Most tests run against a small synthetic tree so they do not move when the extension changes; the
last group runs the real source tree.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

PIPELINE = Path(__file__).resolve().parents[1]
EXT = PIPELINE / "gemini_extension"
_spec = importlib.util.spec_from_file_location("build_addon", EXT / "tools" / "build_addon.py")
ba = importlib.util.module_from_spec(_spec)
sys.modules["build_addon"] = ba
_spec.loader.exec_module(ba)

SOURCE_MANIFEST = {
    "manifest_version": 3,
    "name": "Gemini Bridge",
    "version": "0.2.0",
    "description": "test",
    "permissions": ["tabs", "scripting", "storage", "alarms", "webNavigation"],
    "host_permissions": ["https://gemini.google.com/*"],
    "background": {"service_worker": "background.js"},
    "content_scripts": [{"matches": ["https://gemini.google.com/*"], "js": ["compat.js", "content/locators.js", "content/content.js"], "run_at": "document_idle"}],
    "action": {"default_title": "Gemini Bridge", "default_popup": "popup/popup.html"},
}


def make_tree(root: Path, manifest: dict | None = None) -> Path:
    """A synthetic extension folder, dev clutter included."""
    files = {
        "manifest.json": json.dumps(manifest or SOURCE_MANIFEST, indent=2),
        "background.js": "importScripts('compat.js', 'content/locators.js');\nconsole.log('bg');\n",
        "compat.js": "// shim\n",
        "content/locators.js": "globalThis.GB = {};\n",
        "content/content.js": "globalThis.GBC = {};\n",
        "popup/popup.html": '<!DOCTYPE html><html><head><link rel="stylesheet" href="popup.css"></head><body><script src="popup.js"></script></body></html>\n',
        "popup/popup.css": "body{margin:0}\n",
        "popup/popup.js": "// popup\n",
        # never shipped
        "README.md": "# docs\n",
        "package.json": "{}\n",
        ".gitignore": "x\n",
        "test/a.test.mjs": "// t\n",
        "test/node_modules/dep/index.js": "// d\n",
        "node_modules/dep/index.js": "// d\n",
        "tools/build_addon.py": "# tool\n",
        "dist/old.xpi": "zip",
        "content/locators.js.map": "{}",
        "__pycache__/x.pyc": "x",
    }
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
    return root


@pytest.fixture()
def src(tmp_path: Path) -> Path:
    return make_tree(tmp_path / "src")


# ---------------------------------------------------------------------------------------
# The manifest transform
# ---------------------------------------------------------------------------------------
def test_mv2_manifest_is_a_valid_firefox_manifest():
    before = json.dumps(SOURCE_MANIFEST, sort_keys=True)
    m = ba.firefox_manifest(SOURCE_MANIFEST, "mv2")
    assert json.dumps(SOURCE_MANIFEST, sort_keys=True) == before, "the transform must not touch its input"
    assert m["manifest_version"] == 2
    assert m["background"] == {"scripts": list(ba.BACKGROUND_SCRIPTS), "persistent": True}
    assert "service_worker" not in m["background"]
    assert "host_permissions" not in m and "action" not in m
    assert m["browser_action"] == SOURCE_MANIFEST["action"]
    assert "https://gemini.google.com/*" in m["permissions"]
    assert set(SOURCE_MANIFEST["permissions"]) <= set(m["permissions"])
    gecko = m["browser_specific_settings"]["gecko"]
    assert gecko["id"] == "gemini-bridge@gratovo.app" == ba.ADDON_ID
    assert gecko["strict_min_version"] == ba.GECKO_MIN_VERSION
    assert gecko["data_collection_permissions"] == {"required": ["none"]}
    assert "update_url" not in gecko
    assert m["version"] == "0.2.0"
    assert m["content_scripts"] == SOURCE_MANIFEST["content_scripts"]


def test_mv3_manifest_keeps_the_mv3_shape_but_uses_an_event_page():
    m = ba.firefox_manifest(SOURCE_MANIFEST, "mv3")
    assert m["manifest_version"] == 3
    assert m["background"] == {"scripts": list(ba.BACKGROUND_SCRIPTS)}
    assert m["host_permissions"] == ["https://gemini.google.com/*"]
    assert m["permissions"] == SOURCE_MANIFEST["permissions"]
    assert m["action"] == SOURCE_MANIFEST["action"] and "browser_action" not in m
    assert m["browser_specific_settings"]["gecko"]["id"] == ba.ADDON_ID


def test_update_url_is_written_only_when_asked_for():
    assert "update_url" not in ba.firefox_manifest(SOURCE_MANIFEST)["browser_specific_settings"]["gecko"]
    m = ba.firefox_manifest(SOURCE_MANIFEST, update_url="https://example.invalid/updates.json")
    assert m["browser_specific_settings"]["gecko"]["update_url"] == "https://example.invalid/updates.json"


def test_unknown_mode_is_refused():
    with pytest.raises(ba.BuildError):
        ba.firefox_manifest(SOURCE_MANIFEST, "mv4")


def test_default_mode_is_one_of_the_two():
    assert ba.FIREFOX_MODE in ("mv2", "mv3")
    assert ba.firefox_manifest(SOURCE_MANIFEST)["manifest_version"] == (2 if ba.FIREFOX_MODE == "mv2" else 3)


# ---------------------------------------------------------------------------------------
# What ships
# ---------------------------------------------------------------------------------------
def test_collect_files_excludes_dev_files_and_is_sorted(src: Path):
    names = ba.collect_files(src)
    assert names == sorted(names)
    assert names == ["background.js", "compat.js", "content/content.js", "content/locators.js", "manifest.json", "popup/popup.css", "popup/popup.html", "popup/popup.js"]


def test_build_firefox_writes_a_complete_tree(src: Path, tmp_path: Path):
    out = tmp_path / "out"
    info = ba.build_firefox(src, out)
    assert info == {"dir": str(out), "id": "gemini-bridge@gratovo.app", "version": "0.2.0", "manifestVersion": 2 if ba.FIREFOX_MODE == "mv2" else 3}
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == info["manifestVersion"]
    for ref in ba._referenced_files(manifest):
        assert (out / ref).is_file(), ref
    for forbidden in ("README.md", "package.json", "test", "tools", "node_modules", "dist", ".gitignore", "__pycache__"):
        assert not (out / forbidden).exists(), forbidden
    assert (out / "content" / "content.js").read_text(encoding="utf-8") == "globalThis.GBC = {};\n"


def test_rebuild_is_idempotent_leaves_unchanged_files_alone_and_prunes_stale_ones(src: Path, tmp_path: Path):
    out = tmp_path / "out"
    ba.build_firefox(src, out)
    (out / "stale.js").write_text("old", encoding="utf-8")
    (out / "gone").mkdir()
    (out / "gone" / "x.js").write_text("old", encoding="utf-8")
    kept = out / "content" / "content.js"
    before = kept.stat().st_mtime_ns
    ba.build_firefox(src, out)
    assert not (out / "stale.js").exists()
    assert not (out / "gone").exists()
    assert kept.stat().st_mtime_ns == before, "an unchanged file must not be rewritten (a browser watching the folder would reload)"


def test_changed_source_is_picked_up_by_a_rebuild(src: Path, tmp_path: Path):
    out = tmp_path / "out"
    ba.build_firefox(src, out)
    (src / "content" / "content.js").write_text("globalThis.GBC = {v: 2};\n", encoding="utf-8")
    ba.build_firefox(src, out)
    assert "v: 2" in (out / "content" / "content.js").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------------------
# The .xpi
# ---------------------------------------------------------------------------------------
def test_xpi_layout(src: Path, tmp_path: Path):
    x = tmp_path / "gb.xpi"
    info = ba.build_xpi(src, x)
    assert info["path"] == str(x) and info["id"] == ba.ADDON_ID and info["version"] == "0.2.0"
    assert len(info["sha256"]) == 64 and info["sha256"] == hashlib.sha256(x.read_bytes()).hexdigest()
    with zipfile.ZipFile(x) as zf:
        assert zf.testzip() is None
        names = zf.namelist()
        assert names == sorted(names)
        assert "manifest.json" in names
        assert all(not n.endswith("/") and "\\" not in n and not n.startswith(("/", "./", "../")) for n in names), names
        assert all(i.date_time == (1980, 1, 1, 0, 0, 0) for i in zf.infolist())
        for forbidden in ("README.md", "package.json", "tools/build_addon.py", "test/a.test.mjs"):
            assert forbidden not in names
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["browser_specific_settings"]["gecko"]["id"] == ba.ADDON_ID


def test_xpi_is_deterministic_across_paths_times_and_line_endings(src: Path, tmp_path: Path):
    a = tmp_path / "a" / "x.xpi"
    b = tmp_path / "b" / "y.xpi"
    ia = ba.build_xpi(src, a)
    # same content, different file times and CRLF line endings, at another location
    other = make_tree(tmp_path / "other")
    for p in other.rglob("*.js"):
        p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))
        p.touch()
    ib = ba.build_xpi(other, b)
    assert ia["sha256"] == ib["sha256"]
    assert a.read_bytes() == b.read_bytes()


def test_xpi_differs_when_content_differs(src: Path, tmp_path: Path):
    a = ba.build_xpi(src, tmp_path / "a.xpi")
    (src / "compat.js").write_text("// shim v2\n", encoding="utf-8")
    b = ba.build_xpi(src, tmp_path / "b.xpi")
    assert a["sha256"] != b["sha256"]


def test_xpi_and_folder_hold_the_same_files(src: Path, tmp_path: Path):
    out = tmp_path / "out"
    ba.build_firefox(src, out)
    ba.build_xpi(src, tmp_path / "x.xpi")
    with zipfile.ZipFile(tmp_path / "x.xpi") as zf:
        for name in zf.namelist():
            assert zf.read(name) == (out / name).read_bytes(), name
        on_disk = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
        assert on_disk == sorted(zf.namelist())


# ---------------------------------------------------------------------------------------
# Refusing a broken source
# ---------------------------------------------------------------------------------------
def test_missing_referenced_file_is_reported_by_name(src: Path, tmp_path: Path):
    (src / "content" / "locators.js").unlink()
    with pytest.raises(ba.BuildError, match="content/locators.js"):
        ba.build_firefox(src, tmp_path / "out")


def test_popup_that_loads_a_missing_script_is_reported(src: Path, tmp_path: Path):
    (src / "popup" / "popup.js").unlink()
    with pytest.raises(ba.BuildError, match="popup.js"):
        ba.build_xpi(src, tmp_path / "x.xpi")


@pytest.mark.parametrize("version", ["v1", "1.2.3.4.5", "", "1.0-beta", "1..2"])
def test_firefox_invalid_versions_are_refused(tmp_path: Path, version: str):
    bad = dict(SOURCE_MANIFEST, version=version)
    root = make_tree(tmp_path / "bad", bad)
    with pytest.raises(ba.BuildError, match="version"):
        ba.build_firefox(root, tmp_path / "out")


def test_source_must_be_mv3(tmp_path: Path):
    root = make_tree(tmp_path / "old", dict(SOURCE_MANIFEST, manifest_version=2))
    with pytest.raises(ba.BuildError, match="Manifest V3"):
        ba.build_firefox(root, tmp_path / "out")


def test_missing_folder_and_manifest_are_reported(tmp_path: Path):
    with pytest.raises(ba.BuildError, match="does not exist"):
        ba.build_firefox(tmp_path / "nope", tmp_path / "out")
    (tmp_path / "empty").mkdir()
    with pytest.raises(ba.BuildError, match="manifest.json"):
        ba.build_firefox(tmp_path / "empty", tmp_path / "out")


def test_failed_build_leaves_an_existing_output_untouched(src: Path, tmp_path: Path):
    out = tmp_path / "out"
    ba.build_firefox(src, out)
    good = (out / "manifest.json").read_bytes()
    (src / "compat.js").unlink()
    with pytest.raises(ba.BuildError):
        ba.build_firefox(src, out)
    assert (out / "manifest.json").read_bytes() == good


# ---------------------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------------------
def test_cli_info_firefox_and_xpi(src: Path, tmp_path: Path, capsys):
    assert ba.main(["info", "--src", str(src)]) == 0
    assert json.loads(capsys.readouterr().out)["version"] == "0.2.0"
    assert ba.main(["firefox", "--src", str(src), "--out", str(tmp_path / "o"), "--mode", "mv3"]) == 0
    assert json.loads(capsys.readouterr().out)["manifestVersion"] == 3
    assert ba.main(["xpi", "--src", str(src), "--out", str(tmp_path / "o.xpi")]) == 0
    assert len(json.loads(capsys.readouterr().out)["sha256"]) == 64
    assert ba.main(["info", "--src", str(tmp_path / "missing")]) == 2
    assert "does not exist" in capsys.readouterr().err


# ---------------------------------------------------------------------------------------
# The real source tree
# ---------------------------------------------------------------------------------------
def test_real_source_manifest_stays_a_plain_chrome_mv3_manifest():
    m = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    assert m["manifest_version"] == 3
    assert m["background"]["service_worker"] == "background.js"
    assert re.match(r"^\d+(\.\d+){0,3}$", m["version"])
    # Firefox-only keys are added by the build, so Chrome/Edge never warn about them.
    assert "browser_specific_settings" not in m and "applications" not in m


def test_background_scripts_list_matches_the_importScripts_call():
    bg = (EXT / "background.js").read_text(encoding="utf-8")
    call = re.search(r"importScripts\(([^)]*)\)", bg)
    assert call, "background.js must pull its helper scripts in with importScripts(...) for Chrome"
    imported = re.findall(r"'([^']+)'", call.group(1))
    assert list(ba.BACKGROUND_SCRIPTS) == imported + ["background.js"]


@pytest.mark.parametrize("mode", ["mv2", "mv3"])
def test_real_source_builds_in_both_modes(tmp_path: Path, mode: str):
    out = tmp_path / mode
    info = ba.build_firefox(EXT, out, mode=mode)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert info["version"] == manifest["version"]
    assert info["manifestVersion"] == (2 if mode == "mv2" else 3)
    for ref in ba._referenced_files(manifest):
        assert (out / ref).is_file(), ref
    shipped = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    assert not [n for n in shipped if n.split("/")[0] in ("test", "tools", "node_modules") or n.endswith(".md")], shipped


def test_real_source_xpi_is_deterministic(tmp_path: Path):
    a = ba.build_xpi(EXT, tmp_path / "a.xpi")
    b = ba.build_xpi(EXT, tmp_path / "b.xpi")
    assert a["sha256"] == b["sha256"]
