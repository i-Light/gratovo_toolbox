"""Finds free proxies that can read YouTube search pages, for Settings > Connections > Proxies.

A stopgap until step S5 builds this into the app (docs/proxies-setup.md). It takes the free
ProxyScrape list, keeps the anonymous HTTPS-capable entries, and checks each one the way the app
will use it (curl_cffi, a Chrome fingerprint, certificates checked):

  1. a 204 from https://www.youtube.com/generate_204 within 10 s;
  2. then, for the fastest that pass, one real search page with results and no bot wall.

It writes the fastest that passed both, at most 100 (the app's limit), one per line.
Run from services/pipeline:  uv run python scripts/free_proxies.py --out <file>
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, cast

import curl_cffi.requests as requests

LIST_URL = (
    "https://api.proxyscrape.com/v4/free-proxy-list/get"
    "?request=display_proxies&proxy_format=protocolipport&format=json"
)
PING_URL = "https://www.youtube.com/generate_204"
SEARCH_URL = "https://www.youtube.com/results?search_query=ai+tools+review"
WALL = ("/sorry/", "unusual traffic", "not a bot")
APP_LIMIT = 100
SEARCH_CHECKS = 250  # the fastest this many after the ping get the search check
WORKERS = 30


def fetch_list() -> list[str]:
    data = cast("dict[str, Any]", json.loads(requests.get(LIST_URL, timeout=30).text))
    entries = cast("list[dict[str, Any]]", data.get("proxies", []))
    kept = [
        e
        for e in entries
        if e.get("alive")
        and e.get("ssl")
        and e.get("anonymity") in ("elite", "anonymous")
        and e.get("protocol") in ("http", "socks4", "socks5")
    ]
    return [str(e["proxy"]) for e in kept]


def _get(url: str, proxy: str, timeout: float) -> requests.Response:
    return requests.get(
        url,
        proxies={"http": proxy, "https": proxy},
        timeout=timeout,
        impersonate="chrome",
        cookies={"CONSENT": "YES+cb"},
    )


def ping(proxy: str) -> tuple[str, float] | None:
    start = time.monotonic()
    try:
        ok = _get(PING_URL, proxy, 10).status_code == 204
    except Exception:  # a dead proxy fails in many ways; each means "not usable"
        return None
    return (proxy, time.monotonic() - start) if ok else None


def search(proxy: str) -> tuple[str, float] | None:
    start = time.monotonic()
    try:
        response = _get(SEARCH_URL, proxy, 15)
    except Exception:  # as above
        return None
    text = response.text.lower()
    walled = any(w in response.url.lower() or w in text[:4096] for w in WALL)
    if response.status_code != 200 or walled or "ytinitialdata" not in text:
        return None
    return proxy, time.monotonic() - start


def fastest(check: Any, proxies: list[str]) -> list[str]:
    with ThreadPoolExecutor(WORKERS) as pool:
        passed = [r for r in pool.map(check, proxies) if r is not None]
    return [proxy for proxy, _ in sorted(passed, key=lambda r: r[1])]


def main() -> None:
    parser = argparse.ArgumentParser(description="Free proxies that can read YouTube.")
    parser.add_argument("--out", required=True, help="where to write the list")
    out = Path(parser.parse_args().out)
    listed = fetch_list()
    print(f"{len(listed)} listed")
    pinged = fastest(ping, listed)
    print(f"{len(pinged)} reached YouTube")
    usable = fastest(search, pinged[:SEARCH_CHECKS])[:APP_LIMIT]
    print(f"{len(usable)} read a search page; writing {out}")
    with out.open("w", encoding="utf-8", newline="\n") as file:
        file.write("".join(f"{proxy}\n" for proxy in usable))


if __name__ == "__main__":
    main()
