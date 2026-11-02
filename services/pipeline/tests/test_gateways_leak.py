"""The leak test (`gateways.leak`, step S5 P0) against a fake AWS, a fake checkip and a fake
httpbin: no network. The fake address must never show up in a line or on stderr."""

import io
import json
import socket
import threading
import time
import urllib.request
from collections.abc import Iterator
from typing import Any
from urllib.error import URLError

import pytest
from helpers import start_with
from test_gateways_job import AWS, SECRET_KEY, Check, FakeAws, Reply, end_of, http_error, result_of

from gratovo_pipeline import net, run_control
from gratovo_pipeline.jobs import gateways
from gratovo_pipeline.protocol import Emitter

OWN = "203.0.113.7"  # this computer, as checkip sees it (a documentation address)
OTHER = "198.51.100.9"  # this computer after its address changed mid-test
AMAZON = "3.4.5.6"  # the gateway's own address, as httpbin sees its caller
GATEWAY = "https://apiuseast1.execute-api.us-east-1.amazonaws.com"
LEAK = {"kind": "gateways.leak"}
LIST = ("GET", "/v2/apis?maxResults=100")
DELETE = ("DELETE", "/v2/apis/apiuseast1")
LEFT_BEHIND = (
    "A test gateway named gratovo-leak-test is still in us-east-1. "
    "Delete it in the AWS console (API Gateway \u203a APIs)."
)
NO_ANSWER = "The test gateway or httpbin.org didn't answer in time."


class Text(Reply):
    """A plain-text answer, as checkip gives one."""

    def __init__(self, text: str) -> None:
        super().__init__(None, 200)
        self._raw = text.encode()


def httpbin(
    headers: dict[str, str], *, origin: str | None = AMAZON, show_env: bool = True
) -> Reply:
    """`/anything?show_env=1` as httpbin answers it."""
    answer: dict[str, object] = {
        "args": {"show_env": "1"} if show_env else {},
        "headers": {"Host": "httpbin.org", "Accept": "*/*", **headers},
        "method": "GET",
    }
    if origin is not None:
        answer["origin"] = origin
    return Reply(answer)


def fake(
    headers: dict[str, str] | None = None,
    *,
    checkips: list[Reply | Exception] | None = None,
    **overrides: Reply | Exception,
) -> FakeAws:
    """checkip, the control plane and the test gateway. `overrides` replaces one answer by key:
    `checkip`, `status`, `echo`, `list` (`GET /v2/apis`), `delete`, or a control-plane POST path's
    last segment (`apis`, `stages`). `checkips` answers checkip in turn (before, then after)."""
    return fake_from(overrides, headers, checkips)


def fake_from(
    overrides: dict[str, Reply | Exception],
    headers: dict[str, str] | None = None,
    checkips: list[Reply | Exception] | None = None,
) -> FakeAws:
    answers = iter(checkips or [])

    def handler(request: urllib.request.Request) -> Reply | Exception:
        url = request.full_url
        if url.startswith(gateways.CHECKIP_URL):
            return next(answers, None) or overrides.get("checkip", Text(f"{OWN}\n"))
        if ".execute-api." in url:
            if url.endswith("/status/204"):
                return overrides.get("status", Reply(None, 204))
            if url.endswith("/anything?show_env=1"):
                return overrides.get("echo", httpbin(headers or {}))
            return URLError("unexpected")
        last = url.rsplit("/", 1)[1]
        if request.get_method() == "GET":
            return overrides.get("list", Reply({"items": []}))
        if request.get_method() == "POST" and last in overrides:
            return overrides[last]
        if request.get_method() == "DELETE" and "delete" in overrides:
            return overrides["delete"]
        return FakeAws.happy(request)

    return FakeAws(handler)


