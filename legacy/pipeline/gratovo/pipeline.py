"""Discovery and fetching — the part that actually talks to YouTube.

The function bodies here are carried over unchanged from the previous
`search.py`, because they encode hard-won knowledge about YouTube's response
shapes that is not worth re-deriving. What changed is everything around them:
they used to read a dozen module-level globals assembled at import time, which
meant importing the module ran configuration, and configuration could not be
varied without editing the file. Now a single [configure] call injects a
[Config], and the module has no import-time side effects at all.

QUOTA NOTE (YouTube Data API v3):
  - Queries per day: 10,000       - Search per day: 100
  - Video batch stats per day: 10,000
  Discovery does NOT spend quota — `discover_handles` and `get_recent_video_ids`
  go through scrapetube (HTML), not the API. Only `get_channels_data` and
  `get_videos_data` spend it, and both batch up to 50 ids per call, so even
  hundreds of keywords stays cheap.
"""

from __future__ import annotations

import random
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from gratovo import config, found_emails, run_control, store

# Set by configure(). Module-level rather than threaded through every call
# because the whole module serves exactly one run at a time.
CFG = None
YOUTUBE = None
scrapetube = None


class SearchBlocked(RuntimeError):
    """YouTube has stopped answering this machine, and waiting did not help.

    Raised in place of `scrapetube.BlockedError` so `search.py` can catch it
    without importing scrapetube -- it deliberately does not, which is what
    lets `--status` and `--push-only` run on a machine with nothing installed
    but Python (see `configure`).

    The only correct response is to stop making requests. A run that keeps
    going after this lengthens the block instead of working around it.
    """


def configure(cfg):
    """Binds this module to a resolved [Config] and builds the API client.

    `googleapiclient` and `scrapetube` are imported HERE rather than at module
    top level, on purpose. Only searching needs them; checking status, pushing
    already-collected data, and importing a database do not. Keeping them out
    of the import path means `--status` and `--push-only` work on a machine
    with nothing installed but Python — which is exactly the machine someone is
    using when they are trying to work out why syncing is broken.
    """
    global CFG, YOUTUBE, scrapetube
    from googleapiclient.discovery import build
    from gratovo import scrapetube as _scrapetube
    scrapetube = _scrapetube

    if not cfg.youtube_api_key:
        raise SystemExit(
            f"YOUTUBE_API_KEY is not set.\n"
            f"Copy {config.DATA_DIR / '.env.example'} to {config.ENV_PATH} "
            f"and fill in your own key."
        )
    CFG = cfg
    YOUTUBE = build("youtube", "v3", developerKey=cfg.youtube_api_key)


# ==========================================
# PROGRESS
# ==========================================
# Everything a watcher needs to know *while* a keyword is in flight goes
# through here, on one prefix.
#
# The Flutter app reads this process' stdout line by line and has no other
# progress protocol (see `SearchLaunchResult`'s doc comment). Before these
# lines existed the app printed a handful of summaries per keyword -- all of
# them AFTER the slow part they summarised -- so a run that was scraping
# steadily for two minutes looked, from the app, exactly like a run that had
# hung. `[step]` lines are emitted *before* each wait, not after it, which is
# the whole point: they name what is being waited on.
#
# `flush=True` on every one of them. Python block-buffers stdout when it is a
# pipe rather than a console (8 KB at a time), which meant the app received
# nothing at all until the buffer filled or the process exited -- the single
# biggest reason a run looked dead until it dropped its results at the end.
def step(message):
    print(f"[step] {message}", flush=True)


# ==========================================
# SPONSORSHIP DETECTION
# ==========================================
# A plain keyword/regex pass over each channel's already-stored video
# descriptions -- no network, no YouTube client, nothing that needs
# `configure()` to have run. `store.py` only holds the two derived columns
# (`channels.sponsored_ratio`, `channels.seen_brands`) and a read of
# `videos.description`; the pass itself lives here, next to the rest of what
# this module derives from a channel's videos.
#
# Phrases a sponsorship disclosure very reliably uses. Plain substring checks
# on the lowercased description -- false negatives (a disclosure worded some
# other way) are fine and expected; the point is never to guess.
SPONSOR_SIGNAL_PHRASES = (
    "sponsored", "#ad", "use code", "affiliate link", "paid partnership",
    "in partnership with", "promo code", "discount code",
)

# Brand extraction is deliberately narrow: only the patterns below, never a
# guess at "some capitalized word nearby". Each captures 1-3 capitalized
# words immediately after a disclosure phrase, or the code itself after
# "use/enter/apply code" (creator promo codes are very often the brand or
# creator name, e.g. "use code MKBHD"). `(?i:...)` scopes case-insensitivity
# to the phrase only, so the capture group's `[A-Z]` still requires an
# actually-capitalized brand rather than matching on IGNORECASE too.
# No "." in the token itself -- a trailing sentence stop (e.g. "...by NordVPN.
# Stay safe.") must end the brand there, not glue the next sentence's
# capitalized word on as a second "word" of the name.
_BRAND_NAME = r"[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){0,2}"
BRAND_PATTERNS = (
    re.compile(rf"(?i:sponsored\s+by)[:\s]+({_BRAND_NAME})"),
    re.compile(rf"(?i:in\s+partnership\s+with)[:\s]+({_BRAND_NAME})"),
    re.compile(r"(?i:(?:use|enter|apply)\s+code)[:\s]+([A-Z][A-Z0-9]{1,15})\b"),
)
_BRAND_STRIP = " .,!:;\"'’"


def _detect_sponsorship(description):
    """(is_sponsored, brands) for one video description. `brands` only ever
    contains matches from `BRAND_PATTERNS` -- confident extractions, not an
    attempt to be exhaustive."""
    if not description:
        return False, []
    is_sponsored = any(phrase in description.lower() for phrase in SPONSOR_SIGNAL_PHRASES)
    brands = []
    for pattern in BRAND_PATTERNS:
        for match in pattern.finditer(description):
            brand = match.group(1).strip(_BRAND_STRIP)
            if brand and brand not in brands:
                brands.append(brand)
    return is_sponsored, brands


