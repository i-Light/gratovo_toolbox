"""The backfill job: channels, videos, backfill and backlog (plan D18).

The old `enrich.py` without its report and its sync. The parts named in `only` run in a fixed
order, each skipped when not named:
- `channels`: refetch channel details that are blank or whose fetch failed;
- `videos`: the same for videos;
- `backfill`: widen each in-scope channel's stored uploads to `months` back;
- `backlog`: read the uploads of every channel in the store still missing them (the catch-up).

The first three spend YouTube API calls against one shared ceiling (`maxApiCalls`, checked before
each batch). How the job ends:
- every part done: `result`, then `end` done (also when the ceiling cut a part short:
  `budgetReached` says so, and the next run continues where this stopped);
- a stop (the app's `stop` line, or stdin closing): `result` with the counts so far, then `end`
  stopped; every batch is committed as it goes;
- blocked, quota, no key or a refused key: no result, `end` failed with that code;
- anything else: `end` failed with `crash`. The message and stderr name the error's kind and
  where it happened, never its text, which can carry a URL with a login in it.
"""

from __future__ import annotations

import contextlib
import dataclasses
import sqlite3
import sys
import traceback
from datetime import UTC, datetime
from typing import Final

from gratovo_pipeline import run_control, store
from gratovo_pipeline.config import Config
from gratovo_pipeline.protocol import (
    BACKFILL_MAX_API_CALLS,
    BACKFILL_MONTHS,
    BackfillData,
    BackfillJob,
    BackfillPart,
    BackfillSaved,
    BacklogStamped,
    Emitter,
    EndErrorCode,
    EndState,
    Start,
    TargetsFilled,
)
from gratovo_pipeline.scrapetube import scrapetube
from gratovo_pipeline.scrapetube.proxy_pool import ProxyPool
from gratovo_pipeline.search import backfill as backlog_step
from gratovo_pipeline.search import signals
from gratovo_pipeline.search.context import Search, SearchBlockedError, Source
from gratovo_pipeline.search.discover import LiveSource
from gratovo_pipeline.search.pacing import Pacer
from gratovo_pipeline.youtube import BATCH_SIZE, YouTubeApi, YouTubeError

DB_NAME: Final = "pipeline.db"
CHANNEL_FIELDS: Final = ("country", "subscribers", "name")
VIDEO_FIELDS: Final = ("view_count", "published_at", "title")
# Ids asked of the free scrape for one channel at most, so a daily uploader can't swallow the whole
# budget on its own.
MAX_BACKFILL_IDS: Final = 200
_ORDER: Final[tuple[BackfillPart, ...]] = ("channels", "videos", "backfill", "backlog")
_NOT_FOUND: Final = "None of those channels are on this computer yet. Search for them first."


