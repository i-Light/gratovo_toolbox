"""The pipeline's own network rule (ADR 0013): main's allowlist can't see the pipeline's requests,
so the pipeline refuses any host but YouTube's, Google's API and AWS API Gateway endpoints, plus
the hosts the job's kind adds (plan D20): Gmail's for the mail jobs, AWS's for the gateway jobs."""

from collections.abc import Iterator

import pytest

from gratovo_pipeline import net


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/results?search_query=ai+agents",
        "https://youtube.com/@aitoolsweekly",
        "https://www.YOUTUBE.com/@aitoolsweekly/videos",
        "https://www.googleapis.com/youtube/v3/channels?part=snippet",
        "https://youtube.googleapis.com/youtube/v3/videos",
        "https://abc123.execute-api.eu-west-1.amazonaws.com/prod/results",
    ],
)
def test_the_hosts_the_search_needs_are_allowed(url: str) -> None:
    net.check_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://www.youtube.com/results",  # not HTTPS
        "https://www.youtube.com.evil.example/",
        "https://evilyoutube.com/",
        "https://execute-api.eu-west-1.amazonaws.com.evil.example/",
        "https://abc.execute-api.eu-west-1.amazonaws.com.evil.example/",
        "https://s3.amazonaws.com/bucket",
        "https://www.google.com/",
        "file:///C:/Windows/win.ini",
        "https://user:pw@www.youtube.com/",
        "not a url",
    ],
)
def test_everything_else_is_refused(url: str) -> None:
    with pytest.raises(net.HostNotAllowedError):
        net.check_url(url)


def test_the_refusal_names_the_host_not_the_whole_url() -> None:
    with pytest.raises(net.HostNotAllowedError) as refused:
        net.check_url("https://evil.example/collect?key=AIza-secret")
    assert "AIza-secret" not in str(refused.value)
    assert "evil.example" in str(refused.value)


# --- a job's own hosts (plan D20) ---

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
OAUTH = "https://oauth2.googleapis.com/token"
AWS = "https://apigateway.eu-west-1.amazonaws.com/v2/apis"


@pytest.fixture(autouse=True)
def base_rule() -> Iterator[None]:
    """Each test starts and ends on the search's rule: allow_job_hosts sets process-wide state."""
    net.allow_job_hosts("search")
    yield
    net.allow_job_hosts("search")


def allowed(url: str) -> bool:
    try:
        net.check_url(url)
    except net.HostNotAllowedError:
        return False
    return True


@pytest.mark.parametrize(
    ("kind", "gmail", "aws"),
    [
        ("search", False, False),
        ("video_stats", False, False),
        ("refetch", False, False),
        ("backfill", False, False),
        ("mail.status", True, False),
        ("mail.send", True, False),
        ("mail.replies", True, False),
        ("mail.ack", True, False),
        ("mail.cancel", True, False),
        ("gateways.deploy", False, True),
        ("gateways.destroy", False, True),
        ("gateways.test", False, True),
    ],
)
def test_each_kind_adds_only_its_own_hosts(kind: str, gmail: bool, aws: bool) -> None:
    net.allow_job_hosts(kind)
    assert (allowed(GMAIL), allowed(OAUTH), allowed(AWS)) == (gmail, gmail, aws)
    # The base rule stays for every kind.
    net.check_url("https://www.youtube.com/@aitoolsweekly")
    net.check_url("https://abc123.execute-api.eu-west-1.amazonaws.com/prod")


@pytest.mark.parametrize(
    "url",
    [
        "https://apigateway.amazonaws.com/v2/apis",
        "https://apigateway.EU-WEST-1.amazonaws.com.evil.example/",
        "https://apigateway.eu-west-1.amazonaws.com.evil.example/",
        "https://xapigateway.eu-west-1.amazonaws.com/",
        "https://iam.amazonaws.com/",
        "https://sts.eu-west-1.amazonaws.com/",
        "http://apigateway.eu-west-1.amazonaws.com/v2/apis",
        "https://key:secret@apigateway.eu-west-1.amazonaws.com/v2/apis",
        GMAIL,
    ],
)
def test_the_gateway_jobs_reach_only_api_gateway(url: str) -> None:
    net.allow_job_hosts("gateways.deploy")
    with pytest.raises(net.HostNotAllowedError):
        net.check_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://mail.google.com/",
        "https://www.gmail.googleapis.com.evil.example/",
        "https://accounts.google.com/o/oauth2/token",
        AWS,
    ],
)
def test_the_mail_jobs_reach_only_gmail_and_the_token_endpoint(url: str) -> None:
    net.allow_job_hosts("mail.send")
    with pytest.raises(net.HostNotAllowedError):
        net.check_url(url)


def test_a_second_call_replaces_the_first() -> None:
    net.allow_job_hosts("mail.send")
    net.allow_job_hosts("gateways.test")
    assert not allowed(GMAIL)
    assert allowed(AWS)