def compute_channel_sponsorship(conn, channel_ids):
    """Recomputes `channels.sponsored_ratio` and `channels.seen_brands` for
    [channel_ids] from their stored video descriptions.

    Call alongside `store.mark_channels_videos_fetched` everywhere a
    channel's video set changes -- the same way `store.compute_channel_rollups`
    already is -- so the two columns stay current whenever a channel is
    (re)enriched, whichever of search/backfill/catch-up/manual-refetch did it.

    `sponsored_ratio` is the fraction of the channel's *stored* videos (not
    just the ones with a description -- a failed metadata fetch still counts
    as a stored video, and not a signal) that match a sponsorship phrase.
    A channel with zero stored videos gets `sponsored_ratio=None` -- an
    undefined fraction, not a claim of zero -- and `seen_brands=[]`, never an
    exception. Commits.
    """
    channel_ids = list(dict.fromkeys(channel_ids))  # de-dup, keep order
    if not channel_ids:
        return
    descriptions_by_channel = store.get_channel_video_descriptions(conn, channel_ids)
    for channel_id in channel_ids:
        descriptions = descriptions_by_channel.get(channel_id, [])
        total = len(descriptions)
        if total == 0:
            store.update_channel_sponsorship(conn, channel_id, None, [])
            continue
        matched = 0
        brands = []
        for description in descriptions:
            is_sponsored, found = _detect_sponsorship(description)
            if is_sponsored:
                matched += 1
            for brand in found:
                if brand not in brands:
                    brands.append(brand)
        store.update_channel_sponsorship(conn, channel_id, matched / total, brands)
    conn.commit()


def compute_channel_found_emails(conn, channel_ids):
    """Recomputes `channels.found_emails` for [channel_ids] from the About text
    first, then the stored video descriptions (fix #11). Commits."""
    channel_ids = list(dict.fromkeys(channel_ids))
    if not channel_ids:
        return
    about = store.get_channel_about_texts(conn, channel_ids)
    descriptions = store.get_channel_video_descriptions(conn, channel_ids)
    for channel_id in channel_ids:
        if channel_id not in about:
            continue
        store.update_channel_found_emails(
            conn, channel_id,
            found_emails.find_emails(about[channel_id], *descriptions.get(channel_id, [])))
    conn.commit()


def derive_channel_signals(conn, channel_ids):
    """Everything derived from a channel's About text and videos, in one
    pass: the sponsorship signals and the found emails. Called wherever a
    channel's videos change -- a fetch, a refetch, an R2 download, the
    backfill -- so none of them can be left stale by a path that forgot one."""
    channel_ids = list(dict.fromkeys(channel_ids))
    compute_channel_sponsorship(conn, channel_ids)
    compute_channel_found_emails(conn, channel_ids)


def derive_all_channel_signals(conn, batch=500, log=None):
    """The one-off backfill: [derive_channel_signals] over every channel
    held, [batch] at a time. Returns how many channels it covered."""
    ids = store.all_channel_ids(conn)
    for start in range(0, len(ids), batch):
        derive_channel_signals(conn, ids[start:start + batch])
        if log:
            log(f"[signals] {min(start + batch, len(ids))} of {len(ids)}")
    return len(ids)


# ==========================================
# PACING
# ==========================================
# Applies to the scrapetube (HTML-scraping) calls only. The batched API calls
# are not the ban risk and are not delayed -- they are authenticated, quota'd,
# and YouTube is happy to serve them as fast as the quota allows.
#
# What follows is the whole of this run's request budget, and it is shaped
# around three things YouTube actually looks at:
#
#   the gap between requests   never a constant. Every wait below is sampled
#                              from a range in `data/settings.json`.
#
#   the length of a burst      a person does not read two hundred channel
#                              pages without stopping. `sweep_break` puts a
#                              real pause in every `every` channels, which is
#                              what keeps a long sweep from looking like one
#                              uninterrupted machine-driven burst.
#
#   what we do when told no    handled a layer down, in `scrapetube._request`,
#                              which backs off and eventually raises
#                              `BlockedError` -- converted here to
#                              `SearchBlocked` and allowed to end the run.
#
# The ranges themselves are deliberately unhurried. A keyword that takes six
# minutes instead of ninety seconds costs six minutes; an IP that has to sit
# out a day costs the whole team a day.
def delay_range(delay_setting, default=None):
    """The ``(low, high)`` pair out of a `settings.json` entry.

    Handed straight to scrapetube, which samples between the two on every
    paginated request. Before this, scrapetube used its own hardcoded
    `time.sleep(1)` between continuations no matter what the settings said --
    a fixed one-second beat for the length of a deep search, which is the
    clearest signature a scraper leaves.
    """
    if isinstance(delay_setting, dict):
        span = delay_setting.get("range")
        if isinstance(span, (list, tuple)) and len(span) == 2:
            return (float(span[0]), float(span[1]))
    return default


# Used when `settings.json` has no entry for one of these -- a file from
# before these keys existed, or a hand-trimmed one. Erring slow: a missing
# setting must not silently mean "no delay at all".
SEARCH_PAGE_PACE = (2.5, 6.0)
CHANNEL_PAGE_PACE = (1.5, 3.5)


def paced_delay(delay_setting, reason=None):
    if not delay_setting or "range" not in delay_setting:
        return
    lo, hi = delay_setting["range"]
    wait = random.uniform(lo, hi)
    # Announced only when it is long enough to look like a stall. Under a
    # second, saying so is noisier than the pause itself.
    if wait >= 1.0:
        step(f"Pacing {wait:.1f}s{f' before {reason}' if reason else ''}...")
    run_control.sleep(wait)


def maybe_cooldown(cooldown_setting):
    if not cooldown_setting or "range" not in cooldown_setting:
        return
    if random.randint(1, 100) <= cooldown_setting.get("chance", 0):
        lo, hi = cooldown_setting["range"]
        wait = random.uniform(lo, hi)
        step(f"IP cooldown — pausing {wait:.1f}s...")
        run_control.sleep(wait)


def sweep_break(break_setting, done):
    """The pause partway through a long run of channel-page fetches.

    Per-request jitter alone does not help with the shape of a sweep: two
    hundred requests spaced two to four seconds apart, with no gap anywhere in
    them, is still two hundred requests in ten unbroken minutes, and it is the
    unbroken part that stands out. This is the coffee break -- long enough to
    end the burst, taken every `every` channels.
    """
    if not break_setting or "range" not in break_setting:
        return
    lo, hi = break_setting["range"]
    wait = random.uniform(lo, hi)
    step(f"Pausing {wait:.0f}s after {done} channel(s) — "
         f"spacing the run out so YouTube keeps answering...")
    run_control.sleep(wait)


