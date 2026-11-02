"""The free proxy provider (plan S5, P3-P5): on a fake clock with a fake list and a fake check,
no network. Bans, refill, the remembered list, workers that follow routes, the switch."""

import dataclasses
import json
import re
import threading
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from helpers import changed, start_with

from gratovo_pipeline import net, parallel, run_control, youtube
from gratovo_pipeline.config import Config
from gratovo_pipeline.jobs import search as search_job
from gratovo_pipeline.protocol import BadStartError, parse_start
from gratovo_pipeline.scrapetube import free_proxies, proxy_pool, scrapetube
from gratovo_pipeline.scrapetube.free_proxies import FreeProxyProvider
from gratovo_pipeline.scrapetube.proxy_pool import (
    FREE_COOLDOWN_BASE,
    FREE_COOLDOWN_MAX,
    KIND_FREE,
    Candidate,
    ProxyPool,
    free_candidate,
)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class LowRng:
    def uniform(self, a: float, b: float) -> float:
        return a


@pytest.fixture(autouse=True)
def clean() -> Iterator[None]:
    net.allow_job_hosts("search")
    yield
    net.allow_job_hosts("search")
    run_control.clear_stop()


def url(n: int) -> str:
    return f"http://45.10.0.{n}:8080"


def free(*numbers: int) -> list[Candidate]:
    found = [free_candidate(url(n), 0.0) for n in numbers]
    return [c for c in found if c is not None]


def provider(
    tmp_path: Path, listed: list[str], *, good: set[str] | None = None
) -> tuple[FreeProxyProvider, ProxyPool, Clock, list[int]]:
    clock = Clock()
    pool = ProxyPool.from_routes(clock=clock, sleep=lambda _s: None, rng=LowRng())
    calls = [0]

    def fetch() -> list[str]:
        calls[0] += 1
        return list(listed)

    def check(address: str) -> float | None:
        if good is not None and address not in good:
            return None
        return float(listed.index(address)) + 1 if address in listed else 0.5

    prov = FreeProxyProvider(
        pool, tmp_path, fetch=fetch, check=check, clock=clock, spawn=lambda fn: fn(), min_gap=0.0
    )
    return prov, pool, clock, calls


def free_ids(pool: ProxyPool) -> list[str]:
    return [c.id for c in pool.candidates if c.kind == KIND_FREE]


# --- the pool side ---


def test_a_free_candidate_is_a_proxy_of_kind_free_named_host_port() -> None:
    candidate = free_candidate("socks5://45.10.0.1:1080", 6.0)
    assert candidate is not None
    assert (candidate.kind, candidate.label) == (KIND_FREE, "45.10.0.1:1080")
    assert candidate.proxies == {
        "http": "socks5://45.10.0.1:1080",
        "https": "socks5://45.10.0.1:1080",
    }


def test_a_failing_free_proxy_is_banned_five_minutes_doubling_to_an_hour() -> None:
    clock = Clock()
    pool = ProxyPool(free(1, 2), clock=clock, rng=LowRng())
    bad = pool.candidates[0]
    expected = 0.0
    for n in range(8):
        before = clock.now
        if n % 2:
            pool.report_blocked(bad)
        else:
            pool.report_connection_failure(bad)
        expected = min(FREE_COOLDOWN_BASE * 2**n, FREE_COOLDOWN_MAX)
        assert bad.cooldown_until == before + expected
        # Not reused a second before its time, whoever asks.
        clock.now = bad.cooldown_until - 1
        for _ in range(3):
            lease = pool.acquire()
            assert lease.candidate is not bad
            lease.release()
        clock.now = bad.cooldown_until
    assert expected == 3600.0  # 5, 10, 20, 40, then 60 min and no more


def test_a_success_ends_a_ban_run() -> None:
    clock = Clock()
    pool = ProxyPool(free(1), clock=clock, rng=LowRng())
    only = pool.candidates[0]
    pool.report_blocked(only)
    pool.report_success(only)
    pool.report_blocked(only)
    assert only.cooldown_until == clock.now + FREE_COOLDOWN_BASE


