"""RSS and Atom parsing, using nothing but the standard library.

There are good feed-parsing packages. This does not use one, for the same
reason `sync.py` hand-rolls a PostgREST client: every dependency is something a
teammate has to install correctly on their own machine before anything works,
and feed parsing is genuinely small once you accept that feeds in the wild are
irregular and stop trying to validate them.

WHAT "IRREGULAR" MEANS HERE, since it drives most of the code below:

  * Two formats. RSS 2.0 nests items under <channel><item>; Atom puts <entry>
    at the top level and namespaces every tag. Both are common in trade press.
  * Dates in at least four shapes: RFC 822 (RSS), RFC 3339 (Atom), and both
    with the timezone written as a name rather than an offset.
  * Namespaces on some tags and not others, sometimes within one document.
  * Content in <description>, <summary>, <content>, or content:encoded, with
    HTML in it either way.

Anything unparseable is skipped, never guessed at. An item with no title is
dropped; an item with an unreadable date keeps a null date rather than being
stamped with "now", because a wrong date sorts an old item to the top of the
page and stays there.
"""

from __future__ import annotations

import gzip
import html
import re
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

TIMEOUT = 30

# Some publishers return 403 to a bare urllib request. A plain, honest UA
# string is enough for every feed tried here -- this is not evasion, it is
# identifying the client at all, which the default ("Python-urllib/3.x") does
# poorly enough that some CDNs treat it as a scraper.
USER_AGENT = "GratovoToolbox/1.0 (+news reader; contact via repo owner)"

# Atom and the handful of RSS extension namespaces that actually carry data we
# want. Feeds use these inconsistently, so every lookup tries the namespaced
# and bare form.
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "media": "http://search.yahoo.com/mrss/",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class FeedError(RuntimeError):
    pass


def _decompress(raw, content_encoding):
    """Undoes gzip/deflate, whether or not the server admitted to using it.

    urllib does not send `Accept-Encoding: gzip` and does not decompress
    anything itself. That should mean every response arrives as plain bytes --
    and yet Tubefilter's CDN, at least, gzips regardless, so the feed reached
    the XML parser as compressed bytes and failed at column 0 with "not
    well-formed", which points nowhere near the cause.

    So the header is honoured when present, and the gzip magic number is
    checked whether or not it is. Sniffing the bytes rather than trusting the
    header alone is the part that matters: the server that gets this wrong is
    exactly the server that does not set the header either.
    """
    encoding = (content_encoding or "").lower()
    is_gzip = raw[:2] == b"\x1f\x8b"

    if "gzip" in encoding or is_gzip:
        try:
            return gzip.decompress(raw)
        # EOFError, not just OSError: a truncated response (a CDN that drops
        # the connection mid-stream) raises EOFError, which is NOT an OSError
        # subclass -- so catching only OSError lets it escape as an unhandled
        # exception and takes down the whole refresh instead of marking this
        # one feed as failed. zlib.error covers a corrupt deflate member
        # inside an otherwise well-formed gzip container.
        except (OSError, EOFError, zlib.error) as exc:
            raise FeedError("its gzipped response could not be read (%s)" % exc)
    if "deflate" in encoding:
        try:
            return zlib.decompress(raw)
        except zlib.error:
            # Raw deflate, without the zlib header some servers omit.
            try:
                return zlib.decompress(raw, -zlib.MAX_WBITS)
            except zlib.error as exc:
                raise FeedError(
                    "its compressed response could not be read (%s)" % exc)
    return raw


