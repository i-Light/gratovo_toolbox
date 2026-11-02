"""`scrapetube._request`: redirect loops, leases, gateway routing and the host rule (ported from the
old test_scrapetube_request and test_scrapetube_gateway_routing). Nothing reaches the network: the
session is a fake, the pool is a fake, and the waits between attempts are skipped."""

import gzip
import re
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from curl_cffi.requests import exceptions as curl_errors

from gratovo_pipeline import net
from gratovo_pipeline.protocol import LogLevel, WaitCounter
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import Candidate, ProxyPool, WaitInfo

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
        self.redirects: list[bool] = []
        self.proxies: dict[str, str] = {"http": "stale"}

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, url))
        self.redirects.append(kwargs.get("allow_redirects", True))
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

    def report_current_bytes(self, _size: int) -> None:
        pass

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


@pytest.fixture
def pool(monkeypatch: pytest.MonkeyPatch) -> FakePool:
    fake = FakePool()
    monkeypatch.setattr(scrapetube, "get_pool", lambda: fake)
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
            FakeResponse(),
        ]
    )
    scrapetube.request(session, "GET", "https://www.youtube.com/x")
    assert (pool.acquired, pool.released) == (3, 3)
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
@pytest.mark.parametrize(
    "text",
    [
        "Sign in to confirm you're not a bot",
        "Sign in to confirm you’re not a bot",  # noqa: RUF001
        "Please confirm you’re not a bot",  # noqa: RUF001
    ],
)
def test_the_bot_wall_counts_as_a_block(pool: FakePool, text: str) -> None:
    wall = FakeResponse(headers={"content-type": "text/html"}, text=text)
    scrapetube.request(FakeSession([wall, FakeResponse()]), "GET", "https://www.youtube.com/x")
    assert pool.blocked == 1


@pytest.mark.usefixtures("logged")
def test_a_gateway_candidate_rewrites_the_url(pool: FakePool) -> None:
    pool.candidate.base_url = "https://g.execute-api.eu-west-1.amazonaws.com/p"
    session = FakeSession([FakeResponse()])
    scrapetube.request(session, "GET", "https://www.youtube.com/results?q=a")
    assert session.calls == [("GET", "https://g.execute-api.eu-west-1.amazonaws.com/p/results?q=a")]
    assert session.proxies == {}


GW = "https://g.execute-api.eu-west-1.amazonaws.com/p"


def hop(location: str) -> FakeResponse:
    return FakeResponse(302, headers={"location": location})


@pytest.mark.usefixtures("logged")
def test_a_gateway_redirect_to_youtube_goes_back_through_the_gateway(pool: FakePool) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop("https://www.YouTube.com/x"), FakeResponse(url=f"{GW}/x")])
    response = scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert [u for _, u in session.calls] == [f"{GW}/results", f"{GW}/x"]
    assert session.redirects == [False, False]
    assert response.url == "https://www.youtube.com/x"


@pytest.mark.usefixtures("logged")
def test_a_relative_gateway_redirect_works(pool: FakePool) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop("/y?a=1"), FakeResponse()])
    scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert session.calls[1][1] == f"{GW}/y?a=1"


@pytest.mark.usefixtures("logged")
def test_a_gateway_redirect_off_youtube_is_refused_without_a_request(pool: FakePool) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop("https://example.com/x")] * 3)
    with pytest.raises(scrapetube.PageFailedError):
        scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert all(u.startswith(GW) for _, u in session.calls)
    assert len(session.calls) == scrapetube.MAX_ATTEMPTS
    assert pool.blocked == 0  # refused, not a block


@pytest.mark.usefixtures("logged")
@pytest.mark.parametrize(
    "location",
    [
        "https://youtube.com/x?a=1",
        "https://WWW.YOUTUBE.COM:443/x?a=1",
        "https://www.youtube.com/x?a=1#frag",
    ],
)
def test_a_gateway_redirect_is_rebuilt_on_youtube_and_routed(pool: FakePool, location: str) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop(location), FakeResponse(url=f"{GW}/x?a=1")])
    scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert session.calls[1][1] == f"{GW}/x?a=1"


@pytest.mark.usefixtures("logged")
@pytest.mark.parametrize(
    "location",
    [
        "http://www.youtube.com/x",  # not https: refused, not upgraded
        "https://www.youtube.com:8443/x",
        "https://user@www.youtube.com/x",
        "https://www.youtube.com.evil.example/x",
        "https://www.youtube.com:bad/x",
    ],
)
def test_a_gateway_redirect_that_is_not_plain_youtube_is_refused(
    pool: FakePool, location: str
) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop(location)] * 3)
    with pytest.raises(scrapetube.PageFailedError):
        scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert [u for _, u in session.calls] == [f"{GW}/results"] * scrapetube.MAX_ATTEMPTS
    assert pool.blocked == 0


