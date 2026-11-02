"""Free proxies for the search job: "Find free proxies" in Settings > Connections (plan S5, P3).

Off by default. When on, the provider fetches ProxyScrape's public list, keeps the anonymous
entries that speak HTTP, SOCKS4 or SOCKS5 and can reach YouTube over TLS, checks each one the way
the app will use it (a 204 from `generate_204` within `CHECK_TIMEOUT` seconds, ten at a time,
certificates checked), and hands the fastest to the pool as candidates of kind "free".

  entries      each list entry is rebuilt from checked parts (`clean_entry`): a known scheme that
               matches the entry's protocol, a public IP literal, a port, and nothing else (no
               login, path or query). A bad entry is skipped on its own; a list body over
               `MAX_LIST_BYTES` is a failed fetch.
  remembered   the last good list is kept in `<data_dir>/free-proxies.json` (addresses only: a
               free proxy has no login) and checked again before it is used on the next run.
  first fill   before the first request, and blocking, so it is capped lower (`FIRST_WANT_GOOD`,
               `FIRST_MAX_CHECKED`) and logs a line per batch.
  refill       when fewer than `MIN_USABLE` free proxies are usable, the list is fetched again, at
               most once every `REFILL_EVERY` seconds, on a background thread. A request never
               waits for it. Dead proxies (banned several times in a row) are dropped, new
               addresses are added after the ones held.
  closing      `close` ends the background work: no batch starts after it, the check threads
               are daemons (they never hold the process open), and no line is logged after it.
  safety       page reads only: the Data API never uses a proxy (youtube.py); only the consent
               cookie is sent; certificate checks are never switched off (tested).

The fetch and the check are injected, so the tests run on a fake clock with no network.
"""

from __future__ import annotations

import ipaddress
import json
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final, cast
from urllib.parse import urlsplit

import curl_cffi.requests as requests

from gratovo_pipeline import net, run_control
from gratovo_pipeline.protocol import LogLevel
from gratovo_pipeline.scrapetube.proxy_pool import (
    DEFAULT_MIN_GAP_SECONDS,
    KIND_FREE,
    Candidate,
    ProxyPool,
    free_candidate,
)

LIST_URL: Final = (
    "https://api.proxyscrape.com/v4/free-proxy-list/get"
    "?request=display_proxies&proxy_format=protocolipport&format=json"
)
PING_URL: Final = "https://www.youtube.com/generate_204"
FILE_NAME: Final = "free-proxies.json"

SCHEMES: Final = frozenset({"http", "socks4", "socks5"})
MAX_LIST_BYTES: Final = 5 * 1024 * 1024  # a bigger list body is a failed fetch
CHECK_TIMEOUT: Final = 10.0  # seconds a proxy has to answer
CHECK_PARALLEL: Final = 10  # checked this many at a time
CHECK_GRACE: Final = 5.0  # seconds past CHECK_TIMEOUT a batch waits for a check that hangs
MIN_USABLE: Final = 10  # refill when fewer free proxies than this are usable
REFILL_EVERY: Final = 600.0  # at most one refill per this many seconds
WANT_GOOD: Final = 30  # a refill stops checking once this many have passed
MAX_CHECKED: Final = 300  # ... or this many have been tried
FIRST_WANT_GOOD: Final = 15  # the first fill blocks the run's start: it stops sooner
FIRST_MAX_CHECKED: Final = 100
MAX_HELD: Final = 100  # the most free proxies the pool holds
DROP_AFTER_FAILURES: Final = 3  # banned this many times in a row: dropped at the next refill
TICK: Final = 5.0  # how often the background loop looks at the clock
JOIN_TICK: Final = 0.2  # how often a batch wait looks for a close or a stop

type Fetcher = Callable[[], list[str]]
type Checker = Callable[[str], float | None]
type Log = Callable[[LogLevel, str], None]


