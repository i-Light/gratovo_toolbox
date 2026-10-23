"""The gateway jobs: gateways.deploy, gateways.destroy and gateways.test (plan D19).

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

How a job ends:
- deploy and destroy need the AWS keys (`secrets.aws`); none: `no_aws_keys`;
- `done` even when some regions failed, with the failures in the result;
- anything unexpected: `crash`, naming only the error's kind.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from typing import Any, Final, cast
from urllib.error import HTTPError, URLError

from gratovo_pipeline import net
from gratovo_pipeline.aws_sign import Credentials, SigningError, sign
from gratovo_pipeline.protocol import (
    DeployedGateway,
    Emitter,
    EndErrorCode,
    GatewayFailure,
    GatewayRef,
    GatewaysDeployJob,
    GatewaysDestroyJob,
    GatewayTest,
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

# What AWS answers (403) when the keys themselves are the problem.
AUTH_ERRORS: Final = frozenset(
    {"UnrecognizedClientException", "InvalidSignatureException", "AccessDeniedException"}
)
_API_ID: Final = re.compile(r"[A-Za-z0-9]{1,32}")
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


class AwsCallError(Exception):
    """An AWS call that failed. `str()` is safe to show: the step, the status, AWS's error type."""

    def __init__(self, message: str, *, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth


def _fail(emitter: Emitter, code: EndErrorCode, message: str) -> None:
    emitter.end(state="failed", at=0, found=0, kept=0, error=(code, message))


def run(start: Start, emitter: Emitter, *, open_url: Opener | None = None) -> None:
    """Runs the job and always ends with an `end` line. `open_url` replaces the live transport
    (tests): it takes a request and a timeout and returns a readable body, or raises
    `HTTPError`/`URLError` as urllib does."""
    opener = open_url or _open
    job = start["job"]
    try:
        if job["kind"] == "gateways.test":
            _test(start, emitter, opener)
        elif job["kind"] == "gateways.deploy" or job["kind"] == "gateways.destroy":
            creds = _credentials(start, emitter)
            if creds is None:
                return
            if job["kind"] == "gateways.deploy":
                _deploy(job, creds, emitter, opener)
            else:
                _destroy(job, creds, emitter, opener)
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
    emitter.result("gateways.deploy", {"deployed": deployed, "failed": failed})
    # `aws` (the keys were refused) only when that is why every region failed: with one region
    # working, or failing for another reason, the keys are good and the result tells the rest.
    if not deployed and failed and auth_failures == len(failed):
        _end_auth(emitter)
        return
    emitter.end(state="done", at=0, found=0, kept=0)


def _end_auth(emitter: Emitter) -> None:
    _fail(emitter, "aws", "AWS refused the keys. Check them in Settings.")


def _deploy_region(
    region: str, creds: Credentials, opener: Opener, created: list[str]
) -> tuple[str, str]:
    """(apiId, url) for the gateway built in one region. `created` gets the API's id the moment
    it exists, so the caller can remove a half-built one."""
    api = _aws(
        opener,
        creds,
        region,
        "POST",
        "/v2/apis",
        {"name": API_NAME, "protocolType": "HTTP"},
        "create the API",
    )
    api_id = _identifier(api, "apiId")
    created.append(api_id)
    base = f"/v2/apis/{api_id}"
    integration = _aws(
        opener,
        creds,
        region,
        "POST",
        f"{base}/integrations",
        {
            "integrationType": "HTTP_PROXY",
            "integrationMethod": "ANY",
            "integrationUri": BACKEND,
            "payloadFormatVersion": "1.0",
        },
        "add the integration",
    )
    integration_id = _identifier(integration, "integrationId")
    _aws(
        opener,
        creds,
        region,
        "POST",
        f"{base}/routes",
        {"routeKey": "ANY /{proxy+}", "target": f"integrations/{integration_id}"},
        "add the route",
    )
    _aws(
        opener,
        creds,
        region,
        "POST",
        f"{base}/stages",
        {"stageName": STAGE_NAME, "autoDeploy": True},
        "add the stage",
    )
    return api_id, f"https://{api_id}.execute-api.{region}.amazonaws.com"


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
        body = opener(request, CALL_TIMEOUT)
    except HTTPError as error:
        if error.code == 404 and missing_ok:
            return {}
        kind = _error_type(error)
        named = f" ({kind})" if kind else ""
        raise AwsCallError(
            f"{step}: HTTP {error.code}{named}",
            auth=error.code == 403 and kind in AUTH_ERRORS,
        ) from None
    except URLError, TimeoutError, ConnectionError, OSError:
        raise AwsCallError(f"{step}: couldn't reach AWS") from None
    try:
        raw = body.read(MAX_BODY)
    except TimeoutError, ConnectionError, OSError:
        raise AwsCallError(f"{step}: couldn't reach AWS") from None
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