@pytest.fixture(autouse=True)
def leak_hosts(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    net.allow_job_hosts("gateways.leak")
    monkeypatch.setattr(gateways, "LEAK_POLL_PAUSE", 0.0)
    monkeypatch.setattr(gateways, "LEAK_DELETE_PAUSES", (0.0, 0.0, 0.0))
    yield
    run_control.clear_stop()
    net.allow_job_hosts("search")


def run_leak(
    transport: FakeAws, check: Check, job: dict[str, Any] = LEAK, *, keys: bool = True
) -> list[dict[str, Any]]:
    out = io.StringIO()
    changes: dict[str, object] = {"secrets__aws": AWS} if keys else {}
    start = start_with(job=job, source="live", **changes)
    gateways.run(start, Emitter(out), open_url=transport)
    return [check(line + "\n") for line in out.getvalue().splitlines()]


def control_calls(transport: FakeAws) -> list[tuple[str, str]]:
    return [c for c, r in zip(transport.calls(), transport.requests, strict=True) if _aws(r)]


def deletes(transport: FakeAws) -> list[tuple[str, str]]:
    return [c for c in control_calls(transport) if c[0] == "DELETE"]


def _aws(request: urllib.request.Request) -> bool:
    return request.full_url.startswith("https://apigateway.")


def warnings_of(lines: list[dict[str, Any]]) -> list[str]:
    return [line["text"] for line in lines if line["type"] == "log" and line["level"] == "warn"]


def stop_on(path_end: str, base: FakeAws) -> FakeAws:
    """`base`, but a stop is pressed as the request ending in `path_end` goes out."""

    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.full_url.endswith(path_end):
            run_control.request_stop()
        return base.handler(request)

    return FakeAws(handler)


def test_an_address_in_forwarded_is_a_leak_named_by_header(
    check_from_pipeline: Check, capsys: pytest.CaptureFixture[str]
) -> None:
    transport = fake({"Forwarded": f"for={OWN};proto=https", "X-Amzn-Trace-Id": "Root=1-abc"})

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines) == {
        "outcome": "leak",
        "headers": ["Forwarded"],
        "forwardingHeaders": ["Forwarded", "X-Amzn-Trace-Id"],
        "region": "us-east-1",
        "removed": True,
    }
    assert end_of(lines)["state"] == "done"
    # The leftover check, then the four deploy calls; the delete last.
    assert control_calls(transport) == [
        LIST,
        ("POST", "/v2/apis"),
        ("POST", "/v2/apis/apiuseast1/integrations"),
        ("POST", "/v2/apis/apiuseast1/routes"),
        ("POST", "/v2/apis/apiuseast1/stages"),
        DELETE,
    ]
    assert transport.body(2)["name"] == "gratovo-leak-test"
    assert transport.body(3)["integrationUri"] == "https://httpbin.org/{proxy}"
    # checkip before and after the one echo.
    unsigned = [r.full_url for r in transport.requests if not _aws(r)]
    assert unsigned == [
        gateways.CHECKIP_URL,
        f"{GATEWAY}/status/204",
        f"{GATEWAY}/anything?show_env=1",
        gateways.CHECKIP_URL,
    ]
    assert all(r.get_header("Authorization") is None for r in transport.requests if not _aws(r))
    seen = json.dumps(lines) + capsys.readouterr().err
    assert OWN not in seen
    assert "for=" not in seen
    assert SECRET_KEY not in seen


def test_every_header_that_carries_the_address_is_named_once(check_from_pipeline: Check) -> None:
    transport = fake({"X-Forwarded-For": f"{OWN}, 3.4.5.6", "Forwarded": f'for="{OWN}:5555"'})

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines)["headers"] == ["Forwarded", "X-Forwarded-For"]


def test_no_address_is_clean_and_names_the_forwarding_headers(check_from_pipeline: Check) -> None:
    # Amazon's own address, and ones that only contain this computer's as a part, aren't a leak.
    transport = fake(
        {
            "X-Forwarded-For": "3.4.5.6",
            "Forwarded": "for=203.0.113.70",
            "Via": "1.203.0.113.7",
            "X-Real-Ip": "3.4.5.6",
            "X-Amzn-Trace-Id": "Root=1-abc",
            "User-Agent": "Python-urllib",
        }
    )

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines) == {
        "outcome": "clean",
        "headers": [],
        "forwardingHeaders": [
            "Forwarded",
            "Via",
            "X-Amzn-Trace-Id",
            "X-Forwarded-For",
            "X-Real-Ip",
        ],
        "region": "us-east-1",
        "removed": True,
    }
    assert control_calls(transport)[-1] == DELETE