def break_interval(break_setting):
    """How many channels between `sweep_break`s; 0 disables it."""
    if not isinstance(break_setting, dict):
        return 0
    try:
        return max(0, int(break_setting.get("every", 0) or 0))
    except (TypeError, ValueError):
        return 0


def discover_handles(keyword, limit=5, sort_by="relevance", results_type="video"):
    """Uses Scrapetube to seamlessly paginate through deep search results.
    Returns {handle: channel_id} since the search result's browseEndpoint already carries
    the channel_id (browseId) for free, which is what lets us batch the API lookups below
    (channels().list only batches on id=, forHandle= only ever accepts a single handle).

    sort_by/results_type are passed straight through to scrapetube.get_search --
    "relevance"/"video" (this function's defaults) match exactly what every call
    site used before these became configurable, so omitting them is a no-op.
    Only "video" and "channel" results_type are supported here: scrapetube
    returns a *differently shaped* item for each results_type (a video's
    uploader is nested under shortBylineText/ownerText; a channel result
    carries its own id/handle directly on the item), so each needs its own
    parsing branch below -- "playlist"/"movie" aren't wired up since neither
    is a meaningful way to discover an influencer *channel* to reach out to,
    so there's no real parsing branch for them to fall into.
    """
    channels = {}
    try:
        generator = scrapetube.get_search(
            keyword, limit=limit, sort_by=sort_by, results_type=results_type,
            # Paginating a deep search is the densest run of requests the
            # whole pipeline makes -- one continuation per ~20 results, so a
            # 200-handle keyword is a dozen POSTs back to back. They are now
            # spaced by the configured `jitter_delay` range rather than
            # scrapetube's fixed one second.
            sleep=delay_range(CFG.delay("jitter_delay"), SEARCH_PAGE_PACE),
        )

        # The longest silent stretch of a run by a wide margin: paginating a
        # deep search is minutes of HTTP with nothing to report until it ends.
        # Every twenty results, say where it is up to.
        scanned = 0
        for item in generator:
            scanned += 1
            if scanned % 20 == 0:
                step(f"Scanned {scanned} search result(s) — "
                     f"{len(channels)} channel(s) so far...")
            if results_type == "channel":
                # channelRenderer shape: the channel's own id/handle live
                # directly on the item, not nested under a video's uploader
                # byline. NOTE: unlike the "video" branch below (unchanged,
                # battle-tested field names), this branch's exact field names
                # are inferred from YouTube's well-documented channelRenderer
                # shape rather than verified against a live response from
                # this project -- if switching Results Type to "Channel"
                # ever comes back with 0 discovered channels where "Video"
                # finds some for the same keyword, that's the first place to
                # check (compare against get_json_from_html's raw response).
                browse_endpoint = item.get('navigationEndpoint', {}).get('browseEndpoint', {})
                canonical_url = browse_endpoint.get('canonicalBaseUrl', '')
                channel_id = item.get('channelId') or browse_endpoint.get('browseId', '')
                if canonical_url and "@" in canonical_url and channel_id:
                    handle = canonical_url.strip("/").split("/")[-1]
                    channels[handle] = channel_id
            else:
                owner_runs = item.get('shortBylineText', {}).get('runs', []) or item.get('ownerText', {}).get('runs', [])
                if owner_runs:
                    browse_endpoint = owner_runs[0].get('navigationEndpoint', {}).get('browseEndpoint', {})
                    canonical_url = browse_endpoint.get('canonicalBaseUrl', '')
                    channel_id = browse_endpoint.get('browseId', '')
                    if canonical_url and "@" in canonical_url and channel_id:
                        handle = canonical_url.strip("/").split("/")[-1]
                        channels[handle] = channel_id
    except scrapetube.BlockedError as exc:
        # Not a "this keyword found nothing" error, and it must not be
        # swallowed as one. Everything below this line in the run is more
        # requests to an IP YouTube has already stopped answering.
        raise SearchBlocked(str(exc)) from exc
    except Exception as e:
        print(f"Search generator error: {e}", flush=True)

    return channels


def get_channels_data(channel_batch):
    """Fetches channel metadata for up to config.BATCH_SIZE channels (handle: channel_id) in a single API call."""
    id_to_handle = {channel_id: handle for handle, channel_id in channel_batch.items()}
    results = {}
    try:
        request = _youtube().channels().list(
            id=",".join(id_to_handle.keys()),
            part="snippet,statistics,brandingSettings"
        )
        response = request.execute()

        for channel in response.get('items', []):
            handle = id_to_handle.get(channel['id'])
            snippet = channel['snippet']
            stats = channel['statistics']
            branding = channel.get('brandingSettings', {})

            results[handle] = {
                "Name": snippet.get('title'),
                "Handle": handle,
                "Link": f"https://www.YOUTUBE.com/{handle}",
                "Channel_ID": channel['id'],
                "Description": snippet.get('description'),
                "Subscribers": stats.get('subscriberCount', 'Hidden'),
                "Profile_Picture": snippet.get('thumbnails', {}).get('high', {}).get('url'),
                "Banner": branding.get('image', {}).get('bannerExternalUrl', 'No Banner'),
                # ISO-3166 alpha-2, only present when the channel owner set one
                # in YouTube Studio -- same API response as everything else
                # above, no extra quota cost to also read this field.
                "Country": snippet.get('country'),
            }
    except Exception as e:
        print(f"Error fetching batch channel data: {e}", flush=True)

    return results

def get_channel_data_by_handle(handle):
    """Single-item forHandle lookup for a handle we don't already know the channel_id for.
    Only used by the manual --refetch CLI path for a brand-new handle -- normal discovery
    always gets channel_id for free from scrapetube and goes through get_channels_data instead."""
    try:
        request = _youtube().channels().list(forHandle=handle, part="snippet,statistics,brandingSettings")
        response = request.execute()
        if not response.get('items'):
            return None
        channel = response['items'][0]
        snippet = channel['snippet']
        stats = channel['statistics']
        branding = channel.get('brandingSettings', {})
        return {
            "Name": snippet.get('title'),
            "Handle": handle,
            "Link": f"https://www.YOUTUBE.com/{handle}",
            "Channel_ID": channel['id'],
            "Description": snippet.get('description'),
            "Subscribers": stats.get('subscriberCount', 'Hidden'),
            "Profile_Picture": snippet.get('thumbnails', {}).get('high', {}).get('url'),
            "Banner": branding.get('image', {}).get('bannerExternalUrl', 'No Banner'),
            "Country": snippet.get('country'),
        }
    except Exception as e:
        print(f"Error fetching channel data for {handle}: {e}", flush=True)
        return None


