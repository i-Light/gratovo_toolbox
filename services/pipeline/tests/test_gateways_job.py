"""The gateways jobs (plan D19) against a fake transport: no network, no AWS. Every line is
checked against the schema, and no line or stderr may carry a key, a signature or a gateway URL."""

import io
import json
import urllib.request
from collections.abc import Callable, Iterator
from email.message import Message
from typing import Any
from urllib.error import HTTPError, URLError

import pytest
from helpers import start_with

from gratovo_pipeline import net
from gratovo_pipeline.jobs import gateways
from gratovo_pipeline.protocol import Emitter

Check = Callable[[str], dict[str, Any]]
ACCESS_KEY = "AKIAFAKEFAKEFAKE1234"
SECRET_KEY = "fakeSecretKey/ForTestsOnly+0123456789abcdef"  # noqa: S105 - a fake
AWS = {"accessKeyId": ACCESS_KEY, "secretAccessKey": SECRET_KEY}
GATEWAY_URL = "https://abc123def.execute-api.us-east-1.amazonaws.com"


class Reply:
    """A readable answer, as urllib hands one back."""

    def __init__(self, data: object = None, status: int = 200) -> None:
        self._raw = json.dumps(data).encode() if data is not None else b""
        self.status = status

    def read(self, size: int = -1, /) -> bytes:
        return self._raw

    def close(self) -> None:
        pass


def http_error(url: str, code: int, kind: str | None = None) -> HTTPError:
    headers = Message()
    if kind:
        headers["x-amzn-ErrorType"] = f"{kind}:http://internal.amazon.com/"
    body = json.dumps({"message": f"secret detail {SECRET_KEY}"}).encode()
    return HTTPError(url, code, "error", headers, io.BytesIO(body))


type Handler = Callable[[urllib.request.Request], Reply | Exception]


class FakeAws:
    """Answers by method and path; records what was sent."""

    def __init__(self, handler: Handler | None = None) -> None:
        self.requests: list[urllib.request.Request] = []
        self.handler = handler or self.happy

    def __call__(self, request: urllib.request.Request, timeout: float) -> Reply:
        self.requests.append(request)
        answer = self.handler(request)
        if isinstance(answer, Exception):
            raise answer
        return answer

    @staticmethod
    def happy(request: urllib.request.Request) -> Reply | Exception:
        path = request.full_url.split("amazonaws.com", 1)[1]
        if request.get_method() == "DELETE":
            return Reply(None, 204)
        if path == "/v2/apis":
            return Reply({"apiId": "api" + request.full_url.split(".")[1].replace("-", "")})
        if path.endswith("/integrations"):
            return Reply({"integrationId": "int1"})
        return Reply({})

    def calls(self) -> list[tuple[str, str]]:
        return [(r.get_method(), r.full_url.split("amazonaws.com", 1)[1]) for r in self.requests]

    def body(self, index: int) -> dict[str, Any]:
        data = self.requests[index].data
        assert isinstance(data, bytes)
        loaded: dict[str, Any] = json.loads(data)
        return loaded


@pytest.fixture(autouse=True)
def gateway_hosts() -> Iterator[None]:
    net.allow_job_hosts("gateways.deploy")
    yield
    net.allow_job_hosts("search")


def run_job(
    transport: FakeAws, check: Check, job: dict[str, Any], **changes: object
) -> list[dict[str, Any]]:
    out = io.StringIO()
    start = start_with(job=job, source="live", **changes)
    gateways.run(start, Emitter(out), open_url=transport)
    return [check(line + "\n") for line in out.getvalue().splitlines()]


def deploy(regions: list[str]) -> dict[str, Any]:
    return {"kind": "gateways.deploy", "regions": regions}


def end_of(lines: list[dict[str, Any]]) -> dict[str, Any]:
    assert lines[-1]["type"] == "end"
    return lines[-1]


def result_of(lines: list[dict[str, Any]]) -> dict[str, Any]:
    results = [line for line in lines if line["type"] == "result"]
    assert len(results) == 1
    assert lines.index(results[0]) < len(lines) - 1
    data: dict[str, Any] = results[0]["data"]
    return data


