"""The gateway jobs: gateways.deploy, gateways.destroy, gateways.test and gateways.leak (plan D19,
step S5 P0).

Ported from the old `aws_gateway_setup.py`. The gateways stand in for a proxy list: each is an AWS
API Gateway endpoint whose outbound connection to YouTube starts from AWS's IP range in its
region. Rotating across regions spreads the requests.

WHAT A DEPLOY BUILDS
One HTTP API (API Gateway v2, not the older REST API type) per region, with a single
`ANY /{proxy+}` route behind an HTTP_PROXY integration whose backend is
`https://www.youtube.com/{proxy}`. API Gateway forwards whatever path, query and body it gets to
the same path on youtube.com and hands the answer back, so to the scraper the invoke URL just is
youtube.com. The `$default` stage has no stage segment in its URL:
`https://{apiId}.execute-api.{region}.amazonaws.com/{path}`.

Why an HTTP API: it bills at about $1.00 per million calls against about $3.50 for a REST API, and
a plain pass-through needs nothing a REST API adds (usage plans, validators, service
integrations). Both are free up to 1M calls a month for an account's first 12 months; a handful of
regions at scraper-sized traffic stays inside that, but nothing here enforces it.

Why an explicit `{proxy+}` route: the `$default` catch-all route would also work, but a named
greedy route is what the integration's `{proxy}` placeholder fills from, and it keeps the intent
visible in the console.

The trade-off, on purpose: the route needs no authorization and no API key. Anyone who got hold of
an invoke URL could use it as a free relay, but only to youtube.com, because the backend is fixed.
That is judged fine for a low-traffic team tool (an API-key usage plan means signing or an extra
header on every call). So the URLs are secrets: only the deploy's `result` carries them, to main
alone, and no log line, error or test message does. `gateways.destroy` is there if it stops being
true.

The AWS calls are signed by `aws_sign.py` (SigV4, service `apigateway`) and sent over `urllib`
(no boto3, ADR 0013 §7). One region failing doesn't stop the others. A failure's message is the
step, the HTTP status and AWS's error type word; never a body, a key or a signature.

THE LEAK TEST (step S5, P0)
Does a gateway hand YouTube this computer's own address? HTTP APIs add a `Forwarded: for=<client>`
header, and REST APIs have been seen to add `X-Forwarded-For`. `gateways.leak` finds out for real:
it reads this computer's public IPv4 from `checkip.amazonaws.com` (allowed for this job only),
first deletes any API named exactly `gratovo-leak-test` an earlier run left in the region, then
deploys one throwaway HTTP API of that name whose backend is `https://httpbin.org/{proxy}` instead
of YouTube, waits for `/status/204` to answer, asks `/anything?show_env=1` once (httpbin echoes
the headers it received, the caller it saw and the query as JSON; `show_env` keeps the forwarding
headers it hides by default, `X-Forwarded-For` among them), reads checkip again and reports the
NAMES of the headers whose value holds this computer's address. The outcome is `leak`, `clean`
only when the echo proves itself (`args.show_env == "1"`, a `headers` object, an `origin`) and the
address didn't change during the test, else `unclear`. Live, the checkip and gateway requests go
over IPv4 only, so the address the gateway sees is the one checkip read. The address itself and
every header value are personal data: no result, log line or error carries them. The API is
deleted in `finally`, on an error or a Stop too (a Stop is checked before every step), with
retries; the whole test is bounded by LEAK_BUDGET and the delete by LEAK_REMOVE_BUDGET.

How a job ends:
- deploy, destroy and leak need the AWS keys (`secrets.aws`); none: `no_aws_keys`;
- `done` even when some regions failed, with the failures in the result;
- leak: `aws` when AWS refused a call, `network` when the address couldn't be read or the test
  gateway didn't answer, `stopped` on a Stop, and `aws_left_behind` (over any other reason) when
  a test gateway is still in the account; a done result says whether its gateway was removed;
- anything unexpected: `crash`, naming only the error's kind.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import re
import socket
import ssl
import sys
import threading
import time
import urllib.request
from typing import Any, Final, NamedTuple, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote

from gratovo_pipeline import net, run_control
from gratovo_pipeline.aws_sign import Credentials, SigningError, sign
from gratovo_pipeline.protocol import (
    DeployedGateway,
    Emitter,
    EndErrorCode,
    GatewayFailure,
    GatewayRef,
    GatewaysDeployJob,
    GatewaysDestroyJob,
    GatewaysLeakJob,
    GatewayTest,
    LeakOutcome,
    RegionFailure,
    Start,
)
from gratovo_pipeline.youtube import Body, Opener

API_NAME: Final = "gratovo-yt-proxy"
BACKEND: Final = "https://www.youtube.com/{proxy}"
STAGE_NAME: Final = "$default"
SERVICE: Final = "apigateway"
CALL_TIMEOUT: Final = 30.0
TEST_TIMEOUT: Final = 15.0
MAX_BODY: Final = 1024 * 1024

# The leak test (step S5, P0).
LEAK_API_NAME: Final = "gratovo-leak-test"
LEAK_BACKEND: Final = "https://httpbin.org/{proxy}"
LEAK_REGION: Final = "us-east-1"
CHECKIP_URL: Final = "https://checkip.amazonaws.com"
LEAK_BUDGET: Final = 90.0  # seconds, from the first request to the last (the delete is extra)
LEAK_CALL_TIMEOUT: Final = 15.0
LEAK_POLLS: Final = 10  # `/status/204` tries while the new API comes up
LEAK_POLL_PAUSE: Final = 3.0
LEAK_MAX_HEADERS: Final = 20
LEAK_LIST_PAGES: Final = 10  # `GET /v2/apis` pages read looking for an earlier run's test API
# Deleting the test API: up to four tries with these pauses between, all inside the budget, which
# fits the app's 30 s grace after a Stop or a quit.
LEAK_DELETE_TIMEOUT: Final = 8.0
LEAK_DELETE_PAUSES: Final = (2.0, 5.0, 10.0)
LEAK_REMOVE_BUDGET: Final = 25.0
# Once a Stop is seen: a call already on its way gets at most this long from then (a new one
# from its start), and every delete must end inside the app's 30 s grace from the Stop, less a
# moment for the `end` line.
LEAK_STOP_CALL_TIMEOUT: Final = 5.0
LEAK_STOP_GRACE: Final = 28.0
_NO_ANSWER: Final = "The test gateway or httpbin.org didn't answer in time."
# The headers a relay adds about the caller; `X-Amzn-*` too. Their names go in the result.
_FORWARDING_HEADERS: Final = frozenset({"forwarded", "x-forwarded-for", "x-real-ip", "via"})
_HEADER_NAME: Final = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64}")  # an RFC 9110 token

# What AWS answers (403) when the keys themselves are the problem.
AUTH_ERRORS: Final = frozenset(
    {"UnrecognizedClientException", "InvalidSignatureException", "AccessDeniedException"}
)
_API_ID: Final = re.compile(r"[a-z0-9]{1,32}")  # the protocol's apiId
_ERROR_TYPE: Final = re.compile(r"[A-Za-z][A-Za-z0-9]{0,59}")
_GATEWAY_REGION: Final = re.compile(
    r"[a-z0-9]+\.execute-api\.(?P<region>[a-z]{2}(?:-[a-z]+)+-[0-9])\.amazonaws\.com"
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """AWS's control plane doesn't redirect, and a signed request must not follow one."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_OPENER: Final = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _open(request: urllib.request.Request, timeout: float) -> Body:
    return cast("Body", _OPENER.open(request, timeout=timeout))


