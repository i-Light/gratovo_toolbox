import json
import random
import threading
import time
from typing import Generator

import curl_cffi.requests as requests
from typing_extensions import Literal

from gratovo import config, run_control

# ==========================================
# PACING AND BLOCK HANDLING
# ==========================================
# Every request in this module is an unauthenticated HTML / innertube call to
# youtube.com from a single IP, and one search run makes hundreds of them. Two
# things get a machine blocked, and they are separate problems:
#
#   cadence   a request every N seconds, for the same N every time, is not a
#             pattern a person produces. `_pause` samples the gap instead of
#             reusing it, so no two waits are the same length.
#
#   deafness  far more dangerous. YouTube throttles long before it bans: it
#             starts answering with 429s, or redirects to /sorry/ with a
#             captcha. This module used to neither notice nor care -- nothing
#             checked `status_code`, so a 429 became a JSON parse error, the
#             caller swallowed it as "no results for this channel", and the
#             run carried straight on to the next one at full speed. Being
#             told to slow down and speeding up instead is precisely how a
#             soft throttle becomes a hard block. `_request` now recognises
#             both signals and backs off for progressively longer (capped,
#             see MAX_BACKOFF) -- and keeps retrying rather than giving up:
#             a rate limit is not a run-ending error any more, only a reason
#             to wait. See `_request`'s own doc comment.

# Sampled once per session rather than per request. A client whose User-Agent
# changes between two requests on the same connection is more obviously
# automated than one that never changes it at all; the variety is here so two
# machines on the team do not present as the same client.
#
# These aren't just User-Agent strings -- `curl_cffi`'s `impersonate=` matches
# the whole Chrome TLS/HTTP2 fingerprint (cipher suites, extension order,
# ALPN, ...) for the given version, and generates the full set of headers a
# real install of that version sends (Accept, Accept-Encoding, sec-ch-ua*,
# Sec-Fetch-*, Priority, ...) instead of just the one header the old
# hand-maintained list covered. `requests` couldn't do either -- there is no
# TLS-fingerprint control at that layer, and a Chrome User-Agent with none of
# Chrome's other headers is a weaker disguise than no disguise at all, which
# is exactly the failure a hand-maintained header dict risks drifting into.
#
# Filtered against what the installed curl_cffi actually knows: an unknown
# target fails every request of the session locally ("Impersonating X is not
# supported"), which the retry loop can't tell apart from a real refusal and
# so just burns through every candidate. Listing a version ahead of the
# library is fine -- it starts being used once curl_cffi is upgraded.
_SUPPORTED_TARGETS = {b.value for b in requests.BrowserType}
IMPERSONATE_TARGETS = tuple(
    t for t in ("chrome142", "chrome145", "chrome146", "chrome150")
    if t in _SUPPORTED_TARGETS) or ("chrome",)

# Seconds. Long enough for a slow page, short enough that a hung connection
# does not silently hold a run open forever -- the default is no timeout at
# all, which is how a run ends up looking frozen with nothing in the log.
REQUEST_TIMEOUT = 30

# First backoff in seconds, doubled on each further attempt (capped, see
# MAX_BACKOFF) and then jittered. A network blip deserves a few seconds;
# being throttled deserves minutes, because retrying a throttle quickly is
# just more throttled traffic.
TRANSIENT_BACKOFF = 5.0
THROTTLE_BACKOFF = 45.0

# A connection-level failure (a dead proxy, a refused connection, broken
# TLS) means "try a different candidate now", not "wait out a rate limit" --
# the proxy pool has already cooled that specific candidate down, so the
# very next attempt draws someone else. Short on purpose.
PROXY_FAILOVER_BACKOFF = 3.0

# `requests` already walks up to 30 redirects internally before raising
# `TooManyRedirects`, so each attempt here is expensive on its own -- this
# bounds how many *of those* `_request` will spend on one URL before giving
# up as a `RedirectLoopError` rather than retrying indefinitely like a
# throttle. See that exception's doc comment for why it is bounded at all.
MAX_REDIRECT_LOOP_ATTEMPTS = 2

# The longest a single wait is allowed to grow to, however many attempts have
# already failed. Retrying is unbounded -- there used to be a fixed attempt
# ceiling that raised `BlockedError` and ended the whole run, and the only way
# back in was starting over by hand. A rate limit is not a reason to stop; it
# is a reason to wait, and the only thing that should end a run now is a
# genuine Stop. An uncapped doubling series reaches multi-hour waits within a
# couple dozen attempts, though, which is worse for "come back and check on
# it" than a wait that tops out here and keeps trying at that cadence.
MAX_BACKOFF = 900.0  # 15 minutes

