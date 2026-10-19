"""`python -m comms.quote_review` (from pipeline/): check the playbook's video quotes by ear, in a browser page.

Each video quote is shown with its video looping on the passage, at an adjustable speed. The person corrects the
words if the transcript misheard them and presses Done (or Enter). The Parakeet transcripts are never changed:
data/comms/playbook/quote_reviews.json keeps, for every quote touched, its original transcript wording, its
current wording and whether a person checked it. The rule files hold the current wording; an edited quote is
still matched to the transcript (and to its time in the video) through its original wording. Revert puts back
the original wording of that one quote. A quote that changes later (a new rule, a trimmed quote) comes up again
as new; checked quotes do not. A quote that does not make its point on its own ("they need two things" without
the two things) is flagged instead, with an optional note: it leaves the queue and `comms.verify` fails on it
until the rule quotes the whole point.

Whisper may run at the same time (`comms.video_check watch`): it confirms quotes from the other end of the queue,
and a lease on each quote (comms/review_claims.py) keeps the two from working on the same one. A quote Whisper
heard the same way counts as checked; one it heard differently comes first, with what Whisper heard as a hint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from . import course, playbook, review_claims

PAGE = Path(__file__).with_name("quote_review.html")
PORT = 8770
_lock = threading.Lock()


def reviews_path(directory: Optional[Path] = None) -> Path:
    return Path(directory or playbook.playbook_dir()) / "quote_reviews.json"


def key(doc: str, original: str) -> str:
    return hashlib.sha1(f"{doc}\n{original}".encode("utf-8")).hexdigest()[:16]


def load(directory: Optional[Path] = None) -> dict:
    path = reviews_path(directory)
    if not path.exists():
        return {"about": "Video quotes checked by a person (comms/quote_review.py). original = the Parakeet "
                         "transcript's words; current = the words in the rules now.", "quotes": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def lookup(doc: str, quote: str, data: Optional[dict] = None) -> Optional[dict]:
    """The review record whose current wording is this quote, if any."""
    data = data if data is not None else load()
    for rec in data.get("quotes", {}).values():
        if rec.get("doc") == doc and rec.get("current") == quote:
            return rec
    return None


def original_of(doc: str, quote: str, data: Optional[dict] = None) -> str:
    """The transcript wording behind a quote (the quote itself unless a person edited it)."""
    rec = lookup(doc, quote, data)
    return rec["original"] if rec else quote


def checked(doc: str, quote: str, data: Optional[dict] = None) -> bool:
    rec = lookup(doc, quote, data)
    return bool(rec and rec.get("checked"))


def _rule_files(directory: Optional[Path] = None) -> list[Path]:
    return sorted((Path(directory or playbook.playbook_dir()) / "rules").glob("*.rules.json"))


def replace_in_rules(doc: str, old: str, new: str, directory: Optional[Path] = None) -> int:
    """Change the wording of every rule source that quotes `old` from `doc`; returns how many changed."""
    n = 0
    for path in _rule_files(directory):
        data = json.loads(path.read_text(encoding="utf-8"))
        hit = False
        for r in data.get("rules") or []:
            for s in r.get("src") or []:
                if s.get("doc") == doc and s.get("quote") == old:
                    s["quote"] = new
                    s.pop("whisper", None)
                    hit = True
                    n += 1
        if hit:
            _write_json(path, data)
    return n


def items(directory: Optional[Path] = None, me: Optional[str] = None) -> list[dict]:
    """Every distinct video quote in the rules, with what the page needs; quotes to check come first. `busy` names
    whoever else (Whisper, another tab) holds a lease on the quote right now."""
    data = load(directory)
    heard = _whisper_results()
    claims = review_claims.held(directory)
    seen: dict[tuple, dict] = {}
    rules = playbook.rules(directory)
    for r in rules:
        for s in r.src:
            if not s.doc.startswith("video:"):
                continue
            it = seen.get((s.doc, s.quote))
            if it is None:
                rec = lookup(s.doc, s.quote, data)
                original = rec["original"] if rec else s.quote
                video = course.videos().get(s.doc)
                span = course.video_span(s.doc, original)
                t0, t1, p0, p1 = span if span else (0.0, 0.0, 0.0, 0.0)
                pad = min(15.0, max(3.0, 0.15 * (p1 - p0)))   # the estimate is rougher inside long pieces
                duration = (video.duration if video else None) or t1 + pad
                it = seen[(s.doc, s.quote)] = {
                    "key": key(s.doc, original), "doc": s.doc, "title": video.title if video else s.doc,
                    "original": original, "current": s.quote, "checked": bool(rec and rec.get("checked")),
                    "flagged": bool(rec and rec.get("flagged")), "flag_note": (rec or {}).get("flag_note") or "",
                    "found": span is not None, "start": round(max(0.0, t0 - pad), 1), "end": round(min(duration, t1 + pad), 1),
                    "context": course.context(s.doc, original, 220) or "", "rules": [], "rule_titles": []}
                res = heard(s.doc, s.quote)
                it["whisper"] = None if res is None else ("agreed" if res.get("ok") else "disagreed")
                it["heard"] = (res or {}).get("heard") if it["whisper"] == "disagreed" else None
                owner = claims.get(it["key"])
                it["busy"] = owner if owner and owner != me else None
            it["rules"].append(r.id)
            it["rule_titles"].append(f"{r.id}: {r.title}")
    order = {"disagreed": 0, None: 1, "agreed": 2}
    return sorted(seen.values(), key=lambda it: (it["checked"] or it["flagged"], order.get(it["whisper"], 1), it["doc"], it["start"]))


def _whisper_results():
    """Lookup (doc, quote) -> Whisper's result for exactly these words, or None (the cache is read once)."""
    try:
        from . import video_check
        checks = video_check.load_cache().get("checks") or {}
    except Exception:
        return lambda doc, quote: None
    return lambda doc, quote: video_check.rescored(checks.get(video_check.key(doc, quote)))


