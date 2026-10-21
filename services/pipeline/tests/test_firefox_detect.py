"""Firefox detection on a fake registry and a fake Program Files -- no real browser involved
(ported from the old test_firefox_detect)."""

from pathlib import Path
from typing import Any

from gratovo_pipeline.gemini.browser.firefox_detect import (
    NoRegistry,
    find_firefox,
    read_version_and_channel,
)


class FakeRegistry:
    def __init__(self, keys: dict[tuple[str, str], dict[str, Any]]) -> None:
        self.keys = keys

    def values(self, hive: str, key: str) -> dict[str, Any] | None:
        return self.keys.get((hive, key))

    def subkeys(self, hive: str, key: str) -> list[str]:
        prefix = key + "\\"
        out: list[str] = []
        for h, k in self.keys:
            if h == hive and k.startswith(prefix):
                child = k[len(prefix) :].split("\\", 1)[0]
                if child not in out:
                    out.append(child)
        return out


def make_firefox(
    folder: Path,
    version: str = "156.0.1",
    channel: str | None = "release",
    repository: str = "https://hg.mozilla.org/releases/mozilla-release",
) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    exe = folder / "firefox.exe"
    exe.write_bytes(b"MZ")
    (folder / "application.ini").write_text(
        "; comment\n[App]\nVendor=Mozilla\nName=Firefox\n"
        f"Version={version}\nSourceRepository={repository}\n",
        encoding="utf-8",
    )
    if channel is not None:
        prefs = folder / "defaults" / "pref"
        prefs.mkdir(parents=True, exist_ok=True)
        (prefs / "channel-prefs.js").write_text(
            f'/* MPL */\npref("app.update.channel", "{channel}");\n', encoding="utf-8"
        )
    return exe


def registry_for(
    exe: Path, hive: str = "HKLM", product: str = "Mozilla Firefox"
) -> dict[tuple[str, str], dict[str, Any]]:
    current = "156.0.1 (x64 en-US)"
    base = f"SOFTWARE\\Mozilla\\{product}"
    return {
        (hive, base): {"": "156.0.1", "CurrentVersion": current},
        (hive, f"{base}\\{current}\\Main"): {
            "PathToExe": str(exe),
            "Install Directory": str(exe.parent),
        },
        # A Mozilla key without CurrentVersion must be skipped, not crash.
        (hive, "SOFTWARE\\Mozilla\\Firefox\\Launcher"): {"x": 1},
    }


def test_registry_install_with_version_and_channel(tmp_path: Path) -> None:
    exe = make_firefox(tmp_path / "PF" / "Mozilla Firefox")
    found, tried = find_firefox(registry=FakeRegistry(registry_for(exe)), env={})
    assert found[0].path == str(exe)
    assert (found[0].version, found[0].channel, found[0].source) == (
        "156.0.1",
        "release",
        "registry",
    )
    assert found[0].can_run_unsigned is False
    assert tried[0] == str(exe)


def test_channels_map_to_the_contract_names(tmp_path: Path) -> None:
    cases = [
        ("release", "release", False),
        ("beta", "beta", False),
        ("esr", "esr", True),
        ("aurora", "dev", True),
        ("nightly", "nightly", True),
        ("default", "unknown", False),
    ]
    for raw, expected, unsigned in cases:
        exe = make_firefox(tmp_path / raw, channel=raw)
        _version, channel = read_version_and_channel(exe)
        assert channel == expected, raw
        found, _ = find_firefox(str(exe), registry=NoRegistry(), env={})
        assert found[0].can_run_unsigned is unsigned, raw


def test_channel_falls_back_to_the_source_repository(tmp_path: Path) -> None:
    exe = make_firefox(
        tmp_path / "esr",
        channel=None,
        repository="https://hg.mozilla.org/releases/mozilla-esr128",
    )
    assert read_version_and_channel(exe) == ("156.0.1", "esr")
    bare = tmp_path / "bare"
    bare.mkdir()
    (bare / "firefox.exe").write_bytes(b"MZ")
    assert read_version_and_channel(bare / "firefox.exe") == ("", "unknown")


def test_folder_fallback_and_dedupe(tmp_path: Path) -> None:
    exe = make_firefox(tmp_path / "PF" / "Mozilla Firefox")
    app_paths: dict[tuple[str, str], dict[str, Any]] = {
        ("HKLM", r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe"): {
            "": f'"{exe}"'
        }
    }
    found, tried = find_firefox(
        registry=FakeRegistry({**registry_for(exe), **app_paths}),
        env={"ProgramFiles": str(tmp_path / "PF"), "PATH": ""},
    )
    # Registry, App Paths and the folder all name the same exe: one install.
    assert [f.path for f in found] == [str(exe)]
    assert len(tried) == len(set(tried))

    found, _ = find_firefox(
        registry=NoRegistry(), env={"ProgramFiles": str(tmp_path / "PF"), "PATH": ""}
    )
    assert found[0].source == "folder"


def test_per_user_install_is_found(tmp_path: Path) -> None:
    exe = make_firefox(tmp_path / "Local" / "Mozilla Firefox")
    found, _ = find_firefox(
        registry=FakeRegistry(registry_for(exe, hive="HKCU")),
        env={"LOCALAPPDATA": str(tmp_path / "Local"), "PATH": ""},
    )
    assert found[0].path == str(exe)
    assert found[0].source == "registry"


def test_a_wrong_configured_path_is_reported_not_replaced(tmp_path: Path) -> None:
    real = make_firefox(tmp_path / "PF" / "Mozilla Firefox")
    wrong = tmp_path / "nope" / "firefox.exe"
    found, tried = find_firefox(
        str(wrong),
        registry=FakeRegistry(registry_for(real)),
        env={"ProgramFiles": str(tmp_path / "PF")},
    )
    assert found == []
    assert tried == [str(wrong)]


def test_nothing_installed(tmp_path: Path) -> None:
    found, tried = find_firefox(
        registry=NoRegistry(), env={"ProgramFiles": str(tmp_path), "PATH": ""}
    )
    assert found == []
    assert any("Mozilla Firefox" in t for t in tried)


def test_this_machine_does_not_crash() -> None:
    """Real registry, real env: whatever is found must be well formed."""
    found, tried = find_firefox()
    assert tried
    for install in found:
        assert Path(install.path).is_file()
        assert install.channel in {"release", "beta", "esr", "dev", "nightly", "unknown"}
        assert install.to_json()["path"] == install.path
