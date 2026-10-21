"""`scrapetube._request`: redirect loops, leases, gateway routing and the host rule (ported from the
old test_scrapetube_request and test_scrapetube_gateway_routing). Nothing reaches the network: the
session is a fake, the pool is a fake, and the waits between attempts are skipped."""

from collections.abc import Mapping
from typing import Any

import pytest
from curl_cffi.requests import exceptions as curl_errors

from gratovo_pipeline import net
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import Candidate, WaitInfo

GATEWAY = "https://abc.execute-api.us-east-1.amazonaws.com"


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        url: str = "https://www.youtube.com/x",
        headers: Mapping[str, str] | None = None,
        text: str = "",
    ) -> None:
        self.status_code = status_code
        self.url = url
        self.headers: Mapping[str, str] = headers or {}
        self.text = text

    def json(self) -> Any:
        raise ValueError("not used")


class FakeSession:
    """Answers each request with the next item: a response, or an exception to raise."""

    def __init__(self, answers: list[FakeResponse | Exception]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, str]] = []
        self.proxies: dict[str, str] = {"http": "stale"}

    def request(self, method: str, url: str, **_kwargs: Any) -> FakeResponse:
        self.calls.append((method, url))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


class FakeLease:
    def __init__(self, pool: FakePool) -> None:
        self.pool = pool
        self.candidate = pool.candidate

    def release(self) -> None:
        self.pool.released += 1


class FakePool:
    """Records whether a candidate was blamed for a failure: a redirect loop must not be."""

    def __init__(self) -> None:
        self.candidate = Candidate(id="direct", proxies={}, label="This machine")
        self.blocked = 0
        self.connection_failures = 0
        self.acquired = 0
        self.released = 0

    def acquire(self, **_kwargs: Any) -> FakeLease:
        self.acquired += 1
        return FakeLease(self)

    def report_success(self, _candidate: Candidate) -> None:
        pass

    def report_blocked(self, _candidate: Candidate) -> None:
        self.blocked += 1

    def report_connection_failure(self, _candidate: Candidate) -> None:
        self.connection_failures += 1

    def route_summary(self, *, force: bool = False) -> str | None:
        return "Routes used: 1 direct; last: This machine"


def no_wait(_total: float, _reason: str) -> None:
    pass


@pytest.fixture
def pool(monkeypatch: pytest.MonkeyPatch) -> FakePool:
    fake = FakePool()
    monkeypatch.setattr(scrapetube, "get_pool", lambda: fake)
    monkeypatch.setattr(scrapetube, "_interruptible_wait", no_wait)
    return fake


@pytest.fixture
def logged(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    lines: list[str] = []

    def log(_level: LogLevel, text: str) -> None:
        lines.append(text)

    monkeypatch.setattr(scrapetube, "_log", log)
    return lines


def loop() -> Exception:
    return curl_errors.TooManyRedirects("Exceeded 30 redirects.")


# --- redirect loops ---


@pytest.mark.usefixtures("logged")
def test_a_redirect_loop_gives_up_after_bounded_attempts(pool: FakePool) -> None:
    session = FakeSession([loop(), loop(), loop()])
    with pytest.raises(scrapetube.RedirectLoopError):
        scrapetube.request(session, "GET", "https://www.youtube.com/@x/videos")
    assert len(session.calls) == scrapetube.MAX_REDIRECT_LOOP_ATTEMPTS
    # YouTube's own routing for one page, not the candidate's fault.
    assert (pool.blocked, pool.connection_failures) == (0, 0)


def test_a_redirect_loop_is_not_a_block() -> None:
    # A block ends the whole run; one broken channel page must not.
    assert not issubclass(scrapetube.RedirectLoopError, scrapetube.BlockedError)


@pytest.mark.usefixtures("pool", "logged")
def test_a_later_attempt_that_gets_through_is_returned() -> None:
    ok = FakeResponse(headers={"content-type": "text/html"}, text="<html>fine</html>")
    session = FakeSession([loop(), ok])
    assert scrapetube.request(session, "GET", "https://www.youtube.com/@x/videos") is ok
    assert len(session.calls) == 2


# --- leases ---


def test_the_lease_is_released_after_success_and_the_route_logged(
    pool: FakePool, logged: list[str]
) -> None:
    scrapetube.request(FakeSession([FakeResponse()]), "GET", "https://www.youtube.com/x")
    assert (pool.acquired, pool.released) == (1, 1)
    assert "Routes used: 1 direct; last: This machine" in logged


def test_the_lease_is_released_after_every_failed_attempt(
    pool: FakePool, logged: list[str]
) -> None:
    session = FakeSession(
        [
            curl_errors.ConnectionError("refused"),
            FakeResponse(status_code=429),
            loop(),
            FakeResponse(),
        ]
    )
    scrapetube.request(session, "GET", "https://www.youtube.com/x")
    assert (pool.acquired, pool.released) == (4, 4)
    assert pool.connection_failures == 1
    assert pool.blocked == 1
    assert any("YouTube pushed back" in line for line in logged)


@pytest.mark.usefixtures("logged")
def test_a_captcha_page_served_with_200_counts_as_a_block(pool: FakePool) -> None:
    captcha = FakeResponse(
        headers={"content-type": "text/html"}, text="Our systems have detected unusual traffic"
    )
    scrapetube.request(FakeSession([captcha, FakeResponse()]), "GET", "https://www.youtube.com/x")
    assert pool.blocked == 1


@pytest.mark.usefixtures("logged")
def test_a_gateway_candidate_rewrites_the_url(pool: FakePool) -> None:
    pool.candidate.base_url = "https://g.execute-api.eu-west-1.amazonaws.com/p"
    session = FakeSession([FakeResponse()])
    scrapetube.request(session, "GET", "https://www.youtube.com/results?q=a")
    assert session.calls == [("GET", "https://g.execute-api.eu-west-1.amazonaws.com/p/results?q=a")]
    assert session.proxies == {}


@pytest.mark.usefixtures("pool", "logged")
def test_a_host_outside_the_rule_is_refused_before_any_request() -> None:
    session = FakeSession([FakeResponse()])
    with pytest.raises(net.HostNotAllowedError):
        scrapetube.request(session, "GET", "https://evil.example/collect")
    assert session.calls == []


# --- gateway routing ---


@pytest.mark.parametrize(
    ("url", "routed"),
    [
        ("https://www.youtube.com/results?search_query=x", GATEWAY + "/results?search_query=x"),
        # get_recent_video_ids builds `https://www.YOUTUBE.com/...`: a case-sensitive match missed
        # it, sending the request direct while the pool blamed a gateway.
        (
            "https://www.YOUTUBE.com/@aitoolsweekly/videos?view=0",
            GATEWAY + "/@aitoolsweekly/videos?view=0",
        ),
        ("https://www.YouTube.com/watch?v=abc", GATEWAY + "/watch?v=abc"),
        ("https://example.com/whatever", "https://example.com/whatever"),
    ],
)
def test_route_through_gateway(url: str, routed: str) -> None:
    assert scrapetube.route_through_gateway(url, GATEWAY) == routed


# --- the wait announcer ---


def test_a_cooldown_wait_is_logged_once_not_every_tick(logged: list[str]) -> None:
    announce = scrapetube.WaitAnnouncer()
    for remaining in (60.0, 58.0, 56.0):
        announce(WaitInfo("cooldown", 60.0, remaining, "AWS Gateway 1 (eu-west-1)"))
    assert len(logged) == 1
    assert "AWS Gateway 1 (eu-west-1)" in logged[0]