def test_add_and_remove_are_safe_under_leases() -> None:
    pool = ProxyPool([Candidate(id="a", proxies={}, label="a")], rng=LowRng())
    held = pool.acquire()
    extra = free(1, 2, 3)
    assert pool.add_candidates(extra) == 3
    assert pool.add_candidates(extra) == 0  # the same ids are not added twice
    assert pool.remove([held.candidate, extra[0]]) == [extra[0]]  # a leased one stays
    held.release()
    assert pool.remove(list(pool.candidates)) == []  # the pool is never emptied


def test_the_summary_counts_free_proxies_only_when_used() -> None:
    pool = ProxyPool(free(1), rng=LowRng())
    assert pool.route_summary() is None
    pool.acquire().release()
    summary = pool.route_summary()
    assert summary is not None
    assert "1 free" in summary


# --- the provider ---


def test_refill_checks_the_list_fastest_first_and_remembers_it(tmp_path: Path) -> None:
    listed = [url(i) for i in range(1, 8)]
    prov, pool, _clock, _calls = provider(tmp_path, listed, good=set(listed) - {url(2)})
    prov.refill()
    assert free_ids(pool) == [f"45.10.0.{i}:8080" for i in (1, 3, 4, 5, 6, 7)]
    saved = json.loads((tmp_path / "free-proxies.json").read_text(encoding="utf-8"))
    assert saved == {"proxies": [url(i) for i in (1, 3, 4, 5, 6, 7)]}


def test_the_remembered_list_is_tried_first(tmp_path: Path) -> None:
    (tmp_path / "free-proxies.json").write_text(
        json.dumps({"proxies": [url(i) for i in range(50, 62)]}), encoding="utf-8"
    )
    prov, pool, _clock, calls = provider(tmp_path, [url(1)])
    prov.start()
    try:
        assert free_ids(pool)[0] == "45.10.0.50:8080"
        assert len(free_ids(pool)) == 12
        assert calls[0] == 0  # twelve usable: nothing to fetch yet
        assert pool.acquire().candidate.id == "45.10.0.50:8080"
    finally:
        prov.close()


def test_remembered_proxies_are_checked_before_they_are_added(tmp_path: Path) -> None:
    remembered = [url(i) for i in range(50, 62)]
    (tmp_path / "free-proxies.json").write_text(
        json.dumps({"proxies": remembered}), encoding="utf-8"
    )
    alive = set(remembered[:3])
    prov, pool, _clock, calls = provider(tmp_path, [url(1)], good=alive | {url(1)})
    prov.start()
    try:
        assert free_ids(pool)[:3] == [f"45.10.0.{i}:8080" for i in (50, 51, 52)]
        assert "45.10.0.53:8080" not in free_ids(pool)  # it failed its check
        assert calls[0] == 1  # three usable: the list was fetched too
    finally:
        prov.close()


def test_remembered_entries_are_cleaned_too(tmp_path: Path) -> None:
    (tmp_path / "free-proxies.json").write_text(
        json.dumps({"proxies": [url(1), "http://u:p@45.10.0.2:8080", "http://10.0.0.1:80", 7]}),
        encoding="utf-8",
    )
    assert free_proxies.load_remembered(tmp_path) == [url(1)]


def test_the_first_fill_is_capped_lower_and_logs_each_batch(tmp_path: Path) -> None:
    listed = [url(i) for i in range(1, 201)]
    seen: list[str] = []
    lines: list[str] = []

    def check(address: str) -> float | None:
        seen.append(address)
        return None  # none pass: only the try cap ends it

    prov, _pool, _clock, _calls = provider(tmp_path, listed)
    prov._check = check  # pyright: ignore[reportPrivateUsage]
    prov._log_to = lambda _level, text: lines.append(text)  # pyright: ignore[reportPrivateUsage]
    prov.refill(first=True)
    assert len(seen) == free_proxies.FIRST_MAX_CHECKED
    batches = [t for t in lines if t.startswith("Checked ")]
    assert len(batches) == free_proxies.FIRST_MAX_CHECKED // free_proxies.CHECK_PARALLEL
    assert batches[-1] == "Checked 100 of 100 free proxies: 0 work."

    def passes(address: str) -> float | None:
        seen.append(address)
        return 1.0

    seen.clear()
    prov._check = passes  # pyright: ignore[reportPrivateUsage]
    prov.refill(first=True)
    assert len(seen) == 20  # two batches of ten passed 15


