"""YouTube's own pages, read without the API (vendored scrapetube, ported from legacy and typed).

Every request here is an unauthenticated page or innertube call to youtube.com, hundreds per run.
Two things get a machine blocked, and they are separate problems:

  cadence   a request every N seconds, the same N each time, is not a pattern a person makes.
            `_pause` samples every gap instead.
  deafness  far more dangerous. YouTube throttles long before it bans: 429s, or a captcha page.
            `request` recognises both and backs off for progressively longer (capped at
            MAX_BACKOFF), and keeps retrying: a rate limit is a reason to wait, not to stop.

What a person watching should know (a wait, a refusal, which route served) goes to `_log`, which
the job points at the protocol's log messages. Every URL passes `net.check_url` first.
"""

from __future__ import annotations

import functools
import json
import random
import threading
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import Any, Final, Literal, Protocol
from urllib.parse import quote_plus, urlsplit

import curl_cffi.requests as requests
from curl_cffi.requests import exceptions as curl_errors

from gratovo_pipeline import net, run_control
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube.proxy_pool import ProxyPool, WaitInfo

# curl_cffi's `impersonate=` matches a Chrome version's whole TLS and HTTP/2 fingerprint and
# sends the headers that version sends. Sampled once per session (a client that changes its
# fingerprint mid-connection is more obviously automated), filtered to what the installed
# curl_cffi knows: an unknown target fails every request locally.
_SUPPORTED_TARGETS: Final = {b.value for b in requests.BrowserType}
IMPERSONATE_TARGETS: Final = tuple(
    t for t in ("chrome142", "chrome145", "chrome146", "chrome150") if t in _SUPPORTED_TARGETS
) or ("chrome",)

REQUEST_TIMEOUT: Final = 30  # seconds; the default is none, which is how a run looks frozen

# First backoff in seconds, doubled per attempt (capped), then jittered. A network blip deserves a
# few seconds; a throttle deserves minutes, because retrying it quickly is more throttled traffic.
TRANSIENT_BACKOFF: Final = 5.0
THROTTLE_BACKOFF: Final = 45.0
# A connection failure means "try another candidate now": the pool already cooled this one down.
PROXY_FAILOVER_BACKOFF: Final = 3.0
# Each attempt already walks 30 redirects; this bounds how many attempts a loop gets.
MAX_REDIRECT_LOOP_ATTEMPTS: Final = 2
MAX_BACKOFF: Final = 900.0  # retrying is unbounded, but no single wait grows past 15 minutes
BACKOFF_TICK: Final = 2.0

# YouTube serves the captcha interstitial with a 200 as often as not.
BLOCK_MARKERS: Final = (
    "/sorry/index",
    "detected unusual traffic",
    "unusual traffic from your computer",
    "our systems have detected",
    "recaptcha",
)

YOUTUBE_ORIGIN: Final = "https://www.youtube.com"
_CONSENT: Final = {"CONSENT": "YES+cb"}

type Sleep = tuple[float, float]  # a pause is sampled between these two, in seconds
type Json = Any


class ScrapetubeError(Exception):
    """Anything this module could not get an answer to."""


class ThrottledError(ScrapetubeError):
    """YouTube answered "slow down" (a 429 or 403, or a captcha page): retry after a long wait."""


class BlockedError(ScrapetubeError):
    """A response unusable in a way retrying can't fix: innertube answered with something that
    isn't JSON. Callers treat it as "this run's address was noticed": the run stops."""


class RedirectLoopError(ScrapetubeError):
    """This URL bounces between two others and never lands. It loops the same over a bare
    connection, so it is YouTube's routing for that page, not a refused candidate: no wait or
    rotation fixes it. Deliberately not a BlockedError: one broken page is logged and skipped,
    the run goes on."""


# --- what the scraper says, and the "try again now" signal ---


def _quiet(_level: LogLevel, _text: str) -> None:
    pass


_log: Callable[[LogLevel, str], None] = _quiet


def set_log(log: Callable[[LogLevel, str], None]) -> None:
    """Where the scraper's lines go: the job points it at the protocol's log messages."""
    global _log
    _log = log


_SKIP_LOCK = threading.Lock()
_skip_epoch = 0