def connect_ipv4(
    address: tuple[str, int], timeout: object, source_address: tuple[str, int] | None = None
) -> socket.socket:
    """`socket.create_connection` over IPv4 only: the host's A records, never its AAAA."""
    host, port = address
    error: OSError | None = None
    for family, kind, proto, _, target in socket.getaddrinfo(
        host, port, socket.AF_INET, socket.SOCK_STREAM
    ):
        sock = socket.socket(family, kind, proto)
        try:
            if isinstance(timeout, int | float):
                sock.settimeout(timeout)
            if source_address is not None:
                sock.bind(source_address)
            sock.connect(target)
        except OSError as failure:
            sock.close()
            error = failure
            continue
        return sock
    raise error or OSError("no IPv4 address")


class IPv4HTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = connect_ipv4


class _IPv4HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(IPv4HTTPSConnection, req, context=ssl.create_default_context())


# The leak test's transport: checkip and the gateway must see the same (IPv4) address.
_OPENER_IPV4: Final = urllib.request.build_opener(
    urllib.request.ProxyHandler({}), _NoRedirect(), _IPv4HTTPSHandler()
)


def _open_ipv4(request: urllib.request.Request, timeout: float) -> Body:
    return cast("Body", _OPENER_IPV4.open(request, timeout=timeout))