# How often a wait prints its remaining time (`[backoff]`, parsed by
# `search_progress_parser.dart` into the app's countdown/progress bar) and
# checks for a manual "try again now". Frequent enough that the countdown
# looks alive, infrequent enough that the longest wait is a few hundred
# prints, not tens of thousands.
BACKOFF_TICK = 2.0

# Substrings that mean "you have been noticed" rather than "here is a page".
# YouTube serves the interstitial with a 200 as often as not, so the status
# code alone is not enough to go on.
BLOCK_MARKERS = (
    "/sorry/index",
    "detected unusual traffic",
    "unusual traffic from your computer",
    "our systems have detected",
    "recaptcha",
)


class ScrapetubeError(Exception):
    """Anything this module could not get an answer to."""


class ThrottledError(ScrapetubeError):
    """YouTube answered, and the answer was "slow down" -- a 429, or a captcha
    interstitial. Retryable, but only after a long wait."""


class BlockedError(ScrapetubeError):
    """The response itself is unusable in a way retrying the same request
    cannot fix -- currently only `get_ajax_data`'s "innertube answered with
    something that isn't JSON" case. `_request` no longer raises this for an
    ordinary throttle/refusal (429, captcha, 5xx): those are retried
    indefinitely with backoff instead, since a rate limit is a reason to wait,
    not to stop the run -- see `_request`'s doc comment."""


class RedirectLoopError(ScrapetubeError):
    """This exact URL bounces between two others (redirect A -> B -> A -> ...)
    without ever landing on a page -- confirmed, not assumed: the same
    channel's page loops identically over a bare direct connection with no
    proxy involved, so it is YouTube's own routing for this particular
    URL/channel, not a candidate being refused. Unlike `ThrottledError`,
    waiting longer or trying a different candidate cannot fix it -- there is
    nothing to wait out -- so `_request` gives up after a couple of attempts
    instead of retrying forever, and deliberately does NOT subclass
    `BlockedError`: callers treat that one as "this run's IP got noticed,
    stop everything" (see `pipeline.discover_handles`/`get_recent_video_ids`),
    which would be the wrong reaction to one broken channel page -- this
    should end up in the same "log it and move on to the next one" path as
    any other per-item failure instead."""


def _pause(sleep) -> None:
    """Wait between paginated requests, for a length nobody could predict.

    [sleep] is either a number -- treated as a rough middle, sampled across a
    band around it -- or an explicit ``(low, high)`` pair, which is what the
    pipeline passes so the ranges in `data/settings.json` are the ones
    actually honoured.
    """
    if isinstance(sleep, (tuple, list)) and len(sleep) == 2:
        low, high = float(sleep[0]), float(sleep[1])
    else:
        base = float(sleep or 0)
        low, high = base * 0.6, base * 1.9
    high = max(high, low)
    if high <= 0:
        return
    run_control.sleep(random.uniform(max(0.0, low), high))


def _retry_after(response) -> float:
    """The server's own answer to "how long", when it gave one."""
    if response is None:
        return 0.0
    try:
        return max(0.0, float(response.headers.get("Retry-After", "")))
    except (TypeError, ValueError):
        return 0.0


def _raise_if_blocked(response) -> None:
    """Turn a refusal into an exception, whatever shape it arrived in."""
    status = response.status_code
    if status in (429, 403):
        raise ThrottledError(
            "HTTP {} from {}".format(status, response.url.split("?")[0]))
    if status >= 500:
        raise ScrapetubeError(
            "HTTP {} from {}".format(status, response.url.split("?")[0]))

    # A 200 that is really a captcha. Only the head of the body is worth
    # scanning: the markers live in the title/meta, and searching a megabyte
    # of watch-page HTML on every request is not free.
    if "/sorry/" in response.url:
        raise ThrottledError("redirected to YouTube's captcha page")
    # Only against HTML. The markers are words, and the innertube endpoint
    # returns JSON built partly out of video titles and descriptions -- a
    # search whose results happen to mention one of them is a healthy run,
    # not a block, and stopping it would be worse than the problem.
    if "html" in response.headers.get("Content-Type", "").lower():
        if any(marker in response.text[:4096].lower() for marker in BLOCK_MARKERS):
            raise ThrottledError("served the 'unusual traffic' interstitial")


