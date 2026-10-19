#!/usr/bin/env python3
"""Import YouTube channels by handle from a JSON file.

Reads a list of handles, runs each one through the pipeline
(`pipeline.run_manual_refetch` -- the same path `search.py --refetch` uses),
stores the results locally in `data/database/gratovo.db`, and pushes them to
Supabase. Going through the shared pipeline function is deliberate: this tool
is run rarely, and it must not carry its own copy of "how to add a channel"
that quietly rots as the pipeline changes.

AUTO-CLEAN GATE
---------------
Unlike a single `search.py --refetch @handle` (a person deliberately naming one
channel), a bulk import runs the standing auto-clean rule on every handle the
moment its channel details land -- exactly what a keyword search does via
`pipeline.apply_auto_clean_gate`. A channel below the subscriber floor is
archived and skipped (no video scrape); one above the ceiling is kept but its
uploads are left for the video-backfill backlog. On by default; pass
`--no-auto-clean` to import everything verbatim.

The rule's numbers come, in increasing precedence, from: built-in defaults
(<50k -> sweep as `inactive`, >3M -> delay); an optional `"auto_clean"` block in
`data/settings.json`; and the `--min-subscribers` / `--max-subscribers` /
`--below-action` / `--above-action` / `--label` flags.

Usage:
    python tools/import_handles.py handles.json
    python tools/import_handles.py --file data/handles.json --keyword "AI Creators"
    python tools/import_handles.py --file handles.json --no-sync
    python tools/import_handles.py --file handles.json --limit 15
    python tools/import_handles.py handles.json --no-auto-clean
    python tools/import_handles.py handles.json --min-subscribers 100000 --label irrelevant
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Add pipeline/ to sys.path so gratovo is importable from tools/ or pipeline/
_tools_dir = Path(__file__).resolve().parent
_pipeline_dir = _tools_dir if (_tools_dir / "gratovo").exists() else _tools_dir.parent
sys.path.insert(0, str(_pipeline_dir))

# Configure UTF-8 encoding across streams for cross-platform stability
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

from gratovo import config, pipeline, r2, store, sync


def extract_handles_from_json(data):
    """Tolerantly extracts a list of handle strings from various JSON shapes.

    Supports:
      - Plain list of strings: ["@handle1", "handle2"]
      - List of objects: [{"handle": "@handle1"}, {"name": "...", "channel": "handle2"}]
      - Dict with nested list: {"handles": [...]}, {"channels": [...]}, etc.
    """
    raw = []

    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                raw.append(item)
            elif isinstance(item, dict):
                for key in ("handle", "channel_handle", "channel", "username", "Handle", "name"):
                    val = item.get(key)
                    if isinstance(val, str) and val.strip():
                        raw.append(val)
                        break
    elif isinstance(data, dict):
        for key in ("handles", "channels", "data", "items", "creators"):
            if key in data and isinstance(data[key], list):
                return extract_handles_from_json(data[key])
        raw.extend(str(k) for k in data.keys())

    # Normalize: strip whitespace, ensure single leading '@', and deduplicate
    seen = set()
    cleaned = []
    for h in raw:
        normalized = "@" + str(h).strip().lstrip("@")
        if normalized != "@" and normalized not in seen:
            seen.add(normalized)
            cleaned.append(normalized)

    return cleaned


_AUTO_CLEAN_DEFAULTS = {
    "enabled": True,
    "min_subscribers": 50_000,
    "max_subscribers": 3_000_000,
    "below_min_action": "sweep",
    "above_max_action": "delay",
    "label": "inactive",
}


def resolve_auto_clean_rule(cfg, args):
    """The `auto_clean` block handed to the pipeline, lowest precedence first:
    built-in defaults, then an optional `"auto_clean"` object in
    `data/settings.json`, then whichever CLI flags were actually passed.
    `--no-auto-clean` forces it off regardless.

    Shaped exactly like the block the app writes into `run_config.json`, so
    `config.Config.auto_clean_*` (and `pipeline.auto_clean_action_for_subscribers`
    through it) read it with no special-casing.
    """
    rule = dict(_AUTO_CLEAN_DEFAULTS)

    from_settings = cfg.settings.get("auto_clean")
    if isinstance(from_settings, dict):
        rule.update({k: v for k, v in from_settings.items() if v is not None})

    overrides = {
        "min_subscribers": args.min_subscribers,
        "max_subscribers": args.max_subscribers,
        "below_min_action": args.below_action,
        "above_max_action": args.above_action,
        "label": args.label,
    }
    rule.update({k: v for k, v in overrides.items() if v is not None})

    if args.no_auto_clean:
        rule["enabled"] = False
    return rule


def load_handles(file_path):
    """Reads and parses the JSON handles file."""
    path = Path(file_path)
    if not path.exists():
        sys.exit(f"Error: Handles file does not exist at: {path}")

    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        sys.exit(f"Error reading JSON file {path}: {exc}")

    handles = extract_handles_from_json(content)
    if not handles:
        sys.exit(f"No valid handles found in {path}.")
    return handles


def main():
    parser = argparse.ArgumentParser(
        description="Import channels from a JSON list of handles into the Gratovo database."
    )
    parser.add_argument(
        "file",
        nargs="?",
        type=Path,
        default=None,
        help="Path to the JSON file containing channel handles.",
    )
    parser.add_argument(
        "--file",
        "-f",
        dest="file_opt",
        type=Path,
        help="Alternative flag for specifying the JSON file path.",
    )
    parser.add_argument(
        "--keyword",
        "-k",
        default="imported_handles",
        help="Keyword label to associate with imported channels (default: 'imported_handles').",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of handles to process in this run.",
    )
    parser.add_argument(
        "--recent-videos",
        type=int,
        default=15,
        help="Number of recent videos to fetch per channel (default: 15).",
    )
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="Keep results local only (do not push to Supabase).",
    )
    parser.add_argument(
        "--no-auto-clean",
        dest="no_auto_clean",
        action="store_true",
        help="Import every handle verbatim -- skip the subscriber gate that "
             "otherwise archives channels below the floor and defers ones "
             "above the ceiling.",
    )
    parser.add_argument(
        "--min-subscribers",
        type=int,
        default=None,
        help="Auto-clean floor. Channels below this are archived and their "
             "videos are never fetched (overrides settings.json / the default).",
    )
    parser.add_argument(
        "--max-subscribers",
        type=int,
        default=None,
        help="Auto-clean ceiling. Channels above this are kept but their "
             "uploads are deferred to the video-backfill backlog.",
    )
    parser.add_argument(
        "--below-action",
        choices=("sweep", "delay", "off"),
        default=None,
        help="What to do with channels below --min-subscribers (default: sweep).",
    )
    parser.add_argument(
        "--above-action",
        choices=("sweep", "delay", "off"),
        default=None,
        help="What to do with channels above --max-subscribers (default: delay).",
    )
    parser.add_argument(
        "--label",
        choices=("haramStuff", "irrelevant", "inactive"),
        default=None,
        help="Rejecting label written on channels the gate sweeps "
             "(default: inactive).",
    )

    args = parser.parse_args()
    target_file = args.file_opt or args.file

    if not target_file:
        parser.print_help()
        print("\nError: Please provide a JSON file containing handles.")
        return 1

    handles = load_handles(target_file)
    if args.limit:
        handles = handles[: args.limit]

    print(f"Loaded {len(handles)} unique handle(s) from {target_file}.")

    cfg = config.load()

    # Resolved before `pipeline.configure` so the pipeline sees it the same way
    # it sees a rule forwarded from the app: an `auto_clean` block on
    # `run_config`, read back through `config.Config.auto_clean_*`. Injected in
    # memory only -- `run_config.json` on disk is the app's file and is left
    # untouched.
    auto_clean_rule = resolve_auto_clean_rule(cfg, args)
    cfg.run_config["auto_clean"] = auto_clean_rule
    if auto_clean_rule["enabled"]:
        print(f"Auto-clean gate: on — below "
              f"{auto_clean_rule['min_subscribers']:,} subs → "
              f"{auto_clean_rule['below_min_action']} "
              f"({auto_clean_rule['label']}), above "
              f"{auto_clean_rule['max_subscribers']:,} subs → "
              f"{auto_clean_rule['above_max_action']}.")
    else:
        print("Auto-clean gate: off (--no-auto-clean) — importing every handle "
              "verbatim.")

    conn = store.get_connection(str(config.DB_PATH))
    store.init_db(conn)

    client = None if args.no_sync else r2.connect(cfg)
    if client:
        print(f"Connected to R2 ({cfg.r2_bucket}).")
    elif args.no_sync:
        print("Running in local-only mode (--no-sync).")
    else:
        print("R2 not configured — results will be stored locally in SQLite.")

    pipeline.configure(cfg)

    keyword = args.keyword.strip() or "imported_handles"
    # Seeded first so `run_manual_refetch` can record every channel under this
    # label; marked done at the end so it never sits in the standing queue.
    store.seed_keywords(conn, [keyword])

    result = {"processed": [], "failed": [], "swept": [], "deferred": []}
    try:
        result = pipeline.run_manual_refetch(
            conn, handles, keyword=keyword, recent_videos=args.recent_videos,
            auto_clean=auto_clean_rule["enabled"],
        )
    except pipeline.SearchBlocked as exc:
        # A throttled IP: stop pulling more handles, but still keep and push
        # everything resolved so far (the `finally` below).
        result = getattr(exc, "partial", result)
        print(f"\nStopped: {exc}\n"
              f"  Everything fetched up to here is saved.")
    finally:
        processed = result["processed"]
        failed = result["failed"]
        swept = result.get("swept", [])
        deferred = result.get("deferred", [])
        # Every channel this keyword actually surfaced and resolved, gate
        # verdict aside -- the same "found" count a keyword run records
        # pre-gate.
        store.mark_keyword_done(
            conn, keyword,
            channels_found=len(processed) + len(swept) + len(deferred))
        print(f"\nImport finished: {len(processed)}/{len(handles)} "
              f"channel(s) fully fetched.")
        if swept or deferred:
            print(f"Auto-clean: {len(swept)} archived, {len(deferred)} deferred "
                  f"to the video-backfill backlog.")
        if failed:
            print(f"Failed/unresolved handles ({len(failed)}): {', '.join(failed)}")

        if client:
            print("\nSharing through R2...")
            try:
                uploaded, _ = sync.push_blobs(conn, client)
                ops = sync.write_segment(conn, client, cfg.worker_id)
                print(f"Shared: {uploaded} object(s) uploaded, {ops} catalog op(s).")
            except sync.R2Error as exc:
                print(f"[sync] Share failed: {exc}. Data is safely stored in local SQLite.")
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())