class AwsCallError(Exception):
    """An AWS call that failed. `str()` is safe to show: the step, the status, AWS's error type."""

    def __init__(self, message: str, *, auth: bool = False, retryable: bool = False) -> None:
        super().__init__(message)
        self.auth = auth
        self.retryable = retryable  # AWS was busy (429), failing (5xx) or out of reach


def _fail(emitter: Emitter, code: EndErrorCode, message: str) -> None:
    emitter.end(state="failed", at=0, found=0, kept=0, error=(code, message))


def run(start: Start, emitter: Emitter, *, open_url: Opener | None = None) -> None:
    """Runs the job and always ends with an `end` line. `open_url` replaces the live transport
    (tests): it takes a request and a timeout and returns a readable body, or raises
    `HTTPError`/`URLError` as urllib does."""
    job = start["job"]
    opener = open_url or (_open_ipv4 if job["kind"] == "gateways.leak" else _open)
    try:
        if job["kind"] == "gateways.test":
            _test(start, emitter, opener)
        elif job["kind"] == "gateways.deploy":
            if creds := _credentials(start, emitter):
                _deploy(job, creds, emitter, opener)
        elif job["kind"] == "gateways.destroy":
            if creds := _credentials(start, emitter):
                _destroy(job, creds, emitter, opener)
        elif job["kind"] == "gateways.leak":
            if creds := _credentials(start, emitter):
                _leak(job, creds, emitter, opener)
        else:
            _fail(emitter, "crash", "This is not a gateways job.")
    except Exception as error:  # every way out ends with `end`
        # The kind only: the text of an error can carry a URL or a header.
        print(f"gateways crashed: {type(error).__name__}", file=sys.stderr, flush=True)
        _fail(
            emitter,
            "crash",
            f"The gateway job stopped on an unexpected error ({type(error).__name__}).",
        )


def _credentials(start: Start, emitter: Emitter) -> Credentials | None:
    """The AWS keys, or None after ending the job as `no_aws_keys`."""
    keys = start["secrets"].get("aws")
    if keys is None:
        _fail(emitter, "no_aws_keys", "There are no AWS keys yet. Add them in Settings.")
        return None
    try:
        return Credentials(keys["accessKeyId"], keys["secretAccessKey"])
    except SigningError:
        _fail(emitter, "no_aws_keys", "The AWS keys are incomplete. Add them again.")
        return None


# --- deploy ---


def _deploy(job: GatewaysDeployJob, creds: Credentials, emitter: Emitter, opener: Opener) -> None:
    deployed: list[DeployedGateway] = []
    failed: list[RegionFailure] = []
    auth_failures = 0
    for region in job["regions"]:
        created: list[str] = []  # the API's id, once it exists
        try:
            api_id, url = _deploy_region(region, creds, opener, created)
        except AwsCallError as error:
            failed.append({"region": region, "message": str(error)})
            auth_failures += error.auth
            emitter.log("warn", f"Gateway in {region} failed: {error}")
            if created:
                _undo(region, created[0], creds, opener, emitter)
            continue
        deployed.append({"region": region, "apiId": api_id, "url": url})
        emitter.log("info", f"Gateway in {region} is ready.")
    # `aws` (the keys were refused) only when that is why every region failed: with one region
    # working, or failing for another reason, the keys are good and the result tells the rest.
    # A failed job sends no result, and here there is nothing deployed to report.
    if not deployed and failed and auth_failures == len(failed):
        _end_auth(emitter)
        return
    emitter.result("gateways.deploy", {"deployed": deployed, "failed": failed})
    emitter.end(state="done", at=0, found=0, kept=0)


def _end_auth(emitter: Emitter) -> None:
    _fail(emitter, "aws", "AWS refused the keys. Check them in Settings.")