def _skip_wait_requested() -> bool:
    """Whether the app asked the current wait to end early -- the Search
    screen's "Try again now" button, written as `SKIP_WAIT_PATH` by
    `ScraperProcess.requestSkipWait` (`active_search_run_controller.dart`).

    Consumes the file: it is a one-shot nudge, not a standing "never wait"
    flag, so a second wait later in the run still waits its own length unless
    asked again.
    """
    try:
        if config.SKIP_WAIT_PATH.exists():
            config.SKIP_WAIT_PATH.unlink()
            return True
    except OSError:
        pass
    return False


_SKIP_LOCK = threading.Lock()
_SKIP_EPOCH = 0


def _skip_epoch() -> int:
    return _SKIP_EPOCH


def _skip_signalled(since_epoch: int) -> bool:
    """Whether "Try again now" was pressed since [since_epoch] was read from
    [_skip_epoch].

    [_skip_wait_requested] consumes a one-shot file, so with several workers
    waiting at once only the first to look would ever see it -- and the others
    would sit out the wait the person just asked to end. The first one to
    consume it bumps a shared epoch instead, and every waiter compares the
    epoch it started its wait under, so one press ends every wait in progress
    and none that begins afterwards.
    """
    global _SKIP_EPOCH
    if _skip_wait_requested():
        with _SKIP_LOCK:
            _SKIP_EPOCH += 1
    return _SKIP_EPOCH != since_epoch


def _interruptible_wait(total: float, reason: str) -> None:
    """Sleeps [total] seconds in short ticks, printing a countdown the app
    turns into a progress bar (`[backoff]`, parsed by
    `search_progress_parser.dart`) and ending early if the app signals a
    manual retry (see [_skip_signalled]) or the run is stopped
    (`run_control.sleep`).
    """
    remaining = total
    epoch = _skip_epoch()
    while remaining > 0:
        print("[backoff] total={:.0f} remaining={:.0f} reason={}".format(
            total, remaining, reason), flush=True)
        tick = min(BACKOFF_TICK, remaining)
        run_control.sleep(tick)
        remaining -= tick
        if _skip_signalled(epoch):
            print("[step] Retrying now (asked to skip the wait)...",
                  flush=True)
            return


_POOL = None
_POOL_LOCK = threading.Lock()


def get_pool():
    """The process-wide proxy pool, built once on first use from
    `data/settings.json` and kept for the life of the process -- same
    "read once at start" lifetime as `Config` itself. A mid-run settings
    edit doesn't apply until the next run, same as every other pacing knob.

    Built under a lock: parallel search's workers all reach their first
    request at nearly the same moment, and two pools would be two sets of
    cooldowns and two sets of "last used" -- the rotation guarantees only hold
    within one.
    """
    global _POOL
    if _POOL is None:
        with _POOL_LOCK:
            if _POOL is None:
                from gratovo.scrapetube.proxy_pool import ProxyPool
                _POOL = ProxyPool.from_settings(
                    config.load_proxy_settings(), config.load_aws_gateways())
    return _POOL


_get_pool = get_pool


def reset_pool(pool=None) -> None:
    """Drops (or replaces) the process-wide pool. For tests, and for a caller
    that has just changed what the settings files say."""
    global _POOL
    with _POOL_LOCK:
        _POOL = pool


def _announce_route(pool) -> None:
    """Prints the pool's `[route] use ...` line when one is due -- what the
    Search screen turns into "AWS: in use" rather than just "connected"."""
    line = pool.route_line()
    if line:
        print(line, flush=True)


# A wait shorter than this is not worth a line: the pool's gap is a few
# seconds and a person watching the run would rather not read one for each.
_ROTATION_ANNOUNCE_MIN = 1.5


class _WaitAnnouncer:
    """Says why `ProxyPool.acquire` is waiting, in the two shapes the app
    understands.

    A gap wait -- every connection was used moments ago -- is short and
    routine: one `[step]` line, so a run that is pacing itself reads as
    pacing rather than as a hang. A cooldown wait -- nothing is healthy -- can
    be minutes, so it is a `[backoff]` countdown, which the Search screen draws
    as a progress bar with "Try again now". Waiting on another worker's
    request to finish is normal parallel operation and says nothing.
    """

    def __init__(self):
        self._said_gap = False
        self._last_tick = None

    def __call__(self, info):
        from gratovo.scrapetube import proxy_pool
        if info.reason == proxy_pool.WAIT_COOLDOWN:
            now = time.monotonic()
            if self._last_tick is None or now - self._last_tick >= BACKOFF_TICK - 0.01:
                self._last_tick = now
                print("[backoff] total={:.0f} remaining={:.0f} reason=every connection "
                      "is cooling down (back soonest: {})".format(
                          info.total, info.remaining, info.label), flush=True)
        elif (info.reason == proxy_pool.WAIT_GAP and not self._said_gap
              and info.remaining >= _ROTATION_ANNOUNCE_MIN):
            self._said_gap = True
            print("[step] Rotating - every connection was used moments ago; waiting "
                  "{:.0f}s so none is hit twice in quick succession...".format(
                      info.remaining), flush=True)


