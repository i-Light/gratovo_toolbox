"""A minimal client for Firefox's remote debugging protocol (RDP): enough to install a temporary add-on.

Why: release Firefox only installs signed add-ons for good, but a *temporary*
add-on -- what `about:debugging` "Load Temporary Add-on" and `web-ext run` do --
needs no signature. It lasts until that Firefox exits, so the daemon installs
it again on every launch, which is also how the add-on stays up to date.

Wire format: each packet is `<byte length>:<JSON>` over TCP on loopback. The
server greets first; a request is `{"to": actor, "type": ...}` and its reply
comes `from` that actor. Unsolicited events (`tabListChanged`,
`addonListChanged`, ...) can arrive in between and are skipped. One request at
a time per client, which is all this module does.

Stdlib only (it runs inside the app's bundled interpreter).
"""

from __future__ import annotations

import json
import socket
import time
from pathlib import Path
from typing import Any, Optional

#: Replies to a request carry no `type`, or one of these; anything else from that actor is an event.
_REPLY_TYPES = frozenset({"response"})


class RdpError(Exception):
    """The debugging server refused, answered with an error, or was not there."""


def _frame(message: dict) -> bytes:
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return str(len(body)).encode("ascii") + b":" + body


class RdpClient:
    """One connection to `127.0.0.1:<port>`."""

    def __init__(self, port: int, *, wait_s: float = 30.0, host: str = "127.0.0.1") -> None:
        """Connects, retrying until `wait_s` (Firefox opens the port a moment after it starts)."""
        deadline = time.monotonic() + wait_s
        last: Optional[OSError] = None
        self._sock: Optional[socket.socket] = None
        while True:
            try:
                self._sock = socket.create_connection((host, port), timeout=2.0)
                break
            except OSError as error:
                last = error
                if time.monotonic() >= deadline:
                    raise RdpError(f"Firefox's debugging port {port} did not open within {wait_s:.0f} s: {last}") from last
                time.sleep(0.3)
        self._buffer = b""
        self.greeting = self._read(timeout=10.0)

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    def __enter__(self) -> "RdpClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # --- framing -----------------------------------------------------------------------

    def _recv(self, timeout: float) -> None:
        assert self._sock is not None
        self._sock.settimeout(timeout)
        try:
            chunk = self._sock.recv(65536)
        except socket.timeout as error:
            raise RdpError("Firefox's debugging server stopped answering") from error
        except OSError as error:
            raise RdpError(f"debugging connection failed: {error}") from error
        if not chunk:
            raise RdpError("Firefox closed the debugging connection")
        self._buffer += chunk

    def _read(self, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        while b":" not in self._buffer:
            if len(self._buffer) > 20:
                raise RdpError("not a debugging server (bad packet header)")
            self._recv(max(0.1, deadline - time.monotonic()))
        head, _, rest = self._buffer.partition(b":")
        try:
            length = int(head)
        except ValueError as error:
            raise RdpError("not a debugging server (bad packet length)") from error
        self._buffer = rest
        while len(self._buffer) < length:
            self._recv(max(0.1, deadline - time.monotonic()))
        body, self._buffer = self._buffer[:length], self._buffer[length:]
        try:
            packet = json.loads(body.decode("utf-8"))
        except ValueError as error:
            raise RdpError("debugging server sent a packet that is not JSON") from error
        if not isinstance(packet, dict):
            raise RdpError("debugging server sent a packet that is not an object")
        return packet

    def request(self, to: str, type_: str, *, timeout: float = 30.0, **fields: Any) -> dict:
        """Sends one request and returns its reply; an `error` reply raises `RdpError`."""
        assert self._sock is not None
        self._sock.sendall(_frame({"to": to, "type": type_, **fields}))
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RdpError(f"no reply to {type_} within {timeout:.0f} s")
            packet = self._read(remaining)
            if packet.get("from") != to:
                continue
            if "error" in packet:
                raise RdpError(f"{type_} failed: {packet.get('error')}: {packet.get('message', '')}".strip())
            if "type" not in packet or packet.get("type") in _REPLY_TYPES:
                return packet
            # an event from the same actor (e.g. root's tabListChanged): not our reply

    # --- the calls the daemon needs ------------------------------------------------------

    def root(self) -> dict:
        return self.request("root", "getRoot")

    def install_temporary_addon(self, addon_dir: Path) -> dict:
        """Installs the unpacked add-on in `addon_dir`; returns `{id, actor}` as Firefox reports it."""
        actor = self.root().get("addonsActor")
        if not actor:
            raise RdpError("this Firefox has no add-ons actor (too old, or debugging is restricted)")
        reply = self.request(actor, "installTemporaryAddon", addonPath=str(addon_dir), openDevTools=False, timeout=60.0)
        addon = reply.get("addon")
        if not isinstance(addon, dict) or not addon.get("id"):
            raise RdpError(f"installTemporaryAddon gave no add-on: {reply}")
        return addon

    def list_addons(self) -> list[dict]:
        """`[{id, name, version, temporarilyInstalled, ...}]` for every add-on in that Firefox."""
        reply = self.request("root", "listAddons", iconDataURL=False)
        addons = reply.get("addons")
        return addons if isinstance(addons, list) else []


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False
