"""Shared test setup: no test may reach the network.

The guard covers Python's own sockets. The scraper's requests go through curl_cffi (libcurl, in C),
which this can't see, so every test that touches the scraper fakes its session instead.
"""

import json
import socket
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest
from helpers import schema_errors

SCHEMA_FILE = Path(__file__).parent.parent / "src" / "gratovo_pipeline" / "protocol.schema.json"


class NetworkBlockedError(RuntimeError):
    pass


def _refuse(*_args: object, **_kwargs: object) -> None:
    raise NetworkBlockedError("tests must not reach the network")


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", _refuse)
    monkeypatch.setattr(socket, "create_connection", _refuse)
    monkeypatch.setattr(socket, "getaddrinfo", _refuse)


@pytest.fixture(scope="session")
def protocol_schema() -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))


@pytest.fixture
def check_from_pipeline(protocol_schema: dict[str, Any]) -> Callable[[str], dict[str, Any]]:
    """Returns a checker: one written line in, the message out, or a failed test."""

    def check(line: str) -> dict[str, Any]:
        assert line.endswith("\n")
        assert "\n" not in line[:-1]
        message = cast("dict[str, Any]", json.loads(line))
        errors = schema_errors(protocol_schema["fromPipeline"], message)
        assert errors == [], errors
        return message

    return check