YOUTUBE_ORIGIN = "https://www.youtube.com"


def _route_through_gateway(url: str, base_url: str) -> str:
    """Rewrites a youtube.com request URL to go through an AWS API Gateway
    HTTP-proxy endpoint instead -- see `tools/aws_gateway_setup.py`. The
    gateway's integration forwards whatever path/query it receives straight
    to `https://www.youtube.com/{that same path}`, so swapping the origin is
    all that is needed; [url] here is always one this module built itself
    (`https://www.youtube.com/...`), never one that came back from a response.

    Case-insensitive on purpose: `get_recent_video_ids` (pipeline.py, what
    backfill uses) passes `channel_url=f"https://www.YOUTUBE.com/{handle}"` --
    an existing, uppercase-domain quirk that a plain `str.startswith` silently
    fails to match. Hostnames are case-insensitive in HTTP, so that URL always
    reached YouTube fine on its own; missing it here just meant those requests
    silently skipped the gateway while the pool still picked (and cooled down)
    a gateway candidate as if they hadn't -- a real gap, not a hypothetical
    one: it's exactly why AWS Gateway candidates were absorbing backoff for
    failures happening over a direct connection.
    """
    if url[:len(YOUTUBE_ORIGIN)].lower() == YOUTUBE_ORIGIN.lower():
        return base_url + url[len(YOUTUBE_ORIGIN):]
    return url


