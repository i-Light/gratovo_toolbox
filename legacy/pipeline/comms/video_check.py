"""Confirm video quotes with a second speech model: Whisper must hear the same words in that passage.

    # with the Whisper venv (faster-whisper), from pipeline/:
    "E:\\IMA work\\Tools\\whisper-venv\\Scripts\\python.exe" -m comms.video_check rules      # every video quote in the playbook
    "E:\\IMA work\\Tools\\whisper-venv\\Scripts\\python.exe" -m comms.video_check file Q.json  # [{"doc", "quote"}] candidates
    "E:\\IMA work\\Tools\\whisper-venv\\Scripts\\python.exe" -m comms.video_check watch      # background: checks new quotes as rules are written
    python -m comms.video_check record                                                     # write the cached results into the rules
    python -m comms.video_check report                                                     # what failed, with what Whisper heard

The lesson videos were transcribed with Parakeet (comms/course.py); on 19 videos done by both models it agreed
with Whisper large-v3 on 93.6% of words, and Parakeet mishears the odd word without inventing text. A full
Whisper pass was dropped on purpose (2026-10-15): instead each quoted passage, `[start - pad, end + pad]` of the
video, is transcribed with Whisper (no prompt: a prompt leaked into its output; word timestamps and
hallucination_silence_threshold=2, as in E:\\IMA work\\Tools\\transcribe\\transcribe.py) and the words are
compared after normalising. A quote passes when Whisper hears every word that carries meaning (only fillers
and small function words may be missing) and at least MIN_MATCH of all its words. The window starts tight
around the quote's estimated time and widens to the whole timed piece when it does not pass.

Results are cached in data/comms/playbook/whisper_checks.json by (video, normalised quote): editing a quote
needs a new check. Since 2026-10-15 a person also checks quotes by ear (comms/quote_review.py); verify.py accepts
a video quote that the person checked or that Whisper heard the same way. `watch` works through the quotes
nobody has checked from the far end of the person's queue, holding a lease on each (comms/review_claims.py), so
the two never work on the same quote; an edited quote is checked in its edited words at its original place.
Whisper is a cross-check, never a source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from . import course, playbook

CACHE = playbook.DEFAULT_DIR / "whisper_checks.json"
VIDEOS_ROOT = course.DEFAULT_COURSE_DIR / "course videos"
SR = 16000
MIN_MATCH = 0.9
MODEL = "whisper-large-v3-int8"
# Words Whisper may drop or hear differently without changing what was taught: fillers, articles, discourse words.
MINOR = set("""a an the and so like you know i okay ok right just basically yeah yes oh well now then um uh uhm hmm ah er mm
actually really kind of sort literally guys bro alright all that this is it its to""".split())
FILLERS = {"um", "uh", "uhm", "hmm", "ah", "er", "mm", "mhm"}
NUMBER_WORDS = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
                "eight": "8", "nine": "9", "ten": "10", "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50",
                "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90", "first": "1st", "second": "2nd",
                "third": "3rd"}
# The two models spell casual speech differently ("gonna" / "going to").
SPOKEN = {"gonna": "going to", "wanna": "want to", "gotta": "got to", "kinda": "kind of", "cause": "because",
          "cuz": "because", "ok": "okay", "alright": "all right", "email": "e mail", "emails": "e mails"}


def words(text: str) -> list[str]:
    t = course.norm(text)
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)            # 50,000 -> 50000
    t = re.sub(r"(\d)\s*%", r"\1 percent", t)
    t = re.sub(r"(\d)\s*k\b", r"\1000", t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t).replace("'", "")
    for short, full in SPOKEN.items():
        t = re.sub(rf"\b{short}\b", full, t)
    out = [NUMBER_WORDS.get(w, w) for w in t.split()]
    return [w for w in out if w not in FILLERS]


def key(doc: str, quote: str) -> str:
    return hashlib.sha1(f"{doc}\n{course.norm(quote)}".encode("utf-8")).hexdigest()[:16]


def _one_edit(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _same_word(a: str, b: str) -> bool:
    """One inflection apart ("niche"/"niched", "want"/"wants"): one word extends the other by at most two letters;
    or, for long words, one letter apart ("influences"/"influencers")."""
    if min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 2:
        return False
    return a.startswith(b) or b.startswith(a) or (min(len(a), len(b)) >= 6 and _one_edit(a, b))


def compare(quote: str, heard: str) -> dict:
    q, h = words(quote), words(heard)
    if not q:
        return {"match": 0.0, "missing": [], "ok": False}
    # Longest common subsequence where an inflection counts as the same word (positions, not word types).
    n, m = len(q), len(h)
    same = [[q[i] == h[j] or _same_word(q[i], h[j]) for j in range(m)] for i in range(n)]
    lcs = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            lcs[i][j] = lcs[i + 1][j + 1] + 1 if same[i][j] else max(lcs[i + 1][j], lcs[i][j + 1])
    got = [False] * n
    i = j = 0
    while i < n and j < m:
        if same[i][j] and lcs[i][j] == lcs[i + 1][j + 1] + 1:
            got[i] = True
            i, j = i + 1, j + 1
        elif lcs[i + 1][j] >= lcs[i][j + 1]:
            i += 1
        else:
            j += 1
    missing = [w for w, ok in zip(q, got) if not ok]
    match = round(sum(got) / len(q), 3)
    content = [w for w in missing if w not in MINOR]
    return {"match": match, "missing": missing, "ok": match >= MIN_MATCH and not content}


def load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"about": __doc__.splitlines()[0], "checks": {}}


def save_cache(cache: dict) -> None:
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, CACHE)   # readers (verify, watch) never see half a file


def rescored(result: Optional[dict]) -> Optional[dict]:
    """A cached result compared again with today's normalisation (what Whisper heard is kept, so no re-hearing)."""
    if not result or "heard" not in result:
        return result
    return {**result, **compare(result["quote"], result["heard"])}