def test_the_address_as_the_caller_httpbin_saw_is_a_leak(check_from_pipeline: Check) -> None:
    transport = fake(echo=httpbin({}, origin=f"{OWN}, {AMAZON}"))

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines)["outcome"] == "leak"
    assert result_of(lines)["headers"] == []


def test_the_leak_is_judged_before_names_are_cut(check_from_pipeline: Check) -> None:
    # A name that isn't a valid token can't be shown, but it still carried the address.
    transport = fake({"Bad Name": OWN, **{f"X-Hop-{i:02}": OWN for i in range(25)}})

    lines = run_leak(transport, check_from_pipeline)

    data = result_of(lines)
    assert data["outcome"] == "leak"
    assert len(data["headers"]) == gateways.LEAK_MAX_HEADERS
    assert "Bad Name" not in data["headers"]

    only_bad = fake({"Bad Name": OWN})
    assert result_of(run_leak(only_bad, check_from_pipeline))["outcome"] == "leak"


@pytest.mark.parametrize(
    "echo",
    [
        httpbin({}, show_env=False),  # show_env ignored: the forwarding headers may be hidden
        httpbin({}, origin=None),
        Reply({"headers": "not an object", "args": {"show_env": "1"}, "origin": AMAZON}),
        Text("<html>not json</html>"),
        http_error(GATEWAY, 502),
    ],
)
def test_an_echo_that_doesnt_prove_itself_is_unclear(
    echo: Reply | Exception, check_from_pipeline: Check
) -> None:
    transport = fake(echo=echo)

    lines = run_leak(transport, check_from_pipeline)

    assert end_of(lines)["state"] == "done"
    assert result_of(lines)["outcome"] == "unclear"
    assert control_calls(transport)[-1] == DELETE


@pytest.mark.parametrize("after", [Text(f"{OTHER}\n"), URLError("offline"), Text("::1")])
def test_an_address_that_changed_or_went_unread_is_unclear(
    after: Reply | Exception, check_from_pipeline: Check
) -> None:
    transport = fake(checkips=[Text(f"{OWN}\n"), after])

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines)["outcome"] == "unclear"


def test_either_address_showing_is_still_a_leak(check_from_pipeline: Check) -> None:
    transport = fake({"X-Forwarded-For": OTHER}, checkips=[Text(f"{OWN}\n"), Text(f"{OTHER}\n")])

    lines = run_leak(transport, check_from_pipeline)

    assert result_of(lines)["outcome"] == "leak"
    assert result_of(lines)["headers"] == ["X-Forwarded-For"]


def test_the_region_asked_for_is_the_one_used(check_from_pipeline: Check) -> None:
    transport = fake()

    lines = run_leak(
        transport, check_from_pipeline, {"kind": "gateways.leak", "region": "eu-west-1"}
    )

    assert result_of(lines)["region"] == "eu-west-1"
    assert all(
        r.full_url.startswith("https://apigateway.eu-west-1.")
        for r in transport.requests
        if _aws(r)
    )


def test_a_slow_gateway_is_waited_for(check_from_pipeline: Check) -> None:
    answers = iter([http_error(GATEWAY, 404), URLError("no dns yet"), Reply(None, 204)])

    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.full_url.endswith("/status/204"):
            return next(answers)
        return base.handler(request)

    base = fake()
    transport = FakeAws(handler)

    lines = run_leak(transport, check_from_pipeline)

    assert end_of(lines)["state"] == "done"
    assert sum(r.full_url.endswith("/status/204") for r in transport.requests) == 3


def test_a_failed_create_deletes_nothing(check_from_pipeline: Check) -> None:
    transport = fake(apis=http_error("https://apigateway", 400, "BadRequestException"))

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport) == [LIST, ("POST", "/v2/apis")]
    assert [line["type"] for line in lines if line["type"] != "log"] == ["end"]
    assert end_of(lines)["error"]["code"] == "aws"
    assert "create the API: HTTP 400" in end_of(lines)["error"]["message"]


