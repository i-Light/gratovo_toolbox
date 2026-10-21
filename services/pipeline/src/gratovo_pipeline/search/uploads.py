"""Collects channels' upload ids, asks for their details 50 at a time, and stamps each channel
(`videos_fetched_at`, rollups, signals) the moment every one of its videos is saved. A stop or a
kill then costs only the channels in flight, not the sweep's worth of unstamped work."""

from __future__ import annotations

from collections.abc import Sequence

from gratovo_pipeline import store
from gratovo_pipeline.search import signals
from gratovo_pipeline.search.context import Search
from gratovo_pipeline.youtube import BATCH_SIZE


class UploadCollector:
    def __init__(self, search: Search) -> None:
        self._search = search
        self._batch: list[str] = []
        self._owner: dict[str, str] = {}  # video id -> channel id
        self._unsaved: dict[str, int] = {}  # channel id -> its videos not yet saved
        self._api_ok = True
        self.stamped: list[str] = []
        self.videos_saved = 0

    @property
    def touched(self) -> int:
        return len(self._unsaved)

    def add(self, channel_id: str, video_ids: Sequence[str]) -> None:
        ids = [v for v in dict.fromkeys(video_ids) if v not in self._owner]
        self._unsaved[channel_id] = self._unsaved.get(channel_id, 0) + len(ids)
        for video_id in ids:
            self._owner[video_id] = channel_id
            self._batch.append(video_id)
            if len(self._batch) >= BATCH_SIZE:
                self.flush()

    def flush(self) -> None:
        # After an API failure nothing more is asked: the same call would fail the same way,
        # and while unwinding it would replace the error that ended the run.
        if not self._batch or not self._api_ok:
            return
        ids = list(self._batch)
        self._batch.clear()
        try:
            fetched = self._search.source.videos(ids)
        except BaseException:
            self._api_ok = False
            raise
        conn = self._search.conn
        store.save_videos(conn, fetched, ids, self._owner)
        store.update_run_progress(conn, self._search.run_id, videos_delta=len(ids))
        self.videos_saved += len(fetched)
        for video_id in ids:
            self._unsaved[self._owner[video_id]] -= 1

    def stamp_finished(self) -> list[str]:
        """Stamps every channel whose videos are all saved and not yet stamped; returns them."""
        done = [cid for cid, left in self._unsaved.items() if left <= 0 and cid not in self.stamped]
        if done:
            store.mark_channels_videos_fetched(self._search.conn, done)
            signals.derive(self._search.conn, done)
            self.stamped.extend(done)
        return done

    def finish(self) -> list[str]:
        """The tail: saves what is still batched and stamps what that completes. Runs on the stop
        and blocked paths too, so what the sweep collected is kept."""
        try:
            self.flush()
        finally:
            self.stamp_finished()
        return self.stamped
