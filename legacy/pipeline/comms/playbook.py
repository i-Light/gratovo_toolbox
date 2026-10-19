"""The playbook (data/comms/playbook/): rules from the course, each with verbatim quotes. See its README.md."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO / "data" / "comms" / "playbook"

AREAS = {
    "foundations": ["mindset", "writing", "subject", "formatting", "channels", "calls", "deliverability", "ethics"],
    "influencer": ["qualify", "first_contact", "follow_up", "replies", "offer", "pricing", "negotiation", "managers",
                   "closing", "onboarding", "delivery", "payment", "after"],
    "brand": ["qualify", "first_contact", "follow_up", "replies", "objections", "offer", "presenting", "negotiation",
              "closing", "contract", "payment", "delivery", "after"],
}
LEVELS = ("must", "should", "tip")


def playbook_dir() -> Path:
    return Path(os.environ.get("GRATOVO_PLAYBOOK_DIR") or DEFAULT_DIR)


@dataclass
class Source:
    doc: str
    quote: str
    at: Optional[str] = None
    speaker: Optional[str] = None    # who says it, in a multi-speaker video (videos.json)
    whisper: Optional[dict] = None   # a video quote's Whisper cross-check (comms/video_check.py)


@dataclass
class Rule:
    id: str
    area: str
    stage: str
    title: str
    rule: str
    level: str
    src: list[Source]
    when: Optional[str] = None
    do: list[str] = field(default_factory=list)
    dont: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    file: str = ""


def _load_file(path: Path) -> list[Rule]:
    data = json.loads(path.read_text(encoding="utf-8"))
    area = data.get("area") or path.stem
    out = []
    for raw in data.get("rules") or []:
        out.append(Rule(
            id=str(raw.get("id") or ""), area=area, stage=str(raw.get("stage") or ""), title=str(raw.get("title") or ""),
            rule=str(raw.get("rule") or ""), level=str(raw.get("level") or ""), when=raw.get("when"),
            do=list(raw.get("do") or []), dont=list(raw.get("dont") or []), steps=list(raw.get("steps") or []),
            src=[Source(doc=str(s.get("doc") or ""), quote=str(s.get("quote") or ""), at=s.get("at"), speaker=s.get("speaker"),
                        whisper=s.get("whisper")) for s in raw.get("src") or []],
            file=path.name))
    return out


def rules(directory: Optional[Path] = None) -> list[Rule]:
    root = Path(directory or playbook_dir()) / "rules"
    out: list[Rule] = []
    for path in sorted(root.glob("*.json")):
        out.extend(_load_file(path))
    return out


def coaches(directory: Optional[Path] = None) -> dict[str, str]:
    """Speaker label -> coach name."""
    data = json.loads((Path(directory or playbook_dir()) / "coaches.json").read_text(encoding="utf-8"))
    return {label: name for name, labels in data["coaches"].items() for label in labels}


def coach_names(directory: Optional[Path] = None) -> set[str]:
    data = json.loads((Path(directory or playbook_dir()) / "coaches.json").read_text(encoding="utf-8"))
    return set(data["coaches"])


def videos(directory: Optional[Path] = None) -> dict[str, dict]:
    """Lesson id -> {speakers: single|multi|student, presenter, note} (videos.json)."""
    path = Path(directory or playbook_dir()) / "videos.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("videos") or {}


def scope(directory: Optional[Path] = None) -> dict:
    path = Path(directory or playbook_dir()) / "scope.json"
    if not path.exists():
        return {"out_of_scope": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def examples(directory: Optional[Path] = None) -> list[dict]:
    """Roast examples (examples.json): reconstructed student emails with the coach's verdict and checked quote.
    Learn from them, never copy them."""
    path = Path(directory or playbook_dir()) / "examples.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("examples") or []


def situations(directory: Optional[Path] = None) -> dict:
    """The situations map (situations.json): {"stages": {side: [...]}, "replies": {side: [...]}}, each with its key rules."""
    path = Path(directory or playbook_dir()) / "situations.json"
    if not path.exists():
        return {"stages": {}, "replies": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def key_rules(reply_type: Optional[str], directory: Optional[Path] = None) -> list[str]:
    """The rule ids the situations map names for a reply type ([] for an unknown one)."""
    for side in situations(directory).get("replies", {}).values():
        for r in side:
            if r.get("id") == reply_type:
                return list(r.get("rules") or [])
    return []


def house_choices(directory: Optional[Path] = None) -> list[dict]:
    """The owner's open decisions (house_choices.json): id, options with their sources, default, pick."""
    path = Path(directory or playbook_dir()) / "house_choices.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("choices") or []