def test_a_failure_after_the_create_still_deletes(check_from_pipeline: Check) -> None:
    transport = fake(stages=http_error("https://apigateway", 500))

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport)[-1] == DELETE
    assert end_of(lines)["error"]["code"] == "aws"


def test_a_gateway_that_never_answers_is_deleted(check_from_pipeline: Check) -> None:
    transport = fake(status=http_error(GATEWAY, 404))

    lines = run_leak(transport, check_from_pipeline)

    assert sum(".execute-api." in r.full_url for r in transport.requests) == gateways.LEAK_POLLS
    assert control_calls(transport)[-1] == DELETE
    assert end_of(lines)["error"] == {"code": "network", "message": NO_ANSWER}


def test_an_echo_with_no_answer_is_a_network_failure(check_from_pipeline: Check) -> None:
    transport = fake(echo=URLError("reset"))

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport)[-1] == DELETE
    assert end_of(lines)["error"] == {"code": "network", "message": NO_ANSWER}


def test_a_surprise_after_the_create_still_deletes(check_from_pipeline: Check) -> None:
    transport = fake(echo=ValueError(f"boom {OWN}"))

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport)[-1] == DELETE
    assert end_of(lines)["error"]["code"] == "crash"
    assert OWN not in json.dumps(lines)


def test_a_stop_while_waiting_deletes_and_ends_stopped(check_from_pipeline: Check) -> None:
    transport = stop_on("/status/204", fake(status=http_error(GATEWAY, 404)))

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport)[-1] == DELETE
    assert sum(r.full_url.endswith("/status/204") for r in transport.requests) == 1
    assert not any(r.full_url.endswith("/anything?show_env=1") for r in transport.requests)
    assert [line["type"] for line in lines if line["type"] != "log"] == ["end"]
    assert end_of(lines)["state"] == "stopped"


def test_a_stop_during_the_build_skips_to_the_delete(check_from_pipeline: Check) -> None:
    transport = stop_on("/v2/apis", fake())

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport) == [LIST, ("POST", "/v2/apis"), DELETE]
    assert not any(".execute-api." in r.full_url for r in transport.requests)
    assert end_of(lines)["state"] == "stopped"


def test_a_stop_before_the_build_builds_nothing(check_from_pipeline: Check) -> None:
    transport = stop_on(gateways.CHECKIP_URL, fake())

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport) == [LIST]
    assert end_of(lines)["state"] == "stopped"


def test_a_failed_delete_is_tried_four_times_then_reported(check_from_pipeline: Check) -> None:
    transport = fake({"Forwarded": f"for={OWN}"}, delete=URLError("down"))

    lines = run_leak(transport, check_from_pipeline)

    assert deletes(transport) == [DELETE] * 4
    assert end_of(lines)["state"] == "done"
    assert result_of(lines)["outcome"] == "leak"
    assert result_of(lines)["removed"] is False
    assert warnings_of(lines) == [LEFT_BEHIND]


def test_a_busy_aws_is_waited_out_on_the_delete(check_from_pipeline: Check) -> None:
    answers = iter([http_error("https://apigateway", 429), Reply(None, 204)])

    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.get_method() == "DELETE":
            return next(answers)
        return base.handler(request)

    base = fake()
    transport = FakeAws(handler)

    lines = run_leak(transport, check_from_pipeline)

    assert deletes(transport) == [DELETE] * 2
    assert result_of(lines)["removed"] is True


def test_a_refused_delete_isnt_tried_again(check_from_pipeline: Check) -> None:
    transport = fake(delete=http_error("https://apigateway", 403, "AccessDeniedException"))

    lines = run_leak(transport, check_from_pipeline)

    assert deletes(transport) == [DELETE]
    assert result_of(lines)["removed"] is False