def _deploy_region(
    region: str,
    creds: Credentials,
    opener: Opener,
    created: list[str],
    *,
    name: str = API_NAME,
    backend: str = BACKEND,
    deadline: float | None = None,
    stoppable: bool = False,
) -> tuple[str, str]:
    """(apiId, url) for the gateway built in one region. `created` gets the API's id the moment
    it exists, so the caller can remove a half-built one. With a `deadline` (a `time.monotonic()`
    value) no call waits past it; with `stoppable`, a stop is checked before every call."""

    def call(path: str, payload: dict[str, object], step: str) -> dict[str, Any]:
        if stoppable:
            run_control.check_stop()
        timeout = CALL_TIMEOUT if deadline is None else _left(deadline, CALL_TIMEOUT)
        if timeout <= 0:
            raise AwsCallError(f"{step}: out of time")
        return _aws(opener, creds, region, "POST", path, payload, step, timeout=timeout)

    api = call("/v2/apis", {"name": name, "protocolType": "HTTP"}, "create the API")
    api_id = _identifier(api, "apiId")
    created.append(api_id)
    base = f"/v2/apis/{api_id}"
    integration = call(
        f"{base}/integrations",
        {
            "integrationType": "HTTP_PROXY",
            "integrationMethod": "ANY",
            "integrationUri": backend,
            "payloadFormatVersion": "1.0",
        },
        "add the integration",
    )
    integration_id = _identifier(integration, "integrationId")
    call(
        f"{base}/routes",
        {"routeKey": "ANY /{proxy+}", "target": f"integrations/{integration_id}"},
        "add the route",
    )
    call(f"{base}/stages", {"stageName": STAGE_NAME, "autoDeploy": True}, "add the stage")
    return api_id, f"https://{api_id}.execute-api.{region}.amazonaws.com"


def _left(deadline: float, cap: float) -> float:
    """Seconds until `deadline`, at most `cap`."""
    return min(cap, deadline - time.monotonic())


def _undo(region: str, api_id: str, creds: Credentials, opener: Opener, emitter: Emitter) -> None:
    """Best effort: a half-built gateway is removed so nothing is left in the account."""
    try:
        _aws(opener, creds, region, "DELETE", f"/v2/apis/{api_id}", None, "remove the API")
    except Exception:
        emitter.log("warn", f"The half-built gateway in {region} couldn't be removed.")


# --- destroy ---


def _destroy(job: GatewaysDestroyJob, creds: Credentials, emitter: Emitter, opener: Opener) -> None:
    deleted: list[GatewayRef] = []
    failed: list[GatewayFailure] = []
    for gateway in job["gateways"]:
        region, api_id = gateway["region"], gateway["apiId"]
        try:
            _aws(
                opener,
                creds,
                region,
                "DELETE",
                f"/v2/apis/{api_id}",
                None,
                "delete the API",
                missing_ok=True,
            )
        except AwsCallError as error:
            failed.append({"region": region, "apiId": api_id, "message": str(error)})
            emitter.log("warn", f"Gateway in {region} wasn't deleted: {error}")
            continue
        deleted.append({"region": region, "apiId": api_id})
    emitter.result("gateways.destroy", {"deleted": deleted, "failed": failed})
    emitter.end(state="done", at=0, found=0, kept=0)


# --- test ---


def _test(start: Start, emitter: Emitter, opener: Opener) -> None:
    results = [_probe(url, opener) for url in start["secrets"]["gatewayUrls"]]
    emitter.result("gateways.test", {"results": results})
    emitter.end(state="done", at=0, found=0, kept=0)


def _probe(url: str, opener: Opener) -> GatewayTest:
    """One gateway: `GET <url>/generate_204`, unsigned. Up when the status is below 500 (a 4xx
    still means the gateway answered). The message names the kind of failure, never the URL."""
    probe_url = f"{url.rstrip('/')}/generate_204"
    region = _region_of(url)

    def down(status: int | None, message: str) -> GatewayTest:
        return {"region": region, "status": status, "ok": False, "message": message}

    try:
        net.check_url(probe_url)
    except ValueError:
        return down(None, "Not a gateway address.")
    request = urllib.request.Request(probe_url, headers={"Accept": "*/*"})  # noqa: S310 - check_url allowed it
    try:
        body = opener(request, TEST_TIMEOUT)
    except HTTPError as error:
        status = error.code
        if status < 500:
            return {"region": region, "status": status, "ok": True, "message": None}
        return down(status, f"The gateway answered with HTTP {status}.")
    except TimeoutError:
        return down(None, "The gateway timed out.")
    except URLError, ConnectionError, OSError:
        return down(None, "Couldn't reach the gateway.")
    try:
        status = _status(body)
    finally:
        body.close()
    if status < 500:
        return {"region": region, "status": status, "ok": True, "message": None}
    return down(status, f"The gateway answered with HTTP {status}.")


