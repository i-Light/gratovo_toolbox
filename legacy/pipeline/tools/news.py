#!/usr/bin/env python3
"""
Fetches the team's industry feeds and stores what they returned in the LOCAL
database (`data/database/gratovo.db`, tables `news_sources` / `news_items`).

News is public information from public feeds; there is nothing to share, so
every machine fetches its own. The app's News page reads these two tables and
runs `--refresh` on its own whenever the newest stored feed is more than
3 hours old (see `lib/features/news/`), and has a Refresh button.

USAGE
-----
    python tools/news.py                     # what is configured, and how fresh
    python tools/news.py --refresh           # fetch every enabled feed
    python tools/news.py --refresh --dry-run # fetch and parse, store nothing
    python tools/news.py --add https://example.com/feed.xml --niche "creator economy"
    python tools/news.py --disable https://example.com/feed.xml
    python tools/news.py --enable  https://example.com/feed.xml
    python tools/news.py --remove  https://example.com/feed.xml

Requires only the Python standard library. A starting set of feeds is seeded
the first time the table is empty.
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# tools/ sits beside gratovo/, so the package is one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config, feeds, store  # noqa: E402

# How long to keep items whose feed has rolled them off. Long enough that the
# page stays useful for someone who checks it weekly; short enough that the
# table does not grow without bound.
RETENTION_DAYS = 120

# Between feeds. These are ordinary web requests to a handful of hosts, but
# firing them back to back from one IP is the shape of a scraper.
POLITE_DELAY = 1.0

SEED_SOURCES = (
    ("https://www.tubefilter.com/feed/",             "Tubefilter",               "creator economy"),
    ("https://influencermarketinghub.com/feed/",     "Influencer Marketing Hub", "influencer marketing"),
    ("https://www.socialmediatoday.com/feeds/news/", "Social Media Today",       "social media"),
    ("https://www.marketingdive.com/feeds/news/",    "Marketing Dive",           "marketing"),
    ("https://blog.youtube/rss/",                    "YouTube Official Blog",    "youtube"),
)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect():
    conn = store.get_connection(str(config.DB_PATH))
    store.init_db(conn)
    if conn.execute("SELECT COUNT(*) AS n FROM news_sources").fetchone()["n"] == 0:
        for url, title, niche in SEED_SOURCES:
            add_source(conn, url, niche, title, quiet=True)
    return conn


def list_sources(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM news_sources").fetchall()]


def print_status(conn):
    sources = list_sources(conn)
    if not sources:
        print("No feeds configured. Add one with --add <url>.")
        return

    print("\n%-44s %-22s %-8s %s" % ("FEED", "NICHE", "ENABLED", "LAST FETCH"))
    for source in sorted(sources, key=lambda s: (s.get("title") or s["feed_url"])):
        fetched = source.get("last_fetched_at")
        status = source.get("last_fetch_status") or "never"
        when = fetched[:16].replace("T", " ") if fetched else "-"
        print("%-44s %-22s %-8s %s (%s)" % (
            (source.get("title") or source["feed_url"])[:44],
            (source.get("niche") or "-")[:22],
            "yes" if source.get("enabled") else "no",
            when, status,
        ))
        if source.get("last_fetch_error"):
            print("    ! %s" % source["last_fetch_error"])

    n = conn.execute("SELECT COUNT(*) AS n FROM news_items").fetchone()["n"]
    print("\n%d item(s) stored." % n)


def add_source(conn, url, niche, title, quiet=False):
    conn.execute(
        "INSERT INTO news_sources (id, feed_url, niche, title, enabled, added_at) "
        "VALUES (?, ?, ?, ?, 1, ?) "
        "ON CONFLICT(feed_url) DO UPDATE SET enabled=1, "
        "  niche=COALESCE(excluded.niche, news_sources.niche), "
        "  title=COALESCE(excluded.title, news_sources.title)",
        (str(uuid.uuid4()), url, niche, title, _now_iso()))
    conn.commit()
    if not quiet:
        print("Added %s" % url)


def set_enabled(conn, url, enabled):
    conn.execute("UPDATE news_sources SET enabled=? WHERE feed_url=?",
                 (1 if enabled else 0, url))
    conn.commit()
    print("%s %s" % ("Enabled" if enabled else "Disabled", url))


def remove_source(conn, url):
    conn.execute("DELETE FROM news_items WHERE source_id IN "
                 "(SELECT id FROM news_sources WHERE feed_url=?)", (url,))
    conn.execute("DELETE FROM news_sources WHERE feed_url=?", (url,))
    conn.commit()
    print("Removed %s (and its stored items)" % url)


def refresh(conn, dry_run, only_url=None):
    sources = [s for s in list_sources(conn) if s.get("enabled")]
    if only_url:
        sources = [s for s in sources if s["feed_url"] == only_url]
    if not sources:
        print("Nothing enabled to fetch.")
        return 0

    total_new = 0
    for index, source in enumerate(sources):
        url = source["feed_url"]
        label = source.get("title") or url
        try:
            feed_title, items = feeds.load(url)
        except feeds.FeedError as exc:
            # Recorded rather than only printed, so a feed that has quietly
            # started failing is visible rather than just empty.
            print("  ! %-40s %s" % (label[:40], exc))
            if not dry_run:
                _mark_fetched(conn, url, "failed", str(exc))
            continue

        print("  %-40s %d item(s)" % (label[:40], len(items)))
        if dry_run:
            for item in items[:3]:
                print("      - %s" % item["title"][:70])
            continue

        now = _now_iso()
        for item in items:
            conn.execute(
                "INSERT INTO news_items (id, source_id, guid, title, link, summary, author, "
                "  image_url, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(guid) DO UPDATE SET title=excluded.title, link=excluded.link, "
                "  summary=excluded.summary, author=excluded.author, "
                "  image_url=excluded.image_url, published_at=excluded.published_at, "
                "  fetched_at=excluded.fetched_at",
                (str(uuid.uuid4()), source["id"], item["guid"], item["title"],
                 item.get("link"), item.get("summary"), item.get("author"),
                 item.get("image_url"), item.get("published_at"), now))
        total_new += len(items)
        _mark_fetched(conn, url, "success", None,
                      title=source.get("title") or feed_title)

        if index < len(sources) - 1:
            time.sleep(POLITE_DELAY)

    return total_new


def _mark_fetched(conn, url, status, error, title=None):
    conn.execute(
        "UPDATE news_sources SET last_fetched_at=?, last_fetch_status=?, "
        "  last_fetch_error=?, title=COALESCE(?, title) WHERE feed_url=?",
        (_now_iso(), status, error, title, url))
    conn.commit()


def prune(conn, dry_run):
    """Drops items older than [RETENTION_DAYS]."""
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=RETENTION_DAYS)).isoformat()
    if dry_run:
        print("Would delete items published before %s" % cutoff[:10])
        return
    conn.execute("DELETE FROM news_items WHERE published_at IS NOT NULL AND published_at < ?",
                 (cutoff,))
    conn.commit()
    print("Pruned items published before %s" % cutoff[:10])


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true",
                        help="fetch every enabled feed and store what it returns")
    parser.add_argument("--dry-run", action="store_true",
                        help="with --refresh: fetch and parse, store nothing")
    parser.add_argument("--only", metavar="URL",
                        help="with --refresh: just this one feed")
    parser.add_argument("--add", metavar="URL", help="add a feed")
    parser.add_argument("--niche", metavar="NAME",
                        help="with --add: which niche the feed is for")
    parser.add_argument("--title", metavar="NAME",
                        help="with --add: a name for it (otherwise taken from "
                             "the feed on the first fetch)")
    parser.add_argument("--enable", metavar="URL", help="re-enable a feed")
    parser.add_argument("--disable", metavar="URL",
                        help="stop fetching a feed, keeping its stored items")
    parser.add_argument("--remove", metavar="URL",
                        help="delete a feed AND every item it produced")
    args = parser.parse_args()

    conn = connect()
    print("Using %s" % config.DB_PATH)

    try:
        did_something = False
        if args.add:
            add_source(conn, args.add, args.niche, args.title)
            did_something = True
        if args.enable:
            set_enabled(conn, args.enable, True)
            did_something = True
        if args.disable:
            set_enabled(conn, args.disable, False)
            did_something = True
        if args.remove:
            remove_source(conn, args.remove)
            did_something = True

        if args.refresh:
            print("\nFetching%s" % (" (dry run)" if args.dry_run else ""))
            stored = refresh(conn, args.dry_run, args.only)
            if not args.dry_run:
                print("\nStored %d item(s)." % stored)
                prune(conn, args.dry_run)
            did_something = True

        if not did_something:
            print_status(conn)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