@pytest.mark.parametrize(
    "overrides",
    [
        {"stages": http_error("https://apigateway", 500)},  # an AWS failure
        {"status": http_error(GATEWAY, 404)},  # no answer
        {"echo": ValueError("boom")},  # a surprise
    ],
)
def test_a_failure_that_leaves_the_gateway_says_so(
    overrides: dict[str, Reply | Exception], check_from_pipeline: Check
) -> None:
    transport = fake_from({"delete": URLError("down"), **overrides})

    lines = run_leak(transport, check_from_pipeline)

    assert end_of(lines)["state"] == "failed"
    assert end_of(lines)["error"] == {"code": "aws_left_behind", "message": LEFT_BEHIND}


def test_a_stop_that_leaves_the_gateway_says_so(check_from_pipeline: Check) -> None:
    transport = stop_on("/status/204", fake(delete=URLError("down")))

    lines = run_leak(transport, check_from_pipeline)

    assert end_of(lines)["error"] == {"code": "aws_left_behind", "message": LEFT_BEHIND}


def test_an_earlier_test_gateway_is_deleted_first_and_only_it(check_from_pipeline: Check) -> None:
    pages = iter(
        [
            Reply(
                {
                    "items": [
                        {"apiId": "relay1", "name": "gratovo-yt-proxy"},
                        {"apiId": "old1", "name": "gratovo-leak-test"},
                        {"apiId": "near1", "name": "gratovo-leak-test-2"},
                        {"apiId": "BAD ID", "name": "gratovo-leak-test"},
                    ],
                    "nextToken": "tok/en=",
                }
            ),
            Reply({"items": [{"apiId": "old2", "name": "gratovo-leak-test"}]}),
        ]
    )

    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.get_method() == "GET" and _aws(request):
            return next(pages)
        return base.handler(request)

    base = fake()
    transport = FakeAws(handler)

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport)[:5] == [
        LIST,
        ("GET", "/v2/apis?maxResults=100&nextToken=tok%2Fen%3D"),
        ("DELETE", "/v2/apis/old1"),
        ("DELETE", "/v2/apis/old2"),
        ("POST", "/v2/apis"),
    ]
    assert deletes(transport) == [("DELETE", "/v2/apis/old1"), ("DELETE", "/v2/apis/old2"), DELETE]
    assert result_of(lines)["removed"] is True


def test_an_earlier_test_gateway_that_wont_go_stops_the_run(check_from_pipeline: Check) -> None:
    transport = fake(
        list=Reply({"items": [{"apiId": "old1", "name": "gratovo-leak-test"}]}),
        delete=http_error("https://apigateway", 500),
    )

    lines = run_leak(transport, check_from_pipeline)

    assert ("POST", "/v2/apis") not in control_calls(transport)
    assert end_of(lines)["error"] == {"code": "aws_left_behind", "message": LEFT_BEHIND}


@pytest.mark.parametrize(
    "answer", [Text("not an address"), URLError("offline"), Text(""), Text("::1")]
)
def test_no_own_address_means_no_gateway(
    answer: Reply | Exception, check_from_pipeline: Check
) -> None:
    transport = fake(checkip=answer)

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport) == [LIST]
    assert end_of(lines)["error"] == {
        "code": "network",
        "message": "This computer's public address couldn't be read.",
    }


def test_no_keys_means_no_request(check_from_pipeline: Check) -> None:
    transport = fake()

    lines = run_leak(transport, check_from_pipeline, keys=False)

    assert transport.requests == []
    assert end_of(lines)["error"]["code"] == "no_aws_keys"


@pytest.mark.parametrize("key", ["list", "apis"])
def test_refused_keys_end_with_aws(key: str, check_from_pipeline: Check) -> None:
    refused = http_error("https://apigateway", 403, "UnrecognizedClientException")
    transport = fake_from({key: refused})

    lines = run_leak(transport, check_from_pipeline)

    assert end_of(lines)["error"] == {
        "code": "aws",
        "message": "AWS refused the keys. Check them in Settings.",
    }


def test_checkip_needs_the_leak_jobs_own_rule(check_from_pipeline: Check) -> None:
    net.allow_job_hosts("gateways.deploy")
    transport = fake()

    lines = run_leak(transport, check_from_pipeline)

    assert control_calls(transport) == [LIST]
    assert end_of(lines)["error"]["code"] == "crash"


# --- IPv4 only, live ---