def get_recent_video_ids(handle, limit=15, session=None):
    #NEVER DELETED THIS COMMENT: we leave the limit as 15 to get as many videos as possible to span the entire month (assuming the post about 1 videos per two days) and later after verifying it's a relevant channel we add more until we get the whole 2nd month's videos to better calculate cpm based on avg views and other stats crucial details like sponsors

    """Uses Scrapetube to get video IDs without spending API quota.

    [session] lets a caller sweeping many channels reuse one connection and
    one cookie jar across all of them, the way a browser does, instead of
    opening a fresh TLS connection and a fresh cold consent cookie for every
    single channel. Optional, so the one-off callers (`--refetch`,
    `tools/enrich.py`) need not care.
    """
    video_ids = []
    try:
        generator = scrapetube.get_channel(
            channel_url=f"https://www.YOUTUBE.com/{handle}", limit=limit,
            sleep=delay_range(CFG.delay("human_scroll_delay"), CHANNEL_PAGE_PACE),
            session=session,
        )
        for video in generator:
            video_ids.append(video['videoId'])
    except scrapetube.BlockedError as exc:
        raise SearchBlocked(str(exc)) from exc
    except Exception as e:
        print(f"Error fetching videos for {handle}: {e}", flush=True)
    return video_ids


_thread_local = threading.local()


def _youtube():
    """The API client for the calling thread: the module's own on the main
    thread (and whatever a test put there), a thread's own everywhere else --
    parallel search runs `process_keyword` on worker threads."""
    if threading.current_thread() is threading.main_thread():
        return YOUTUBE
    return youtube_client_for_thread()


def youtube_client_for_thread():
    """A YouTube API client owned by the calling thread.

    `googleapiclient`'s client wraps a single `httplib2.Http` that is not safe
    to share across threads. The module-level `YOUTUBE` is fine for the
    single-threaded search path; `backfill_missing_videos`' catch-up mode
    fetches video metadata on a small thread pool (so the API round-trips
    overlap the paced scrapetube reads instead of adding to them), and each
    of those workers needs its own client. Built lazily, once per worker.
    """
    client = getattr(_thread_local, "youtube", None)
    if client is None:
        from googleapiclient.discovery import build
        client = build("youtube", "v3", developerKey=CFG.youtube_api_key,
                       cache_discovery=False)
        _thread_local.youtube = client
    return client


def get_videos_data(video_ids, youtube=None):
    """Fetches metadata for up to config.BATCH_SIZE videos (video_id list) in a
    single API call. [youtube] overrides the module-level client -- passed by
    the catch-up sweep's fetch pool, which cannot share one client across
    threads (see `youtube_client_for_thread`)."""
    results = {}
    if not video_ids:
        return results
    try:
        request = (youtube or _youtube()).videos().list(
            part="snippet,statistics",
            id=",".join(video_ids)
        )
        response = request.execute()

        for item in response.get('items', []):
            snippet = item['snippet']
            stats = item.get('statistics', {})
            results[item['id']] = {
                "id": item['id'],
                "Title": snippet.get('title'),
                "Description": snippet.get('description'),
                "Thumbnail": snippet.get('thumbnails', {}).get('maxres', {}).get('url') or snippet.get('thumbnails', {}).get('high', {}).get('url'),
                "Tags": snippet.get('tags', []),
                "PublishedAt": snippet.get('publishedAt'),
                # Same call, same quota cost as before -- `statistics` was
                # simply never requested. Powers Influencer.averageViews on
                # the Flutter side (PocketBaseInfluencerRepository), which
                # had a field for this with nothing populating it.
                "ViewCount": stats.get('viewCount'),
            }
    except Exception as e:
        print(f"Error fetching batch video data: {e}", flush=True)

    return results


def _parse_subscribers(value):
    """The subscriber count as an int, or None when it is missing, hidden, or
    not a plain number ("Hidden", "", None, "1.2M").

    None is 'unknown size', and the gate never archives on a count it does not
    have -- the same call the Supabase RPC makes when it reports a channel as
    `skipped_unknown` rather than out of range.
    """
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    return int(text) if text.isdigit() else None


def auto_clean_action_for_subscribers(subs):
    """The standing auto-clean rule's verdict for one parsed subscriber count:
    ``"sweep"``, ``"delay"``, or ``None`` meaning leave the channel alone -- it
    is inside the range, its count is unknown, its band is switched "off", or
    no rule is in force.

    The single place the rule's subscriber thresholds are interpreted.
    `apply_auto_clean_gate` (keyword runs, a whole batch at once) and
    `run_manual_refetch`'s import gate (one handle at a time) both route through
    here so the two can never drift apart.
    """
    if CFG is None or not CFG.auto_clean_enabled or subs is None:
        return None
    lo = CFG.auto_clean_min_subscribers
    hi = CFG.auto_clean_max_subscribers
    if lo is not None and subs < lo:
        action = CFG.auto_clean_below_min_action
    elif hi is not None and subs > hi:
        action = CFG.auto_clean_above_max_action
    else:
        return None  # inside the range -- fetched now, like always
    return action if action in ("sweep", "delay") else None


