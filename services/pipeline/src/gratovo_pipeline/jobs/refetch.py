"""The refetch job: channels read again by handle (plan D18), the old `run_manual_refetch`.

Each handle is resolved (a known channel is flagged for a full refresh; an unknown one is looked
up by handle, and an archived one is restored: a person naming a handle overrides the tombstone),
recorded under the job's keyword, and its details read and saved. Then the auto-clean rule, when
the job brings one, decides by subscribers:
- sweep: archived with the rule's label, uploads skipped;
- delay: kept, uploads left to the backlog;
- otherwise (or no rule): the recent uploads are read, saved and stamped.

Each handle that lands is announced as a `channel` line. One that fails alone goes to `failed`
and the run goes on. How the run ends:
- every handle tried: `result`, then `end` `done`;
- a stop between handles: `result` with what landed, then `end` `stopped`;
- blocked, quota, network or a refused key: `failed` with that code and no result;
- anything else: `failed` with `crash` (the error's kind and frames, never its text).
"""

from __future__ import annotations

import sqlite3
import sys
import traceback
from collections.abc import Mapping, Sequence
from typing import Final, Literal, Protocol

from gratovo_pipeline import net, run_control, store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import (
    MAX_FAILED_HANDLES,
    REFETCH_KEYWORD,
    Emitter,
    EndErrorCode,
    EndState,
    Outcome,
    Start,
)
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import ProxyPool
from gratovo_pipeline.search import auto_clean
from gratovo_pipeline.search.context import Search, SearchBlockedError, Source, Sweep
from gratovo_pipeline.search.discover import LiveSource
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.search.uploads import UploadCollector
from gratovo_pipeline.youtube import ChannelInfo, VideoInfo, YouTubeApi, YouTubeError

DB_NAME: Final = "pipeline.db"


class RefetchSource(Source, Protocol):
    """What a search reads from, and the one-handle lookup."""

    def channel_for_handle(self, handle: str) -> tuple[str, ChannelInfo] | None: ...


class _LiveRefetchSource:
    def __init__(self, live: LiveSource, api: YouTubeApi) -> None:
        self._live = live
        self._api = api

    def find_channels(self, keyword: str, *, limit: int) -> dict[str, str]:
        return self._live.find_channels(keyword, limit=limit)

    def sweep(self) -> Sweep:
        return self._live.sweep()

    def channels(self, batch: Mapping[str, str]) -> dict[str, ChannelInfo]:
        return self._live.channels(batch)

    def videos(self, video_ids: Sequence[str]) -> dict[str, VideoInfo]:
        return self._live.videos(video_ids)

    def channel_for_handle(self, handle: str) -> tuple[str, ChannelInfo] | None:
        return self._api.channel_for_handle(handle)


class _EndError(Exception):
    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code
        self.message = message