def test_checks_run_on_daemon_threads(tmp_path: Path) -> None:
    daemons: list[bool] = []

    def check(_address: str) -> float | None:
        daemons.append(threading.current_thread().daemon)
        return 1.0

    prov, _pool, _clock, _calls = provider(tmp_path, [url(1), url(2)])
    prov._check = check  # pyright: ignore[reportPrivateUsage]
    prov.refill()
    assert daemons == [True, True]


def test_close_ends_a_hung_check_and_nothing_is_logged_after(tmp_path: Path) -> None:
    release = threading.Event()
    entered = threading.Event()
    lines: list[str] = []

    def check(_address: str) -> float | None:
        entered.set()
        release.wait(30)
        return 1.0

    prov, pool, _clock, _calls = provider(tmp_path, [url(1)])
    prov._check = check  # pyright: ignore[reportPrivateUsage]
    prov._log_to = lambda _level, text: lines.append(text)  # pyright: ignore[reportPrivateUsage]
    worker = threading.Thread(target=prov.refill, daemon=True)
    worker.start()
    try:
        assert entered.wait(5)
        prov.close()
        worker.join(5)
        assert not worker.is_alive()  # the refill gave up on the hung check
        assert lines == []
        assert free_ids(pool) == []
        assert prov.tick() is False  # nothing starts once closed
    finally:
        release.set()


def test_a_damaged_remembered_file_is_ignored(tmp_path: Path) -> None:
    (tmp_path / "free-proxies.json").write_text("{not json", encoding="utf-8")
    assert free_proxies.load_remembered(tmp_path) == []


def test_refill_waits_ten_minutes_and_only_when_fewer_than_ten_are_usable(tmp_path: Path) -> None:
    prov, pool, clock, calls = provider(tmp_path, [url(i) for i in range(1, 13)])
    assert prov.tick() is True  # nothing usable: due at once
    assert (calls[0], len(free_ids(pool))) == (1, 12)
    assert prov.tick() is False  # twelve usable
    for candidate in [c for c in pool.candidates if c.kind == KIND_FREE][:4]:
        candidate.cooldown_until = clock.now + 10_000  # banned well past the refill interval
    assert prov.tick() is False  # fewer than 10 usable, but it refilled moments ago
    clock.now += free_proxies.REFILL_EVERY - 1
    assert prov.tick() is False
    clock.now += 1
    assert prov.tick() is True
    assert calls[0] == 2


def test_refill_adds_new_ones_and_drops_those_banned_for_long(tmp_path: Path) -> None:
    listed = [url(i) for i in range(1, 7)]
    prov, pool, clock, _calls = provider(tmp_path, listed)
    prov.refill()
    doomed = next(c for c in pool.candidates if c.kind == KIND_FREE)
    for _ in range(free_proxies.DROP_AFTER_FAILURES):
        pool.report_blocked(doomed)
    listed[:] = [url(7), url(8), *listed[1:]]
    clock.now += free_proxies.REFILL_EVERY
    prov.refill()
    assert doomed not in pool.candidates
    ids = free_ids(pool)
    assert "45.10.0.7:8080" in ids
    assert "45.10.0.8:8080" in ids
    assert len(ids) == 7  # five kept, two new


def test_a_busy_dead_proxy_stays_until_a_later_refill(tmp_path: Path) -> None:
    prov, pool, _clock, _calls = provider(tmp_path, [url(1), url(2)])
    prov.refill()
    lease = pool.acquire()
    for _ in range(free_proxies.DROP_AFTER_FAILURES):
        pool.report_blocked(lease.candidate)
    prov.refill()
    assert lease.candidate in pool.candidates
    lease.release()


def test_a_list_that_cannot_be_fetched_changes_nothing(tmp_path: Path) -> None:
    prov, pool, _clock, _calls = provider(tmp_path, [url(1)])
    prov.refill()

    def broken() -> list[str]:
        raise OSError("offline")

    prov._fetch = broken  # pyright: ignore[reportPrivateUsage]
    prov.refill()
    assert free_ids(pool) == ["45.10.0.1:8080"]