def test_the_live_leak_test_goes_over_ipv4(
    monkeypatch: pytest.MonkeyPatch, check_from_pipeline: Check
) -> None:
    used: list[str] = []

    def ipv4(request: urllib.request.Request, timeout: float) -> Reply:
        used.append(request.full_url)
        raise URLError("offline")

    monkeypatch.setattr(gateways, "_open_ipv4", ipv4)
    out = io.StringIO()
    gateways.run(start_with(job=LEAK, source="live", secrets__aws=AWS), Emitter(out))

    assert used  # every request of the run went through the IPv4 transport
    assert all(check_from_pipeline(line + "\n") for line in out.getvalue().splitlines())


@pytest.mark.usefixtures("loopback")
def test_the_ipv4_connection_asks_for_a_records_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Live, the leak test connects over IPv4 only, so the gateway sees the address checkip read."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    asked: list[int] = []
    real = socket.getaddrinfo

    def getaddrinfo(host: str, port: int, family: int = 0, *rest: Any) -> Any:
        asked.append(family)
        return real("127.0.0.1", port, family, *rest)

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    try:
        sock = gateways.connect_ipv4(("example.invalid", port), 2.0)
        sock.close()
    finally:
        server.close()

    assert asked == [socket.AF_INET]


def test_the_https_connection_uses_the_ipv4_connect(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[tuple[str, int]] = []

    def connect(address: tuple[str, int], *_rest: object) -> socket.socket:
        called.append(address)
        raise OSError("not here")

    monkeypatch.setattr(gateways, "connect_ipv4", connect)
    connection = gateways.IPv4HTTPSConnection("example.invalid")
    with pytest.raises(OSError, match="not here"):
        connection.connect()

    assert called == [("example.invalid", 443)]


# --- the 30 s after a Stop (after review) ---


def hangs_on(path_end: str, base: FakeAws, release: threading.Event) -> FakeAws:
    """`base`, but the request ending in `path_end` presses Stop and then hangs until
    `release` (a call on its way when the Stop comes)."""

    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.full_url.endswith(path_end):
            run_control.request_stop()
            release.wait(30)
            return URLError("released")
        return base.handler(request)

    return FakeAws(handler)


def test_a_call_on_its_way_at_a_stop_is_given_up_after_the_cap(
    monkeypatch: pytest.MonkeyPatch, check_from_pipeline: Check
) -> None:
    monkeypatch.setattr(gateways, "LEAK_STOP_CALL_TIMEOUT", 0.3)
    release = threading.Event()
    transport = hangs_on("/status/204", fake(), release)
    try:
        started = time.monotonic()
        lines = run_leak(transport, check_from_pipeline)
        assert time.monotonic() - started < 10  # not the call's own 15 s
    finally:
        release.set()
    assert control_calls(transport)[-1] == DELETE  # the delete still went out
    assert end_of(lines)["state"] == "stopped"


def test_a_call_after_a_stop_gets_the_short_timeout(check_from_pipeline: Check) -> None:
    timeouts: list[tuple[str, float]] = []
    base = stop_on("/status/204", fake(status=http_error(GATEWAY, 404)))

    def opener(request: urllib.request.Request, timeout: float) -> Reply:
        timeouts.append((request.get_method(), timeout))
        return base(request, timeout)

    out = io.StringIO()
    gateways.run(
        start_with(job=LEAK, source="live", secrets__aws=AWS), Emitter(out), open_url=opener
    )
    assert timeouts[-1] == ("DELETE", gateways.LEAK_STOP_CALL_TIMEOUT)


def test_the_delete_after_a_stop_fits_what_is_left_of_the_grace(
    monkeypatch: pytest.MonkeyPatch, check_from_pipeline: Check
) -> None:
    monkeypatch.setattr(gateways, "LEAK_STOP_GRACE", 0.0)  # nothing left of it
    transport = stop_on("/status/204", fake(status=http_error(GATEWAY, 404)))

    lines = run_leak(transport, check_from_pipeline)

    assert deletes(transport) == []
    assert end_of(lines)["error"] == {"code": "aws_left_behind", "message": LEFT_BEHIND}