def request_skip_wait() -> None:
    """Ends every wait in progress (the app's "Try again now"), none that begins afterwards: each
    waiter compares the epoch it started under."""
    global _skip_epoch
    with _SKIP_LOCK:
        _skip_epoch += 1


def _skipped_since(epoch: int) -> bool:
    return _skip_epoch != epoch


def _interruptible_wait(total: float, reason: str) -> None:
    """Sleeps `total` seconds in short ticks, ended early by a stop or a skip."""
    epoch = _skip_epoch
    remaining = total
    while remaining > 0:
        tick = min(BACKOFF_TICK, remaining)
        run_control.sleep(tick)
        remaining -= tick
        if _skipped_since(epoch):
            _log("info", f"Trying again now, as asked ({reason}).")
            return


def _pause(sleep: Sleep) -> None:
    """Waits between paginated requests, for a length nobody could predict."""
    low, high = max(0.0, sleep[0]), max(sleep)
    if high > 0:
        run_control.sleep(random.uniform(low, high))  # noqa: S311 - pacing, not security


# --- the session ---


class Response(Protocol):
    @property
    def status_code(self) -> int: ...
    @property
    def url(self) -> str: ...
    @property
    def headers(self) -> Mapping[str, str]: ...  # lowercase names
    @property
    def text(self) -> str: ...
    def json(self) -> Json: ...


class Requester(Protocol):
    proxies: dict[str, str]

    def request(
        self,
        method: str,
        url: str,
        /,
        *,
        timeout: float,
        params: Mapping[str, str | int] | None = None,
        json: Json = None,
        headers: Mapping[str, str] | None = None,
    ) -> Response: ...


class Session(Requester, Protocol):
    headers: dict[str, str]

    def close(self) -> None: ...


class _CurlResponse:
    def __init__(self, response: requests.Response) -> None:
        self.status_code: int = response.status_code
        self.url: str = response.url
        self.headers: Mapping[str, str] = {
            k.lower(): v for k, v in response.headers.items() if v is not None
        }
        self.text: str = response.text

    def json(self) -> Json:
        return json.loads(self.text)


class CurlSession:
    """One impersonated browser, with the proxies and headers `request` sets on it."""

    def __init__(self) -> None:
        self._session = requests.Session(impersonate=random.choice(IMPERSONATE_TARGETS))  # noqa: S311
        self.proxies: dict[str, str] = {}
        self.headers: dict[str, str] = {}

    def request(
        self,
        method: str,
        url: str,
        /,
        *,
        timeout: float,
        params: Mapping[str, str | int] | None = None,
        json: Json = None,
        headers: Mapping[str, str] | None = None,
    ) -> Response:
        response = self._session.request(  # pyright: ignore[reportUnknownMemberType] - curl_cffi leaves dict args untyped
            method,  # pyright: ignore[reportArgumentType] - curl_cffi types it as a Literal
            url,
            params=dict(params) if params else None,
            json=json,
            headers={**self.headers, **(headers or {})},
            cookies=_CONSENT,
            proxies=dict(self.proxies) if self.proxies else None,  # pyright: ignore[reportArgumentType]
            timeout=timeout,
        )
        return _CurlResponse(response)

    def close(self) -> None:
        self._session.close()


def get_session() -> Session:
    """A session that looks like one browser and keeps looking like it. Its proxies are set per
    request from the pool: rotating within a session's life is the point."""
    return CurlSession()


# --- the pool ---

_pool = ProxyPool.from_routes()
_POOL_LOCK = threading.Lock()


def get_pool() -> ProxyPool:
    """The process-wide pool. One for every worker: the rotation rules hold only within one."""
    return _pool


def set_pool(pool: ProxyPool) -> None:
    """Sets the run's pool (from its routes), once, before any request."""
    global _pool
    with _POOL_LOCK:
        _pool = pool


_ROTATION_ANNOUNCE_MIN: Final = 1.5  # a shorter gap wait isn't worth a line


