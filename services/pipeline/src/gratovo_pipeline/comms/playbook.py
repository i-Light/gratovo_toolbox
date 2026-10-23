"""The playbook (data/comms/playbook/): rules from the course, each with verbatim quotes. See its
README.md.

The playbook ships with the code (`paths.PLAYBOOK_DIR`); a tool run by hand may point
`GRATOVO_PLAYBOOK_DIR` at a copy instead."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from gratovo_pipeline import paths

DEFAULT_DIR = paths.PLAYBOOK_DIR
PLAYBOOK_DIR_ENV = "GRATOVO_PLAYBOOK_DIR"

AREAS = {
    "foundations": [
        "mindset",
        "writing",
        "subject",
        "formatting",
        "channels",
        "calls",
        "deliverability",
        "ethics",
    ],
    "influencer": [
        "qualify",
        "first_contact",
        "follow_up",
        "replies",
        "offer",
        "pricing",
        "negotiation",
        "managers",
        "closing",
        "onboarding",
        "delivery",
        "payment",
        "after",
    ],
    "brand": [
        "qualify",
        "first_contact",
        "follow_up",
        "replies",
        "objections",
        "offer",
        "presenting",
        "negotiation",
        "closing",
        "contract",
        "payment",
        "delivery",
        "after",
    ],
}
LEVELS = ("must", "should", "tip")


def playbook_dir() -> Path:
    return Path(os.environ.get(PLAYBOOK_DIR_ENV) or DEFAULT_DIR)


@dataclass
class Source:
    doc: str
    quote: str
    at: str | None = None
    speaker: str | None = None  # who says it, in a multi-speaker video (videos.json)
    whisper: dict[str, Any] | None = (
        None  # a video quote's Whisper cross-check (comms/video_check.py)
    )


@dataclass
class Rule:
    id: str
    area: str
    stage: str
    title: str
    rule: str
    level: str
    src: list[Source]
    when: str | None = None
    do: list[str] = field(default_factory=list[str])
    dont: list[str] = field(default_factory=list[str])
    steps: list[str] = field(default_factory=list[str])
    file: str = ""


def _list(value: object) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_file(path: Path) -> list[Rule]:
    data = _read(path)
    area = data.get("area") or path.stem
    out: list[Rule] = []
    raws: list[Any] = data.get("rules") or []
    for raw in raws:
        out.append(
            Rule(
                id=str(raw.get("id") or ""),
                area=area,
                stage=str(raw.get("stage") or ""),
                title=str(raw.get("title") or ""),
                rule=str(raw.get("rule") or ""),
                level=str(raw.get("level") or ""),
                when=raw.get("when"),
                do=list(_list(raw.get("do"))),
                dont=list(_list(raw.get("dont"))),
                steps=list(_list(raw.get("steps"))),
                src=[
                    Source(
                        doc=str(s.get("doc") or ""),
                        quote=str(s.get("quote") or ""),
                        at=s.get("at"),
                        speaker=s.get("speaker"),
                        whisper=s.get("whisper"),
                    )
                    for s in _list(raw.get("src"))
                ],
                file=path.name,
            )
        )
    return out


def rules(directory: Path | None = None) -> list[Rule]:
    root = Path(directory or playbook_dir()) / "rules"
    out: list[Rule] = []
    for path in sorted(root.glob("*.json")):
        out.extend(_load_file(path))
    return out


def coaches(directory: Path | None = None) -> dict[str, str]:
    """Speaker label -> coach name."""
    data = _read(Path(directory or playbook_dir()) / "coaches.json")
    return {label: name for name, labels in data["coaches"].items() for label in labels}


def coach_names(directory: Path | None = None) -> set[str]:
    data = _read(Path(directory or playbook_dir()) / "coaches.json")
    return set(data["coaches"])


def videos(directory: Path | None = None) -> dict[str, dict[str, Any]]:
    """Lesson id -> {speakers: single|multi|student, presenter, note} (videos.json)."""
    path = Path(directory or playbook_dir()) / "videos.json"
    if not path.exists():
        return {}
    return _read(path).get("videos") or {}


def scope(directory: Path | None = None) -> dict[str, Any]:
    path = Path(directory or playbook_dir()) / "scope.json"
    if not path.exists():
        return {"out_of_scope": {}}
    return _read(path)


def examples(directory: Path | None = None) -> list[dict[str, Any]]:
    """Roast examples (examples.json): reconstructed student emails with the coach's verdict and
    checked quote. Learn from them, never copy them."""
    path = Path(directory or playbook_dir()) / "examples.json"
    if not path.exists():
        return []
    return _read(path).get("examples") or []


def situations(directory: Path | None = None) -> dict[str, Any]:
    """The situations map (situations.json): {"stages": {side: [...]}, "replies": {side: [...]}},
    each with its key rules."""
    path = Path(directory or playbook_dir()) / "situations.json"
    if not path.exists():
        return {"stages": {}, "replies": {}}
    return _read(path)


def key_rules(reply_type: str | None, directory: Path | None = None) -> list[str]:
    """The rule ids the situations map names for a reply type ([] for an unknown one)."""
    replies: dict[str, Any] = situations(directory).get("replies", {})
    for side in replies.values():
        for r in side:
            if r.get("id") == reply_type:
                return list(r.get("rules") or [])
    return []


def house_choices(directory: Path | None = None) -> list[dict[str, Any]]:
    """The owner's open decisions (house_choices.json): id, options with their sources, default,
    pick."""
    path = Path(directory or playbook_dir()) / "house_choices.json"
    if not path.exists():
        return []
    return _read(path).get("choices") or []