def fetch(url):
    """Raw bytes of one feed, or a [FeedError] naming what went wrong.

    The error text ends up in `news_sources.last_fetch_error` and is shown on
    the News page, so it is written to be read by whoever added the feed rather
    than by whoever wrote this function.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return _decompress(
                response.read(), response.headers.get("Content-Encoding"))
    except urllib.error.HTTPError as exc:
        raise FeedError("the site returned HTTP %s" % exc.code) from exc
    except urllib.error.URLError as exc:
        raise FeedError("could not reach it (%s)" % exc.reason) from exc
    except (TimeoutError, OSError) as exc:
        raise FeedError("the connection failed (%s)" % exc) from exc


def _text(element):
    if element is None:
        return None
    # itertext() rather than .text: Atom summaries frequently contain inline
    # markup, and .text stops at the first child element, silently truncating
    # the summary at its first <a href>.
    raw = "".join(element.itertext())
    cleaned = _WS_RE.sub(" ", _TAG_RE.sub(" ", html.unescape(raw))).strip()
    return cleaned or None


def _find(parent, *names):
    """First non-empty match among `names`, trying namespaced then bare."""
    for name in names:
        if ":" in name:
            prefix, local = name.split(":", 1)
            found = parent.find("{%s}%s" % (NS[prefix], local))
        else:
            found = parent.find(name)
        if found is not None:
            return found
    return None


def parse_date(value):
    """Any of the date shapes feeds use -> an aware datetime, or None.

    None is a real answer, not a failure to handle: an item with no usable
    date must stay undated so it sorts last, rather than being stamped with the
    fetch time and jumping to the top of the page on every refresh.
    """
    if not value:
        return None
    text = value.strip()

    # RFC 3339 / ISO 8601 (Atom). Python does not accept a trailing 'Z' before
    # 3.11, and this project's pipeline targets older interpreters too.
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    # RFC 822 (RSS). parsedate_to_datetime raises on a malformed date and, on
    # some versions, returns a naive datetime for one with a timezone NAME
    # rather than an offset ("Mon, 5 Jan 2026 10:00:00 EST").
    try:
        parsed = parsedate_to_datetime(text)
        if parsed is None:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _link_of(entry):
    """RSS puts the URL in <link>'s text; Atom puts it in a href attribute."""
    link = _find(entry, "link", "atom:link")
    if link is None:
        return None
    if link.get("href"):
        return link.get("href").strip()
    return (link.text or "").strip() or None


def _image_of(entry):
    for tag in ("media:thumbnail", "media:content"):
        prefix, local = tag.split(":")
        found = entry.find("{%s}%s" % (NS[prefix], local))
        if found is not None and found.get("url"):
            return found.get("url")
    enclosure = entry.find("enclosure")
    if enclosure is not None and (enclosure.get("type") or "").startswith("image/"):
        return enclosure.get("url")
    return None


def parse(raw, feed_url):
    """(feed_title, [item, ...]) from one feed document.

    An item without a title or without any usable identity is skipped rather
    than stored under a made-up one -- a synthetic guid would defeat the unique
    constraint that stops re-fetching from duplicating everything.
    """
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError as exc:
        raise FeedError("it is not valid XML (%s)" % exc) from exc

    # RSS: <rss><channel><item>. Atom: <feed><entry>. RDF/RSS 1.0 puts <item>
    # at the top level beside <channel>, which is why entries are searched for
    # in both places rather than only under the channel.
    channel = root.find("channel")
    container = channel if channel is not None else root
    entries = container.findall("item") or root.findall("item") or \
        root.findall("{%s}entry" % NS["atom"])

    feed_title = _text(_find(container, "title", "atom:title"))

    items = []
    for entry in entries:
        title = _text(_find(entry, "title", "atom:title"))
        if not title:
            continue

        link = _link_of(entry)
        guid_element = _find(entry, "guid", "atom:id", "id")
        guid = (_text(guid_element) or link or "").strip()
        if not guid:
            # No stable identity, so no way to avoid duplicating it on the next
            # run. Skipped rather than stored once and forever after re-stored.
            continue

        summary = _text(_find(
            entry, "description", "atom:summary", "summary",
            "content:encoded", "atom:content", "content"))
        published = parse_date(_text(_find(
            entry, "pubDate", "atom:published", "published",
            "atom:updated", "updated", "dc:date")))
        author = _text(_find(entry, "dc:creator", "author", "atom:author"))

        items.append({
            "guid": guid,
            "title": title,
            "link": link,
            # Trimmed here rather than in the UI: a feed that ships the whole
            # article in <content:encoded> would otherwise put tens of
            # kilobytes per item into the database for a two-line preview.
            "summary": summary[:1000] if summary else None,
            "author": author,
            "image_url": _image_of(entry),
            "published_at": published.isoformat() if published else None,
        })

    return feed_title, items


def load(feed_url):
    """fetch + parse, as one call. Raises [FeedError] with a readable reason."""
    return parse(fetch(feed_url), feed_url)