class WaitAnnouncer:
    """Says, once per wait, why `ProxyPool.acquire` is waiting: a cooldown (nothing healthy, can be
    minutes) or a gap (every connection used moments ago). Waiting on a busy worker says nothing."""

    def __init__(self) -> None:
        self._said = False

    def __call__(self, info: WaitInfo) -> None:
        if self._said:
            return
        if info.reason == "cooldown":
            self._said = True
            _log(
                "warn",
                f"Every connection is cooling down; back in about {info.total:.0f}s "
                f"(soonest: {info.label}).",
            )
        elif info.reason == "gap" and info.remaining >= _ROTATION_ANNOUNCE_MIN:
            self._said = True
            _log(
                "info",
                f"Rotating: waiting {info.remaining:.0f}s so no connection is hit twice in a row.",
            )


def route_through_gateway(url: str, base_url: str) -> str:
    """A youtube.com URL rewritten to go through an AWS API Gateway that forwards the same path to
    youtube.com. Case-insensitive: `https://www.YOUTUBE.com/...` must route too."""
    if url[: len(YOUTUBE_ORIGIN)].lower() == YOUTUBE_ORIGIN:
        return base_url + url[len(YOUTUBE_ORIGIN) :]
    return url


# --- one request ---


def _retry_after(response: Response | None) -> float:
    if response is None:
        return 0.0
    try:
        return max(0.0, float(response.headers.get("retry-after", "")))
    except ValueError:
        return 0.0


def _raise_if_blocked(response: Response) -> None:
    status = response.status_code
    # The path only: through a gateway the host is the gateway's, and its URL is a secret.
    where = urlsplit(response.url).path or "/"
    if status in (429, 403):
        raise ThrottledError(f"HTTP {status} from {where}")
    if status >= 500:
        raise ScrapetubeError(f"HTTP {status} from {where}")
    if "/sorry/" in response.url:
        raise ThrottledError("redirected to YouTube's captcha page")
    # Only in HTML: innertube's JSON is built from titles and descriptions, and a search whose
    # results mention a marker is a healthy run. Only the head is scanned: the markers live there.
    if "html" in response.headers.get("content-type", "").lower():
        head = response.text[:4096].lower()
        if any(marker in head for marker in BLOCK_MARKERS):
            raise ThrottledError("served the 'unusual traffic' page")


def _describe(error: Exception) -> str:
    """An attempt's failure for the log. Our own errors name a status and a path; a library's
    message can carry the proxy URL (with its login) or the gateway's host, so only its kind."""
    return str(error) if isinstance(error, ScrapetubeError) else type(error).__name__


