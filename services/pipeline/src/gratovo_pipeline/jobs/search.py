"""The search job: every keyword from `startAt` on, one or several at a time, then `end`.

Each keyword is committed as it goes, so `end.at` (the first keyword not done) is where a resume
starts. How the run ends:
- every keyword done: `done`;
- a keyword whose search stopped early (a page failed on every route): a `keyword` `incomplete`
  ("The search stopped early."; its channels are kept, it stays pending), left out of the
  finished ones so `end.at` can point at it, and the run goes on with the next keyword;
  the run itself is not failed. A block never ends a run: it cools its route (scrapetube);
- a stop (the app's `stop` line, or stdin closing): `stopped`, keeping what the keyword in
  progress had read;
- quota (unless `rules.continuous` waits it out) or a refused key: `failed` with that code, after
  a `keyword` `failed` for the keyword it happened in;
- anything else: `failed` with `crash`. The message and stderr name the error's kind and where
  it happened, never its text, which can carry a URL with a login in it.
"""

from __future__ import annotations

import contextlib
import sqlite3
import sys
import threading
import traceback
from collections.abc import Callable
from typing import Final, Literal

from gratovo_pipeline import example, parallel, run_control, store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import Emitter, EndErrorCode, EndState, Start, WaitCounter
from gratovo_pipeline.scrapetube import free_proxies, scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import ProxyPool, RouteDelta
from gratovo_pipeline.search import keyword as keyword_step
from gratovo_pipeline.search.context import Search, Source
from gratovo_pipeline.search.discover import LiveSource
from gratovo_pipeline.search.keyword import KeywordResult
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import YouTubeApi, YouTubeError

DB_NAME: Final = "pipeline.db"


class _EndError(Exception):
    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code
        self.message = message


