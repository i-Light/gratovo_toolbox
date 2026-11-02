"""YouTube's own pages, read without the API (vendored scrapetube, ported from legacy and typed).

Every request here is an unauthenticated page or innertube call to youtube.com, hundreds per run.
Two things get a machine blocked, and they are separate problems:

  cadence   a request every N seconds, the same N each time, is not a pattern a person makes.
            `_pause` samples every gap instead.
  deafness  far more dangerous. YouTube throttles long before it bans: 429s, or a captcha page.
            `request` recognises both, cools that route and tries the page again on another
            (MAX_ATTEMPTS in all); the pool's cooldowns and gaps are the wait. A page that fails
            every attempt is a PageFailedError: the caller ends that search or channel, not the run.

`route_affinity` keeps a keyword on one route for its pages while that route is healthy. Every
page response is counted in bytes (`take_thread_bytes`, `total_bytes`).

What a person watching should know (a wait, a refusal, which route served) goes to `_log`, which
the job points at the protocol's log messages. Every URL passes `net.check_url` first.
"""

from __future__ import annotations

import contextlib
import functools
import gzip
import json
import random
import threading
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal, Protocol
from urllib.parse import quote_plus, urljoin, urlsplit

import curl_cffi.requests as requests
from curl_cffi.requests import exceptions as curl_errors

from gratovo_pipeline import net, run_control
from gratovo_pipeline.protocol import LogLevel, WaitReason, WaitSink, utc_iso
from gratovo_pipeline.scrapetube.proxy_pool import Candidate, ProxyPool, WaitInfo

# curl_cffi's `impersonate=` matches a Chrome version's whole TLS and HTTP/2 fingerprint and
# sends the headers that version sends. Sampled once per session (a client that changes its
# fingerprint mid-connection is more obviously automated), filtered to what the installed
# curl_cffi knows: an unknown target fails every request locally.
_SUPPORTED_TARGETS: Final = {b.value for b in requests.BrowserType}
IMPERSONATE_TARGETS: Final = tuple(
    t for t in ("chrome142", "chrome145", "chrome146", "chrome150") if t in _SUPPORTED_TARGETS
) or ("chrome",)

REQUEST_TIMEOUT: Final = 30  # seconds; the default is none, which is how a run looks frozen

# A page gets this many attempts, each on a different route when the pool has another.
MAX_ATTEMPTS: Final = 3
# Each attempt already walks 30 redirects; this bounds how many attempts a loop gets.
MAX_REDIRECT_LOOP_ATTEMPTS: Final = 2
MAX_GATEWAY_HOPS: Final = 5
_YOUTUBE_HOSTS: Final = frozenset({"youtube.com", "www.youtube.com"})
GZIP_LEVEL: Final = 6  # what a compressed response is sized at: its body gzipped again

# YouTube serves the captcha interstitial with a 200 as often as not.
BLOCK_MARKERS: Final = (
    "/sorry/index",
    "detected unusual traffic",
    "unusual traffic from your computer",
    "our systems have detected",
    "recaptcha",
    "sign in to confirm you're not a bot",
    "sign in to confirm you’re not a bot",  # noqa: RUF001
    "confirm you're not a bot",
    "confirm you’re not a bot",  # noqa: RUF001
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
    """Innertube answered with something that isn't JSON. Inside `request` it cools the route and
    counts as an attempt; it never ends a run."""


class PageFailedError(ScrapetubeError):
    """A page failed MAX_ATTEMPTS times. Names the last cause (kind and path only). The search or
    the channel it belonged to ends; the run goes on. `all_blocked`: every attempt was a throttle or
    a block (a sweep that must end its job on a block reads it)."""

    def __init__(self, message: str, *, all_blocked: bool = False) -> None:
        super().__init__(message)
        self.all_blocked = all_blocked


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


def _pause(sleep: Sleep) -> None:
    """Waits between paginated requests, for a length nobody could predict."""
    low, high = max(0.0, sleep[0]), max(sleep)
    if high > 0:
        run_control.sleep(random.uniform(low, high))  # noqa: S311 - pacing, not security


# --- one route per keyword ---

_affinity = threading.local()


@contextlib.contextmanager
def route_affinity() -> Generator[None]:
    """Inside it, this thread's requests prefer the route that served its last page: the keyword's
    pages, its sweep and its details stay on one route while it is healthy, and move to another
    when it cools down (the new one then becomes the preferred route)."""
    previous: list[Candidate | None] | None = getattr(_affinity, "preferred", None)
    _affinity.preferred = [None]
    try:
        yield
    finally:
        _affinity.preferred = previous


def _preferred() -> Candidate | None:
    holder: list[Candidate | None] | None = getattr(_affinity, "preferred", None)
    return holder[0] if holder else None


def _remember_route(candidate: Candidate) -> None:
    holder: list[Candidate | None] | None = getattr(_affinity, "preferred", None)
    if holder is not None:
        holder[0] = candidate


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
        allow_redirects: bool = True,
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
        allow_redirects: bool = True,
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
            allow_redirects=allow_redirects,
        )
        return _CurlResponse(response)

    def close(self) -> None:
        self._session.close()