def apply_auto_clean_gate(conn, discovered, channel_info_by_handle, keyword):
    """The standing auto-clean rule's subscriber decision, applied to a
    keyword's fresh finds *before* any of their videos are fetched.

    Returns ``(swept_count, delayed_handles)``:

      * swept   -- archived via `store.archive_channel_locally` and removed from
                   `discovered` in place, so nothing downstream fetches or
                   counts them for video work. The tombstone syncs up on the
                   next share.
      * delayed -- left exactly as they are (channel row intact,
                   `videos_fetched_at` still NULL) and returned so the caller
                   keeps this run's video sweep off them. The per-keyword
                   `backfill_missing_videos` backlog picks them up later.

    Which band does which is `CFG.auto_clean_below_min_action` /
    `_above_max_action` -- 'sweep', 'delay' or 'off'. Does nothing at all unless
    the app forwarded an enabled rule carrying a subscriber bound.
    """
    if CFG is None or not CFG.auto_clean_enabled:
        return 0, set()

    label = CFG.auto_clean_label

    swept = 0
    delayed = set()
    unknown = 0
    for handle, channel_id in list(discovered.items()):
        info = channel_info_by_handle.get(handle) or {}
        subs = _parse_subscribers(info.get("Subscribers"))
        if subs is None:
            stored = store.get_channel_row(conn, channel_id)
            subs = _parse_subscribers(stored.get("subscribers")) if stored else None
        if subs is None:
            unknown += 1
            continue

        action = auto_clean_action_for_subscribers(subs)
        if action is None:
            continue  # inside the range, or the band is switched "off"

        if action == "sweep":
            store.archive_channel_locally(
                conn, channel_id, handle, label, subscribers=subs,
                found_via=[{
                    "keyword": keyword,
                    "limit": CFG.handles_limit,
                    "discovered_at": store._now(),
                }])
            discovered.pop(handle, None)
            swept += 1
        elif action == "delay":
            delayed.add(handle)

    if swept or delayed or unknown:
        step(f"Auto-clean gate: {swept} archived, {len(delayed)} deferred to the "
             f"video backlog, {unknown} left alone (subscriber count unknown).")
    return swept, delayed


def process_keyword(conn, run_id, keyword):
    print(f"\n{'='*60}\nKeyword: {keyword}\n{'='*60}", flush=True)

    step(f"Searching YouTube for '{keyword}' — up to {CFG.handles_limit} "
         f"{CFG.results_type} result(s), sorted by {CFG.sort_by}...")
    discovered = discover_handles(
        keyword, limit=CFG.handles_limit, sort_by=CFG.sort_by, results_type=CFG.results_type
    )
    step(f"Discovered {len(discovered)} channel(s).")
    paced_delay(CFG.delay("found_channels_delay"), reason="reading the results")

    # Everything this run is NOT going to touch is decided here, at the handle
    # level, before a single detail is fetched. Two kinds of channel are
    # dropped, for the same reason:
    #
    #   archived  the team already rejected it. Re-adding it would spend quota
    #             re-fetching a channel somebody deliberately removed and then
    #             put it in front of them to vet a second time, undoing both the
    #             storage saving and the decision. This is what the tombstone in
    #             `channel_archive` exists for.
    #   known     the database already holds it. Nothing below can learn
    #             anything new about a channel discovery has already processed,
    #             so every call it would make is quota and wall clock spent to
    #             arrive back where we started.
    #
    # Refreshing a stale channel is a separate, deliberate job with its own
    # budget — `tools/enrich.py`, or `--refetch` for one channel — not something
    # a keyword search does as a side effect of finding the channel again.
    step("Dropping already-known and archived channels...")
    discovered, known, archived = store.partition_discovered(conn, discovered)

    # The one thing a skipped-but-live channel still gets: the link saying this
    # keyword found it too. A local INSERT, no fetch. See record_keyword_links.
    store.record_keyword_links(conn, known, keyword)

    # And the same for a skipped-but-archived channel: the keyword is appended to
    # its tombstone's `found_via` (deduped) and queued for Supabase, so the
    # Keyword Evaluation card scores this term on what it re-surfaces from the
    # archive too — without un-archiving or re-fetching anything. See
    # store.record_archive_keyword_links.
    store.record_archive_keyword_links(conn, archived, keyword, CFG.handles_limit)

    for handle, channel_id in discovered.items():
        store.record_channel_discovery(conn, handle, channel_id, keyword)

    if known or archived:
        step(f"Skipped {len(known)} already-known and {len(archived)} archived "
             f"channel(s); {len(discovered)} new.")

    # ---- channel metadata: only fetch what's unknown or manually flagged for refetch ----
    to_fetch = store.get_channels_to_fetch(conn, discovered)
    channel_info_by_handle = {}
    batch = {}
    fetch_total = len(to_fetch)
    fetched_so_far = 0

    def flush_channel_batch():
        # Hoisted out of the loop-plus-tail duplication it used to be, so the
        # "fetching N of M" line has one place to live rather than two.
        nonlocal batch, fetched_so_far
        if not batch:
            return
        step(f"Fetching channel details {fetched_so_far + len(batch)}/{fetch_total}...")
        fetched = get_channels_data(batch)
        store.save_channels(conn, fetched, batch)
        store.update_run_progress(conn, run_id, channels_delta=len(batch))
        channel_info_by_handle.update(fetched)
        fetched_so_far += len(batch)
        batch = {}

    for handle, channel_id in to_fetch.items():
        batch[handle] = channel_id
        if len(batch) >= config.BATCH_SIZE:
            flush_channel_batch()
    flush_channel_batch()
    step(f"Fetched metadata for {len(channel_info_by_handle)} channel(s).")

    # ---- auto-clean gate ----
    # The standing rule's subscriber decision, made HERE, before a single video
    # scrape is spent on a channel it would throw away. Swept channels are
    # archived and removed from `discovered`; deferred ones keep their turn for
    # the video backlog rather than this run. Off unless the app forwarded an
    # enabled rule -- see `apply_auto_clean_gate`.
    discovered_count = len(discovered)
    _, gate_deferred = apply_auto_clean_gate(conn, discovered, channel_info_by_handle, keyword)

    # ---- decide which channels still need videos ----
    # Subscriber count and video recency are no longer filtered here -- we
    # fetch everything and leave that filtering to the influencer page, so
    # the raw data is always available if someone loosens a filter later.
    # (The auto-clean gate above is the one exception, and it is opt-in.)
    step("Deciding which channels still need their recent uploads...")
    needing_videos = store.get_channels_needing_videos(conn, discovered)
    for handle in gate_deferred:
        needing_videos.pop(handle, None)
    qualifying_handles = {}
    for handle, channel_id in needing_videos.items():
        info = channel_info_by_handle.get(handle)
        if info is None:
            stored = store.get_channel_row(conn, channel_id)
            channel_country = stored.get("country") if stored else None
        else:
            channel_country = info.get("Country")
        # CFG.country_filter is None when the run didn't ask for one -- every
        # channel qualifies, same as before this filter existed. Otherwise it
        # is a set of ISO codes and a channel qualifies if its own country is
        # one of them. A channel with no country set on YouTube never matches a
        # filter that IS set (nothing to compare against).
        if CFG.country_filter and (channel_country or "").upper() not in CFG.country_filter:
            continue
        qualifying_handles[handle] = channel_id

    video_id_to_channel_id = {}
    video_batch = []
    video_info_by_id = {}
    touched_channel_ids = set()

    def flush_video_batch():
        if not video_batch:
            return
        step(f"Fetching details for {len(video_batch)} video(s)...")
        fetched_v = get_videos_data(video_batch)
        store.save_videos(conn, fetched_v, video_batch, video_id_to_channel_id)
        store.update_run_progress(conn, run_id, videos_delta=len(video_batch))
        video_info_by_id.update(fetched_v)
        video_batch.clear()

    channel_total = len(qualifying_handles)
    if channel_total:
        step(f"Reading recent uploads from {channel_total} channel(s)...")

    # One session for the whole sweep. Every channel used to get a brand new
    # `requests.Session`: a fresh TLS handshake and a fresh CONSENT cookie,
    # two hundred times over, from a client claiming to be a browser. A
    # browser opens the connection once and keeps it.
    break_setting = CFG.delay("channel_sweep_break")
    every = break_interval(break_setting)
    sweep_session = scrapetube.get_session()
    try:
        for position, (handle, channel_id) in enumerate(qualifying_handles.items(), 1):
            if every and position > 1 and (position - 1) % every == 0:
                sweep_break(break_setting, position - 1)
            step(f"Recent uploads {position}/{channel_total}: @{handle}")
            video_ids = get_recent_video_ids(handle, session=sweep_session)
            paced_delay(CFG.delay("recent_videos_delay"))
            touched_channel_ids.add(channel_id)
            for vid in video_ids:
                video_id_to_channel_id[vid] = channel_id
                video_batch.append(vid)
                if len(video_batch) >= config.BATCH_SIZE:
                    flush_video_batch()
    finally:
        # Runs on the blocked path too, so whatever the sweep did manage to
        # collect is saved rather than thrown away with the exception.
        flush_video_batch()
        store.mark_channels_videos_fetched(conn, touched_channel_ids)
        derive_channel_signals(conn, touched_channel_ids)
        sweep_session.close()

    store.mark_channels_videos_fetched(conn, touched_channel_ids)
    derive_channel_signals(conn, touched_channel_ids)
    step(f"Fetched {len(video_info_by_id)} video(s) across {len(touched_channel_ids)} channel(s) "
         f"(country filter excluded: {len(needing_videos) - len(qualifying_handles)}).")

    # Every live channel this keyword surfaced, not only the ones this run had
    # work to do on. "How many channels does this keyword find" is a question
    # about the keyword, and it does not change because somebody else's run
    # happened to get there first.
    # `discovered_count` is the pre-gate figure: a channel the auto-clean gate
    # archived was still a channel this keyword found, and the count is a
    # question about the keyword.
    store.mark_keyword_done(conn, keyword, channels_found=discovered_count + len(known))
    # One worker at a time works the backlog: it is one shared list, and two
    # workers taking a slice of it at once would fetch the same channels.
    if _BACKLOG_LOCK.acquire(blocking=False):
        try:
            backfill_missing_videos(conn, run_id)
        finally:
            _BACKLOG_LOCK.release()
    else:
        step("Another worker is catching up the video backlog; moving on.")
    maybe_cooldown(CFG.delay("ip_cooldown"))