def _failure(error: BaseException) -> _EndError:
    if isinstance(error, _EndError):
        return error
    if isinstance(error, SearchBlockedError):
        return _EndError("blocked", "YouTube stopped answering this computer. Try again later.")
    if isinstance(error, YouTubeError):
        return _EndError(error.code, str(error))
    # Kind and frames only: the message itself can carry a proxy URL.
    frames = "".join(traceback.format_tb(error.__traceback__))
    print(f"refetch crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True)
    return _EndError(
        "crash", f"The refetch stopped on an unexpected error ({type(error).__name__})."
    )


def _live_source(cfg: Config, emitter: Emitter) -> tuple[RefetchSource, Pacer]:
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
    return _LiveRefetchSource(LiveSource(cfg, api, pacer, log=emitter.log), api), pacer


def _open(cfg: Config) -> sqlite3.Connection:
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    conn = store.get_connection(cfg.data_dir / DB_NAME)
    try:
        store.init_db(conn)
    except store.SchemaTooNewError:
        conn.close()
        raise _EndError("crash", "pipeline.db was written by a newer version of the app.") from None
    return conn


class _Tally:
    def __init__(self) -> None:
        self.processed = 0
        self.swept = 0
        self.deferred = 0
        self.failed: list[str] = []


def _normal(raw: str) -> str:
    return "@" + raw.strip().lstrip("@")


def _announce(search: Search, keyword: str, channel_id: str, outcome: Outcome) -> None:
    row = store.get_channel_row(search.conn, channel_id)
    if row is None:
        return
    search.events.channel(
        keyword=keyword,
        channel_id=channel_id,
        handle=row["handle"],
        name=row["name"] or row["handle"] or channel_id,
        subscribers=auto_clean.parse_subscribers(row["subscribers"]),
        median_views=row["median_views_last_30"],
        country=row["country"],
        outcome=outcome,
    )


def _resolve(
    search: Search, source: RefetchSource, handle: str, keyword: str
) -> tuple[str, ChannelInfo | None] | None:
    """(channel_id, details already read or None), or None when the handle is unknown to
    YouTube. Leaves the channel recorded and flagged for a full refresh."""
    conn = search.conn
    channel_id = store.force_refetch_by_handle(conn, handle)
    info: ChannelInfo | None = None
    if channel_id is None:
        resolved = source.channel_for_handle(handle)
        if resolved is None:
            return None
        channel_id, info = resolved
        # A person naming this handle overrides the tombstone, as re-adding it by hand does.
        store.unarchive(conn, channel_id)
        store.record_channel_discovery(conn, handle, channel_id, keyword)
        store.force_refetch_by_handle(conn, handle)
    else:
        store.record_channel_discovery(conn, handle, channel_id, keyword)
    return channel_id, info


def _refetch_one(
    search: Search,
    source: RefetchSource,
    sweep: Sweep,
    handle: str,
    keyword: str,
    tally: _Tally,
) -> None:
    conn = search.conn
    resolved = _resolve(search, source, handle, keyword)
    if resolved is None:
        search.warn(f"Could not resolve {handle}. Skipping it.")
        tally.failed.append(handle)
        return
    channel_id, info = resolved
    if info is None:
        info = source.channels({handle: channel_id}).get(handle)
    store.save_channels(conn, {handle: info} if info else {}, {handle: channel_id})
    store.update_run_progress(conn, search.run_id, channels_delta=1)
    if info is None:
        search.warn(f"YouTube gave no details for {handle}. Skipping it.")
        tally.failed.append(handle)
        return

    subscribers = auto_clean.parse_subscribers(info["Subscribers"])
    rule = search.cfg.auto_clean
    match auto_clean.action_for(rule, subscribers):
        case "sweep" if rule is not None and subscribers is not None:
            found_via = {"keyword": keyword, "limit": 0, "discovered_at": store.utc_now()}
            store.archive_channel_locally(
                conn,
                channel_id,
                handle,
                rule.label,
                subscribers=subscribers,
                found_via=[found_via],
            )
            search.events.channel(
                keyword=keyword,
                channel_id=channel_id,
                handle=handle,
                name=info["Name"] or handle,
                subscribers=subscribers,
                median_views=None,
                country=info["Country"],
                outcome="swept",
            )
            tally.swept += 1
            return
        case "delay":
            # The refresh flag cleared and videos_fetched_at still empty: the backlog's.
            _announce(search, keyword, channel_id, "delayed")
            tally.deferred += 1
            return
        case _:
            pass

    collector = UploadCollector(search)
    try:
        collector.add(channel_id, sweep.recent_video_ids(handle))
        search.pacer.pause("recent_videos_delay")
    finally:
        collector.finish()
    if channel_id in collector.stamped:
        _announce(search, keyword, channel_id, "kept")
        tally.processed += 1


def run(start: Start, emitter: Emitter, *, source: RefetchSource | None = None) -> None:
    """Runs the job and always ends with an `end` line. `source` replaces the configured one
    (tests)."""
    cfg = Config.from_start(start)
    job = start["job"]
    if job["kind"] != "refetch":  # parse_start guarantees it
        emitter.end(state="failed", at=0, found=0, kept=0, error=("crash", "Not a refetch job."))
        return
    handles = [_normal(h) for h in job["handles"]]
    keyword = job.get("keyword", REFETCH_KEYWORD)
    emitter.log("info", cfg.describe())

    def end(state: EndState, failure: _EndError | None = None) -> None:
        emitter.end(
            state=state,
            at=0,
            found=0,
            kept=0,
            error=(failure.code, failure.message) if failure else None,
        )

    try:
        conn = _open(cfg)
        if source is not None:
            pacer = Pacer.off()
        else:
            source, pacer = _live_source(cfg, emitter)
    except BaseException as error:  # every way out ends with `end`
        end("failed", _failure(error))
        return

    try:
        store.reconcile_stale_runs(conn)
        run_id = store.start_run(conn, len(handles), "re-enrich")
    except BaseException as error:
        conn.close()
        end("failed", _failure(error))
        return

    search = Search(conn, run_id, cfg, source, pacer, emitter)
    tally = _Tally()
    sweep = source.sweep()
    stopped = False
    try:
        for index, handle in enumerate(handles):
            run_control.check_stop()
            if index:
                pacer.pause("found_channels_delay", reason="the next handle")
            try:
                _refetch_one(search, source, sweep, handle, keyword, tally)
            except KeyboardInterrupt, YouTubeError, SearchBlockedError, net.HostNotAllowedError:
                raise
            except Exception as error:  # one handle's trouble must not end the run
                search.warn(f"Couldn't refetch {handle} ({type(error).__name__}). Skipping it.")
                tally.failed.append(handle)
    except KeyboardInterrupt:  # RunAborted too: a stop
        stopped = True
    except BaseException as error:
        failure = _failure(error)
        _finish(conn, run_id, tally, "interrupted")
        end("failed", failure)
        sweep.close()
        return
    sweep.close()
    _finish(conn, run_id, tally, "interrupted" if stopped else "done")
    emitter.result(
        "refetch",
        {
            "processed": tally.processed,
            "swept": tally.swept,
            "deferred": tally.deferred,
            "failedCount": len(tally.failed),
            "failed": tally.failed[:MAX_FAILED_HANDLES],
        },
    )
    end("stopped" if stopped else "done")


def _finish(
    conn: sqlite3.Connection,
    run_id: int,
    tally: _Tally,
    status: Literal["done", "interrupted"],
) -> None:
    try:
        store.update_run_progress(conn, run_id, keywords_done=tally.processed)
        store.finish_run(conn, run_id, status)
    finally:
        conn.close()
