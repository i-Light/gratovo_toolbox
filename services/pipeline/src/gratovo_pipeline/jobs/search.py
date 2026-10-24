"""The search job: every keyword from `startAt` on, one or several at a time, then `end`.

Each keyword is committed as it goes, so `end.at` (the first keyword not done) is where a resume
starts. How the run ends:
- every keyword done: `done`;
- a stop (the app's `stop` line, or stdin closing): `stopped`, keeping what the keyword in
  progress had read;
- blocked, quota, network or a refused key: `failed` with that code, after a `keyword` `failed`
  for the keyword it happened in;
- anything else: `failed` with `crash`. The message and stderr name the error's kind and where
  it happened, never its text, which can carry a URL with a login in it.
"""

from __future__ import annotations

import sqlite3
import sys
import threading
import traceback
from typing import Final, Literal

from gratovo_pipeline import example, parallel, run_control, store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import Emitter, EndErrorCode, EndState, Start
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import ProxyPool
from gratovo_pipeline.search import keyword as keyword_step
from gratovo_pipeline.search.context import Search, SearchBlockedError, Source
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
    if isinstance(error, SearchBlockedError):
        return _EndError("blocked", "YouTube stopped answering this computer. Try again later.")
    if isinstance(error, YouTubeError):
        return _EndError(error.code, str(error))
    # Kind and frames only: the message itself can carry a proxy URL.
    frames = "".join(traceback.format_tb(error.__traceback__))
    print(f"search crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True)
    return _EndError(
        "crash", f"The search stopped on an unexpected error ({type(error).__name__})."
    )


def _live_source(cfg: Config, emitter: Emitter) -> tuple[Source, Pacer]:
    if not cfg.youtube_key:
        raise _EndError("no_youtube_key", "There is no YouTube API key for the team yet.")
    scrapetube.set_log(emitter.log)
    scrapetube.set_pool(
        ProxyPool.from_routes(
            proxy_urls=cfg.proxy_urls,
            gateway_urls=cfg.gateway_urls,
            proxies_enabled=cfg.proxies_enabled,
            include_direct=cfg.include_direct,
        )
    )
    pacer = Pacer(cfg.delay, log=emitter.log)
    api = YouTubeApi(cfg.youtube_key, log=emitter.log)
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

    def end(state: EndState, failure: _EndError | None = None) -> None:
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
        conn = _open(cfg)
        if source is not None:
            pacer = Pacer.off()
        elif cfg.source == "example":
            source, pacer = example.ExampleSource(), Pacer.off()
        else:
            source, pacer = _live_source(cfg, emitter)
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
    emitter.run(total=total, start_at=cfg.start_at)
    settings = {
        "perKeyword": cfg.handles_limit,
        "sortBy": cfg.sort_by,
        "resultsType": cfg.results_type,
        "countries": sorted(cfg.country_filter or ()),
    }
    skip = frozenset(start["job"].get("skip", ()))  # built once, shared by every worker
    failed: dict[int, str] = {}  # the keyword a failure happened in (not those stopped by it)

    def work(worker_conn: sqlite3.Connection, index: int, keyword: str) -> None:
        search = Search(worker_conn, run_id, cfg, source, pacer, emitter, skip)
        store.mark_keyword_started(worker_conn, keyword, cfg.worker, settings)
        emitter.keyword(index=index, total=total, keyword=keyword, state="started")
        try:
            result = keyword_step.process_keyword(search, keyword)
        except KeyboardInterrupt:
            raise
        except BaseException:
            with lock:
                failed[index] = keyword
            raise
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

    def on_done(_index: int, _keyword: str) -> None:
        with lock:
            done = len(results)
        store.update_run_progress(conn, run_id, keywords_done=done)

    items = [(i, cfg.keywords[i]) for i in range(cfg.start_at, total)]
    try:
        parallel.run_keywords(
            items,
            cfg.parallel_workers,
            work,
            on_done,
            connect=lambda: store.get_connection(cfg.data_dir / DB_NAME),
        )
    except KeyboardInterrupt:  # RunAborted too: a stop
        _finish(conn, run_id, results, "interrupted")
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
        _finish(conn, run_id, results, "interrupted")
        end("failed", failure)
        return
    if run_control.stop_requested() and end_at() < total:  # stopped before a keyword began
        _finish(conn, run_id, results, "interrupted")
        end("stopped")
        return
    _finish(conn, run_id, results, "done")
    end("done")


def _finish(
    conn: sqlite3.Connection,
    run_id: int,
    results: dict[int, KeywordResult],
    status: Literal["done", "interrupted"],
) -> None:
    try:
        store.update_run_progress(conn, run_id, keywords_done=len(results))
        store.finish_run(conn, run_id, status)
    finally:
        conn.close()