def test_checks_stop_once_enough_have_passed(tmp_path: Path) -> None:
    listed = [url(i) for i in range(1, 101)]
    seen: list[str] = []

    def check(address: str) -> float | None:
        seen.append(address)
        return 1.0

    prov, pool, _clock, _calls = provider(tmp_path, listed)
    prov._check = check  # pyright: ignore[reportPrivateUsage]
    prov.refill()
    assert len(seen) == free_proxies.WANT_GOOD  # three batches of ten
    assert len(free_ids(pool)) == free_proxies.WANT_GOOD


def test_a_second_refill_does_not_start_while_one_runs(tmp_path: Path) -> None:
    started: list[Any] = []
    prov, _pool, _clock, _calls = provider(tmp_path, [url(1)])
    prov._spawn = started.append  # pyright: ignore[reportPrivateUsage]
    assert prov.tick() is True
    assert prov.tick() is False  # the first has not finished
    assert len(started) == 1


# --- the switch ---


def test_the_switch_is_off_by_default_and_the_host_stays_blocked() -> None:
    cfg = Config.from_start(start_with(settings={}))
    assert cfg.free_proxies is False
    net.allow_job_hosts("search", free_proxies=cfg.free_proxies)
    with pytest.raises(net.HostNotAllowedError):
        net.check_url(free_proxies.LIST_URL)


def test_the_switch_opens_the_list_host_for_a_search_only() -> None:
    cfg = Config.from_start(start_with(settings={"freeProxies": {"enabled": True}}))
    assert cfg.free_proxies is True
    net.allow_job_hosts("search", free_proxies=True)
    net.check_url(free_proxies.LIST_URL)
    for kind in ("refetch", "backfill", "mail.send", "gateways.test"):
        net.allow_job_hosts(kind, free_proxies=True)
        with pytest.raises(net.HostNotAllowedError):
            net.check_url(free_proxies.LIST_URL)


def test_the_switch_is_parsed_strictly() -> None:
    ok = changed("settings", {"freeProxies": {"enabled": True}})
    assert parse_start(json.dumps(ok))["settings"].get("freeProxies") == {"enabled": True}
    for bad in ({"enabled": "yes"}, {"enabled": True, "x": 1}, {}):
        with pytest.raises(BadStartError):
            parse_start(json.dumps(changed("settings", {"freeProxies": bad})))


@pytest.mark.parametrize(("on", "starts"), [(False, 0), (True, 1)])
def test_the_provider_starts_only_when_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch, on: bool, starts: int
) -> None:
    started: list[object] = []

    def record(self: FreeProxyProvider) -> None:
        started.append(self)

    monkeypatch.setattr(FreeProxyProvider, "start", record)
    cfg = Config.from_start(
        start_with(
            source="live", settings={"freeProxies": {"enabled": on}}, secrets__youtubeKey="k"
        )
    )
    emitter: Any = SimpleNamespace(log=noop)
    try:
        search_job._live_source(cfg, emitter)  # pyright: ignore[reportPrivateUsage]
    finally:  # _live_source sets process-wide state: put it back
        scrapetube.set_pool(ProxyPool.from_routes())
        scrapetube.set_log(quiet)
        scrapetube.set_wait_sink(None)
    assert len(started) == starts


# --- workers follow routes (P5) ---


def quiet(_level: object, _text: str) -> None: ...


class Conn:
    def close(self) -> None: ...


def noop(*_args: object) -> None: ...


def test_workers_grow_when_more_routes_become_usable() -> None:
    routes = [1]
    lock = threading.Lock()
    running = [0, 0]  # now, most at once
    grown = threading.Event()

    def work(_conn: Conn, position: int, _keyword: str) -> None:
        with lock:
            running[0] += 1
            running[1] = max(running[1], running[0])
        if position == 0:
            routes[0] = 4  # the list refilled while keyword 0 ran
            grown.wait(5)
        else:
            if running[0] >= 3:
                grown.set()
            threading.Event().wait(0.05)
        with lock:
            running[0] -= 1

    done = parallel.run_keywords(
        [(i, f"k{i}") for i in range(10)],
        lambda: routes[0],
        work,
        noop,
        connect=Conn,
    )
    assert done == 10
    assert running[1] >= 3  # it grew past one worker
    assert running[1] <= 4  # and no further than the routes