def _status(body: Body) -> int:
    code: object = getattr(body, "status", None) or getattr(body, "code", None)
    return code if isinstance(code, int) else 200


def _region_of(url: str) -> str | None:
    host = url.split("://", 1)[-1].split("/", 1)[0].split("@")[-1].split(":", 1)[0].lower()
    found = _GATEWAY_REGION.fullmatch(host)
    return found.group("region") if found else None


# --- leak test ---


class _LeakError(Exception):
    """The leak test couldn't finish. `str()` is safe to show (no address, no header value)."""

    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code


class _TestGateway:
    """The test API this run built, and whether it is gone again."""

    def __init__(self) -> None:
        self.created: list[str] = []  # the API's id, once it exists
        self.removed = False

    @property
    def left_behind(self) -> bool:
        return bool(self.created) and not self.removed


class _Echo(NamedTuple):
    """What httpbin's `/anything?show_env=1` echoed: the headers it received, the caller it saw,
    and whether the answer proves it was httpbin with `show_env` honoured."""

    headers: dict[str, str]
    origin: str | None
    proven: bool


class _Finding(NamedTuple):
    outcome: LeakOutcome
    headers: list[str]
    forwarding: list[str]


class _StopWatch:
    """When this job first saw a Stop, and the limits that follow from it (see
    LEAK_STOP_CALL_TIMEOUT and LEAK_STOP_GRACE)."""

    def __init__(self) -> None:
        self.seen_at: float | None = None

    def seen(self) -> float | None:
        if self.seen_at is None and run_control.stop_requested():
            self.seen_at = time.monotonic()
        return self.seen_at

    def remove_end(self) -> float:
        """The latest moment a delete may run to."""
        end = time.monotonic() + LEAK_REMOVE_BUDGET
        seen = self.seen()
        return end if seen is None else min(end, seen + LEAK_STOP_GRACE)

    def wrap(self, opener: Opener) -> Opener:
        """`opener`, run on a daemon thread and waited for until it answers or, once a Stop is
        seen, LEAK_STOP_CALL_TIMEOUT has passed (from the Stop, or from the call's start if that
        is later). A call given up on raises TimeoutError, which every caller takes as no
        answer."""

        def capped(request: urllib.request.Request, timeout: float) -> Body:
            started = time.monotonic()
            seen = self.seen()
            if seen is not None:
                timeout = min(timeout, LEAK_STOP_CALL_TIMEOUT)
            box: dict[str, Body | BaseException] = {}

            def call() -> None:
                try:
                    box["body"] = opener(request, timeout)
                except BaseException as error:  # handed to the waiting thread
                    box["error"] = error

            worker = threading.Thread(target=call, name="leak-call", daemon=True)
            worker.start()
            while True:
                worker.join(0.1)
                if not worker.is_alive():
                    break
                seen = self.seen()
                if seen is not None and time.monotonic() >= (
                    max(seen, started) + LEAK_STOP_CALL_TIMEOUT
                ):
                    raise TimeoutError("given up after a stop")
            error = box.get("error")
            if isinstance(error, BaseException):
                raise error
            return cast("Body", box["body"])

        return capped


def _left_behind_message(region: str) -> str:
    return (
        f"A test gateway named {LEAK_API_NAME} is still in {region}. "
        "Delete it in the AWS console (API Gateway \u203a APIs)."
    )


def _leak(job: GatewaysLeakJob, creds: Credentials, emitter: Emitter, opener: Opener) -> None:
    region = job.get("region", LEAK_REGION)
    gateway = _TestGateway()
    watch = _StopWatch()
    opener = watch.wrap(opener)
    try:
        _clear_leftovers(region, creds, opener, emitter, watch)
        finding = _leak_test(region, creds, emitter, opener, gateway, watch)
    except KeyboardInterrupt:  # RunAborted too: a stop. The test gateway was deleted on the way.
        if gateway.left_behind:
            _fail(emitter, "aws_left_behind", _left_behind_message(region))
        else:
            emitter.end(state="stopped", at=0, found=0, kept=0)
        return
    except AwsCallError as error:
        if gateway.left_behind:
            _fail(emitter, "aws_left_behind", _left_behind_message(region))
        elif error.auth:
            _end_auth(emitter)
        else:
            _fail(emitter, "aws", f"The test gateway couldn't be built ({error}).")
        return
    except _LeakError as error:
        if gateway.left_behind:
            _fail(emitter, "aws_left_behind", _left_behind_message(region))
        else:
            _fail(emitter, error.code, str(error))
        return
    except Exception as error:
        if not gateway.left_behind:
            raise  # `run` ends it as a crash
        print(f"gateways crashed: {type(error).__name__}", file=sys.stderr, flush=True)
        _fail(emitter, "aws_left_behind", _left_behind_message(region))
        return
    emitter.result(
        "gateways.leak",
        {
            "outcome": finding.outcome,
            "headers": finding.headers,
            "forwardingHeaders": finding.forwarding,
            "region": region,
            "removed": gateway.removed,
        },
    )
    emitter.end(state="done", at=0, found=0, kept=0)


