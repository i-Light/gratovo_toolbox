"""The jobs a start line can ask for, one module each (plan D15).

Each module has `run(start, emitter)`, which always ends with an `end` line. A module is imported
only when its job runs, so a search never loads the mail or AWS code.
"""

from __future__ import annotations

from gratovo_pipeline.protocol import Emitter, Start


def run(start: Start, emitter: Emitter) -> None:
    """Runs the job the start line names."""
    kind = start["job"]["kind"]
    if kind == "search":
        from gratovo_pipeline.jobs import search

        search.run(start, emitter)
    elif kind in ("mail.status", "mail.send", "mail.replies", "mail.ack", "mail.cancel"):
        from gratovo_pipeline.jobs import mail

        mail.run(start, emitter)
    elif kind == "video_stats":
        from gratovo_pipeline.jobs import video_stats

        video_stats.run(start, emitter)
    elif kind == "refetch":
        from gratovo_pipeline.jobs import refetch

        refetch.run(start, emitter)
    elif kind == "backfill":
        from gratovo_pipeline.jobs import backfill

        backfill.run(start, emitter)
    else:  # gateways.deploy, gateways.destroy, gateways.test
        from gratovo_pipeline.jobs import gateways

        gateways.run(start, emitter)