_BACKLOG_LOCK = threading.Lock()


def backfill_missing_videos(conn, run_id, limit=None, emit_io=False):
    """Works a bounded slice of the backlog of channels missing their recent
    uploads, drawn from the whole local store rather than this keyword's own
    finds -- see `store.get_video_backfill_candidates` for why that backlog
    exists at all and cannot clear itself otherwise.

    Run after every keyword rather than once at the end of a whole search, so
    a run of one keyword makes exactly as much progress on the backlog per
    keyword as a run of a hundred, and an interrupted run has still chipped
    away at it up to the last keyword it finished -- the same reasoning
    `search.py` already applies to pushing results after every keyword.

    Bounded by [limit] (`CFG.backfill_batch_size` if not given) so a large
    backlog is worked down gradually rather than turning one keyword into an
    unplanned hour. `search.py --catch-up-videos` passes a much larger
    [limit] and calls this in a loop -- unlike the wide, per-channel,
    quota-hungry backfill in `tools/enrich.py`, this only ever fetches each
    channel's normal ~15-video window, which costs no more than ordinary
    discovery does, so working through the whole backlog in one sitting is
    cheap.

    NOT scoped to `CFG.country_filter`, and that is the point of the backlog.
    It used to be, on the reasoning that a run narrowed to one country should
    spend its backfill turn inside the same scope -- but the discovery pass
    already skips non-matching channels, so the country filter was the very
    reason most of them had no videos, and scoping the catch-up the same way
    left them permanently unmeasured. Measured against the team's store: 5,336
    channels had never had their uploads read, and the scoped backlog could
    reach 277 of them. The other 5,059 -- 3,107 outside the filter and 1,952
    whose country YouTube never exposed -- could not be reached by any run.
    The visible cost of that is `channels.avg_views_last_30`: without videos
    there is no average, and without an average the auto-clean rule's
    average-views bound counts a channel as unknown-size and refuses to tag it,
    so those channels sit in the list forever, unfiltered and unfilterable.

    A country filter is a question about which channels to *look for*, not
    about which of the ones already found are worth knowing the size of.
    Narrowing by country stays available where it belongs -- the app's own
    filters, applied to the results.

    [emit_io] is set only by the `search.py --catch-up-videos` sweep (a
    per-keyword search leaves it off). Besides turning on the `[catchup-io]`
    progress line the app's panel reads, it selects the two behaviours that
    only make sense for a dedicated backlog run rather than a slice between
    keywords: the gentler `catchup_videos_delay` pacing, and fetching video
    metadata on a small thread pool so the API round-trips overlap the paced
    scrapetube reads instead of adding to them.

    Paced and made interruption-safe exactly like the per-keyword sweep above
    it, but the stamping is incremental: `videos_fetched_at` is written for
    each channel the moment its uploads are read and every one of its videos
    is saved and committed (`stamp_finished_channels`), not once at the end.
    The `finally` still flushes the tail and re-stamps as a backstop, but it
    cannot be relied on -- when `search.py --catch-up-videos` is the caller,
    the app terminates this process outright on Windows to hand the database
    to a search (see `scraper_process_io.dart`; SIGINT is not a real console
    interrupt there), so `finally` and the `KeyboardInterrupt` path may never
    run. Stamping as we go is what lets a killed pass resume from where it got
    to instead of re-reading the same oldest-first channels every launch --
    on a machine someone searches from all day, the batch-at-the-end version
    could be killed before a single 200-channel batch finished and so never
    persist anything at all.
    """
    backlog = store.get_video_backfill_candidates(
        conn, limit if limit is not None else CFG.backfill_batch_size)
    if not backlog:
        return

    remaining_before = store.count_channels_needing_videos(conn)
    step(f"Backfilling videos for {len(backlog)} channel(s) still missing them "
         f"(backlog: {remaining_before})...")

    video_id_to_channel_id = {}
    video_batch = []
    video_info_by_id = {}
    touched_channel_ids = set()

    # Two things happen to every channel here, one after the other, and the app
    # draws them as two layers of one bar (see `video_catchup_controller.dart`):
    # first its upload list is read with scrapetube (`get_recent_video_ids`, no
    # quota), then -- batched across channels, `config.BATCH_SIZE` ids at a time
    # -- that list's metadata is fetched from the API (`get_videos_data`). The
    # only machine-readable position the sweep emitted was `[catchup] done=` in
    # `search.py`, which moves just once per `_CATCH_UP_BATCH_SIZE`-channel outer
    # batch -- minutes apart -- so the bar sat still between jumps and the two
    # sub-steps were invisible. `[catchup-io]` fills that gap: counts local to
    # this one call, which the app adds onto the `[catchup] done=` base. The
    # existing `[catchup]` line is deliberately left exactly as it was.
    batch_total = len(backlog)
    channels_scanned = 0
    channels_fetched = 0
    # Video ids collected for a channel but not yet saved. A channel is only
    # "fetched" once every id it contributed has been written, so this counts
    # down to zero as batches land and the channel is tallied then.
    unflushed_by_channel = {}
    # Channels already stamped `videos_fetched_at` this call, so
    # `stamp_finished_channels` does not re-issue an UPDATE for them every
    # iteration.
    stamped_channel_ids = set()

    # The catch-up sweep fetches metadata on a pool so the API round-trips
    # overlap the paced scrapetube reads that dominate the loop, rather than
    # being paid one after another between them. The pool only ever runs the
    # HTTP call (`get_videos_data`, which swallows its own errors); every
    # SQLite write still happens on this thread, in `write_fetched`, as
    # results are reaped. A per-keyword search keeps the old inline path.
    fetch_pool = ThreadPoolExecutor(
        max_workers=5, thread_name_prefix="catchup-fetch") if emit_io else None
    pending = []  # [(future, batch)] awaiting metadata, pool path only
    delay_setting = (CFG.delay("catchup_videos_delay")
                     or CFG.delay("recent_videos_delay")) if emit_io \
        else CFG.delay("recent_videos_delay")

    def emit_io_progress():
        if not emit_io:
            return
        print(f"[catchup-io] scanned={channels_scanned} "
              f"fetched={channels_fetched} batch={batch_total}", flush=True)

    def stamp_finished_channels():
        """Persist `videos_fetched_at` for every touched channel whose uploads
        have been read and whose videos are all saved and committed -- as it
        happens, so a hard kill (see the docstring) costs only the channel in
        flight, not the whole run's worth of unstamped work."""
        done_now = [
            cid for cid in touched_channel_ids
            if cid not in stamped_channel_ids
            and unflushed_by_channel.get(cid, 0) <= 0
        ]
        if done_now:
            store.mark_channels_videos_fetched(conn, done_now)
            derive_channel_signals(conn, done_now)
            stamped_channel_ids.update(done_now)

    def write_fetched(batch, fetched_v):
        """The DB half of a flush -- always on the calling (main) thread."""
        nonlocal channels_fetched
        store.save_videos(conn, fetched_v, batch, video_id_to_channel_id)
        store.update_run_progress(conn, run_id, videos_delta=len(batch))
        video_info_by_id.update(fetched_v)
        for vid in batch:
            cid = video_id_to_channel_id[vid]
            remaining = unflushed_by_channel.get(cid, 0) - 1
            unflushed_by_channel[cid] = remaining
            if remaining == 0:
                channels_fetched += 1
        emit_io_progress()

    def reap(block=False):
        """Write the results of finished (or, with [block], all) pool futures.
        A future that failed outright leaves its channels unflushed, so they
        are not stamped and come back on the next pass rather than being lost
        as if handled."""
        if not pending:
            return
        keep = []
        for future, batch in pending:
            if not block and not future.done():
                keep.append((future, batch))
                continue
            try:
                fetched_v = future.result(timeout=20 if block else None)
            except Exception as exc:  # noqa: BLE001
                print(f"[catchup-io] a metadata batch was dropped ({exc}); its "
                      f"channels stay in the backlog.", flush=True)
                continue
            write_fetched(batch, fetched_v)
        pending[:] = keep

    def flush_video_batch(block=False):
        if video_batch:
            batch = list(video_batch)
            video_batch.clear()
            if fetch_pool is None:
                write_fetched(batch, get_videos_data(batch))
            else:
                pending.append((fetch_pool.submit(
                    lambda ids: get_videos_data(
                        ids, youtube=youtube_client_for_thread()),
                    batch), batch))
        if fetch_pool is not None:
            reap(block=block)

    backfill_session = scrapetube.get_session()
    try:
        for handle, channel_id in backlog.items():
            step(f"Backfill: {handle}")
            video_ids = get_recent_video_ids(handle, session=backfill_session)
            paced_delay(delay_setting)
            touched_channel_ids.add(channel_id)
            channels_scanned += 1
            unflushed_by_channel[channel_id] = len(video_ids)
            # A channel with no readable uploads has nothing left to fetch --
            # it is finished the instant it is scanned.
            if not video_ids:
                channels_fetched += 1
            for vid in video_ids:
                video_id_to_channel_id[vid] = channel_id
                video_batch.append(vid)
                if len(video_batch) >= config.BATCH_SIZE:
                    flush_video_batch()
            # Take in whatever the pool finished while this channel was being
            # read and paced, then persist everything now complete -- the loop
            # may not come back from the next `get_recent_video_ids`.
            if fetch_pool is not None:
                reap()
            emit_io_progress()
            stamp_finished_channels()
    finally:
        # Backstop for the normal exit path; on a hard kill it may not run at
        # all, which is exactly why the stamping above is per-channel.
        flush_video_batch(block=True)
        stamp_finished_channels()
        store.mark_channels_videos_fetched(conn, touched_channel_ids)
        derive_channel_signals(conn, touched_channel_ids)
        if fetch_pool is not None:
            fetch_pool.shutdown(wait=False, cancel_futures=True)
        backfill_session.close()

    step(f"Backfilled videos for {len(touched_channel_ids)} channel(s) "
         f"(backlog remaining: {remaining_before - len(touched_channel_ids)}).")