def _clear_leftovers(
    region: str, creds: Credentials, opener: Opener, emitter: Emitter, watch: _StopWatch
) -> None:
    """Deletes an earlier run's test API that is still there (the app was killed mid-test, say).
    Only an API named exactly LEAK_API_NAME is touched, never the owner's relays. No tags: the
    documented IAM policy covers `/apis*` only. One that can't be deleted ends the run before a
    new one is built."""
    leftovers: list[str] = []
    token: str | None = None
    for _ in range(LEAK_LIST_PAGES):
        run_control.check_stop()
        path = "/v2/apis?maxResults=100"
        if token:
            path += f"&nextToken={quote(token, safe='')}"
        answer = _aws(
            opener, creds, region, "GET", path, None, "list the APIs", timeout=LEAK_CALL_TIMEOUT
        )
        items: object = answer.get("items")
        for item in cast("list[object]", items) if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            api = cast("dict[str, object]", item)
            api_id = api.get("apiId")
            if (
                api.get("name") == LEAK_API_NAME
                and isinstance(api_id, str)
                and _API_ID.fullmatch(api_id)
            ):
                leftovers.append(api_id)
        next_token: object = answer.get("nextToken")
        if not isinstance(next_token, str) or not next_token:
            break
        token = next_token
    for api_id in leftovers:
        emitter.log("info", f"An earlier test gateway in {region} is still there. Deleting it.")
        if not _remove_test_gateway(region, api_id, creds, opener, emitter, watch):
            raise _LeakError("aws_left_behind", _left_behind_message(region))


def _leak_test(
    region: str,
    creds: Credentials,
    emitter: Emitter,
    opener: Opener,
    gateway: _TestGateway,
    watch: _StopWatch,
) -> _Finding:
    """What a fresh gateway passed on of this computer's address. The gateway is deleted before
    this returns or raises; `gateway` says whether that worked. A stop is checked before every
    step, and once the gateway exists a stop skips straight to the delete."""
    deadline = time.monotonic() + LEAK_BUDGET
    before = _public_ipv4(opener, deadline)
    if before is None:
        raise _LeakError("network", "This computer's public address couldn't be read.")
    run_control.check_stop()
    try:
        _, url = _deploy_region(
            region,
            creds,
            opener,
            gateway.created,
            name=LEAK_API_NAME,
            backend=LEAK_BACKEND,
            deadline=deadline,
            stoppable=True,
        )
        emitter.log("info", f"Test gateway in {region} built. Waiting for it to answer.")
        _wait_until_answering(url, opener, deadline)
        run_control.check_stop()
        echo = _echo(url, opener, deadline)
        run_control.check_stop()
        after = _public_ipv4(opener, deadline)
    finally:
        if gateway.created:
            gateway.removed = _remove_test_gateway(
                region, gateway.created[0], creds, opener, emitter, watch
            )
    return _judge(before, after, echo)


def _judge(
    before: ipaddress.IPv4Address, after: ipaddress.IPv4Address | None, echo: _Echo
) -> _Finding:
    """Leak when this computer's address (as read before or after) shows in any echoed header or
    in the caller httpbin saw. Clean only when the echo is proven and the address held steady
    through the test; anything else can't tell."""
    patterns = [_whole(before)]
    if after is not None and after != before:
        patterns.append(_whole(after))

    def holds(value: str) -> bool:
        return any(pattern.search(value) for pattern in patterns)

    forwarding = sorted(name for name in echo.headers if _is_forwarding(name))[:LEAK_MAX_HEADERS]
    # From the full set: a name that can't be shown still makes it a leak.
    matched = {name for name, value in echo.headers.items() if holds(value)}
    if matched or (echo.origin is not None and holds(echo.origin)):
        shown = sorted(name for name in matched if _HEADER_NAME.fullmatch(name))
        return _Finding("leak", shown[:LEAK_MAX_HEADERS], forwarding)
    if not echo.proven or after != before:
        return _Finding("unclear", [], forwarding)
    return _Finding("clean", [], forwarding)