def _request(session: requests.Session, method: str, url: str, **kwargs):
    """One request, retried with escalating (capped) backoff until it
    succeeds or the run is stopped from outside.

    There used to be a fixed attempt ceiling that raised `BlockedError` and
    ended the whole run -- the only way back in was starting over by hand. A
    rate limit is not a reason to stop; it is a reason to wait, so this now
    waits, exactly as long as it takes, and keeps trying until a request
    finally gets through. Only a genuine Stop (a `KeyboardInterrupt`, caught
    well above this) ends the run instead. It prints while it waits
    (`[step]` / `[backoff]`) -- a silent wait is indistinguishable from a
    hang to whoever is watching the run.

    Every attempt also draws a candidate from the proxy pool and points
    [session] at it before firing -- see `proxy_pool.py`. With proxy
    rotation left off (the default) the pool has exactly one candidate,
    direct, so this is a no-op and behaviour is unchanged from before the
    pool existed. A candidate may instead be an AWS API Gateway endpoint
    (`base_url` set) -- those route by rewriting the request URL rather than
    setting `session.proxies`, see `_route_through_gateway`.
    """
    attempt = 0
    redirect_loop_attempts = 0
    while True:
        attempt += 1
        hinted = 0.0
        response = None
        pool = _get_pool()
        # Waits -- announced, and cut short by a Stop -- until the rotation
        # rules allow a candidate: never the previous request's, never one
        # inside its minimum gap, never one another worker is using. See
        # `proxy_pool.py`. Released in the `finally` below the moment the
        # request is over, however it ended, so the gap is measured from the
        # end of this request rather than from when it was chosen.
        epoch = _skip_epoch()
        lease = pool.acquire(skip_requested=lambda: _skip_signalled(epoch),
                             on_wait=_WaitAnnouncer())
        candidate = lease.candidate
        if candidate.base_url:
            session.proxies = {}
            request_url = _route_through_gateway(url, candidate.base_url)
        else:
            session.proxies = candidate.proxies
            request_url = url
        try:
            response = session.request(
                method, request_url, timeout=REQUEST_TIMEOUT, **kwargs)
            _raise_if_blocked(response)
            pool.report_success(candidate)
            _announce_route(pool)
            return response
        except ThrottledError as exc:
            # Only a response that came back can carry a Retry-After, and a
            # ThrottledError is only ever raised about one that did.
            last, base = exc, THROTTLE_BACKOFF
            hinted = _retry_after(response)
            pool.report_blocked(candidate)
        except requests.exceptions.TooManyRedirects as exc:
            # requests raises this itself, mid-redirect-chain, before any
            # response exists for `_raise_if_blocked` to inspect. NOT treated
            # as a candidate-health signal (unlike every other branch here):
            # confirmed by direct reproduction that a genuine redirect loop
            # (YouTube bouncing a specific channel page between two of its own
            # URLs) happens identically over a bare connection with no proxy
            # at all -- so cooling this candidate down would be blaming it for
            # something that was never its fault, and every other candidate
            # would fail the identical way in its turn. Bounded separately
            # from the rest of this function's otherwise-unbounded retrying
            # (see this function's own doc comment) for the same reason: no
            # amount of waiting or rotating breaks a loop that isn't about
            # rate limiting, so retrying it forever would strand a whole run
            # on one broken page instead of the caller skipping it and moving
            # on, which every caller of `get_channel`/`get_search` already
            # does for exactly this shape of failure (see `RedirectLoopError`).
            redirect_loop_attempts += 1
            if redirect_loop_attempts >= MAX_REDIRECT_LOOP_ATTEMPTS:
                raise RedirectLoopError(
                    "{} redirect loop after {} attempt(s): {}".format(
                        url.split("?")[0], redirect_loop_attempts, exc)
                ) from exc
            last, base = exc, THROTTLE_BACKOFF
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectTimeout,
                requests.exceptions.SSLError, requests.exceptions.ConnectionError) as exc:
            # Never got an HTTP response at all -- this candidate itself is
            # unreachable or broken (a dead free proxy, refused connection,
            # a proxy mangling TLS), not YouTube saying no. Cools down fast
            # and briefly: the fix is "try a different candidate", which the
            # very next iteration already does.
            last, base = exc, PROXY_FAILOVER_BACKOFF
            pool.report_connection_failure(candidate)
        except (ScrapetubeError, requests.exceptions.RequestException) as exc:
            last, base = exc, TRANSIENT_BACKOFF
        finally:
            lease.release()

        wait = max(hinted, base * (2 ** min(attempt - 1, 10)))
        wait = min(wait, MAX_BACKOFF)
        wait = min(random.uniform(wait, wait * 1.4), MAX_BACKOFF)
        # candidate.label identifies which connection hit the problem (a
        # specific proxy, an AWS gateway region, or "This machine") -- worth
        # having in the reason text itself since `_raise_if_blocked`'s own
        # message never mentions how the request got there, and this is the
        # only place a person watching the run's log can tell "the eu-west-1
        # gateway is the one getting refused" from "everything is".
        reason = "{}: {}".format(candidate.label, last)
        print("[step] YouTube pushed back ({}) - waiting {:.0f}s before "
              "retry {}...".format(reason, wait, attempt + 1), flush=True)
        _interruptible_wait(wait, reason)

# YouTube now renders channel/search video items as "lockupViewModel" (it replaced
# "videoRenderer" for these grids some time ago), but it still mixes both structures
# depending on the page/experiment, so we look for either one and normalize whichever
# is found (see _normalize_item below). Keeping the old key here too costs nothing and
# protects against YouTube reverting/mixing again.
type_property_map = {
    "videos": ("lockupViewModel", "videoRenderer"),
    "streams": ("lockupViewModel", "videoRenderer"),
    "shorts": ("reelWatchEndpoint", "shortsLockupViewModel")
}