def run_manual_refetch(conn, handles, *, keyword="__manual_refetch__",
                       recent_videos=15, auto_clean=False):
    """Runs a list of handles through the pipeline: resolve each one, force a
    full refresh of its channel details, and fetch its recent-uploads window --
    leaving rows the same shape a search run would have.

    This is the single path for "a list of handles" work. `search.py --refetch`
    and `tools/import_handles.py` both call it, so neither drifts from the
    pipeline as it changes.

    [keyword] is the `channel_keywords` label every handle is recorded under, so
    an imported channel has provenance in the app like any other. `--refetch`
    keeps the internal `__manual_refetch__` marker; the import tool passes its
    own. [recent_videos] sizes the uploads window fetched per channel.

    [auto_clean] applies the standing auto-clean rule's subscriber decision to
    each handle the moment its channel details land, before its uploads are
    fetched -- the same call `apply_auto_clean_gate` makes for a keyword run's
    fresh finds (`auto_clean_action_for_subscribers`). `tools/import_handles.py`
    turns it on for a bulk import; `search.py --refetch` leaves it off, because
    a person naming one handle is deliberately asking for that channel. A
    'sweep' verdict archives the channel and skips its videos; a 'delay' verdict
    keeps the channel but leaves `videos_fetched_at` NULL so the video-backfill
    backlog picks its uploads up later.

    Returns ``{"processed": [...], "failed": [...], "swept": [...],
    "deferred": [...]}`` (lists of handles): fully fetched, unresolved/errored,
    archived by the gate, and metadata-only-pending-backlog respectively. A
    throttle (`SearchBlocked`) still propagates rather than being folded into
    `failed` -- a blocked IP is not a per-handle warning to carry on from.
    """
    processed = []
    failed = []
    swept = []
    deferred = []
    for index, raw in enumerate(handles):
        handle = "@" + str(raw).strip().lstrip("@")
        # Space the handles out the way a keyword run spaces its found
        # channels. `--refetch` is only ever a handful and never noticed the
        # lack; a bulk import from `tools/import_handles.py` is where a
        # back-to-back burst with no pacing earns a throttle.
        if index:
            paced_delay(CFG.delay("found_channels_delay"), reason="the next handle")
        try:
            channel_id = store.force_refetch_by_handle(conn, handle)

            if not channel_id:
                info = get_channel_data_by_handle(handle)
                if not info:
                    print(f"Could not resolve handle '{handle}'. Skipping.", flush=True)
                    failed.append(handle)
                    continue
                channel_id = info["Channel_ID"]
                # A manual refetch is a person deliberately asking for this
                # channel, which overrides the tombstone the same way re-adding it
                # by hand does in the app.
                store.unarchive(conn, channel_id)
                store.force_refetch_by_handle(conn, handle)

            # Recorded for already-known channels too, not just freshly
            # resolved ones: the channel<->keyword association is meant to
            # accumulate across runs (see `store.record_channel_discovery`), and
            # this is a no-op `INSERT OR IGNORE` when the link is already there.
            # It also no-ops for an archived channel -- which `unarchive` above
            # has already cleared on the new-handle path.
            store.record_channel_discovery(conn, handle, channel_id, keyword)

            # `[step]` lines are the progress protocol a launched run has -- see
            # search_progress_parser.dart. Harmless in a terminal, and what lets the
            # app's re-enrich panel show more than a spinner.
            print(f"[step] Channel details for {handle}...", flush=True)
            fetched = get_channels_data({handle: channel_id})
            store.save_channels(conn, fetched, {handle: channel_id})

            if auto_clean:
                subs = _parse_subscribers(
                    fetched.get(handle, {}).get("Subscribers"))
                if subs is None:
                    stored = store.get_channel_row(conn, channel_id)
                    subs = (_parse_subscribers(stored.get("subscribers"))
                            if stored else None)
                action = auto_clean_action_for_subscribers(subs)
                if action == "sweep":
                    store.archive_channel_locally(
                        conn, channel_id, handle, CFG.auto_clean_label,
                        subscribers=subs,
                        found_via=[{
                            "keyword": keyword,
                            "limit": CFG.handles_limit,
                            "discovered_at": store._now(),
                        }])
                    print(f"[step] Auto-clean swept {handle}: "
                          f"{subs:,} subscriber(s) — archived as "
                          f"{CFG.auto_clean_label}.", flush=True)
                    swept.append(handle)
                    continue
                if action == "delay":
                    print(f"[step] Auto-clean deferred {handle}: "
                          f"{subs:,} subscriber(s) — uploads left for the "
                          f"video-backfill backlog.", flush=True)
                    deferred.append(handle)
                    continue

            print(f"[step] Recent uploads for {handle}...", flush=True)
            video_ids = get_recent_video_ids(handle, limit=recent_videos)
            video_info = get_videos_data(video_ids)
            store.save_videos(conn, video_info, video_ids,
                              {vid: channel_id for vid in video_ids})
            store.mark_channels_videos_fetched(conn, [channel_id])
            derive_channel_signals(conn, [channel_id])

            name = fetched.get(handle, {}).get("Name", "?")
            print(f"Refetched {handle} ({name}): {len(video_info)} video(s).", flush=True)
            processed.append(handle)
        except SearchBlocked as exc:
            # Stop the batch, but hand the caller what landed before the
            # throttle so its summary (and the keyword's `channels_found`) is
            # still right -- the rows themselves are already committed.
            exc.partial = {"processed": processed, "failed": failed,
                           "swept": swept, "deferred": deferred}
            raise
        except Exception as exc:
            # One handle that errors out (a private channel, a transient API
            # hiccup) must not take the rest of the list down with it.
            print(f"  ! Failed to refetch {handle}: {exc}", flush=True)
            failed.append(handle)

    return {"processed": processed, "failed": failed,
            "swept": swept, "deferred": deferred}