def _is_forwarding(name: str) -> bool:
    lower = name.lower()
    return bool(_HEADER_NAME.fullmatch(name)) and (
        lower in _FORWARDING_HEADERS or lower.startswith("x-amzn-")
    )


def _whole(address: ipaddress.IPv4Address) -> re.Pattern[str]:
    """Finds the address whole: 203.0.113.7 isn't found inside 1.203.0.113.7 or 203.0.113.70."""
    return re.compile(rf"(?<![0-9.]){re.escape(str(address))}(?![0-9]|\.[0-9])")


def _public_ipv4(opener: Opener, deadline: float) -> ipaddress.IPv4Address | None:
    """This computer's public IPv4 as checkip.amazonaws.com sees it, or None. It goes nowhere
    else: not into a log, an error or the result."""
    status, raw = _fetch(CHECKIP_URL, opener, deadline)
    if status != 200:
        return None
    try:
        return ipaddress.IPv4Address(raw.decode("ascii").strip())
    except ValueError:  # an AddressValueError's text holds the input: it isn't kept
        return None


def _wait_until_answering(url: str, opener: Opener, deadline: float) -> None:
    """A new API takes a few seconds to answer: `/status/204` is tried until it does."""
    for attempt in range(LEAK_POLLS):
        if attempt:
            run_control.sleep(max(0.0, _left(deadline, LEAK_POLL_PAUSE)))
        run_control.check_stop()
        status, _ = _fetch(f"{url}/status/204", opener, deadline)
        if status == 204:
            return
        if time.monotonic() >= deadline:
            break
    raise _LeakError("network", _NO_ANSWER)


def _echo(url: str, opener: Opener, deadline: float) -> _Echo:
    """What httpbin received through the gateway. No answer at all is a failure; an answer that
    isn't httpbin's JSON (or ignores `show_env`) is an unproven echo."""
    status, raw = _fetch(f"{url}/anything?show_env=1", opener, deadline)
    if status is None:
        raise _LeakError("network", _NO_ANSWER)
    unproven = _Echo({}, None, proven=False)
    if status != 200:
        return unproven
    try:
        answer: object = json.loads(raw)
    except ValueError:
        return unproven
    if not isinstance(answer, dict):
        return unproven
    data = cast("dict[str, object]", answer)
    headers, args, origin = data.get("headers"), data.get("args"), data.get("origin")
    if not isinstance(headers, dict):
        return unproven
    echoed = {
        str(name): value
        for name, value in cast("dict[object, object]", headers).items()
        if isinstance(value, str)
    }
    shown_env = isinstance(args, dict) and cast("dict[str, object]", args).get("show_env") == "1"
    origin_text = origin if isinstance(origin, str) else None
    return _Echo(echoed, origin_text, proven=shown_env and origin_text is not None)


def _fetch(url: str, opener: Opener, deadline: float) -> tuple[int | None, bytes]:
    """(status, body) of one unsigned GET, within the deadline. An HTTP error is its status with
    no body; no answer at all (or no time left) is None."""
    timeout = _left(deadline, LEAK_CALL_TIMEOUT)
    if timeout <= 0:
        return None, b""
    net.check_url(url)
    request = urllib.request.Request(url, headers={"Accept": "*/*"})  # noqa: S310 - check_url allowed it
    try:
        body = opener(request, timeout)
    except HTTPError as error:
        error.close()
        return error.code, b""
    except URLError, TimeoutError, ConnectionError, OSError:
        return None, b""
    try:
        return _status(body), body.read(64 * 1024)
    except TimeoutError, ConnectionError, OSError:
        return None, b""
    finally:
        body.close()