@pytest.mark.usefixtures("logged")
@pytest.mark.parametrize(
    "location",
    [
        "https://www.google.com/sorry/index?continue=x",
        "https://www.youtube.com/sorry/index",
        "https://consent.youtube.com/m?continue=x",
    ],
)
def test_a_gateway_redirect_to_the_captcha_or_consent_is_a_block(
    pool: FakePool, location: str
) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop(location)] * 3)
    with pytest.raises(scrapetube.PageFailedError) as failed:
        scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert pool.blocked == scrapetube.MAX_ATTEMPTS
    assert failed.value.all_blocked
    assert len(session.calls) == scrapetube.MAX_ATTEMPTS


@pytest.mark.usefixtures("logged")
def test_a_gateway_request_off_youtube_is_never_sent(pool: FakePool) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([])
    with pytest.raises(scrapetube.PageFailedError):
        scrapetube.request(session, "GET", "https://www.youtube.com.evil.example/x")
    assert session.calls == []


@pytest.mark.usefixtures("logged")
@pytest.mark.parametrize(
    "error",
    [
        curl_errors.ReadTimeout("slow"),
        curl_errors.Timeout("slow"),
        curl_errors.ConnectTimeout("slow"),
    ],
)
def test_a_timeout_is_a_connection_failure(pool: FakePool, error: Exception) -> None:
    session = FakeSession([error, FakeResponse()])
    scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert pool.connection_failures == 1
    assert pool.blocked == 0


@pytest.mark.usefixtures("logged")
def test_six_gateway_hops_is_a_redirect_loop(pool: FakePool) -> None:
    pool.candidate.base_url = GW
    session = FakeSession([hop("/x")] * 12)
    with pytest.raises(scrapetube.RedirectLoopError):
        scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert len(session.calls) == 12


@pytest.mark.usefixtures("logged")
def test_a_proxy_candidate_leaves_redirects_to_the_library(pool: FakePool) -> None:
    session = FakeSession([FakeResponse()])
    scrapetube.request(session, "GET", "https://www.youtube.com/results")
    assert session.redirects == [True]


def test_a_failed_attempt_logs_neither_the_gateway_nor_a_proxy_login(
    pool: FakePool, logged: list[str]
) -> None:
    # The gateway URLs and proxy URLs are the job's secrets: the log reaches the page.
    gateway = "https://g.execute-api.eu-west-1.amazonaws.com/p"
    pool.candidate.base_url = gateway
    session = FakeSession(
        [
            FakeResponse(status_code=403, url=gateway + "/results?q=a"),
            curl_errors.ProxyError("CONNECT to http://ai-user:proxy-pass-123@proxy.example failed"),
            curl_errors.Timeout("Operation timed out after g.execute-api.eu-west-1.amazonaws.com"),
        ]
    )
    with pytest.raises(scrapetube.PageFailedError) as failed:
        scrapetube.request(session, "GET", "https://www.youtube.com/results?q=a")
    assert "execute-api" not in str(failed.value)
    pushed_back = [line for line in logged if "pushed back" in line]
    assert len(pushed_back) == 3
    for line in pushed_back:
        assert "execute-api" not in line
        assert "proxy-pass-123" not in line
    assert "HTTP 403 from /results" in pushed_back[0]  # YouTube's path, not the gateway
    assert "This machine: ProxyError)" in pushed_back[1]


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


# --- three attempts, three routes (step S2, R1) ---


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class LowRng:
    def uniform(self, a: float, b: float) -> float:
        return a


def real_pool(monkeypatch: pytest.MonkeyPatch, *gateways: str) -> tuple[ProxyPool, FakeClock]:
    """A real pool on a fake clock whose sleeps advance it, installed as the module's pool."""
    clock = FakeClock()

    def sleep(seconds: float) -> None:
        clock.now += seconds

    pool = ProxyPool.from_routes(
        gateway_urls=gateways,
        include_direct=not gateways,
        min_gap_seconds=0,
        clock=clock,
        sleep=sleep,
        rng=LowRng(),
    )
    monkeypatch.setattr(scrapetube, "get_pool", lambda: pool)
    return pool, clock


GATEWAYS = tuple(f"https://g{i}.execute-api.eu-west-1.amazonaws.com/p" for i in range(3))


def host_of(call: tuple[str, str]) -> str:
    return call[1].split("/")[2].split(".")[0]