# --- bandwidth ---

_traffic = threading.local()
_TOTAL_LOCK = threading.Lock()
_total_bytes = 0


def response_bytes(response: Response) -> int:
    """What a page response cost on the wire, as near as the library lets us tell: the body
    gzipped again at level 6 when it came compressed, else its length, plus the headers."""
    body = response.text.encode("utf-8", errors="replace")
    if response.headers.get("content-encoding"):
        body = gzip.compress(body, GZIP_LEVEL)
    head = sum(len(name) + len(value) + 4 for name, value in response.headers.items())
    return len(body) + head


def _count_bytes(response: Response) -> None:
    global _total_bytes
    size = response_bytes(response)
    _traffic.count = getattr(_traffic, "count", 0) + size
    get_pool().report_current_bytes(size)
    with _TOTAL_LOCK:
        _total_bytes += size


def thread_bytes() -> int:
    """Bytes this thread has downloaded since it last took the count."""
    return int(getattr(_traffic, "count", 0))


def take_thread_bytes() -> int:
    """This thread's count, which then starts again at zero (a keyword's start)."""
    count = thread_bytes()
    _traffic.count = 0
    return count


def total_bytes() -> int:
    with _TOTAL_LOCK:
        return _total_bytes


def reset_total_bytes() -> None:
    global _total_bytes
    with _TOTAL_LOCK:
        _total_bytes = 0


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


# --- telling the app about a long routes wait (step S2, R4) ---

ROUTES_WAIT_MIN: Final = 30.0  # a shorter cooldown wait isn't worth a message


class _NoWaits:
    def wait(self, reason: WaitReason, until: str) -> None:
        pass

    def resume(self, reason: WaitReason) -> None:
        pass


_waits: WaitSink = _NoWaits()


def set_wait_sink(sink: WaitSink | None) -> None:
    """Where long routes waits are told: the job gives a counting sink (`WaitCounter`), so many
    workers waiting are one `wait` and one `resume`. None is a no-op."""
    global _waits
    _waits = sink if sink is not None else _NoWaits()


class WaitAnnouncer:
    """Says, once per wait, why `ProxyPool.acquire` is waiting: a cooldown (nothing healthy, can be
    minutes) or a gap (every connection used moments ago). Waiting on a busy worker says nothing.
    A cooldown of 30 s or more is also told to the app, and `done` ends it."""

    def __init__(self) -> None:
        self._said = False
        self._told = False

    def done(self, *, resumed: bool) -> None:
        """The wait is over: a lease came back (`resumed`), or the wait was cut short."""
        if self._told:
            self._told = False
            _waits.resume("routes")

    def __call__(self, info: WaitInfo) -> None:
        if info.reason == "cooldown" and not self._told and info.total >= ROUTES_WAIT_MIN:
            self._told = True
            until = utc_iso(datetime.now(UTC) + timedelta(seconds=info.remaining))
            _waits.wait("routes", until)
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


class _AtYouTube:
    """A gateway's answer that reports the youtube.com form of its URL, so the block checks and
    the callers never see the gateway's address."""

    def __init__(self, response: Response, url: str) -> None:
        self._response = response
        self.url = url
        self.status_code = response.status_code
        self.headers = response.headers
        self.text = response.text

    def json(self) -> Json:
        return self._response.json()


def _through_gateway(
    session: Requester,
    method: str,
    url: str,
    base_url: str,
    *,
    params: Mapping[str, str | int] | None,
    json: Json,
    headers: Mapping[str, str] | None,
) -> Response:
    """Send via the gateway with redirects off and follow a 3xx by hand, only to youtube.com and
    back through the same gateway, so no hop reaches YouTube from this machine's address."""
    current = url
    for hop in range(MAX_GATEWAY_HOPS + 1):
        target = route_through_gateway(current, base_url)
        if not _is_under(target, base_url):  # never sent anywhere but through the gateway
            raise ScrapetubeError("a gateway request didn't go through the gateway")
        net.check_url(target)
        response = session.request(
            method,
            target,
            timeout=REQUEST_TIMEOUT,
            params=params,
            json=json,
            headers=headers,
            allow_redirects=False,
        )
        _count_bytes(response)
        location = response.headers.get("location")
        if not (300 <= response.status_code < 400 and location):
            if response.url.startswith(base_url):
                return _AtYouTube(response, YOUTUBE_ORIGIN + response.url[len(base_url) :])
            return response
        if hop == MAX_GATEWAY_HOPS:
            raise curl_errors.TooManyRedirects(f"Exceeded {MAX_GATEWAY_HOPS} gateway redirects.")
        current = _redirect_target(current, location)
        if response.status_code == 303 or (
            response.status_code in (301, 302) and method.upper() == "POST"
        ):
            method, json = "GET", None
        params = None  # the Location already carries the query
    raise AssertionError("unreachable")  # pragma: no cover