def cached(doc: str, quote: str) -> Optional[dict]:
    return rescored((load_cache().get("checks") or {}).get(key(doc, quote)))


class Checker:
    def __init__(self, threads: int = 8):
        os.environ.setdefault("HF_HOME", r"E:\IMA work\Tools\hf-cache")
        from faster_whisper import WhisperModel   # the Whisper venv only
        self.model = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=threads)

    @staticmethod
    def audio(path: Path, start: float, end: float):
        import numpy as np
        cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(path),
               "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
        return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32)

    def hear(self, path: Path, start: float, end: float) -> str:
        segs, _ = self.model.transcribe(self.audio(path, start, end), language="en", beam_size=5, vad_filter=True,
                                        condition_on_previous_text=False, word_timestamps=True,
                                        hallucination_silence_threshold=2.0)
        return " ".join(s.text.strip() for s in segs)

    def check(self, doc: str, quote: str, original: Optional[str] = None) -> dict:
        """`original`: the transcript's words, when a person edited the quote (they say where it is)."""
        video = course.videos().get(doc)
        span = course.video_span(doc, original or quote) if video else None
        base = {"doc": doc, "quote": quote, "model": MODEL, "checked": time.strftime("%Y-%m-%d %H:%M")}
        if span is None:
            return {**base, "ok": False, "match": 0.0, "missing": [], "error": "quote not in the Parakeet transcript"}
        t0, t1, p0, p1 = span
        lo, hi = max(0.0, p0 - 2), min(video.duration or p1 + 2, p1 + 2)
        path = VIDEOS_ROOT / video.file
        best = None
        for pad in (8, 30, None):
            s, e = (lo, hi) if pad is None else (max(lo, t0 - pad), min(hi, t1 + pad))
            heard = self.hear(path, s, e)
            result = {**base, **compare(quote, heard), "window": f"{course.clock(s)}-{course.clock(e)}", "heard": heard}
            if best is None or (result["ok"], result["match"]) > (best["ok"], best["match"]):
                best = result
            if best["ok"] or (pad is not None and e - s >= hi - lo):
                break
        return best


def _source_record(result: dict) -> dict:
    out = {"ok": result["ok"], "match": result["match"], "window": result.get("window"), "model": MODEL}
    if result.get("missing"):
        out["missing"] = result["missing"]
    return out


def run(items: list[tuple[str, str]], recheck: bool = False) -> dict:
    cache = load_cache()
    checks = cache.setdefault("checks", {})
    for k in list(checks):
        checks[k] = rescored(checks[k])
    todo = [(d, q) for d, q in dict.fromkeys(items) if recheck or key(d, q) not in checks]
    print(f"{len(items)} video quotes, {len(todo)} to check", flush=True)
    if todo:
        checker = Checker()
        for i, (doc, quote) in enumerate(todo, 1):
            t = time.time()
            result = checker.check(doc, quote)
            checks[key(doc, quote)] = result
            save_cache(cache)   # every result at once: a stopped run resumes
            print(f"[{i}/{len(todo)}] {'ok ' if result['ok'] else 'NO '} {result['match']:.2f} "
                  f"{time.time() - t:4.0f}s {doc.split('/')[-1][:40]} | {quote[:60]}", flush=True)
    return checks