def test_deploy_makes_the_four_calls_in_order_with_the_right_bodies(
    check_from_pipeline: Check,
) -> None:
    aws = FakeAws()

    lines = run_job(aws, check_from_pipeline, deploy(["us-east-1"]), secrets__aws=AWS)

    assert aws.calls() == [
        ("POST", "/v2/apis"),
        ("POST", "/v2/apis/apiuseast1/integrations"),
        ("POST", "/v2/apis/apiuseast1/routes"),
        ("POST", "/v2/apis/apiuseast1/stages"),
    ]
    assert aws.body(0) == {"name": "gratovo-yt-proxy", "protocolType": "HTTP"}
    assert aws.body(1) == {
        "integrationType": "HTTP_PROXY",
        "integrationMethod": "ANY",
        "integrationUri": "https://www.youtube.com/{proxy}",
        "payloadFormatVersion": "1.0",
    }
    assert aws.body(2) == {"routeKey": "ANY /{proxy+}", "target": "integrations/int1"}
    assert aws.body(3) == {"stageName": "$default", "autoDeploy": True}
    for request in aws.requests:
        assert request.full_url.startswith("https://apigateway.us-east-1.amazonaws.com/")
        auth = request.get_header("Authorization")
        assert auth is not None
        assert "/us-east-1/apigateway/aws4_request" in auth
        assert f"Credential={ACCESS_KEY}/" in auth
    assert result_of(lines) == {
        "deployed": [
            {
                "region": "us-east-1",
                "apiId": "apiuseast1",
                "url": "https://apiuseast1.execute-api.us-east-1.amazonaws.com",
            }
        ],
        "failed": [],
    }
    assert end_of(lines)["state"] == "done"
    assert (end_of(lines)["at"], end_of(lines)["found"], end_of(lines)["kept"]) == (0, 0, 0)


def test_a_failing_region_does_not_stop_the_next_and_its_half_built_api_is_deleted(
    check_from_pipeline: Check,
) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        if "eu-west-1" in request.full_url and request.full_url.endswith("/routes"):
            return http_error(request.full_url, 400, "BadRequestException")
        return FakeAws.happy(request)

    aws = FakeAws(handler)

    lines = run_job(aws, check_from_pipeline, deploy(["eu-west-1", "us-east-1"]), secrets__aws=AWS)

    calls = aws.calls()
    assert ("DELETE", "/v2/apis/apieuwest1") in calls
    assert calls.index(("DELETE", "/v2/apis/apieuwest1")) < calls.index(("POST", "/v2/apis"), 4)
    assert aws.requests[calls.index(("DELETE", "/v2/apis/apieuwest1"))].full_url.startswith(
        "https://apigateway.eu-west-1."
    )
    data = result_of(lines)
    assert [g["region"] for g in data["deployed"]] == ["us-east-1"]
    assert data["failed"] == [
        {"region": "eu-west-1", "message": "add the route: HTTP 400 (BadRequestException)"}
    ]
    assert end_of(lines)["state"] == "done"


def test_a_failed_cleanup_is_only_a_warning(check_from_pipeline: Check) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.get_method() == "DELETE":
            return URLError("down")
        if request.full_url.endswith("/stages"):
            return http_error(request.full_url, 500)
        return FakeAws.happy(request)

    lines = run_job(FakeAws(handler), check_from_pipeline, deploy(["us-east-1"]), secrets__aws=AWS)

    assert result_of(lines)["failed"] == [
        {"region": "us-east-1", "message": "add the stage: HTTP 500"}
    ]
    assert end_of(lines)["state"] == "done"
    assert any(line["type"] == "log" and "removed" in line["text"] for line in lines)


def test_missing_keys_end_with_no_aws_keys(check_from_pipeline: Check) -> None:
    aws = FakeAws()

    lines = run_job(aws, check_from_pipeline, deploy(["us-east-1"]))

    assert aws.requests == []
    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["state"] == "failed"
    assert lines[0]["error"]["code"] == "no_aws_keys"


def test_every_region_refused_for_the_keys_ends_with_aws(check_from_pipeline: Check) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        return http_error(request.full_url, 403, "UnrecognizedClientException")

    lines = run_job(
        FakeAws(handler), check_from_pipeline, deploy(["us-east-1", "eu-west-1"]), secrets__aws=AWS
    )

    assert [line["type"] for line in lines if line["type"] != "log"] == ["end"], "no result"
    assert end_of(lines)["state"] == "failed"
    assert end_of(lines)["error"]["code"] == "aws"


def test_a_mix_of_reasons_is_still_done(check_from_pipeline: Check) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        if "eu-west-1" in request.full_url:
            return http_error(request.full_url, 403, "AccessDeniedException")
        return http_error(request.full_url, 429, "TooManyRequestsException")

    lines = run_job(
        FakeAws(handler), check_from_pipeline, deploy(["us-east-1", "eu-west-1"]), secrets__aws=AWS
    )

    assert end_of(lines)["state"] == "done"
    assert len(result_of(lines)["failed"]) == 2


def test_destroy_counts_a_404_as_deleted(check_from_pipeline: Check) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        if request.full_url.endswith("/gone1"):
            return http_error(request.full_url, 404, "NotFoundException")
        if request.full_url.endswith("/bad1"):
            return http_error(request.full_url, 409, "ConflictException")
        return Reply(None, 204)

    job = {
        "kind": "gateways.destroy",
        "gateways": [
            {"region": "us-east-1", "apiId": "gone1"},
            {"region": "eu-west-1", "apiId": "ok1"},
            {"region": "eu-west-1", "apiId": "bad1"},
        ],
    }
    aws = FakeAws(handler)

    lines = run_job(aws, check_from_pipeline, job, secrets__aws=AWS)

    assert [c[0] for c in aws.calls()] == ["DELETE"] * 3
    assert all(r.get_header("Authorization") for r in aws.requests)
    data = result_of(lines)
    assert data["deleted"] == [
        {"region": "us-east-1", "apiId": "gone1"},
        {"region": "eu-west-1", "apiId": "ok1"},
    ]
    assert data["failed"] == [
        {
            "region": "eu-west-1",
            "apiId": "bad1",
            "message": "delete the API: HTTP 409 (ConflictException)",
        }
    ]
    assert end_of(lines)["state"] == "done"