@pytest.mark.usefixtures("logged")
def test_a_page_gets_three_attempts_on_three_distinct_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool, _clock = real_pool(monkeypatch, *GATEWAYS)
    answers: list[FakeResponse | Exception] = [FakeResponse(status_code=429) for _ in range(3)]
    session = FakeSession(answers)
    with pytest.raises(scrapetube.PageFailedError) as failed:
        scrapetube.request(session, "GET", "https://www.youtube.com/results?q=a")
    assert len(session.calls) == scrapetube.MAX_ATTEMPTS == 3
    assert sorted(host_of(c) for c in session.calls) == ["g0", "g1", "g2"]
    assert str(failed.value) == "/results failed after 3 attempts (HTTP 429 from /x)"
    assert all(c.cooldown_until > 0 for c in pool.candidates), "each route was cooled"


@pytest.mark.usefixtures("logged")
def test_a_blocked_route_never_ends_the_request_while_another_is_healthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool, _clock = real_pool(monkeypatch, *GATEWAYS)
    ok = FakeResponse(text="fine")
    session = FakeSession([FakeResponse(status_code=403), FakeResponse(status_code=429), ok])
    assert scrapetube.request(session, "GET", "https://www.youtube.com/x") is ok
    assert len({host_of(c) for c in session.calls}) == 3
    assert sum(1 for c in pool.candidates if c.cooldown_until > 0) == 2


@pytest.mark.usefixtures("logged")
def test_one_route_alone_is_reused_after_its_cooldown(monkeypatch: pytest.MonkeyPatch) -> None:
    pool, clock = real_pool(monkeypatch)
    ok = FakeResponse(text="fine")
    session = FakeSession([FakeResponse(status_code=429), ok])
    assert scrapetube.request(session, "GET", "https://www.youtube.com/x") is ok
    assert len(session.calls) == 2
    assert clock.now >= 1000.0 + 120.0, "the second attempt waited for the cooldown"
    assert pool.candidates[0].cooldown_until == 0.0, "and the success cleared it"


class HtmlAnswer(FakeResponse):
    def json(self) -> Any:
        raise ValueError("Expecting value")


class JsonAnswer(FakeResponse):
    def json(self) -> Any:
        return {"ok": True}


@pytest.mark.usefixtures("logged")
def test_a_non_json_answer_cools_the_route_and_the_next_route_is_tried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool, _clock = real_pool(monkeypatch, *GATEWAYS[:2])
    good = JsonAnswer(text='{"ok": true}')
    session = FakeSession([HtmlAnswer(text="<html>captcha</html>"), good])
    url = "https://www.youtube.com/youtubei/v1/search"
    assert scrapetube.request(session, "POST", url, expect_json=True) is good
    assert len({host_of(c) for c in session.calls}) == 2
    assert sum(1 for c in pool.candidates if c.cooldown_until > 0) == 1


# --- one route per keyword (step S2, R2) ---


@pytest.mark.usefixtures("logged")
def test_a_keyword_stays_on_its_route_while_healthy_and_moves_when_it_cools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_pool(monkeypatch, *GATEWAYS[:2])
    answers: list[FakeResponse | Exception] = [FakeResponse(text="p") for _ in range(4)]
    answers += [FakeResponse(status_code=429)] + [FakeResponse(text="p") for _ in range(3)]
    session = FakeSession(answers)
    with scrapetube.route_affinity():
        for _ in range(4):
            scrapetube.request(session, "GET", "https://www.youtube.com/x")
        first = {host_of(c) for c in session.calls}
        assert len(first) == 1, "four pages, one route"
        for _ in range(3):  # the first of these meets a 429 and moves on
            scrapetube.request(session, "GET", "https://www.youtube.com/x")
    later = [host_of(c) for c in session.calls[4:]]
    assert later[0] in first, "the 429 came from the preferred route"
    assert later[1] not in first, "the next attempt moved to the other"
    assert set(later[1:]) == {later[1]}, "and the keyword stays on the new route"


@pytest.mark.usefixtures("logged")
def test_without_affinity_requests_alternate(monkeypatch: pytest.MonkeyPatch) -> None:
    real_pool(monkeypatch, *GATEWAYS[:2])
    answers: list[FakeResponse | Exception] = [FakeResponse(text="p") for _ in range(4)]
    session = FakeSession(answers)
    for _ in range(4):
        scrapetube.request(session, "GET", "https://www.youtube.com/x")
    assert len({host_of(c) for c in session.calls}) == 2


# --- bandwidth (step S2, R7) ---


@pytest.mark.usefixtures("pool", "logged")
def test_a_plain_response_counts_its_body_and_headers() -> None:
    scrapetube.take_thread_bytes()
    response = FakeResponse(headers={"content-type": "text/html"}, text="a" * 1000)
    scrapetube.request(FakeSession([response]), "GET", "https://www.youtube.com/x")
    assert scrapetube.take_thread_bytes() == 1000 + len("content-type") + len("text/html") + 4
    assert scrapetube.thread_bytes() == 0, "taking the count resets it"