def _remove_test_gateway(
    region: str,
    api_id: str,
    creds: Credentials,
    opener: Opener,
    emitter: Emitter,
    watch: _StopWatch,
) -> bool:
    """Deletes one test API; True once it is gone. Up to four tries, pausing 2, 5 and 10 s, while
    AWS is busy (429), failing (5xx) or out of reach, all inside LEAK_REMOVE_BUDGET, and after a
    Stop inside what is left of LEAK_STOP_GRACE from it, so it fits the app's 30 s grace after a
    Stop or a quit. A stop doesn't cut it short otherwise."""
    end = watch.remove_end()
    for attempt in range(len(LEAK_DELETE_PAUSES) + 1):
        if attempt:
            pause = LEAK_DELETE_PAUSES[attempt - 1]
            if time.monotonic() + pause + 1.0 > end:
                break
            time.sleep(pause)
        timeout = _left(end, LEAK_DELETE_TIMEOUT)
        if timeout <= 0:
            break
        try:
            _aws(
                opener,
                creds,
                region,
                "DELETE",
                f"/v2/apis/{api_id}",
                None,
                "remove the test gateway",
                missing_ok=True,
                timeout=timeout,
            )
        except AwsCallError as error:
            if error.retryable:
                continue
            break
        emitter.log("info", f"Test gateway in {region} removed.")
        return True
    emitter.log("warn", _left_behind_message(region))
    return False


# --- one signed AWS call ---


def _aws(
    opener: Opener,
    creds: Credentials,
    region: str,
    method: str,
    path: str,
    payload: dict[str, object] | None,
    step: str,
    *,
    missing_ok: bool = False,
    timeout: float = CALL_TIMEOUT,
) -> dict[str, Any]:
    """The JSON answer of one API Gateway call, signed for the region. Raises AwsCallError with a
    safe message. With `missing_ok`, a 404 counts as success (the thing is already gone)."""
    url = f"https://apigateway.{region}.amazonaws.com{path}"
    try:
        net.check_url(url)
    except ValueError:
        raise AwsCallError(f"{step}: that address isn't allowed") from None
    data = json.dumps(payload).encode() if payload is not None else b""
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        signed = sign(
            method=method,
            url=url,
            headers=headers,
            body=data,
            region=region,
            service=SERVICE,
            credentials=creds,
        )
    except SigningError:
        raise AwsCallError(f"{step}: the request couldn't be signed") from None
    request = urllib.request.Request(
        url, data=data if payload is not None else None, headers=signed, method=method
    )
    try:
        body = opener(request, timeout)
    except HTTPError as error:
        if error.code == 404 and missing_ok:
            return {}
        kind = _error_type(error)
        named = f" ({kind})" if kind else ""
        raise AwsCallError(
            f"{step}: HTTP {error.code}{named}",
            auth=error.code == 403 and kind in AUTH_ERRORS,
            retryable=error.code == 429 or error.code >= 500,
        ) from None
    except URLError, TimeoutError, ConnectionError, OSError:
        raise AwsCallError(f"{step}: couldn't reach AWS", retryable=True) from None
    try:
        raw = body.read(MAX_BODY)
    except TimeoutError, ConnectionError, OSError:
        raise AwsCallError(f"{step}: couldn't reach AWS", retryable=True) from None
    finally:
        body.close()
    if not raw:
        return {}
    try:
        answer: object = json.loads(raw)
    except ValueError:
        raise AwsCallError(f"{step}: AWS's answer wasn't JSON") from None
    return cast("dict[str, Any]", answer) if isinstance(answer, dict) else {}


def _error_type(error: HTTPError) -> str | None:
    """AWS's error type word (`x-amzn-ErrorType`, or `__type` in the body); nothing else of the
    answer is kept."""
    header = error.headers.get("x-amzn-ErrorType") if error.headers else None
    candidates: list[object] = [header.split(":")[0] if header else None]
    try:
        parsed: object = json.loads(error.read(64 * 1024) or b"null")
    except ValueError, OSError:
        parsed = None
    if isinstance(parsed, dict):
        data = cast("dict[str, object]", parsed)
        candidates += [data.get("__type"), data.get("code")]
    for candidate in candidates:
        if isinstance(candidate, str):
            word = candidate.rsplit("#", 1)[-1]
            if _ERROR_TYPE.fullmatch(word):
                return word
    return None


def _identifier(answer: dict[str, Any], field: str) -> str:
    value = answer.get(field)
    if isinstance(value, str) and _API_ID.fullmatch(value):
        return value
    raise AwsCallError("AWS's answer had no usable id")
