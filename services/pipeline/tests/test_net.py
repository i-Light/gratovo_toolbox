"""The pipeline's own network rule (ADR 0013): main's allowlist can't see the pipeline's requests,
so the pipeline refuses any host but YouTube's, Google's API and AWS API Gateway endpoints."""

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
