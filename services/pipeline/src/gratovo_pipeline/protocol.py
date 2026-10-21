"""The JSON-lines protocol with the desktop app (version 1, ADR 0013).

The source of truth is the zod schemas in `apps/desktop/src/main/pipeline/protocol.ts`; the
`protocol.schema.json` beside this file is generated from them, and the tests check every message
written here against it. The names below are the wire's, camelCase included.

Main writes one `start` line, then perhaps a `stop`. The pipeline answers with `ready`, then the
job's messages, and always ends with one `end`.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Mapping, Sequence
from typing import Final, Literal, NotRequired, TextIO, TypedDict, cast

PROTOCOL: Final = 1
# Text fields the schema caps at this length; longer text is cut, never refused.
MAX_TEXT: Final = 500

AutoCleanAction = Literal["sweep", "delay", "off"]
LogLevel = Literal["info", "warn", "error"]
KeywordState = Literal["started", "done", "failed"]
Outcome = Literal["kept", "swept", "delayed"]
EndState = Literal["done", "stopped", "failed"]
EndErrorCode = Literal["bad_start", "no_youtube_key", "blocked", "quota", "network", "crash"]


class AutoClean(TypedDict):
    enabled: bool
    minSubscribers: int
    maxSubscribers: int
    belowMin: AutoCleanAction
    aboveMax: AutoCleanAction
    label: str


class Rules(TypedDict):
    countries: list[str]
    perKeyword: int
    sortBy: Literal["relevance", "upload_date", "view_count", "rating"]
    resultsType: Literal["video", "channel"]
    autoClean: AutoClean


class SearchJob(TypedDict):
    kind: Literal["search"]
    keywords: list[str]
    startAt: int
    rules: Rules


class Parallel(TypedDict):
    enabled: bool
    maxWorkers: int


class Proxies(TypedDict):
    enabled: bool
    includeDirect: bool


class Settings(TypedDict):
    pacing: NotRequired[Literal["normal", "fast"]]
    parallel: NotRequired[Parallel]
    proxies: NotRequired[Proxies]


class Secrets(TypedDict):
    youtubeKey: str | None
    proxyUrls: list[str]
    gatewayUrls: list[str]


class Start(TypedDict):
    type: Literal["start"]
    protocol: Literal[1]
    source: Literal["live", "example"]
    dataDir: str
    worker: str
    job: SearchJob
    settings: Settings
    secrets: Secrets


class BadStartError(ValueError):
    """The start line was unusable. The message names the field, never its value."""


# --- reading the start line ---

_COUNTRY = re.compile(r"[A-Z]{2}")
_INDEX_MAX = 10_000
_COUNT_MAX = 100_000_000


def _object(
    value: object, where: str, required: set[str], optional: frozenset[str] = frozenset()
) -> dict[str, object]:
    if not isinstance(value, dict):
        raise BadStartError(f"{where} must be an object")
    found = cast("dict[str, object]", value)
    missing = required - found.keys()
    if missing:
        raise BadStartError(f"{where} is missing {', '.join(sorted(missing))}")
    extra = found.keys() - required - optional
    if extra:
        raise BadStartError(f"{where} has unknown fields")
    return found


def _string(value: object, where: str, low: int, high: int) -> str:
    if not isinstance(value, str) or not low <= len(value) <= high:
        raise BadStartError(f"{where} must be text of {low} to {high} characters")
    return value


def _integer(value: object, where: str, low: int, high: int) -> int:
    # bool is an int in Python, but not a number on the wire.
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise BadStartError(f"{where} must be a whole number from {low} to {high}")
    return value


def _boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise BadStartError(f"{where} must be true or false")
    return value


def _choice[T: str](value: object, where: str, choices: Sequence[T]) -> T:
    for choice in choices:
        if value == choice:
            return choice
    raise BadStartError(f"{where} must be one of {', '.join(choices)}")


def _list(value: object, where: str, high: int, low: int = 0) -> list[object]:
    if not isinstance(value, list):
        raise BadStartError(f"{where} must be a list")
    items = cast("list[object]", value)
    if not low <= len(items) <= high:
        raise BadStartError(f"{where} must hold {low} to {high} items")
    return items


def _rules(value: object) -> Rules:
    raw = _object(value, "rules", {"countries", "perKeyword", "sortBy", "resultsType", "autoClean"})
    countries: list[str] = []
    for item in _list(raw["countries"], "rules.countries", 250):
        if not isinstance(item, str) or not _COUNTRY.fullmatch(item):
            raise BadStartError("rules.countries must be two-letter country codes")
        countries.append(item)
    clean = _object(
        raw["autoClean"],
        "rules.autoClean",
        {"enabled", "minSubscribers", "maxSubscribers", "belowMin", "aboveMax", "label"},
    )
    actions: tuple[AutoCleanAction, ...] = ("sweep", "delay", "off")
    return {
        "countries": countries,
        "perKeyword": _integer(raw["perKeyword"], "rules.perKeyword", 1, 1000),
        "sortBy": _choice(
            raw["sortBy"], "rules.sortBy", ("relevance", "upload_date", "view_count", "rating")
        ),
        "resultsType": _choice(raw["resultsType"], "rules.resultsType", ("video", "channel")),
        "autoClean": {
            "enabled": _boolean(clean["enabled"], "rules.autoClean.enabled"),
            "minSubscribers": _integer(
                clean["minSubscribers"], "rules.autoClean.minSubscribers", 0, _COUNT_MAX
            ),
            "maxSubscribers": _integer(
                clean["maxSubscribers"], "rules.autoClean.maxSubscribers", 0, _COUNT_MAX
            ),
            "belowMin": _choice(clean["belowMin"], "rules.autoClean.belowMin", actions),
            "aboveMax": _choice(clean["aboveMax"], "rules.autoClean.aboveMax", actions),
            "label": _string(clean["label"], "rules.autoClean.label", 1, 40),
        },
    }


def _job(value: object) -> SearchJob:
    raw = _object(value, "job", {"kind", "keywords", "startAt", "rules"})
    _choice(raw["kind"], "job.kind", ("search",))
    keywords: list[str] = []
    for item in _list(raw["keywords"], "job.keywords", 500, low=1):
        keyword = _string(item, "job.keywords", 1, 200)
        if keyword != keyword.strip():
            raise BadStartError("job.keywords must have no spaces around a keyword")
        keywords.append(keyword)
    if len({k.lower() for k in keywords}) != len(keywords):
        raise BadStartError("job.keywords must be unique")
    start_at = _integer(raw["startAt"], "job.startAt", 0, _INDEX_MAX)
    if start_at >= len(keywords):
        raise BadStartError("job.startAt must name a keyword")
    return {
        "kind": "search",
        "keywords": keywords,
        "startAt": start_at,
        "rules": _rules(raw["rules"]),
    }


def _settings(value: object) -> Settings:
    raw = _object(value, "settings", set(), frozenset({"pacing", "parallel", "proxies"}))
    settings: Settings = {}
    if "pacing" in raw:
        settings["pacing"] = _choice(raw["pacing"], "settings.pacing", ("normal", "fast"))
    if "parallel" in raw:
        parallel = _object(raw["parallel"], "settings.parallel", {"enabled", "maxWorkers"})
        settings["parallel"] = {
            "enabled": _boolean(parallel["enabled"], "settings.parallel.enabled"),
            "maxWorkers": _integer(parallel["maxWorkers"], "settings.parallel.maxWorkers", 1, 16),
        }
    if "proxies" in raw:
        proxies = _object(raw["proxies"], "settings.proxies", {"enabled", "includeDirect"})
        settings["proxies"] = {
            "enabled": _boolean(proxies["enabled"], "settings.proxies.enabled"),
            "includeDirect": _boolean(proxies["includeDirect"], "settings.proxies.includeDirect"),
        }
    return settings


def _secrets(value: object) -> Secrets:
    raw = _object(value, "secrets", {"youtubeKey", "proxyUrls", "gatewayUrls"})
    key = raw["youtubeKey"]
    return {
        "youtubeKey": None if key is None else _string(key, "secrets.youtubeKey", 1, 200),
        "proxyUrls": [
            _string(u, "secrets.proxyUrls", 1, 2000)
            for u in _list(raw["proxyUrls"], "secrets.proxyUrls", 100)
        ],
        "gatewayUrls": [
            _string(u, "secrets.gatewayUrls", 1, 2000)
            for u in _list(raw["gatewayUrls"], "secrets.gatewayUrls", 100)
        ],
    }


def parse_start(line: str) -> Start:
    """Reads and checks the start line. Raises BadStartError, which never repeats a value."""
    try:
        value: object = json.loads(line)
    except ValueError:
        raise BadStartError("the start line must be JSON") from None
    raw = _object(
        value,
        "start",
        {"type", "protocol", "source", "dataDir", "worker", "job", "settings", "secrets"},
    )
    _choice(raw["type"], "type", ("start",))
    if _integer(raw["protocol"], "protocol", 1, 1) != PROTOCOL:
        raise BadStartError("protocol must be 1")
    return {
        "type": "start",
        "protocol": 1,
        "source": _choice(raw["source"], "source", ("live", "example")),
        "dataDir": _string(raw["dataDir"], "dataDir", 1, 1024),
        "worker": _string(raw["worker"], "worker", 1, 64),
        "job": _job(raw["job"]),
        "settings": _settings(raw["settings"]),
        "secrets": _secrets(raw["secrets"]),
    }


def listen_for_stop(stream: TextIO, on_stop: Callable[[], None]) -> threading.Thread:
    """Watches stdin after the start line; calls on_stop once, on a stop line or when the app
    closes the stream (it quit or crashed: nobody is left to read the results)."""

    def listen() -> None:
        for line in stream:
            try:
                message: object = json.loads(line)
            except ValueError:
                continue
            if (
                isinstance(message, dict)
                and cast("dict[str, object]", message).get("type") == "stop"
            ):
                break
        on_stop()

    thread = threading.Thread(target=listen, name="stdin", daemon=True)
    thread.start()
    return thread


# --- writing ---


def _cut(text: str) -> str:
    return text if len(text) <= MAX_TEXT else text[: MAX_TEXT - 1] + "…"


class Emitter:
    """Writes messages to stdout, one line each. Safe to share between threads."""

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def _send(self, message: Mapping[str, object]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self._lock:
            self._stream.write(line)
            self._stream.flush()

    def ready(self) -> None:
        from gratovo_pipeline import __version__

        self._send({"type": "ready", "protocol": PROTOCOL, "version": __version__})

    def run(self, *, total: int, start_at: int) -> None:
        self._send({"type": "run", "state": "running", "total": total, "startAt": start_at})

    def keyword(
        self,
        *,
        index: int,
        total: int,
        keyword: str,
        state: KeywordState,
        found: int | None = None,
        kept: int | None = None,
        error: str | None = None,
    ) -> None:
        message: dict[str, object] = {
            "type": "keyword",
            "index": index,
            "total": total,
            "keyword": keyword,
            "state": state,
        }
        if found is not None:
            message["found"] = found
        if kept is not None:
            message["kept"] = kept
        if error:
            message["error"] = _cut(error)
        self._send(message)

    def channel(
        self,
        *,
        keyword: str,
        channel_id: str,
        handle: str | None,
        name: str,
        subscribers: int | None,
        median_views: int | None,
        country: str | None,
        outcome: Outcome,
    ) -> None:
        self._send(
            {
                "type": "channel",
                "keyword": keyword,
                "channelId": channel_id,
                "handle": handle[:300] if handle else None,
                "name": name[:300] or channel_id,
                "subscribers": subscribers,
                "medianViews": median_views,
                "country": country if country and _COUNTRY.fullmatch(country) else None,
                "outcome": outcome,
            }
        )

    def log(self, level: LogLevel, text: str) -> None:
        self._send({"type": "log", "level": level, "text": _cut(text)})

    def end(
        self,
        *,
        state: EndState,
        at: int,
        found: int,
        kept: int,
        error: tuple[EndErrorCode, str] | None = None,
    ) -> None:
        message: dict[str, object] = {
            "type": "end",
            "state": state,
            "at": at,
            "found": found,
            "kept": kept,
        }
        if error is not None:
            message["error"] = {"code": error[0], "message": _cut(error[1])}
        self._send(message)