def test_workers_shrink_to_the_routes_but_never_below_one() -> None:
    routes = [4]
    lock = threading.Lock()
    running = [0]
    late: list[int] = []

    def work(_conn: Conn, position: int, _keyword: str) -> None:
        with lock:
            running[0] += 1
        if position == 0:
            routes[0] = 0  # every route banned
        threading.Event().wait(0.05)
        with lock:
            if position >= 20:
                late.append(running[0])
            running[0] -= 1

    done = parallel.run_keywords(
        [(i, f"k{i}") for i in range(40)],
        lambda: routes[0],
        work,
        noop,
        connect=Conn,
    )
    assert done == 40  # one worker is always left to finish the queue
    assert max(late) == 1


def test_a_fixed_count_still_works() -> None:
    done = parallel.run_keywords([(i, f"k{i}") for i in range(6)], 2, noop, noop, connect=Conn)
    assert done == 6


# --- safety (P4) ---

SCRAPETUBE_DIR = Path(proxy_pool.__file__).parent


def test_certificates_are_never_turned_off_in_the_scrapetube_code() -> None:
    risky = re.compile(r"verify\s*=\s*(False|0|None)|SSL_VERIFY|insecure", re.IGNORECASE)
    for path in sorted(SCRAPETUBE_DIR.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        assert not risky.search(text), f"{path.name} turns certificate checks off"


def test_requests_pass_no_verify_argument(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, Any]] = []

    class Fake:
        def request(self, _method: str, _url: str, **kwargs: Any) -> Any:
            sent.append(kwargs)
            return SimpleNamespace(
                status_code=200, text="", url="https://www.youtube.com/", headers={}, content=b""
            )

        def close(self) -> None: ...

    session = scrapetube.CurlSession()
    session._session = Fake()  # pyright: ignore[reportPrivateUsage,reportAttributeAccessIssue]
    session.proxies = {"https": "http://45.10.0.1:8080"}
    session.request("GET", "https://www.youtube.com/results", timeout=5)
    assert "verify" not in sent[0]  # curl_cffi's default is on
    assert sent[0]["cookies"] == {"CONSENT": "YES+cb"}  # only the consent cookie

    def fake_get(*_args: Any, **kwargs: Any) -> Any:
        sent.append(kwargs)
        return SimpleNamespace(status_code=204)

    monkeypatch.setattr(free_proxies.requests, "get", fake_get)
    assert free_proxies.ping("http://45.10.0.1:8080") is not None
    assert "verify" not in sent[-1]
    assert sent[-1]["cookies"] == {"CONSENT": "YES+cb"}


def proxy_handlers(opener: Any) -> list[object]:
    held = cast("list[object]", opener.handlers)
    return [h for h in held if isinstance(h, urllib.request.ProxyHandler)]


def test_the_data_api_never_uses_a_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        monkeypatch.setenv(name, "http://45.10.0.9:8080")
    # The control: a default opener picks the proxy up from the environment.
    assert proxy_handlers(urllib.request.build_opener()) != []
    # The opener youtube.py builds does not, and neither does the one it holds.
    built = youtube._build_opener()  # pyright: ignore[reportPrivateUsage]
    assert proxy_handlers(built) == []
    assert proxy_handlers(youtube._OPENER) == []  # pyright: ignore[reportPrivateUsage]
    source = Path(youtube.__file__).read_text(encoding="utf-8")
    assert "ProxyHandler({})" in source
    imports = " ".join(re.findall(r"^(?:from|import) .*$", source, re.MULTILINE))
    for name in ("proxy_pool", "scrapetube", "free_proxies", "curl_cffi"):
        assert name not in imports


# --- list entries (P3, after review) ---