@pytest.mark.usefixtures("pool", "logged")
def test_a_compressed_response_counts_its_body_gzipped_again() -> None:
    scrapetube.take_thread_bytes()
    body = "<html>" + "ai agents " * 2000 + "</html>"
    response = FakeResponse(headers={"content-encoding": "br"}, text=body)
    scrapetube.request(FakeSession([response]), "GET", "https://www.youtube.com/x")
    expected = len(gzip.compress(body.encode(), 6)) + len("content-encoding") + len("br") + 4
    assert scrapetube.take_thread_bytes() == expected < len(body)


@pytest.mark.usefixtures("pool", "logged")
def test_every_attempt_counts_and_the_total_follows_all_threads() -> None:
    scrapetube.take_thread_bytes()
    scrapetube.reset_total_bytes()
    answers: list[FakeResponse | Exception] = [
        FakeResponse(status_code=429, text="x" * 100),
        FakeResponse(text="y" * 50),
    ]
    scrapetube.request(FakeSession(answers), "GET", "https://www.youtube.com/x")
    assert scrapetube.thread_bytes() == 150
    assert scrapetube.total_bytes() == 150


# --- long routes waits are told (step S2, R4) ---


class Sink:
    def __init__(self) -> None:
        self.told: list[tuple[str, ...]] = []

    def wait(self, reason: str, until: str) -> None:
        self.told.append(("wait", reason, until))

    def resume(self, reason: str) -> None:
        self.told.append(("resume", reason))


@pytest.fixture
def sink() -> Iterator[Sink]:
    told = Sink()
    scrapetube.set_wait_sink(WaitCounter(told))
    yield told
    scrapetube.set_wait_sink(None)


@pytest.mark.usefixtures("logged")
def test_a_cooldown_of_two_minutes_sends_one_wait_then_one_resume(
    monkeypatch: pytest.MonkeyPatch, sink: Sink
) -> None:
    real_pool(monkeypatch)  # one route: after the 429 it cools for 120 s
    ok = FakeResponse(text="fine")
    session = FakeSession([FakeResponse(status_code=429), ok])
    assert scrapetube.request(session, "GET", "https://www.youtube.com/x") is ok
    assert [m[0] for m in sink.told] == ["wait", "resume"]
    assert sink.told[0][1] == "routes"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", sink.told[0][2])


def test_two_workers_in_one_long_wait_send_one_wait_and_one_resume(sink: Sink) -> None:
    first, second = scrapetube.WaitAnnouncer(), scrapetube.WaitAnnouncer()
    for announce in (first, second):
        for remaining in (120.0, 118.0):
            announce(WaitInfo("cooldown", 120.0, remaining, "AWS Gateway 1"))
    first.done(resumed=True)
    second.done(resumed=True)
    assert [m[0] for m in sink.told] == ["wait", "resume"]


def test_a_cooldown_under_thirty_seconds_is_not_told(sink: Sink) -> None:
    announce = scrapetube.WaitAnnouncer()
    announce(WaitInfo("cooldown", 20.0, 20.0, "AWS Gateway 1"))
    announce.done(resumed=True)
    assert sink.told == []


@pytest.mark.usefixtures("logged")
def test_a_resume_that_raises_does_not_leak_the_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    class Broken:
        def wait(self, reason: str, until: str) -> None:
            pass

        def resume(self, reason: str) -> None:
            raise OSError("pipe closed")

    scrapetube.set_wait_sink(Broken())
    try:
        pool, _clock = real_pool(monkeypatch)  # one route: the 429 cools it for 120 s
        session = FakeSession([FakeResponse(status_code=429), FakeResponse(text="fine")])
        with pytest.raises(OSError, match="pipe closed"):
            scrapetube.request(session, "GET", "https://www.youtube.com/x")
        assert not pool.candidates[0].busy, "the lease was released"
    finally:
        scrapetube.set_wait_sink(None)


@pytest.mark.usefixtures("logged")
def test_page_failed_says_whether_every_attempt_was_a_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_pool(monkeypatch, *GATEWAYS)
    blocked = FakeSession([FakeResponse(status_code=429) for _ in range(3)])
    with pytest.raises(scrapetube.PageFailedError) as all_blocked:
        scrapetube.request(blocked, "GET", "https://www.youtube.com/x")
    assert all_blocked.value.all_blocked

    real_pool(monkeypatch, *GATEWAYS)
    mixed = FakeSession(
        [
            FakeResponse(status_code=429),
            FakeResponse(status_code=503),
            FakeResponse(status_code=429),
        ]
    )
    with pytest.raises(scrapetube.PageFailedError) as some:
        scrapetube.request(mixed, "GET", "https://www.youtube.com/x")
    assert not some.value.all_blocked