def test_destroy_without_keys_ends_with_no_aws_keys(check_from_pipeline: Check) -> None:
    job = {"kind": "gateways.destroy", "gateways": [{"region": "us-east-1", "apiId": "x1"}]}

    lines = run_job(FakeAws(), check_from_pipeline, job)

    assert lines[0]["error"]["code"] == "no_aws_keys"


def test_the_test_reports_each_url_without_the_url(check_from_pipeline: Check) -> None:
    good = "https://aaa111.execute-api.us-east-1.amazonaws.com"
    bad = "https://bbb222.execute-api.eu-west-1.amazonaws.com"
    gone = "https://ccc333.execute-api.ap-south-1.amazonaws.com"
    elsewhere = "https://example.com/secret-path"

    def handler(request: urllib.request.Request) -> Reply | Exception:
        assert request.get_header("Authorization") is None
        assert request.full_url.endswith("/generate_204")
        if "aaa111" in request.full_url:
            return Reply(None, 204)
        if "bbb222" in request.full_url:
            return http_error(request.full_url, 502)
        return URLError("no route")

    aws = FakeAws(handler)

    lines = run_job(
        aws,
        check_from_pipeline,
        {"kind": "gateways.test"},
        secrets__gatewayUrls=[good, bad, gone, elsewhere],
    )

    assert len(aws.requests) == 3  # the fourth never left
    assert result_of(lines)["results"] == [
        {"region": "us-east-1", "status": 204, "ok": True, "message": None},
        {
            "region": "eu-west-1",
            "status": 502,
            "ok": False,
            "message": "The gateway answered with HTTP 502.",
        },
        {
            "region": "ap-south-1",
            "status": None,
            "ok": False,
            "message": "Couldn't reach the gateway.",
        },
        {"region": None, "status": None, "ok": False, "message": "Not a gateway address."},
    ]
    assert end_of(lines)["state"] == "done"
    seen = json.dumps(lines)
    for url in (good, bad, gone, elsewhere):
        assert url.split("//")[1].split("/")[0] not in seen
    assert "secret-path" not in seen


def test_a_4xx_from_a_gateway_still_counts_as_up(check_from_pipeline: Check) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        return http_error(request.full_url, 404)

    lines = run_job(
        FakeAws(handler),
        check_from_pipeline,
        {"kind": "gateways.test"},
        secrets__gatewayUrls=[GATEWAY_URL],
    )

    assert result_of(lines)["results"] == [
        {"region": "us-east-1", "status": 404, "ok": True, "message": None}
    ]


def test_the_test_needs_no_keys_and_handles_no_urls(check_from_pipeline: Check) -> None:
    lines = run_job(FakeAws(), check_from_pipeline, {"kind": "gateways.test"})

    assert result_of(lines) == {"results": []}
    assert end_of(lines)["state"] == "done"


def test_a_surprise_is_a_crash_that_names_only_its_kind(
    check_from_pipeline: Check, capsys: pytest.CaptureFixture[str]
) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        return ValueError(f"boom {request.full_url} {SECRET_KEY}")

    lines = run_job(FakeAws(handler), check_from_pipeline, deploy(["us-east-1"]), secrets__aws=AWS)

    assert [line["type"] for line in lines] == ["end"]
    assert lines[0]["error"]["code"] == "crash"
    assert "ValueError" in lines[0]["error"]["message"]
    assert SECRET_KEY not in json.dumps(lines) + capsys.readouterr().err


def test_no_line_or_stderr_carries_a_key_or_a_signature(
    check_from_pipeline: Check, capsys: pytest.CaptureFixture[str]
) -> None:
    def handler(request: urllib.request.Request) -> Reply | Exception:
        if "eu-west-1" in request.full_url:
            return http_error(request.full_url, 403, "InvalidSignatureException")
        return FakeAws.happy(request)

    aws = FakeAws(handler)

    lines = run_job(aws, check_from_pipeline, deploy(["us-east-1", "eu-west-1"]), secrets__aws=AWS)

    signatures: list[str] = []
    for request in aws.requests:
        auth = request.get_header("Authorization")
        assert auth is not None
        signatures.append(auth.rsplit("Signature=", 1)[1])
    assert signatures
    seen = json.dumps(lines) + capsys.readouterr().err
    secrets: list[str] = [SECRET_KEY, ACCESS_KEY, "Authorization", *signatures]
    for secret in secrets:
        assert secret not in seen
    assert "secret detail" not in seen