def get_channel(
    channel_id: str = None,
    channel_url: str = None,
    channel_username: str = None,
    limit: int = None,
    sleep: float = 1,
    sort_by: Literal["newest", "oldest", "popular"] = "newest",
    content_type: Literal["videos", "shorts", "streams"] = "videos",
    session: requests.Session = None,
) -> Generator[dict, None, None]:

    """Get videos for a channel.

    Parameters:
        channel_id (``str``, *optional*):
            The channel id from the channel you want to get the videos for.
            If you prefer to use the channel url instead, see ``channel_url`` below.

        channel_url (``str``, *optional*):
            The url to the channel you want to get the videos for.
            Since there is a few type's of channel url's, you can use the one you want
            by passing it here instead of using ``channel_id``.

        channel_username (``str``, *optional*):
            The username from the channel you want to get the videos for.
            Ex. ``LinusTechTips`` (without the @).
            If you prefer to use the channel url instead, see ``channel_url`` above.

        limit (``int``, *optional*):
            Limit the number of videos you want to get.

        sleep (``float`` or ``(low, high)``, *optional*):
            How long to wait between calls to youtube, in order to prevent
            getting blocked. A single number is treated as a rough middle and
            sampled around it; a ``(low, high)`` pair is sampled between the
            two. Never a fixed interval either way -- see ``_pause``, and the
            ranges in `data/settings.json` the pipeline passes down. Defaults
            to 1.

        session (``requests.Session``, *optional*):
            An existing session to reuse, so a caller walking many channels
            keeps one connection and one cookie jar rather than opening a new
            one per channel. The caller owns it and closes it; a session
            created here is closed here.

        sort_by (``str``, *optional*):
            In what order to retrieve to videos. Pass one of the following values.
            ``"newest"``: Get the new videos first.
            ``"oldest"``: Get the old videos first.
            ``"popular"``: Get the popular videos first. Defaults to "newest".

        content_type (``str``, *optional*):
            In order to get content type. Pass one of the following values.
            ``"videos"``: Videos
            ``"shorts"``: Shorts
            ``"streams"``: Streams
    """

    base_url = ""
    if channel_url:
        base_url = channel_url
    elif channel_id:
        base_url = f"https://www.youtube.com/channel/{channel_id}"
    elif channel_username:
        base_url = f"https://www.youtube.com/@{channel_username}"

    url = "{base_url}/{content_type}?view=0&flow=grid".format(
        base_url=base_url,
        content_type=content_type,
    )
    api_endpoint = "https://www.youtube.com/youtubei/v1/browse"
    # Narrower root than the old "contents" (which can match unrelated "contents" keys
    # earlier in the tree, e.g. inside page headers) before we search inside it for
    # sort chips / continuations / video items.
    videos = get_videos(url, api_endpoint, "twoColumnBrowseResultsRenderer", type_property_map[content_type], limit, sleep, sort_by, session)
    for video in videos:
        yield video


def get_playlist(
    playlist_id: str, limit: int = None, sleep: int = 1,
    session: requests.Session = None
) -> Generator[dict, None, None]:

    """Get videos for a playlist.

    Parameters:
        playlist_id (``str``):
            The playlist id from the playlist you want to get the videos for.

        limit (``int``, *optional*):
            Limit the number of videos you want to get.

        sleep (``float`` or ``(low, high)``, *optional*):
            How long to wait between calls to youtube, in order to prevent
            getting blocked. A single number is treated as a rough middle and
            sampled around it; a ``(low, high)`` pair is sampled between the
            two. Never a fixed interval either way -- see ``_pause``, and the
            ranges in `data/settings.json` the pipeline passes down. Defaults
            to 1.

        session (``requests.Session``, *optional*):
            An existing session to reuse, so a caller walking many channels
            keeps one connection and one cookie jar rather than opening a new
            one per channel. The caller owns it and closes it; a session
            created here is closed here.

    """

    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    api_endpoint = "https://www.youtube.com/youtubei/v1/browse"
    videos = get_videos(url, api_endpoint, "playlistVideoListRenderer", "playlistVideoRenderer", limit, sleep, None, session)
    for video in videos:
        yield video


def get_search(
    query: str,
    limit: int = None,
    sleep: int = 1,
    sort_by: Literal["relevance", "upload_date", "view_count", "rating"] = "relevance",
    results_type: Literal["video", "channel", "playlist", "movie"] = "video",
    session: requests.Session = None,
) -> Generator[dict, None, None]:

    """Search youtube and get videos.

    Parameters:
        query (``str``):
            The term you want to search for.

        limit (``int``, *optional*):
            Limit the number of videos you want to get.

        sleep (``float`` or ``(low, high)``, *optional*):
            How long to wait between calls to youtube, in order to prevent
            getting blocked. A single number is treated as a rough middle and
            sampled around it; a ``(low, high)`` pair is sampled between the
            two. Never a fixed interval either way -- see ``_pause``, and the
            ranges in `data/settings.json` the pipeline passes down. Defaults
            to 1.

        session (``requests.Session``, *optional*):
            An existing session to reuse, so a caller walking many channels
            keeps one connection and one cookie jar rather than opening a new
            one per channel. The caller owns it and closes it; a session
            created here is closed here.

        sort_by (``str``, *optional*):
            In what order to retrieve to videos. Pass one of the following values.
            ``"relevance"``: Get the new videos in order of relevance.
            ``"upload_date"``: Get the new videos first.
            ``"view_count"``: Get the popular videos first.
            ``"rating"``: Get videos with more likes first.
            Defaults to "relevance".

        results_type (``str``, *optional*):
            What type you want to search for. Pass one of the following values:
            ``"video"|"channel"|"playlist"|"movie"``. Defaults to "video".

    """

    sort_by_map = {
        "relevance": "A",
        "upload_date": "I",
        "view_count": "M",
        "rating": "E",
    }

    results_type_map = {
        "video": ["B", ("lockupViewModel", "videoRenderer")],
        "channel": ["C", "channelRenderer"],
        "playlist": ["D", "playlistRenderer"],
        "movie": ["E", ("lockupViewModel", "videoRenderer")],
    }

    param_string = f"CA{sort_by_map[sort_by]}SAhA{results_type_map[results_type][0]}"
    url = f"https://www.youtube.com/results?search_query={query}&sp={param_string}"
    api_endpoint = "https://www.youtube.com/youtubei/v1/search"
    videos = get_videos(
        url, api_endpoint, "contents", results_type_map[results_type][1],
        limit, sleep, None, session
    )
    for video in videos:
        yield video



