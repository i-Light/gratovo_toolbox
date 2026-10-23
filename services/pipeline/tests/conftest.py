"""Shared test setup: no test may reach the network.

The guard covers Python's own sockets. The scraper's requests go through curl_cffi (libcurl, in C),
which this can't see, so every test that touches the scraper fakes its session instead.
"""

import json
import socket
import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from helpers import schema_errors

SCHEMA_FILE = Path(__file__).parent.parent / "src" / "gratovo_pipeline" / "protocol.schema.json"
GEMINI_SCHEMA_FILE = SCHEMA_FILE.parent / "gemini" / "gemini.schema.json"


class NetworkBlockedError(RuntimeError):
    pass


def _refuse(*_args: object, **_kwargs: object) -> None:
    raise NetworkBlockedError("tests must not reach the network")


_LOOPBACK = frozenset({"127.0.0.1", "::1"})
_REAL_CONNECT = socket.socket.connect
_REAL_CONNECT_EX = socket.socket.connect_ex
_REAL_CREATE_CONNECTION = socket.create_connection
_REAL_GETADDRINFO = socket.getaddrinfo


def _host(address: object) -> object:
    return address[0] if isinstance(address, tuple) and address else address  # pyright: ignore[reportUnknownVariableType]


def _loopback_only(real: Callable[..., Any]) -> Callable[..., Any]:
    """`real`, but only towards this computer: the address is the call's first argument after
    the socket (methods) or the first argument (functions)."""

    def guarded(*args: Any, **kwargs: Any) -> Any:
        target = args[1] if args and isinstance(args[0], socket.socket) else args[0]
        if _host(target) not in _LOOPBACK:
            _refuse()
        return real(*args, **kwargs)

    return guarded


@pytest.fixture(autouse=True)
def no_network(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    if "loopback" in request.fixturenames:
        # The bridge's tests talk to a fake extension on 127.0.0.1 (plan D5). Nothing else.
        monkeypatch.setattr(socket.socket, "connect", _loopback_only(_REAL_CONNECT))
        monkeypatch.setattr(socket.socket, "connect_ex", _loopback_only(_REAL_CONNECT_EX))
        monkeypatch.setattr(socket, "create_connection", _loopback_only(_REAL_CREATE_CONNECTION))
        monkeypatch.setattr(socket, "getaddrinfo", _loopback_only(_REAL_GETADDRINFO))
        return
    monkeypatch.setattr(socket.socket, "connect", _refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", _refuse)
    monkeypatch.setattr(socket, "create_connection", _refuse)
    monkeypatch.setattr(socket, "getaddrinfo", _refuse)


@pytest.fixture
def loopback() -> None:
    """Asking for this lets the test connect to 127.0.0.1 and nowhere else (see `no_network`)."""


@pytest.fixture(scope="session")
def protocol_schema() -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))


@pytest.fixture(scope="session")
def gemini_schema() -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(GEMINI_SCHEMA_FILE.read_text(encoding="utf-8")))


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


@pytest.fixture
def check_from_gemini(gemini_schema: dict[str, Any]) -> Callable[[str], dict[str, Any]]:
    """The same for the Gemini bridge: one line it wrote in, the message out, or a failed test."""

    def check(line: str) -> dict[str, Any]:
        assert line.endswith("\n")
        assert "\n" not in line[:-1]
        message = cast("dict[str, Any]", json.loads(line))
        errors = schema_errors(gemini_schema["fromGemini"], message)
        assert errors == [], errors
        return message

    return check


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """A fresh pipeline.db in a temporary folder. The behaviour under test is mostly SQL, so a
    real database rather than a fake: a fake store would test the fake."""
    from gratovo_pipeline import store

    connection = store.get_connection(tmp_path / "pipeline.db")
    store.init_db(connection)
    yield connection
    connection.close()