def request(
    session: Requester,
    method: str,
    url: str,
    *,
    params: Mapping[str, str | int] | None = None,
    json: Json = None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    """One request, retried with escalating (capped) backoff until it succeeds or the run stops.

    Every attempt draws a candidate from the pool and points the session at it; a gateway rewrites
    the URL instead. The lease is released however the attempt ended, so the gap is measured from
    the end of the request. Raises RedirectLoopError, net.HostNotAllowedError or RunAborted.
    """
    attempt = 0
    redirect_loops = 0
    while True:
        attempt += 1
        pool = get_pool()
        epoch = _skip_epoch
        lease = pool.acquire(
            skip_requested=functools.partial(_skipped_since, epoch), on_wait=WaitAnnouncer()
        )
        candidate = lease.candidate
        if candidate.base_url:
            session.proxies = {}
            target = route_through_gateway(url, candidate.base_url)
        else:
            session.proxies = candidate.proxies
            target = url
        response: Response | None = None
        hinted = 0.0
        try:
            net.check_url(target)
            response = session.request(
                method, target, timeout=REQUEST_TIMEOUT, params=params, json=json, headers=headers
            )
            _raise_if_blocked(response)
            pool.report_success(candidate)
            summary = pool.route_summary()
            if summary:
                _log("info", summary)
            return response
        except ThrottledError as exc:
            last: Exception = exc
            base = THROTTLE_BACKOFF
            hinted = _retry_after(response)
            pool.report_blocked(candidate)
        except curl_errors.TooManyRedirects as exc:
            # Raised mid-chain, before any response. Not the candidate's fault (see
            # RedirectLoopError), so its health is left alone, and the retries are bounded.
            redirect_loops += 1
            if redirect_loops >= MAX_REDIRECT_LOOP_ATTEMPTS:
                raise RedirectLoopError(
                    f"{url.split('?')[0]} loops after {redirect_loops} attempt(s)"
                ) from exc
            last, base = exc, THROTTLE_BACKOFF
        except (
            curl_errors.ProxyError,
            curl_errors.ConnectTimeout,
            curl_errors.SSLError,
            curl_errors.ConnectionError,
        ) as exc:
            # No HTTP answer at all: this candidate is unreachable or broken. Try another, soon.
            last, base = exc, PROXY_FAILOVER_BACKOFF
            pool.report_connection_failure(candidate)
        except (ScrapetubeError, curl_errors.RequestException) as exc:
            last, base = exc, TRANSIENT_BACKOFF
        finally:
            lease.release()

        wait = min(max(hinted, base * (2 ** min(attempt - 1, 10))), MAX_BACKOFF)
        wait = min(random.uniform(wait, wait * 1.4), MAX_BACKOFF)  # noqa: S311
        reason = f"{candidate.label}: {_describe(last)}"
        _log(
            "warn", f"YouTube pushed back ({reason}); waiting {wait:.0f}s before try {attempt + 1}."
        )
        _interruptible_wait(wait, reason)


# --- pages ---

# YouTube renders grids as `lockupViewModel` now and still mixes in `videoRenderer`, depending on
# the page or experiment, so both are read and normalized (normalize_item).
type Selector = str | tuple[str, ...]
_CHANNEL_ITEMS: Final[dict[str, Selector]] = {
    "videos": ("lockupViewModel", "videoRenderer"),
    "streams": ("lockupViewModel", "videoRenderer"),
    "shorts": ("reelWatchEndpoint", "shortsLockupViewModel"),
}
_SEARCH_SORT: Final = {"relevance": "A", "upload_date": "I", "view_count": "M", "rating": "E"}
_SEARCH_TYPE: Final[dict[str, tuple[str, Selector]]] = {
    "video": ("B", ("lockupViewModel", "videoRenderer")),
    "channel": ("C", "channelRenderer"),
    "playlist": ("D", "playlistRenderer"),
    "movie": ("E", ("lockupViewModel", "videoRenderer")),
}


def get_channel(
    *,
    channel_url: str,
    limit: int | None = None,
    sleep: Sleep = (0.6, 1.9),
    sort_by: Literal["newest", "oldest", "popular"] = "newest",
    content_type: Literal["videos", "shorts", "streams"] = "videos",
    session: Session | None = None,
) -> Generator[dict[str, Json]]:
    """A channel's videos, newest first by default. A session passed in is the caller's to close."""
    url = f"{channel_url}/{content_type}?view=0&flow=grid"
    # A narrower root than "contents", which also matches keys inside page headers.
    yield from get_videos(
        url,
        "https://www.youtube.com/youtubei/v1/browse",
        "twoColumnBrowseResultsRenderer",
        _CHANNEL_ITEMS[content_type],
        limit,
        sleep,
        sort_by,
        session,
    )


def get_search(
    query: str,
    *,
    limit: int | None = None,
    sleep: Sleep = (0.6, 1.9),
    sort_by: Literal["relevance", "upload_date", "view_count", "rating"] = "relevance",
    results_type: Literal["video", "channel", "playlist", "movie"] = "video",
    session: Session | None = None,
) -> Generator[dict[str, Json]]:
    """Search results, as YouTube's own items."""
    code, selector = _SEARCH_TYPE[results_type]
    url = f"https://www.youtube.com/results?search_query={quote_plus(query)}&sp=CA{_SEARCH_SORT[sort_by]}SAhA{code}"
    yield from get_videos(
        url,
        "https://www.youtube.com/youtubei/v1/search",
        "contents",
        selector,
        limit,
        sleep,
        None,
        session,
    )


def get_videos(
    url: str,
    api_endpoint: str,
    selector_list: str,
    selector_item: Selector,
    limit: int | None,
    sleep: Sleep,
    sort_by: str | None = None,
    session: Session | None = None,
) -> Generator[dict[str, Json]]:
    # A session made here is closed here, in `finally`, which also runs when a caller stops
    # early (every caller with a limit).
    owns_session = session is None
    active = session or get_session()
    try:
        is_first = True
        count = 0
        next_data: dict[str, Json] | None = None
        api_key = ""
        client: Json = None
        while True:
            if is_first:
                html = get_initial_data(active, url)
                client = json.loads(
                    get_json_from_html(html, "INNERTUBE_CONTEXT", 2, '"}},') + '"}}'
                )["client"]
                api_key = get_json_from_html(html, "innertubeApiKey", 3)
                active.headers["X-YouTube-Client-Name"] = "1"
                active.headers["X-YouTube-Client-Version"] = client["clientVersion"]
                data: Json = json.loads(
                    get_json_from_html(html, "var ytInitialData = ", 0, "};") + "}"
                )
                data = next(search_dict(data, selector_list), None)
                next_data = get_next_data(data, sort_by)
                is_first = False
                if sort_by and sort_by != "newest":
                    # Applying the sort chip is a second request, paced like any other.
                    _pause(sleep)
                    continue
            else:
                assert next_data is not None  # noqa: S101 - the loop ends when it is None
                data = get_ajax_data(active, api_endpoint, api_key, next_data, client)
                next_data = get_next_data(data)
            for result in get_videos_items(data, selector_item):
                count += 1
                yield result
                if count == limit:
                    return
            if not next_data:
                return
            _pause(sleep)
    finally:
        if owns_session:
            active.close()


def get_initial_data(session: Requester, url: str) -> str:
    return request(session, "GET", url, params={"ucbcb": 1}).text


def get_ajax_data(
    session: Requester, api_endpoint: str, api_key: str, next_data: Mapping[str, Json], client: Json
) -> Json:
    body = {
        "context": {"clickTracking": next_data["click_params"], "client": client},
        "continuation": next_data["token"],
    }
    # What a browser sends on this call. Innertube accepts the request without them, but
    # "accepted" and "unremarkable" differ, and this is the request a run makes most.
    response = request(
        session,
        "POST",
        api_endpoint,
        params={"key": api_key},
        json=body,
        headers={
            "Content-Type": "application/json",
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "same-origin",
            "Sec-Fetch-Site": "same-origin",
            "X-Origin": "https://www.youtube.com",
        },
    )
    try:
        return response.json()
    except ValueError as exc:
        # Non-JSON from a JSON-only endpoint: an interstitial that slipped past the markers.
        raise BlockedError(f"innertube returned a non-JSON body ({exc})") from exc


def get_json_from_html(html: str, key: str, num_chars: int = 2, stop: str = '"') -> str:
    begin = html.find(key) + len(key) + num_chars
    return html[begin : html.find(stop, begin)]


_SORT_CHIPS: Final = {
    "newest": 0,
    "popular": 1,
    "oldest": 2,
}  # YouTube's order; please don't change it


def get_next_data(data: Json, sort_by: str | None = None) -> dict[str, Json] | None:
    if sort_by and sort_by != "newest":
        chips = next(search_dict(data, "feedFilterChipBarRenderer"), None)
        endpoint = (
            chips["contents"][_SORT_CHIPS[sort_by]]["chipCloudChipRenderer"]["navigationEndpoint"]
            if chips
            else None
        )
    else:
        endpoint = next(search_dict(data, "continuationEndpoint"), None)
    if not endpoint:
        return None
    return {
        "token": endpoint["continuationCommand"]["token"],
        "click_params": {"clickTrackingParams": endpoint["clickTrackingParams"]},
    }


def search_dict(partial: Json, search_key: str) -> Generator[Json]:
    """Every value under search_key at any depth, breadth first."""
    stack: list[Json] = [partial]
    while stack:
        current = stack.pop(0)
        if isinstance(current, dict):
            for key, value in current.items():  # pyright: ignore[reportUnknownVariableType]
                if key == search_key:
                    yield value
                else:
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)  # pyright: ignore[reportUnknownArgumentType]


def get_videos_items(data: Json, selector: Selector) -> Generator[dict[str, Json]]:
    selectors: Sequence[str] = selector if isinstance(selector, tuple) else (selector,)
    for key in selectors:
        for item in search_dict(data, key):
            yield normalize_item(item)


def normalize_item(item: Json) -> dict[str, Json]:
    """The item with a top-level `videoId`: `lockupViewModel` carries it as `contentId`, with
    `contentType` saying what it points to."""
    if not isinstance(item, dict):
        return {}
    found: dict[str, Json] = dict(item)  # pyright: ignore[reportUnknownArgumentType]
    if (
        "videoId" not in found
        and found.get("contentId")
        and found.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO"
    ):
        found["videoId"] = found["contentId"]
    return found