def edit(item_key: str, text: str, done: bool, directory: Optional[Path] = None) -> dict:
    """Save new wording for one quote (and mark it checked when done)."""
    text = re.sub(r"\s+", " ", text).strip()
    with _lock:
        data = load(directory)
        rec = _record(data, item_key, directory)
        if text and text != rec["current"]:
            replace_in_rules(rec["doc"], rec["current"], text, directory)
            rec["current"] = text
            rec["edited_at"] = time.strftime("%Y-%m-%d %H:%M")
        if done:
            rec["checked"] = True
            rec["checked_at"] = time.strftime("%Y-%m-%d %H:%M")
        _write_json(reviews_path(directory), data)
        return rec


def _record(data: dict, item_key: str, directory: Optional[Path]) -> dict:
    rec = data["quotes"].get(item_key)
    if rec is None:
        it = next((i for i in items(directory) if i["key"] == item_key), None)
        if it is None:
            raise KeyError(item_key)
        rec = data["quotes"][item_key] = {"doc": it["doc"], "original": it["original"], "current": it["current"],
                                          "checked": False}
    return rec


def flag(item_key: str, flagged: bool = True, note: str = "", directory: Optional[Path] = None) -> dict:
    """Mark a quote as not making its point on its own (or take the mark back); the rule must quote more."""
    with _lock:
        data = load(directory)
        rec = _record(data, item_key, directory)
        if flagged:
            rec["flagged"] = True
            rec["flag_note"] = re.sub(r"\s+", " ", note or "").strip()
            rec["flagged_at"] = time.strftime("%Y-%m-%d %H:%M")
        else:
            for k in ("flagged", "flag_note", "flagged_at"):
                rec.pop(k, None)
        _write_json(reviews_path(directory), data)
        return rec


def revert(item_key: str, directory: Optional[Path] = None) -> dict:
    """Put back the transcript's wording for this one quote; whether it was checked stays as it was."""
    with _lock:
        data = load(directory)
        rec = data["quotes"].get(item_key)
        if rec is None:
            raise KeyError(item_key)
        if rec["current"] != rec["original"]:
            replace_in_rules(rec["doc"], rec["current"], rec["original"], directory)
            rec["current"] = rec["original"]
            rec["reverted_at"] = time.strftime("%Y-%m-%d %H:%M")
            _write_json(reviews_path(directory), data)
        return rec


def _owner(tab: Optional[str]) -> str:
    return "person:" + re.sub(r"[^A-Za-z0-9]", "", tab or "")[:24]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):   # quiet console
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: Optional[dict] = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            return self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        if url.path == "/api/items":
            return self._json(items(me=_owner(parse_qs(url.query).get("tab", [""])[0])))
        if url.path == "/video":
            return self._video(parse_qs(url.query).get("doc", [""])[0])
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        try:
            if self.path == "/api/save":
                return self._json(edit(body["key"], body.get("text", ""), bool(body.get("done"))))
            if self.path == "/api/revert":
                return self._json(revert(body["key"]))
            if self.path == "/api/flag":
                return self._json(flag(body["key"], bool(body.get("flagged", True)), body.get("note", "")))
            if self.path == "/api/claim":
                return self._json({"ok": review_claims.claim(body["key"], _owner(body.get("tab")), review_claims.PERSON_LEASE)})
            if self.path == "/api/release":
                review_claims.release(body["key"], _owner(body.get("tab")))
                return self._json({"ok": True})
        except KeyError:
            return self._json({"error": "unknown quote"}, 404)
        self._send(404, b"not found", "text/plain")

    def _video(self, doc: str):
        from .video_check import VIDEOS_ROOT
        video = course.videos().get(doc)
        if video is None:
            return self._send(404, b"no such video", "text/plain")
        path = VIDEOS_ROOT / video.file
        size = path.stat().st_size
        start, end = 0, min(size - 1, 4 * 1024 * 1024)
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else min(size - 1, start + 4 * 1024 * 1024)
        elif m and m.group(2):
            start, end = size - int(m.group(2)), size - 1
        with path.open("rb") as f:
            f.seek(start)
            chunk = f.read(end - start + 1)
        headers = {"Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{start + len(chunk) - 1}/{size}"}
        try:
            self._send(206, chunk, "video/mp4", headers)
        except (ConnectionError, OSError):
            pass   # the browser moved on (seeking); nothing to do


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.quote_review", description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    its = items()
    todo = sum(1 for it in its if not it["checked"] and not it["flagged"] and it["whisper"] != "agreed")
    print(f"Quote review at {url} ({todo} quotes to check). Close this window to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