@pytest.mark.parametrize(
    ("raw", "protocol", "clean"),
    [
        ("http://45.10.0.1:8080", "http", "http://45.10.0.1:8080"),
        ("SOCKS5://45.10.0.1:1080/", "socks5", "socks5://45.10.0.1:1080"),
        ("socks4://45.10.0.1:1080", None, "socks4://45.10.0.1:1080"),
        ("http://[2a00:1450:4001::1]:3128", "http", "http://[2a00:1450:4001::1]:3128"),
        ("socks5://45.10.0.1:1080", "http", None),  # not the entry's protocol
        ("https://45.10.0.1:443", "https", None),  # not a scheme the pool takes
        ("http://10.0.0.1:8080", "http", None),  # private
        ("http://127.0.0.1:8080", "http", None),
        ("http://203.0.113.5:8080", "http", None),  # documentation range: not global
        ("http://proxy.example:8080", "http", None),  # a name, not an IP literal
        ("http://45.10.0.1", "http", None),  # no port
        ("http://45.10.0.1:0", "http", None),
        ("http://45.10.0.1:70000", "http", None),
        ("http://u:p@45.10.0.1:8080", "http", None),
        ("http://45.10.0.1:8080/x", "http", None),
        ("http://45.10.0.1:8080?a=1", "http", None),
        ("http://45.10.0.1:8080#f", "http", None),
        (None, "http", None),
    ],
)
def test_list_entries_are_rebuilt_from_checked_parts(
    raw: object, protocol: str | None, clean: str | None
) -> None:
    assert free_proxies.clean_entry(raw, protocol) == clean


def entry(proxy: object, protocol: object = "http", **changes: object) -> dict[str, object]:
    return {
        "proxy": proxy,
        "protocol": protocol,
        "alive": True,
        "ssl": True,
        "anonymity": "elite",
        **changes,
    }


def test_bad_list_entries_are_skipped_one_by_one() -> None:
    body = {
        "proxies": [
            entry("http://45.10.0.1:8080"),
            "not an entry",
            entry("http://10.0.0.1:8080"),
            entry("http://45.10.0.2:8080", anonymity="transparent"),
            entry("http://45.10.0.3:8080", alive=False),
            entry("socks5://45.10.0.4:1080", "socks5"),
            entry(12),
        ]
    }
    assert free_proxies.parse_list(json.dumps(body)) == [
        "http://45.10.0.1:8080",
        "socks5://45.10.0.4:1080",
    ]


class Streamed:
    def __init__(self, chunks: list[bytes], status: int = 200) -> None:
        self.status_code = status
        self.chunks = chunks
        self.read = 0
        self.closed = False

    def iter_content(self) -> Iterator[bytes]:
        for chunk in self.chunks:
            self.read += 1
            yield chunk

    def close(self) -> None:
        self.closed = True


def test_the_list_is_read_as_a_stream_and_closed() -> None:
    answer = Streamed([json.dumps({"proxies": [entry("http://45.10.0.1:8080")]}).encode()])
    sent: list[dict[str, Any]] = []

    def get(_url: str, **kwargs: Any) -> Streamed:
        sent.append(kwargs)
        return answer

    net.allow_job_hosts("search", free_proxies=True)
    assert free_proxies.fetch_list(get) == ["http://45.10.0.1:8080"]
    assert answer.closed
    assert sent[0]["stream"] is True
    assert sent[0]["allow_redirects"] is False


@pytest.mark.parametrize(
    ("chunks", "status"),
    [
        ([b"x" * (1024 * 1024)] * 6 + [b"never read"], 200),  # over 5 MB
        ([b"{}"], 503),
    ],
)
def test_a_body_too_big_or_a_bad_status_is_a_failed_fetch(
    tmp_path: Path, chunks: list[bytes], status: int
) -> None:
    answer = Streamed(chunks, status)

    def get(_url: str, **_kwargs: Any) -> Streamed:
        return answer

    net.allow_job_hosts("search", free_proxies=True)
    with pytest.raises(ValueError, match=r"too big|HTTP"):
        free_proxies.fetch_list(get)
    assert answer.closed
    assert answer.read <= 6  # no further than the cap

    clock = Clock()
    pool = ProxyPool.from_routes(free_proxies=True, include_direct=False, clock=clock, rng=LowRng())
    lines: list[str] = []

    def log(_level: object, text: str) -> None:
        lines.append(text)

    prov = FreeProxyProvider(
        pool, tmp_path, fetch=lambda: free_proxies.fetch_list(get), clock=clock, log=log
    )
    prov.refill()
    assert lines == ["The free proxy list could not be fetched."]
    assert pool.candidates == []


# --- the pool with free proxies on (P3, P7, after review) ---


class HighRng:
    def uniform(self, a: float, b: float) -> float:
        return b