def get_video(
    id: str,
) -> dict:

    """Get a single video.

    Parameters:
        id (``str``):
            The video id from the video you want to get.
    """

    session = get_session()
    url = f"https://www.youtube.com/watch?v={id}"
    html = get_initial_data(session, url)
    client = json.loads(
        get_json_from_html(html, "INNERTUBE_CONTEXT", 2, '"}},') + '"}}'
    )["client"]
    session.headers["X-YouTube-Client-Name"] = "1"
    session.headers["X-YouTube-Client-Version"] = client["clientVersion"]
    # Single-video pages now key off ytInitialPlayerResponse -> videoDetails
    # (used to be ytInitialData -> videoPrimaryInfoRenderer).
    data = json.loads(
        get_json_from_html(html, "var ytInitialPlayerResponse = ", 0, "};") + "}"
    )
    return next(search_dict(data, "videoDetails"))



def get_videos(
    url: str, api_endpoint: str, selector_list: str, selector_item: str, limit: int, sleep: float, sort_by: str = None, session: requests.Session = None
) -> Generator[dict, None, None]:
    # A session passed in belongs to the caller and outlives this generator;
    # one made here does not. The close used to sit at the bottom of the loop
    # body, which meant a caller that stopped early -- every caller with a
    # `limit`, i.e. all of them -- abandoned the generator before reaching it
    # and leaked the connection. `finally` runs on abandonment too.
    owns_session = session is None
    session = session or get_session()
    try:
        is_first = True
        quit_it = False
        count = 0
        while True:
            if is_first:
                html = get_initial_data(session, url)
                client = json.loads(
                    get_json_from_html(html, "INNERTUBE_CONTEXT", 2, '"}},') + '"}}'
                )["client"]
                api_key = get_json_from_html(html, "innertubeApiKey", 3)
                session.headers["X-YouTube-Client-Name"] = "1"
                session.headers["X-YouTube-Client-Version"] = client["clientVersion"]
                data = json.loads(
                    get_json_from_html(html, "var ytInitialData = ", 0, "};") + "}"
                )
                data = next(search_dict(data, selector_list), None)
                next_data = get_next_data(data, sort_by)
                is_first = False
                if sort_by and sort_by != "newest":
                    # Applying the sort chip is a second request to the same
                    # page, not a free re-read of the one just fetched, so it
                    # gets paced like any other.
                    _pause(sleep)
                    continue
            else:
                data = get_ajax_data(session, api_endpoint, api_key, next_data, client)
                next_data = get_next_data(data)
            for result in get_videos_items(data, selector_item):
                try:
                    count += 1
                    yield result
                    if count == limit:
                        quit_it = True
                        break
                except GeneratorExit:
                    quit_it = True
                    break

            if not next_data or quit_it:
                break

            # Sampled, never fixed: `time.sleep(sleep)` here meant a run
            # requested a continuation on exactly the same beat for the whole
            # of a deep search, which is the single clearest tell a scraper
            # leaves behind.
            _pause(sleep)
    finally:
        if owns_session:
            session.close()


