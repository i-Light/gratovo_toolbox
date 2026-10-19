#!/usr/bin/env python3
"""Recomputes every channel's derived signals: sponsorship and found emails.

    python tools/derive_signals.py

A one-off backfill. From now on the signals are derived wherever a channel's
videos change (a fetch, a refetch, an R2 download), so this only catches up the
channels stored before that -- in particular `channels.found_emails`, which no
channel has until it runs. Reads only what is already in `gratovo.db`: no
network, no YouTube, nothing sent anywhere. Safe to run again; it only ever
rewrites the three derived columns.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config, pipeline, store  # noqa: E402


def main() -> int:
    conn = store.get_connection(str(config.DB_PATH))
    try:
        store.init_db(conn)
        count = pipeline.derive_all_channel_signals(conn, log=print)
        with_email = conn.execute(
            "SELECT COUNT(*) FROM channels WHERE found_emails IS NOT NULL AND found_emails != '[]'"
        ).fetchone()[0]
    finally:
        conn.close()
    print(f"derived signals for {count} channels; {with_email} have a published email")
    return 0


if __name__ == "__main__":
    sys.exit(main())