def video_sources() -> list[tuple[Path, int, int, dict]]:
    out = []
    root = playbook.playbook_dir() / "rules"
    for path in sorted(root.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for i, rule in enumerate(data.get("rules") or []):
            for j, src in enumerate(rule.get("src") or []):
                if str(src.get("doc") or "").startswith("video:"):
                    out.append((path, i, j, src))
    return out


def cmd_rules(args) -> int:
    checks = run([(s["doc"], s["quote"]) for _, _, _, s in video_sources()], recheck=args.recheck)
    # Read the rules again: they may have been edited during a long run. Records go by (video, quote).
    sources = video_sources()
    files: dict[Path, dict] = {}
    for path, i, j, src in sources:
        data = files.setdefault(path, json.loads(path.read_text(encoding="utf-8")))
        result = checks.get(key(src["doc"], src["quote"]))
        if result:
            data["rules"][i]["src"][j]["whisper"] = _source_record(result)
    for path, data in files.items():
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bad = [s for _, _, _, s in sources if not (checks.get(key(s["doc"], s["quote"])) or {}).get("ok")]
    print(f"{len(sources) - len(bad)}/{len(sources)} video quotes confirmed by Whisper")
    if args.toast:
        from .pool import toast
        toast("Video quote check", f"{len(sources) - len(bad)}/{len(sources)} confirmed; {len(bad)} to fix")
    return 0


def cmd_record(args) -> int:
    """Write the cached results into the rules' sources (no Whisper: any venv, takes a second)."""
    checks = {k: rescored(v) for k, v in (load_cache().get("checks") or {}).items()}
    files: dict[Path, dict] = {}
    n = 0
    for path, i, j, src in video_sources():
        data = files.setdefault(path, json.loads(path.read_text(encoding="utf-8")))
        result = checks.get(key(src["doc"], src["quote"]))
        if result:
            data["rules"][i]["src"][j]["whisper"] = _source_record(result)
            n += 1
    for path, data in files.items():
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"recorded {n} checks in the rules")
    return 0


def cmd_watch(args) -> int:
    """Check the video quotes nobody has checked yet, from the far end of the person's queue, one lease at a time
    (comms/review_claims.py). Only the cache is written: rule files are never touched, so a person editing them
    meanwhile is safe. Stops after `--idle` minutes with nothing to do."""
    from . import quote_review, review_claims
    owner = f"whisper:{os.getpid()}"
    checker, idle_since = None, time.time()
    try:
        while True:
            todo = [it for it in quote_review.items() if not it["checked"] and not it["flagged"] and it["whisper"] is None and not it["busy"]]
            if not todo:
                if time.time() - idle_since > args.idle * 60:
                    print("idle: stopping", flush=True)
                    return 0
                time.sleep(30)
                continue
            it = todo[-1]
            if not review_claims.claim(it["key"], owner, review_claims.WHISPER_LEASE):
                continue
            try:
                checker = checker or Checker()
                t = time.time()
                result = checker.check(it["doc"], it["current"], it["original"])
                cache = load_cache()            # merge: never lose a result written meanwhile
                cache.setdefault("checks", {})[key(it["doc"], it["current"])] = result
                save_cache(cache)
            finally:
                review_claims.release(it["key"], owner)
            idle_since = time.time()
            print(f"{time.strftime('%H:%M')} {'ok ' if result['ok'] else 'NO '} {result['match']:.2f} {time.time() - t:4.0f}s "
                  f"({len(todo) - 1} left) {it['doc'].split('/')[-1][:40]} | {it['current'][:60]}", flush=True)
    finally:
        review_claims.release_all(owner)


def cmd_file(args) -> int:
    items = json.loads(Path(args.path).read_text(encoding="utf-8"))
    run([(x["doc"], x["quote"]) for x in items], recheck=args.recheck)
    return cmd_report(args, only=[(x["doc"], x["quote"]) for x in items])


def cmd_report(args, only=None) -> int:
    checks = load_cache().get("checks") or {}
    keys = [key(d, q) for d, q in only] if only else list(checks)
    for k in keys:
        r = rescored(checks.get(k))
        if r and (not r["ok"] or getattr(args, "all", False)):
            print(f"{'ok' if r['ok'] else 'NO'} {r['match']:.2f} {r['doc'].split('/')[-1]} @{r.get('window')}\n"
                  f"  quote:   {r['quote']}\n  missing: {' '.join(r.get('missing') or [])}\n  heard:   {r.get('heard', r.get('error'))}\n")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m comms.video_check")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("rules")
    p.add_argument("--recheck", action="store_true")
    p.add_argument("--toast", action="store_true")
    p = sub.add_parser("file")
    p.add_argument("path")
    p.add_argument("--recheck", action="store_true")
    p = sub.add_parser("report")
    p.add_argument("--all", action="store_true")
    sub.add_parser("record")
    p = sub.add_parser("watch")
    p.add_argument("--idle", type=float, default=240, help="minutes with nothing to check before stopping")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
    except Exception:  # noqa: BLE001 - not Windows
        pass
    return {"rules": cmd_rules, "file": cmd_file, "report": cmd_report, "record": cmd_record, "watch": cmd_watch}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