class _EndError(Exception):
    def __init__(self, code: EndErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: EndErrorCode = code
        self.message = message


def _failure(error: BaseException) -> _EndError:
    """The `end` error for what stopped the job."""
    if isinstance(error, _EndError):
        return error
    if isinstance(error, SearchBlockedError):
        return _EndError("blocked", "YouTube stopped answering this computer. Try again later.")
    if isinstance(error, YouTubeError):
        return _EndError(error.code, str(error))
    # Kind and frames only: the message itself can carry a proxy URL.
    frames = "".join(traceback.format_tb(error.__traceback__))
    print(f"backfill crashed: {type(error).__name__}\n{frames}", file=sys.stderr, flush=True)
    return _EndError(
        "crash", f"The update stopped on an unexpected error ({type(error).__name__})."
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


class Budget:
    """A hard ceiling on API calls, checked before every batch. `limit` 0 means none.

    The daily quota is shared with the searches, so an update that quietly drains it breaks
    tomorrow's discovery. Running out is a normal, resumable stop: what was fetched is saved, and
    the rows it filled no longer match the queries."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0
        self.reached = False

    def take(self) -> bool:
        if self.limit and self.used >= self.limit:
            self.reached = True
            return False
        self.used += 1
        return True


def _plan_channels(
    conn: sqlite3.Connection, handles: list[str] | None, include_absent: bool, limit: int | None
) -> store.Discovered:
    """{handle: channel_id} worth refetching: blanks fetched before the field's watermark (all of
    them with `include_absent`), and every failed fetch."""
    targets: store.Discovered = {}
    for field in CHANNEL_FIELDS:
        watermark = (
            None if include_absent else store.field_coverage_watermark(conn, "channels", field)
        )
        targets.update(store.get_channels_missing(conn, [field], handles, watermark))
    for handle, channel_id in store.get_channels_failed(conn, handles).items():
        targets.setdefault(handle, channel_id)
    return dict(list(targets.items())[:limit]) if limit else targets


def _plan_videos(
    conn: sqlite3.Connection, handles: list[str] | None, include_absent: bool, limit: int | None
) -> list[tuple[str, str]]:
    """[(video_id, channel_id)] worth refetching, by the same rule."""
    seen: set[str] = set()
    targets: list[tuple[str, str]] = []
    for field in VIDEO_FIELDS:
        watermark = (
            None if include_absent else store.field_coverage_watermark(conn, "videos", field)
        )
        for video_id, channel_id in store.get_videos_needing_refetch(
            conn, [field], handles, watermark
        ):
            if video_id not in seen:
                seen.add(video_id)
                targets.append((video_id, channel_id))
    return targets[:limit] if limit else targets


def _parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _ids_needed_for_window(stored_count: int, oldest: str | None, months: int) -> int:
    """How many ids to ask the free scrape for to reach `months` back, from this channel's own
    upload rate (one more month is a lot of video for a daily uploader and little for a monthly
    one). 0 when the stored uploads already reach that far. Over-asking is cheap: only ids not
    already stored cost quota."""
    target_days = months * 30
    oldest_at = _parse_iso(oldest)
    if oldest_at is None or stored_count < 2:
        return MAX_BACKFILL_IDS
    covered_days = max((datetime.now(UTC) - oldest_at).days, 1)
    if covered_days >= target_days:
        return 0
    per_day = stored_count / covered_days
    # 1.4x headroom: uploads are bursty, and an under-ask leaves the window silently short.
    wanted = int(per_day * target_days * 1.4) + 5
    return min(max(wanted, stored_count + 5), MAX_BACKFILL_IDS)


def _zero_filled() -> TargetsFilled:
    return TargetsFilled(targets=0, filled=0)


@dataclasses.dataclass
class _Tally:
    """The counts the result reports. A part not asked for stays None."""

    channels: TargetsFilled | None = None
    videos: TargetsFilled | None = None
    backfill: BackfillSaved | None = None
    backlog: BacklogStamped | None = None


@dataclasses.dataclass
class _Work:
    conn: sqlite3.Connection
    cfg: Config
    job: BackfillJob
    source: Source
    pacer: Pacer
    emitter: Emitter
    run_id: int
    budget: Budget
    handles: list[str] | None
    scope: store.Discovered  # the channels a backfill widens
    tally: _Tally

    def info(self, text: str) -> None:
        self.emitter.log("info", text)

    def out_of_calls(self, what: str) -> bool:
        """Takes one API call; if the ceiling is reached, says what is left for next time."""
        if self.budget.take():
            return False
        self.info(
            f"Reached the limit of {self.budget.limit} YouTube calls; {what} wait for next time."
        )
        return True


def _channels(work: _Work) -> None:
    result = work.tally.channels = _zero_filled()
    targets = _plan_channels(
        work.conn, work.handles, work.job.get("includeAbsent", False), work.job.get("limit")
    )
    result["targets"] = len(targets)
    items = list(targets.items())
    work.info(f"Channels to refetch: {len(items)}.")
    for start in range(0, len(items), BATCH_SIZE):
        run_control.check_stop()
        if work.out_of_calls(f"{len(items) - start} channel(s)"):
            return
        batch = dict(items[start : start + BATCH_SIZE])
        fetched = work.source.channels(batch)
        # A channel asked for and not returned is marked failed (and retried next time: a
        # failure says nothing about what YouTube holds).
        store.save_channels(work.conn, fetched, batch)
        result["filled"] += len(fetched)
        store.update_run_progress(work.conn, work.run_id, channels_delta=len(fetched))
        work.info(f"Channels: {start + len(batch)} of {len(items)} asked for.")


def _stamp(work: _Work, channel_ids: set[str]) -> None:
    """Moves each channel's stamp, which is what makes the next share upload its object again,
    and derives what the new descriptions change."""
    ids = sorted(channel_ids)
    store.mark_channels_videos_fetched(work.conn, ids)
    signals.derive(work.conn, ids)


def _videos(work: _Work) -> None:
    result = work.tally.videos = _zero_filled()
    targets = _plan_videos(
        work.conn, work.handles, work.job.get("includeAbsent", False), work.job.get("limit")
    )
    result["targets"] = len(targets)
    owner = dict(targets)
    ids = [video_id for video_id, _ in targets]
    work.info(f"Videos to refetch: {len(ids)}.")
    for start in range(0, len(ids), BATCH_SIZE):
        run_control.check_stop()
        if work.out_of_calls(f"{len(ids) - start} video(s)"):
            return
        batch = ids[start : start + BATCH_SIZE]
        fetched = work.source.videos(batch)
        store.save_videos(work.conn, fetched, batch, owner)
        _stamp(work, {owner[video_id] for video_id in batch if video_id in fetched})
        result["filled"] += len(fetched)
        store.update_run_progress(work.conn, work.run_id, videos_delta=len(fetched))
        work.info(f"Videos: {start + len(batch)} of {len(ids)} asked for.")


def _backfill(work: _Work) -> None:
    result = work.tally.backfill = BackfillSaved(channels=0, saved=0)
    months = work.job.get("months", BACKFILL_MONTHS)
    pending: list[str] = []
    owner: dict[str, str] = {}
    sweep = work.source.sweep()
    try:
        for handle, channel_id in work.scope.items():
            run_control.check_stop()
            stored, oldest, _ = store.get_channel_video_span(work.conn, channel_id)
            wanted = _ids_needed_for_window(stored, oldest, months)
            if wanted == 0:
                continue
            known = store.get_existing_video_ids(work.conn, channel_id)
            # A block raises SearchBlockedError, which ends the job: another channel would only
            # be another request to an address YouTube has stopped answering.
            scraped = sweep.recent_video_ids(handle, limit=wanted)
            fresh = [v for v in dict.fromkeys(scraped) if v not in known and v not in owner]
            if fresh:
                result["channels"] += 1
                for video_id in fresh:
                    owner[video_id] = channel_id
                    pending.append(video_id)
                work.info(f"Backfill: {len(fresh)} new upload(s) found for a channel.")
            # These are page requests: a burst from one address is what gets a machine blocked.
            work.pacer.pause("recent_videos_delay")
    finally:
        sweep.close()
    if not pending:
        work.info("Backfill: every channel in scope already covers the window.")
        return
    done = 0
    for start in range(0, len(pending), BATCH_SIZE):
        run_control.check_stop()
        if work.out_of_calls(f"{len(pending) - start} new video(s)"):
            break
        batch = pending[start : start + BATCH_SIZE]
        fetched = work.source.videos(batch)
        store.save_videos(work.conn, fetched, batch, owner)
        result["saved"] += len(fetched)
        store.update_run_progress(work.conn, work.run_id, videos_delta=len(fetched))
        done = start + len(batch)
    # Only a channel with every new upload saved counts as fetched; the rest are asked again.
    left = {owner[video_id] for video_id in pending[done:]}
    finished = {owner[video_id] for video_id in pending[:done]} - left
    if finished:
        _stamp(work, finished)
    work.info(f"Backfill: saved {result['saved']} video(s) across {result['channels']} channel(s).")


def _backlog(work: _Work) -> None:
    result = work.tally.backlog = BacklogStamped(stamped=0)
    store.set_run_kind(work.conn, work.run_id, "catch-up")
    search = Search(work.conn, work.run_id, work.cfg, work.source, work.pacer, work.emitter)
    while True:
        run_control.check_stop()
        read = backlog_step.backfill_missing_videos(search)
        result["stamped"] += read
        if read == 0:
            return


_PARTS = {"channels": _channels, "videos": _videos, "backfill": _backfill, "backlog": _backlog}


def _data(work: _Work) -> BackfillData:
    return {
        "channels": work.tally.channels,
        "videos": work.tally.videos,
        "backfill": work.tally.backfill,
        "backlog": work.tally.backlog,
        "apiCalls": work.budget.used,
        "budgetReached": work.budget.reached,
    }


def run(start: Start, emitter: Emitter, *, source: Source | None = None) -> None:
    """Runs the job and always ends with an `end` line. `source` replaces the configured one
    (tests)."""

    def end(state: EndState, failure: _EndError | None = None) -> None:
        emitter.end(
            state=state,
            at=0,
            found=0,
            kept=0,
            error=(failure.code, failure.message) if failure else None,
        )

    job = start["job"]
    if job["kind"] != "backfill":
        end("failed", _EndError("bad_start", "This is not a backfill job."))
        return
    cfg = Config.from_start(start)
    try:
        conn = _open(cfg)
    except BaseException as error:  # every way out ends with `end`
        end("failed", _failure(error))
        return
    run_id: int | None = None
    try:
        handles: list[str] | None = None
        if "handles" in job:
            known = store.get_channels(conn, job["handles"])
            unknown = len(set(job["handles"]) - set(known))
            if unknown:
                emitter.log("warn", f"{unknown} of those channel(s) aren't on this computer yet.")
            if not known:
                raise _EndError("not_found", _NOT_FOUND)
            handles = list(known)
        pacer = Pacer.off()
        if source is None:
            source, pacer = _live_source(cfg, emitter)
        store.reconcile_stale_runs(conn)
        run_id = store.start_run(conn, 0, "re-enrich")
        work = _Work(
            conn=conn,
            cfg=cfg,
            job=job,
            source=source,
            pacer=pacer,
            emitter=emitter,
            run_id=run_id,
            budget=Budget(job.get("maxApiCalls", BACKFILL_MAX_API_CALLS)),
            handles=handles,
            scope=store.get_channels(conn, handles),
            tally=_Tally(),
        )
        wanted = set(job["only"])
        # A part asked for but not reached (a stop) still reports, with zeros.
        if "channels" in wanted:
            work.tally.channels = _zero_filled()
        if "videos" in wanted:
            work.tally.videos = _zero_filled()
        if "backfill" in wanted:
            work.tally.backfill = BackfillSaved(channels=0, saved=0)
        if "backlog" in wanted:
            work.tally.backlog = BacklogStamped(stamped=0)
        try:
            for part in _ORDER:
                if part in wanted:
                    _PARTS[part](work)
        except KeyboardInterrupt:  # RunAborted too: a stop
            store.finish_run(conn, run_id, "interrupted")
            emitter.result("backfill", _data(work))
            end("stopped")
            return
        store.finish_run(conn, run_id, "done")
        emitter.result("backfill", _data(work))
        end("done")
    except BaseException as error:
        if run_id is not None:
            with contextlib.suppress(sqlite3.Error):
                store.finish_run(conn, run_id, "interrupted")
        end("failed", _failure(error))
    finally:
        conn.close()