def get_session() -> requests.Session:
    """A session that looks like one browser, and keeps looking like it.

    The User-Agent used to be a single hardcoded Chrome 114 string -- a
    browser version years out of date, which is a standing flag on its own,
    paired with a hand-maintained header dict that only ever covered the
    top-level navigation shape (nothing sent Sec-Fetch-* correctly for the
    innertube POSTs, no sec-ch-ua client hints at all). `impersonate=`
    replaces both: it is sampled per session from current Chrome versions
    same as before, but now drives curl's actual TLS/HTTP2 fingerprint for
    that version too, and generates the matching header set itself rather
    than one this module has to keep in sync by hand.

    Proxies are not set here: `_request` assigns `session.proxies` fresh on
    every single call from the proxy pool (`proxy_pool.py`), since a session
    can live across many requests (a whole channel sweep, in the pipeline's
    case) and rotating within that lifetime is the point.
    """
    return requests.Session(impersonate=random.choice(IMPERSONATE_TARGETS))

def get_initial_data(session: requests.Session, url: str) -> str:
    session.cookies.set("CONSENT", "YES+cb", domain=".youtube.com")
    response = _request(session, "GET", url, params={"ucbcb": 1})
    return response.text


def get_ajax_data(
    session: requests.Session,
    api_endpoint: str,
    api_key: str,
    next_data: dict,
    client: dict,
) -> dict:
    data = {
        "context": {"clickTracking": next_data["click_params"], "client": client},
        "continuation": next_data["token"],
    }
    # Origin/Referer are what a browser sends on this exact call. Innertube
    # accepts the request without them, which is why they were missing -- but
    # "accepted" and "unremarkable" are different things, and this is the
    # request a run makes most often.
    response = _request(
        session, "POST", api_endpoint,
        params={"key": api_key}, json=data,
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
        # A non-JSON body from an endpoint that only ever returns JSON means
        # we were served something else -- an interstitial that slipped past
        # the markers above, most likely. Treat it as a refusal rather than
        # crash three frames up with a decode error.
        raise BlockedError(
            "innertube returned a non-JSON body ({})".format(exc))


def get_json_from_html(html: str, key: str, num_chars: int = 2, stop: str = '"') -> str:
    pos_begin = html.find(key) + len(key) + num_chars
    pos_end = html.find(stop, pos_begin)
    return html[pos_begin:pos_end]


def get_next_data(data: dict, sort_by: str = None) -> dict:
    # Youtube, please don't change the order of these
    sort_by_map = {
        "newest": 0,
        "popular": 1,
        "oldest": 2,
    }
    if sort_by and sort_by != "newest":
        endpoint = next(
            search_dict(data, "feedFilterChipBarRenderer"), None)["contents"][sort_by_map[sort_by]]["chipCloudChipRenderer"]["navigationEndpoint"]
    else:
        endpoint = next(search_dict(data, "continuationEndpoint"), None)
    if not endpoint:
        return None
    next_data = {
        "token": endpoint["continuationCommand"]["token"],
        "click_params": {"clickTrackingParams": endpoint["clickTrackingParams"]},
    }

    return next_data


def search_dict(partial: dict, search_key: str) -> Generator[dict, None, None]:
    stack = [partial]
    while stack:
        current_item = stack.pop(0)
        if isinstance(current_item, dict):
            for key, value in current_item.items():
                if key == search_key:
                    yield value
                else:
                    stack.append(value)
        elif isinstance(current_item, list):
            for value in current_item:
                stack.append(value)


def get_videos_items(data: dict, selector) -> Generator[dict, None, None]:
    # `selector` may be a single renderer/view-model key, or a tuple of them to try
    # (YouTube currently mixes "lockupViewModel" and the older "videoRenderer" for the
    # same grids, depending on the page/experiment).
    selectors = selector if isinstance(selector, (tuple, list)) else (selector,)
    for sel in selectors:
        for item in search_dict(data, sel):
            yield normalize_item(item)


def normalize_item(item: dict) -> dict:
    """Make sure the yielded dict always exposes a top-level "videoId" key.

    The classic "videoRenderer"/"playlistVideoRenderer" items already have one.
    Newer "lockupViewModel" items instead carry the id under "contentId" (with
    "contentType" telling us what it points to), so translate that shape here to
    keep the rest of scrapetube (and anyone consuming its output) working the same
    way regardless of which renderer YouTube served this time.
    """
    if not isinstance(item, dict) or "videoId" in item:
        return item

    content_id = item.get("contentId")
    content_type = item.get("contentType")
    if content_id and content_type == "LOCKUP_CONTENT_TYPE_VIDEO":
        item = dict(item)
        item["videoId"] = content_id

    return item