def _failure(error: BaseException) -> _EndError:
    """The `end` error for what stopped the run."""
    if isinstance(error, _EndError):
        return error
    if isinstance(error, YouTubeError):
        return _EndError(error.code, str(error))
    # Kind and frames only: the message itself can carry a proxy URL.
    frames = "".join(traceback.format_tb(error.__traceback__))
    print(f"search crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True)
    return _EndError(
        "crash", f"The search stopped on an unexpected error ({type(error).__name__})."
    )


def _live_source(
    cfg: Config,
    emitter: Emitter,
    providers: list[free_proxies.FreeProxyProvider] | None = None,
) -> tuple[Source, Pacer]:
    """The live source and its pacer. The free proxy provider, when the switch is on, goes into
    `providers` the moment it exists: the caller closes it however the run ends."""
    if not cfg.youtube_key:
        raise _EndError("no_youtube_key", "There is no YouTube API key for the team yet.")
    scrapetube.set_log(emitter.log)
    pool = ProxyPool.from_routes(
        proxy_urls=cfg.proxy_urls,
        gateway_urls=cfg.gateway_urls,
        proxies_enabled=cfg.proxies_enabled,
        include_direct=cfg.include_direct,
        free_proxies=cfg.free_proxies,
    )
    scrapetube.set_pool(pool)
    if cfg.free_proxies:  # off by default; the list's host is blocked unless the switch is on
        provider = free_proxies.FreeProxyProvider(pool, cfg.data_dir, log=emitter.log)
        if providers is not None:
            providers.append(provider)
        provider.start()
    pacer = Pacer(cfg.delay, log=emitter.log)
    waits = WaitCounter(emitter)  # one `wait` and one `resume` per reason, however many workers
    scrapetube.set_wait_sink(waits)
    api = YouTubeApi(
        cfg.youtube_key,
        log=emitter.log,
        wait_on_network=True,
        wait_on_quota=cfg.continuous,
        waits=waits,
    )
    return LiveSource(cfg, api, pacer, log=emitter.log), pacer


def _open(cfg: Config) -> sqlite3.Connection:
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    conn = store.get_connection(cfg.data_dir / DB_NAME)
    try:
        store.init_db(conn)
    except store.SchemaTooNewError:
        conn.close()
        raise _EndError("crash", "pipeline.db was written by a newer version of the app.") from None
    return conn


def run(start: Start, emitter: Emitter, *, source: Source | None = None) -> None:
    """Runs the job and always ends with an `end` line. `source` replaces the configured one
    (tests)."""
    cfg = Config.from_start(start)
    total = len(cfg.keywords)
    emitter.log("info", cfg.describe())

    results: dict[int, KeywordResult] = {}
    lock = threading.Lock()

    def end_at() -> int:
        return next((i for i in range(cfg.start_at, total) if i not in results), total)

    providers: list[free_proxies.FreeProxyProvider] = []

    def end(state: EndState, failure: _EndError | None = None) -> None:
        for provider in providers:  # closed first: no free-proxy line after `end`
            provider.close()
        with lock:
            found = sum(r.found for r in results.values())
            kept = sum(r.kept for r in results.values())
        emitter.end(
            state=state,
            at=end_at(),
            found=found,
            kept=kept,
            error=(failure.code, failure.message) if failure else None,
        )

    try:
        _run(cfg, start, emitter, source, results, lock, end, providers)
    finally:
        for provider in providers:  # every way out, a crash in `end` itself included
            provider.close()


def _run(
    cfg: Config,
    start: Start,
    emitter: Emitter,
    source: Source | None,
    results: dict[int, KeywordResult],
    lock: threading.Lock,
    end: Callable[..., None],
    providers: list[free_proxies.FreeProxyProvider],
) -> None:
    total = len(cfg.keywords)

    def end_at() -> int:
        return next((i for i in range(cfg.start_at, total) if i not in results), total)

    live_pool = False  # the routes are the run's own pool (not a test's injected source)
    try:
        conn = _open(cfg)
        if source is not None:
            pacer = Pacer.off()
        elif cfg.source == "example":
            source, pacer = example.ExampleSource(), Pacer.off()
        else:
            source, pacer = _live_source(cfg, emitter, providers)
            live_pool = True
    except BaseException as error:  # every way out ends with `end`
        end("failed", _failure(error))
        return

    try:
        store.reconcile_stale_runs(conn)
        store.seed_keywords(conn, cfg.keywords)
        run_id = store.start_run(conn, total)
    except BaseException as error:
        conn.close()
        end("failed", _failure(error))
        return
    scrapetube.reset_total_bytes()
    emitter.run(total=total, start_at=cfg.start_at)
    settings = {
        "perKeyword": cfg.handles_limit,
        "sortBy": cfg.sort_by,
        "resultsType": cfg.results_type,
        "countries": sorted(cfg.country_filter or ()),
    }
    skip = frozenset(start["job"].get("skip", ()))  # built once, shared by every worker
    failed: dict[int, str] = {}  # the keyword a failure happened in (not those stopped by it)

    incomplete = [0]  # keywords whose search stopped early (they stay queued)
    routes_failed = [False]  # a route write failed: said once, and the run carries on

    def save_routes(route_conn: sqlite3.Connection, deltas: list[RouteDelta]) -> None:
        """Adds route counts to the run's rows. A failure never ends the run (S5, P7)."""
        try:
            store.add_run_routes(route_conn, run_id, deltas)
        except Exception as error:
            with contextlib.suppress(sqlite3.Error):  # drop a half-written batch
                route_conn.rollback()
            with lock:
                first, routes_failed[0] = not routes_failed[0], True
            if first:  # the kind only: the text could name a file path
                emitter.log(
                    "warn",
                    f"The route counts couldn't be saved ({type(error).__name__}); "
                    "the run carries on.",
                )

    def note_incomplete() -> None:
        if incomplete[0]:
            emitter.log(
                "info",
                f"{incomplete[0]} keyword(s) stopped early and stay queued for the next run.",
            )

    def work(worker_conn: sqlite3.Connection, index: int, keyword: str) -> None:
        search = Search(worker_conn, run_id, cfg, source, pacer, emitter, skip)
        scrapetube.take_thread_bytes()  # this keyword's traffic starts from zero
        pool = scrapetube.get_pool()
        pool.take_thread_requests()
        store.mark_keyword_started(worker_conn, keyword, cfg.worker, settings)
        emitter.keyword(index=index, total=total, keyword=keyword, state="started")
        # One route per keyword while it is healthy: the search, the sweep and the details.
        with scrapetube.route_affinity():
            result = _search_keyword(search, index, keyword)
            note_routes(worker_conn, pool, result)
            if result is None or not result.complete:
                note_incomplete_keyword(index, keyword, result)
                if result is not None:
                    keyword_step.after_keyword(search)
                return
            with lock:
                results[index] = result
            emitter.keyword(
                index=index,
                total=total,
                keyword=keyword,
                state="done",
                found=result.found,
                kept=result.kept,
            )
            keyword_step.after_keyword(search)

    def note_routes(
        worker_conn: sqlite3.Connection, pool: ProxyPool, result: KeywordResult | None
    ) -> None:
        """The keyword goes to the route that served most of its requests; then every route's
        counts since the last write are added to the run's rows (S5, P7)."""
        counts = pool.take_thread_requests()
        if result is not None and counts:
            main = max(counts, key=lambda candidate: counts[candidate])
            pool.note_keyword(main, finished=result.complete, found=result.found, kept=result.kept)
        save_routes(worker_conn, pool.take_route_stats())

    def _search_keyword(search: Search, index: int, keyword: str) -> KeywordResult | None:
        """The keyword's result; None when a scraper error escaped (the keyword is incomplete)."""
        try:
            return keyword_step.process_keyword(search, keyword)
        except KeyboardInterrupt:
            raise
        except scrapetube.ScrapetubeError as error:
            emitter.log("warn", f'"{keyword}": the search stopped early ({type(error).__name__}).')
            row = store.get_keyword(search.conn, keyword)
            store.mark_keyword_incomplete(
                search.conn, keyword, channels_found=int(row["channels_found"]) if row else 0
            )
            return None
        except BaseException:
            with lock:
                failed[index] = keyword
            raise

    def note_incomplete_keyword(index: int, keyword: str, result: KeywordResult | None) -> None:
        emitter.keyword(
            index=index,
            total=total,
            keyword=keyword,
            state="incomplete",
            found=result.found if result else 0,
            kept=result.kept if result else 0,
            error="The search stopped early.",
        )
        with lock:
            incomplete[0] += 1

    def note_failed_keyword(_index: int, keyword: str, error: BaseException) -> None:
        emitter.log("warn", f'"{keyword}": the keyword failed ({type(error).__name__}).')

    def on_done(_index: int, _keyword: str) -> None:
        with lock:
            done = len(results)
        store.update_run_progress(conn, run_id, keywords_done=done)

    items = [(i, cfg.keywords[i]) for i in range(cfg.start_at, total)]

    def wanted_workers() -> int:
        """One worker per usable route, up to the cap: re-counted between keywords (S5, P5)."""
        if not live_pool:
            return cfg.parallel_workers
        return parallel.worker_count(
            enabled=cfg.parallel_enabled,
            max_workers=cfg.parallel_max,
            rotating_connections=scrapetube.get_pool().usable_count(),
        )

    try:
        parallel.run_keywords(
            items,
            wanted_workers,
            work,
            on_done,
            connect=lambda: store.get_connection(cfg.data_dir / DB_NAME),
            quota_fatal=not cfg.continuous,
            on_failed=note_failed_keyword,
        )
    except KeyboardInterrupt:  # RunAborted too: a stop
        # "stopped", not "interrupted": the person paused it, so the history shows a pause, not a
        # failure (plan step 5). A failure or a killed process stays "interrupted".
        note_incomplete()
        _finish(conn, run_id, results, "stopped", save_routes)
        end("stopped")
        return
    except BaseException as error:
        failure = _failure(error)
        with lock:
            failed_now = sorted(failed.items())
        for index, keyword in failed_now:
            emitter.keyword(
                index=index, total=total, keyword=keyword, state="failed", error=failure.message
            )
        _finish(conn, run_id, results, "interrupted", save_routes)
        end("failed", failure)
        return
    if run_control.stop_requested() and end_at() < total:  # stopped before a keyword began
        _finish(conn, run_id, results, "stopped", save_routes)
        end("stopped")
        return
    note_incomplete()
    _finish(conn, run_id, results, "done", save_routes)
    end("done")


def _finish(
    conn: sqlite3.Connection,
    run_id: int,
    results: dict[int, KeywordResult],
    status: Literal["done", "stopped", "interrupted"],
    save_routes: Callable[[sqlite3.Connection, list[RouteDelta]], None],
) -> None:
    try:
        store.update_run_progress(
            conn, run_id, keywords_done=len(results), bytes_downloaded=scrapetube.total_bytes()
        )
        save_routes(conn, scrapetube.get_pool().take_route_stats())
        store.finish_run(conn, run_id, status)
    finally:
        conn.close()