def test_jitter_never_takes_a_ban_past_its_cap() -> None:
    clock = Clock()
    pool = ProxyPool(free(1, 2), clock=clock, rng=HighRng())
    bad = pool.candidates[0]
    for _ in range(8):
        pool.report_blocked(bad)
        assert bad.cooldown_until - clock.now <= FREE_COOLDOWN_MAX
    assert bad.cooldown_until - clock.now == FREE_COOLDOWN_MAX
    gateway = Candidate(id="g", proxies={}, base_url="https://g")
    other = ProxyPool([gateway], clock=clock, rng=HighRng())
    for _ in range(8):
        other.report_blocked(gateway)
    assert gateway.cooldown_until - clock.now == proxy_pool.BLOCK_COOLDOWN_MAX
    for _ in range(8):
        other.report_connection_failure(gateway)
    assert gateway.cooldown_until - clock.now == proxy_pool.CONNECTION_COOLDOWN_MAX


def test_free_on_and_direct_off_never_uses_this_machine() -> None:
    clock = Clock()

    def sleep(seconds: float) -> None:
        clock.now += seconds

    pool = ProxyPool.from_routes(
        free_proxies=True, include_direct=False, clock=clock, sleep=sleep, rng=LowRng()
    )
    assert pool.candidates == []  # no route at all: still not this machine
    assert pool.describe()["direct"] is False
    added = free(1, 2)
    pool.add_candidates(added)
    for candidate in added:  # every free proxy banned
        pool.report_blocked(candidate)
    banned_until = min(c.cooldown_until for c in added)
    lease = pool.acquire()  # waits out the ban instead of falling back to this machine
    assert lease.candidate in added
    assert clock.now >= banned_until
    lease.release()
    assert all(c.kind == KIND_FREE for c in pool.candidates)


def test_an_empty_pool_waits_for_the_provider() -> None:
    clock = Clock()
    pool = ProxyPool.from_routes(free_proxies=True, include_direct=False, clock=clock)
    ticks = [0]

    def sleep(seconds: float) -> None:
        clock.now += seconds
        ticks[0] += 1
        if ticks[0] == 3:
            pool.add_candidates(free(7))

    pool._sleep = sleep  # pyright: ignore[reportPrivateUsage]
    assert pool.acquire().candidate.id == "45.10.0.7:8080"
    assert ticks[0] == 3


@pytest.mark.parametrize(
    ("routes", "direct"),
    [
        ({"include_direct": True}, True),  # the owner's switch adds it
        ({"include_direct": False, "proxy_urls": ["http://45.10.0.9:8080"]}, False),
    ],
)
def test_with_free_on_only_the_switch_adds_this_machine(
    routes: dict[str, Any], direct: bool
) -> None:
    pool = ProxyPool.from_routes(free_proxies=True, **routes)
    assert pool.describe()["direct"] is direct


@pytest.mark.parametrize(("free_on", "said"), [(True, "direct off"), (False, "direct on")])
def test_the_run_log_says_where_direct_stands(free_on: bool, said: str) -> None:
    cfg = Config.from_start(
        start_with(
            settings={"freeProxies": {"enabled": free_on}},
            secrets__proxyUrls=[],
            secrets__gatewayUrls=[],
        )
    )
    cfg = dataclasses.replace(cfg, include_direct=False, gateway_urls=(), proxy_urls=())
    # Free on: only the switch adds this machine. Off with no route at all: this machine.
    assert said in cfg.describe()


def test_a_removed_proxy_keeps_its_stats_and_a_late_keyword_lands() -> None:
    clock = Clock()
    pool = ProxyPool(free(1, 2), clock=clock, rng=LowRng())
    gone = pool.candidates[0]
    pool.acquire().release()  # one request through `gone`
    pool.report_blocked(gone)
    clock.now += 100
    assert pool.remove([gone]) == [gone]
    clock.now += 1000  # rest after the removal is not booked
    pool.note_keyword(gone, finished=True, found=4, kept=2)
    deltas = {(d.kind, d.label): d.stats for d in pool.take_route_stats()}
    stats = deltas[(KIND_FREE, "45.10.0.1:8080")]
    assert (stats.requests, stats.blocks, stats.keywords_finished) == (1, 1, 1)
    assert (stats.channels_found, stats.in_range_found) == (4, 2)
    assert stats.seconds_resting == 100
    assert pool.take_route_stats() == []  # taken once
