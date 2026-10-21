"""The loopback opt-in lets a test reach 127.0.0.1 and nothing else (plan D5)."""

import socket

import pytest
from conftest import NetworkBlockedError


@pytest.mark.usefixtures("loopback")
def test_loopback_reaches_this_computer() -> None:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            pass


@pytest.mark.usefixtures("loopback")
def test_loopback_still_refuses_anywhere_else() -> None:
    with pytest.raises(NetworkBlockedError):
        socket.create_connection(("example.com", 443), timeout=2)
    with socket.socket() as sock, pytest.raises(NetworkBlockedError):
        sock.connect(("93.184.215.14", 443))


def test_without_the_opt_in_even_loopback_is_refused() -> None:
    with pytest.raises(NetworkBlockedError):
        socket.create_connection(("127.0.0.1", 9), timeout=2)