def clean_entry(raw: object, protocol: object = None) -> str | None:
    """`scheme://ip:port` rebuilt from the checked parts of `raw`, or None. The scheme is one of
    SCHEMES (and `protocol`'s, when given), the host a public IP literal, the port 1-65535; a
    login, a path, a query or a fragment refuses the entry."""
    if not isinstance(raw, str) or (protocol is not None and protocol not in SCHEMES):
        return None
    try:
        parts = urlsplit(raw.strip())
        port = parts.port
        host = ipaddress.ip_address(parts.hostname or "")
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if (
        scheme not in SCHEMES
        or (protocol is not None and scheme != protocol)
        or not host.is_global
        or port is None
        or not 1 <= port <= 65535
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        return None
    shown = f"[{host}]" if host.version == 6 else str(host)
    return f"{scheme}://{shown}:{port}"


def parse_list(text: str) -> list[str]:
    """The usable entries of ProxyScrape's JSON: alive, TLS-capable, elite or anonymous, and
    clean (see `clean_entry`). Bad entries are skipped one by one."""
    data: object = json.loads(text)
    top = cast("dict[str, object]", data) if isinstance(data, dict) else {}
    entries = top.get("proxies", [])
    found: list[str] = []
    for entry in cast("list[object]", entries) if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        e = cast("dict[str, Any]", entry)
        if not (e.get("alive") and e.get("ssl") and e.get("anonymity") in ("elite", "anonymous")):
            continue
        clean = clean_entry(e.get("proxy"), e.get("protocol"))
        if clean is not None:
            found.append(clean)
    return found


def fetch_list(get: Callable[..., Any] = requests.get) -> list[str]:
    """ProxyScrape's list, filtered (`parse_list`). Raises on a failed fetch: not a 200, or a
    body over MAX_LIST_BYTES (read no further than that)."""
    net.check_url(LIST_URL)
    response = get(LIST_URL, timeout=30, impersonate="chrome", stream=True, allow_redirects=False)
    try:
        if response.status_code != 200:
            raise ValueError(f"HTTP {response.status_code}")
        body = bytearray()
        for chunk in response.iter_content():
            body += chunk
            if len(body) > MAX_LIST_BYTES:
                raise ValueError("the list is too big")
    finally:
        response.close()
    return parse_list(body.decode("utf-8"))


def ping(proxy: str) -> float | None:
    """Seconds to a 204 from YouTube through `proxy`, or None (any failure means unusable)."""
    start = time.monotonic()
    try:
        net.check_url(PING_URL)
        response = requests.get(
            PING_URL,
            proxies={"http": proxy, "https": proxy},
            timeout=CHECK_TIMEOUT,
            impersonate="chrome",
            cookies={"CONSENT": "YES+cb"},
        )
        ok = response.status_code == 204
    except Exception:
        return None
    return time.monotonic() - start if ok else None


def load_remembered(data_dir: Path) -> list[str]:
    """The last good list, each entry checked as a list entry is; nothing for a missing or
    damaged file."""
    try:
        raw = json.loads((data_dir / FILE_NAME).read_text(encoding="utf-8"))
        items = cast("list[object]", raw["proxies"])
        listed = [clean for item in items if (clean := clean_entry(item))]
    except OSError, ValueError, KeyError, TypeError:
        return []
    return listed[:MAX_HELD]


def remember(data_dir: Path, proxies: list[str]) -> None:
    """Writes the list atomically; a failure to write costs only the head start next run."""
    path = data_dir / FILE_NAME
    temp = path.with_suffix(".tmp")
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        with temp.open("w", encoding="utf-8", newline="\n") as file:
            json.dump({"proxies": proxies[:MAX_HELD]}, file)
        temp.replace(path)
    except OSError:
        return


class FreeProxyProvider:
    def __init__(
        self,
        pool: ProxyPool,
        data_dir: Path,
        *,
        fetch: Fetcher = fetch_list,
        check: Checker = ping,
        clock: Callable[[], float] = time.monotonic,
        spawn: Callable[[Callable[[], None]], None] | None = None,
        log: Log | None = None,
        min_gap: float = DEFAULT_MIN_GAP_SECONDS,
    ) -> None:
        self._pool = pool
        self._dir = data_dir
        self._fetch = fetch
        self._check = check
        self._clock = clock
        self._spawn = spawn or self._thread
        self._log_to: Log = log or _quiet
        self._gap = min_gap
        self._lock = threading.Lock()
        self._log_lock = threading.Lock()  # a line and `close` never cross
        self._last_refill: float | None = None
        self._refilling = False
        self._closed = threading.Event()

    # --- the run's side ---

    def start(self) -> None:
        """Before the first request: checks the remembered list and adds what passes, then fills
        up (here, once, when fewer than MIN_USABLE are usable, so the run does not begin on this
        machine's own address), then keeps watching on a background thread."""
        remembered = load_remembered(self._dir)
        if remembered:
            self._log("info", f"Checking {len(remembered)} free proxies from the last run.")
            good = self._checked(remembered, first=True)
            self._pool.add_candidates([c for u in good if (c := free_candidate(u, self._gap))])
        if self._usable() < MIN_USABLE:
            self._log("info", "Looking for free proxies; the run starts when they are checked.")
            self.refill(first=True)
        if not self._closed.is_set():
            threading.Thread(target=self._watch, name="free-proxies", daemon=True).start()

    def close(self) -> None:
        """Ends the background work. Once this returns, nothing more is logged."""
        with self._log_lock:
            self._closed.set()

    def tick(self) -> bool:
        """Starts a background refill when one is due; True when it did."""
        with self._lock:
            now = self._clock()
            due = (
                not self._closed.is_set()
                and not self._refilling
                and self._usable() < MIN_USABLE
                and (self._last_refill is None or now - self._last_refill >= REFILL_EVERY)
            )
            if not due:
                return False
            self._refilling = True
            self._last_refill = now
        self._spawn(self._background)
        return True

    # --- inside ---

    def _log(self, level: LogLevel, text: str) -> None:
        with self._log_lock:
            if not self._closed.is_set():
                self._log_to(level, text)

    def _usable(self) -> int:
        now = self._clock()
        return sum(
            1 for c in self._pool.candidates if c.kind == KIND_FREE and c.cooldown_until <= now
        )

    def _held(self) -> list[Candidate]:
        return [c for c in self._pool.candidates if c.kind == KIND_FREE]

    def _thread(self, target: Callable[[], None]) -> None:
        threading.Thread(target=target, name="free-proxies-refill", daemon=True).start()

    def _done(self) -> bool:
        return self._closed.is_set() or run_control.stop_requested()

    def _watch(self) -> None:
        while not self._closed.wait(TICK) and not run_control.stop_requested():
            self.tick()

    def _background(self) -> None:
        try:
            self.refill()
        except Exception:
            self._log("warn", "Refilling the free proxies failed; it will try again later.")
        finally:
            with self._lock:
                self._refilling = False

    def refill(self, *, first: bool = False) -> None:
        """Fetches, checks and merges now (blocking: `start` and the background thread use it).
        `first` is the run's first fill: capped lower, a line per batch."""
        with self._lock:
            self._last_refill = self._clock()
        held = {c.id for c in self._held()}
        try:
            listed = self._fetch()
        except Exception:
            self._log("warn", "The free proxy list could not be fetched.")
            return
        fresh = [url for url in dict.fromkeys(listed) if _id(url) not in held]
        good = self._checked(fresh, first=first)
        if self._closed.is_set():
            return
        dead = [c for c in self._held() if c.consecutive_failures >= DROP_AFTER_FAILURES]
        removed = self._pool.remove(dead)
        room = max(0, MAX_HELD - len(self._held()))
        added = self._pool.add_candidates(
            [c for url in good[:room] if (c := free_candidate(url, self._gap))]
        )
        self._log(
            "info",
            f"Free proxies: {added} added, {len(removed)} dropped, {self._usable()} usable.",
        )
        remember(
            self._dir,
            [c.proxies["https"] for c in self._held() if c.cooldown_until <= self._clock()],
        )

    def _checked(self, urls: list[str], *, first: bool = False) -> list[str]:
        """The proxies among `urls` that reach YouTube, fastest first; checks stop at WANT_GOOD
        passes or MAX_CHECKED tries (the first fill: FIRST_WANT_GOOD, FIRST_MAX_CHECKED)."""
        want, most = (FIRST_WANT_GOOD, FIRST_MAX_CHECKED) if first else (WANT_GOOD, MAX_CHECKED)
        limit = min(len(urls), most)
        passed: list[tuple[str, float]] = []
        tried = 0
        while tried < limit and len(passed) < want and not self._done():
            batch = urls[tried : min(tried + CHECK_PARALLEL, limit)]
            tried += len(batch)
            for url, seconds in zip(batch, self._check_batch(batch), strict=True):
                if seconds is not None:
                    passed.append((url, seconds))
            if first:
                self._log("info", f"Checked {tried} of {limit} free proxies: {len(passed)} work.")
        return [url for url, _ in sorted(passed, key=lambda item: item[1])]

    def _check_batch(self, batch: list[str]) -> list[float | None]:
        """One check per proxy, all at once, each on its own daemon thread so a hung check never
        holds the process open. Waits at most CHECK_TIMEOUT + CHECK_GRACE, less on a close or a
        stop; a check that hasn't answered by then counts as failed."""
        results: list[float | None] = [None] * len(batch)

        def one(index: int, url: str) -> None:
            try:
                results[index] = self._check(url)
            except Exception:
                results[index] = None

        threads = [
            threading.Thread(target=one, args=(i, url), name="free-proxies-check", daemon=True)
            for i, url in enumerate(batch)
        ]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + CHECK_TIMEOUT + CHECK_GRACE
        for thread in threads:
            while thread.is_alive() and not self._done() and time.monotonic() < deadline:
                thread.join(JOIN_TICK)
        return [None if t.is_alive() else r for r, t in zip(results, threads, strict=True)]


def _quiet(_level: LogLevel, _message: str) -> None: ...


def _id(url: str) -> str:
    """host:port of a proxy URL, as a Candidate's id (what the pool compares)."""
    candidate = free_candidate(url, 0.0)
    return candidate.id if candidate else url