def _is_under(target: str, base_url: str) -> bool:
    return target == base_url or target.startswith((base_url + "/", base_url + "?"))


def _redirect_target(current: str, location: str) -> str:
    """Where a gateway's 3xx points, rebuilt as `YOUTUBE_ORIGIN` + path + query. A `/sorry/` page
    (any host) or the consent page is a block (ThrottledError); anything but https on youtube.com
    or www.youtube.com, port 443 at most, with no login, is refused (ScrapetubeError)."""
    try:
        parts = urlsplit(urljoin(current, location))
        port = parts.port
    except ValueError:
        raise ScrapetubeError("redirected to a malformed address") from None
    host = (parts.hostname or "").lower()
    if "/sorry/" in parts.path.lower() or host == "consent.youtube.com":
        raise ThrottledError("redirected to YouTube's captcha or consent page")
    if (
        parts.scheme != "https"
        or host not in _YOUTUBE_HOSTS
        or port not in (None, 443)
        or parts.username is not None
        or parts.password is not None
    ):
        raise ScrapetubeError("redirected off YouTube")
    query = f"?{parts.query}" if parts.query else ""
    return f"{YOUTUBE_ORIGIN}{parts.path or '/'}{query}"


# --- one request ---


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
    expect_json: bool = False,
) -> Response:
    """One request, at most MAX_ATTEMPTS attempts, each on a route not yet tried for it while the
    pool holds another (one route alone is reused once its cooldown ends).

    Every attempt draws a candidate from the pool and points the session at it; a gateway rewrites
    the URL instead. The lease is released however the attempt ended, so the gap is measured from
    the end of the request. A throttle, a block (`expect_json`: a body that isn't JSON), a
    connection failure or a bad status cools or skips that route and the next attempt goes
    straight on: the pool's cooldowns and gaps are the wait. Raises PageFailedError after the last
    attempt, RedirectLoopError, net.HostNotAllowedError or RunAborted.
    """
    redirect_loops = 0
    tried: list[Candidate] = []
    last_reason = ""
    all_blocked = True
    for attempt in range(1, MAX_ATTEMPTS + 1):
        pool = get_pool()
        epoch = _skip_epoch
        announcer = WaitAnnouncer()
        try:
            lease = pool.acquire(
                skip_requested=functools.partial(_skipped_since, epoch),
                on_wait=announcer,
                exclude=tuple(tried),
                prefer=_preferred(),
            )
        except BaseException:
            announcer.done(resumed=False)
            raise
        candidate = lease.candidate
        tried.append(candidate)
        try:  # the lease is released however the attempt ends, `announcer.done` raising included
            announcer.done(resumed=True)
            if candidate.base_url:
                session.proxies = {}
                response = _through_gateway(
                    session,
                    method,
                    url,
                    candidate.base_url,
                    params=params,
                    json=json,
                    headers=headers,
                )
            else:
                session.proxies = candidate.proxies
                net.check_url(url)
                response = session.request(
                    method, url, timeout=REQUEST_TIMEOUT, params=params, json=json, headers=headers
                )
                _count_bytes(response)
            _raise_if_blocked(response)
            if expect_json:
                try:
                    response.json()
                except ValueError as exc:
                    # Non-JSON from a JSON-only endpoint: an interstitial past the markers.
                    raise BlockedError(f"innertube returned a non-JSON body ({exc})") from exc
            pool.report_success(candidate)
            _remember_route(candidate)
            summary = pool.route_summary()
            if summary:
                _log("info", summary)
            return response
        except (ThrottledError, BlockedError) as exc:
            last: Exception = exc
            pool.report_blocked(candidate)
        except curl_errors.TooManyRedirects as exc:
            # Raised mid-chain, before any response. Not the candidate's fault (see
            # RedirectLoopError), so its health is left alone, and the retries are bounded.
            redirect_loops += 1
            all_blocked = False
            if redirect_loops >= MAX_REDIRECT_LOOP_ATTEMPTS:
                raise RedirectLoopError(
                    f"{url.split('?')[0]} loops after {redirect_loops} attempt(s)"
                ) from exc
            last = exc
        except (
            curl_errors.ProxyError,
            curl_errors.Timeout,
            curl_errors.SSLError,
            curl_errors.ConnectionError,
        ) as exc:
            # No HTTP answer at all (none in time included): this candidate is unreachable or
            # broken. Try another, now.
            last = exc
            all_blocked = False
            pool.report_connection_failure(candidate)
        except (ScrapetubeError, curl_errors.RequestException) as exc:
            last = exc
            all_blocked = False
        finally:
            lease.release()

        last_reason = _describe(last)
        _log("warn", f"YouTube pushed back ({candidate.label}: {last_reason}); try {attempt}.")
    raise PageFailedError(
        f"{urlsplit(url).path or '/'} failed after {MAX_ATTEMPTS} attempts ({last_reason})",
        all_blocked=all_blocked,
    )


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
        expect_json=True,  # judged inside the attempt, where another route can follow
    )
    return response.json()


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
