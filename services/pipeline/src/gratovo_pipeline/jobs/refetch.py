"""The refetch job: channels read again by handle (plan D18).

A stub until its task builds it: it ends the job as `failed` (`crash`).
"""

from __future__ import annotations

from gratovo_pipeline.protocol import Emitter, Start


def run(start: Start, emitter: Emitter) -> None:
    emitter.end(state="failed", at=0, found=0, kept=0, error=("crash", "This job isn't built yet."))
