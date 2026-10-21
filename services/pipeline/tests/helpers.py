"""Helpers the tests import (pytest discourages importing conftest itself)."""

import copy
import json
from collections.abc import Mapping
from typing import Any

from gratovo_pipeline.protocol import Start, parse_start


def schema_errors(schema: Mapping[str, Any], instance: Any) -> list[str]:
    """What JSON Schema finds wrong with instance (any decoded JSON); empty when it is valid."""
    from jsonschema import Draft202012Validator

    validator = Draft202012Validator(schema)
    # The stubs leave one overload of iter_errors untyped; the messages are plain strings.
    found = validator.iter_errors(instance)  # pyright: ignore[reportUnknownMemberType]
    return [str(error.message) for error in found]


START: dict[str, Any] = {
    "type": "start",
    "protocol": 1,
    "source": "example",
    "dataDir": "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline",
    "worker": "example",
    "job": {
        "kind": "search",
        "keywords": ["best ai video editor 2026", "claude code tutorial"],
        "startAt": 1,
        "rules": {
            "countries": ["US", "GB"],
            "perKeyword": 200,
            "sortBy": "upload_date",
            "resultsType": "video",
            "autoClean": {
                "enabled": True,
                "minSubscribers": 50000,
                "maxSubscribers": 2000000,
                "belowMin": "sweep",
                "aboveMax": "delay",
                "label": "inactive",
            },
        },
    },
    "settings": {"pacing": "fast", "parallel": {"enabled": True, "maxWorkers": 3}},
    "secrets": {"youtubeKey": "test-key", "proxyUrls": [], "gatewayUrls": []},
}


def changed(path: str, value: object, base: Mapping[str, Any] = START) -> dict[str, Any]:
    """A copy of base with one value replaced (`a.b.c`), or removed when value is ...."""
    start = copy.deepcopy(dict(base))
    *parents, last = path.split(".")
    node = start
    for key in parents:
        node = node[key]
    if value is ...:
        del node[last]
    else:
        node[last] = value
    return start


def start_with(**changes: object) -> Start:
    """START with changes keyed by path (`job__startAt=0` sets job.startAt), as parse_start
    returns it."""
    message: dict[str, Any] = copy.deepcopy(START)
    for key, value in changes.items():
        message = changed(key.replace("__", "."), value, message)
    return parse_start(json.dumps(message))
