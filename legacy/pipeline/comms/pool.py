"""Run many prompts across several Gemini tabs at once, every answer checkpointed to disk.

    from comms.pool import run
    run({"key": "prompt", ...}, out_dir=Path(...), tabs=10)

One fresh chat per prompt, one worker per tab (the bridge routes each call by `tabId`). An answer is
written to `out_dir/answers/<key>.json` the moment it arrives, so a stopped run resumes where it was and
keys already answered are skipped. A prompt that fails is retried twice; when Gemini says the usage limit
is reached every worker pauses (30 minutes, then longer) and the run stops after the third limit, saying
so. `out_dir/status.json` is the live counter; `summary.txt` and a Windows toast mark the end.

Before every send the worker waits until its tab is ready (prompt box and model button shown, nothing
generating). A tab still answering one of our prompts (a send that looked failed but went through) is
waited for and the answer kept under its key, matched by the END of the prompt: all prompts share a long
instruction header (the first full run, 2026-10-14, loaded 10 tabs at once, sent into half-loaded pages and
then met BUSY on every tab). Tab problems (BUSY, a missing element, a menu that did not open) put the
prompt back in the queue without using its attempts; a tab that keeps failing is reloaded, then retired.

Every prompt is sent with the thinking level set and read back (default "high"): Argon's level resets to
the lowest on every new tab and reload, and a whole batch once ran on "low" unnoticed (2026-10-14). A send
whose level cannot be confirmed is not sent; each answer file records the model and the level confirmed.

Pace (2026-10-14): ten tabs sending 40-68k-character prompts at high thinking got the account refused after
about 25 prompts in 35 minutes. Default now: 3 tabs and at least `gap_s` seconds between any two sends; a
refusal pauses every worker (30 minutes, then longer), counted once however many tabs met it.

Long deterministic jobs run detached (owner's standing preference: highest thinking level, an alert at the
end, nobody watching).

A conversation instead of one prompt (`job=`, 2026-10-15, the scenario runner): `job(key, client)` gets the
bridge as its worker sees it (`TabClient`: every call goes to the worker's tab; every send carries the level and
is checked for a refusal, and every send after the first waits its turn like any prompt) and returns a dict
that is saved as the answer's `result`. `prompts[key]` is still the first prompt, used to recognise it on a tab;
an answer found on a tab is never kept for a job (the job runs again).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Empty, Queue
from typing import Callable, Optional

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

from gemini_bridge import browser_manager  # noqa: E402
from gemini_bridge.client import Gemini  # noqa: E402
from gemini_bridge.errors import GeminiError  # noqa: E402

# A refusal looks like a connection problem on the page ("check your internet connection" toast, the prompt put
# back in the box): that is how Gemini answered every tab once the account was throttled (2026-10-14).
LIMIT_RX = re.compile(r"reached your limit|reached (the|your) limit|usage limit|try again (later|tomorrow)|"
                      r"check your (internet )?connection|وصلت إلى الحد|الحد الأقصى|الاتصال بالإنترنت", re.I)
# Gemini's generic error ("حدث خطأ (1)", "Something went wrong"): once can be a hiccup, but on 2026-10-16 it began on
# one account's tabs after nine hours of use, a sign of throttling. Three on one account within 15 minutes count as
# a refusal of that account.
GENERIC_ERROR_RX = re.compile(r"حدث خطأ|something went wrong|an error occurred", re.I)
GENERIC_ERRORS, GENERIC_WINDOW_S = 3, 900


def toast(title: str, text: str) -> None:
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
        "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        f"$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('{title.replace(chr(39), chr(39) * 2)}')) > $null;"
        f"$t.Item(1).AppendChild($x.CreateTextNode('{text.replace(chr(39), chr(39) * 2)}')) > $null;"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Gratovo').Show([Windows.UI.Notifications.ToastNotification]::new($x))")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False)


class Status:
    def __init__(self, path: Path):
        self.path, self.lock = path, threading.Lock()
        self.s = {"total": 0, "done": 0, "skipped": 0, "failed": 0, "retries": 0, "limits": 0, "tabs": 0,
                  "pausedUntil": 0, "started": time.time(), "lastOk": None, "lastError": None, "finished": False}

    def update(self, **kw):
        with self.lock:
            for k, v in kw.items():
                if k.startswith("+"):
                    self.s[k[1:]] = self.s.get(k[1:], 0) + v
                else:
                    self.s[k] = v
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.s, indent=1), encoding="utf-8")
            os.replace(tmp, self.path)


class TabClient:
    """The bridge as one job sees it (run(job=...)): every call goes to the worker's tab; a send carries the
    run's level (and model, in a new chat), raises on a refusal, and waits its turn unless it is the first (the
    worker waited for that one)."""

    def __init__(self, g, tab_id: int, wait_turn: Callable[[], None], model: Optional[str], thinking: str):
        self.g, self.tab_id, self.wait_turn, self.model, self.thinking = g, tab_id, wait_turn, model, thinking
        self.sends = 0

    def call(self, method: str, params: Optional[dict] = None, timeout: Optional[float] = None):
        params = dict(params or {}, tabId=self.tab_id)
        if method != "send":
            return self.g.call(method, params, timeout=timeout)
        if self.sends:
            self.wait_turn()
        self.sends += 1
        if self.model and params.get("newChat"):
            params.setdefault("model", self.model)
        if self.thinking:
            params.setdefault("thinking", self.thinking)
        r = self.g.call("send", params, timeout=timeout)
        text = str(r.get("textRaw") or r.get("text") or "")
        if LIMIT_RX.search(text) and len(text) < 600:
            raise GeminiError("GEMINI_ERROR", "usage limit: " + text[:200])
        return r


def connect(port: int = 8765, wait_s: float = 60.0) -> Gemini:
    g = Gemini(port=port, auto_open=False, connect_timeout=wait_s)
    g.server.start()
    result = browser_manager.ensure_window(g, {"browser": "firefox", "timeoutS": wait_s})
    if not result.get("connected"):
        raise RuntimeError("Gemini bridge did not connect: " + str(result.get("message")))
    return g


def run(prompts: dict, out_dir: Path, tabs: int = 3, model: Optional[str] = "Argon", timeout_s: int = 900,
        mode: Optional[str] = None, skills: Optional[list] = None, port: int = 8765,
        log: Callable[[str], None] = print, title: str = "Gemini batch", thinking: str = "high",
        gap_s: float = 60, accounts: Optional[list] = None,
        job: Optional[Callable[[str, TabClient], dict]] = None) -> dict:
    out_dir = Path(out_dir)
    answers = out_dir / "answers"
    answers.mkdir(parents=True, exist_ok=True)
    status = Status(out_dir / "status.json")
    def answered(k: str) -> bool:
        # an answer whose thinking level was never confirmed does not count: it is asked again
        path = answers / f"{k}.json"
        if not path.exists():
            return False
        try:
            return not thinking or bool(json.loads(path.read_text(encoding="utf-8")).get("thinking"))
        except (OSError, ValueError):
            return False

    def settled(k: str) -> bool:
        """Answered, or given up on in this run (its error file is newer than the run's start)."""
        err = answers / f"{k}.error.txt"
        return answered(k) or (err.exists() and err.stat().st_mtime >= started)

    started = time.time()
    todo = [k for k in prompts if not answered(k)]
    status.update(total=len(prompts), skipped=len(prompts) - len(todo), tabs=tabs * len(accounts or [0]))
    if not todo:
        log("nothing to do")
        return {"done": 0}
    g = connect(port)
    # With `accounts` (e.g. [0, 1]) there are exactly `tabs` tabs on each account's /u/N/ and no others: tabs already
    # on an account are reused, the missing ones opened there. All tabs pull from one queue, so a tab that finishes
    # takes the next prompt whichever account it is on.
    def account_of(url: str) -> int:
        m = re.search(r"/u/(\d+)(?:/|$)", str(url or ""))
        return int(m.group(1)) if m else 0

    open_tabs = [(t["tabId"], account_of(t.get("url"))) for t in g.tabs()]
    if accounts:
        slots = []
        for a in accounts:
            mine = [x for x in open_tabs if x[1] == a][:tabs]
            while len(mine) < tabs:
                known = {t for t, _ in open_tabs} | {t for t, _ in slots} | {t for t, _ in mine}
                try:
                    tab_id = g.open(url=f"https://gemini.google.com/u/{a}/app", new_tab=True)["tabId"]
                except GeminiError as error:
                    # a slow page (2026-10-15: "content script never reported ready" on a tab that was fine a
                    # minute later): the tab exists, so wait for it instead of opening another
                    log(f"opening a tab on /u/{a}: {error}; waiting for it")
                    time.sleep(30)
                    new = [t["tabId"] for t in g.tabs() if t["tabId"] not in known and account_of(t.get("url")) == a]
                    if not new:
                        raise
                    tab_id = new[0]
                time.sleep(1.5)
                landed = g.call("get_url", {"tabId": tab_id}).get("accountIndex")
                if landed is not None and landed != a:   # Google sends a /u/N with no account behind it elsewhere
                    raise RuntimeError(f"account /u/{a} is not signed in (the tab landed on /u/{landed})")
                mine.append((tab_id, a))
            slots += mine
    else:
        slots = open_tabs[:tabs]
        while len(slots) < tabs:
            slots.append((g.open(new_tab=True)["tabId"], 0))
            time.sleep(1.5)
    acct_of = dict(slots)
    ids = [t for t, _ in slots]
    queue: Queue = Queue()
    for k in todo:
        queue.put((k, 0, 0))   # key, attempts used, tab problems met
    stop = threading.Event()
    lock = threading.Lock()
    # each account has its own pause (a refusal) and its own send spacing: one account being throttled never
    # holds back the other
    acct_state = {a: {"until": 0.0, "limits": 0, "next": 0.0, "workers": 0, "errors": []} for a in set(acct_of.values())}
    for a in acct_of.values():
        acct_state[a]["workers"] += 1
    pace_lock = threading.Lock()

    def wait_turn(tab_id: int) -> None:
        # spacing per account: at most one send every gap_s seconds on it, whatever the number of its tabs
        pace = acct_state[acct_of[tab_id]]
        with pace_lock:
            start = max(time.time(), pace["next"])
            pace["next"] = start + gap_s
        while time.time() < start and not stop.is_set():
            time.sleep(min(5.0, max(0.01, start - time.time())))

    def fingerprint(text: str) -> str:
        # The prompts share a long instruction header; what tells them apart is the end (the call itself).
        return " ".join(str(text or "").split())[-300:].lower()

    by_tail = {fingerprint(p): k for k, p in prompts.items()}

    def to_chat(tab_id: int) -> None:
        # A tab left on another Gemini page (the Skills page, a gem) has no prompt box.
        try:
            index = g.call("get_url", {"tabId": tab_id}).get("accountIndex") or 0
            g.call("navigate", {"url": f"https://gemini.google.com/u/{index}/app", "tabId": tab_id}, timeout=60)
        except Exception as error:  # noqa: BLE001 - the send that follows reports what is wrong
            log(f"tab {tab_id}: could not open the chat page: {error}")

    def save(key: str, text: str, tab_id: int, model, level, t0: float, **extra) -> None:
        rec = {"key": key, "text": text, "model": model, "thinking": level, "thinkingRequested": thinking,
               "durationMs": int((time.time() - t0) * 1000), "tab": tab_id, "account": acct_of.get(tab_id), "at": time.strftime("%Y-%m-%d %H:%M:%S"), **extra}
        tmp = answers / f"{key}.json.tmp"
        tmp.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, answers / f"{key}.json")
        status.update(**{"+done": 1}, lastOk=time.time())

    def wait_answer(tab_id: int) -> Optional[str]:
        """The tab's last answer once it is complete and has stopped changing (None on timeout)."""
        deadline = time.time() + timeout_s
        last_text, stable_since = None, time.time()
        while time.time() < deadline and not stop.is_set():
            try:
                r = g.call("get_last_response", {"tabId": tab_id}, timeout=30)
            except Exception:  # noqa: BLE001 - a slow page: ask again
                time.sleep(5)
                continue
            text = str(r.get("textRaw") or r.get("text") or "")
            if text != last_text:
                last_text, stable_since = text, time.time()
            if r.get("complete") and text and time.time() - stable_since >= 3:
                return text
            time.sleep(4)
        return None

    LEVEL_IN_LABEL = {"مرتفع": "مرتفع", "high": "high", "متوسط": "متوسط", "medium": "medium"}

    def level_now(tab_id: int) -> Optional[str]:
        # same page, no reload since the send set the level before typing: read it back for the record.
        # The model button names the level once it is above the lowest ("Argon مرتفع"): no menu needed.
        for _ in range(3):
            try:
                label = str((g.call("status", {"tabId": tab_id}, timeout=20).get("model") or {}).get("name") or "")
                hit = next((v for k, v in LEVEL_IN_LABEL.items() if k in label.lower()), None)
                if hit:
                    return hit
                return g.call("list_thinking_levels", {"tabId": tab_id}, timeout=30).get("current")
            except Exception:  # noqa: BLE001 - a frozen background tab: it is woken up, ask again
                time.sleep(5)
        return None

    def last_prompt_key(tab_id: int) -> Optional[str]:
        try:
            convo = g.call("get_conversation", {"tabId": tab_id}, timeout=30)
        except Exception:  # noqa: BLE001
            return None
        users = [t for t in convo if t.get("role") == "user"]
        return by_tail.get(fingerprint(users[-1].get("text"))) if users else None

    def sent_late(tab_id: int, key: str, wait_s: float = 60) -> bool:
        """A long prompt the page was slow to show (a background tab): give it a minute to appear before
        calling the send refused, so it is not sent a second time from another tab."""
        deadline = time.time() + wait_s
        while not stop.is_set():
            if last_prompt_key(tab_id) == key:
                return True
            if time.time() > deadline:
                return False
            time.sleep(10)
        return False

    def generating(tab_id: int) -> bool:
        try:
            return bool(g.call("status", {"tabId": tab_id}, timeout=20).get("generating"))
        except Exception:  # noqa: BLE001 - unknown counts as busy
            return True

    def halt(tab_id: int) -> bool:
        """Stop the tab's generation, and reload it on a fresh chat when stop does not take. True once it is idle."""
        try:
            g.call("stop", {"tabId": tab_id}, timeout=30)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(3)
        if generating(tab_id):
            to_chat(tab_id)
            time.sleep(5)
        return not generating(tab_id)

    def salvage(tab_id: int) -> bool:
        """The tab is answering: if it is one of our prompts (a send that looked failed but went through),
        wait for the answer and keep it under the right key; a generation that never ends is stopped. False when the
        tab could not be brought back to idle."""
        key = last_prompt_key(tab_id)
        if job:
            # With a job (the engine) an answer left on a tab is never kept: the job that sent it already failed, so
            # stop it at once (2026-10-16, run-02 base: tab 4 waited out 900 s twenty times over five hours).
            log(f"tab {tab_id}: stopping a generation left on it")
            return halt(tab_id)
        log(f"tab {tab_id}: waiting for the answer already on it ({key or 'not one of ours'})")
        t0 = time.time()
        text = wait_answer(tab_id)
        if text is None:
            log(f"tab {tab_id}: stopping a generation that did not finish in {timeout_s}s")
            return halt(tab_id)
        if key and not answered(key):
            if LIMIT_RX.search(text) and len(text) < 600:
                return True
            save(key, text, tab_id, None, level_now(tab_id), t0, recovered="answer found on the tab")
            log(f"ok {key} (found answering on tab {tab_id})")
        return True

    def ready(tab_id: int, wait_s: float = 120) -> bool:
        """Prompt box and model button present, nothing generating (an answer in progress is salvaged first). A tab
        that stays 'generating' through a stop and a reload twice is not ready: its prompt goes back to the queue."""
        deadline = time.time() + wait_s
        stuck = 0
        while not stop.is_set():
            try:
                st = g.call("status", {"tabId": tab_id}, timeout=20)
            except Exception:  # noqa: BLE001
                st = {}
            els = st.get("elements") or {}
            if st.get("generating"):
                if not salvage(tab_id):
                    stuck += 1
                    if stuck >= 2:
                        log(f"tab {tab_id}: still generating after a stop and a reload, twice")
                        return False
                deadline = time.time() + 30
                continue
            if (els.get("textarea") or {}).get("found") and (els.get("modelSwitcher") or {}).get("found"):
                return True
            if time.time() > deadline:
                return False
            time.sleep(4)
        return False

    # Problems of the tab, not of the prompt: they never use up a prompt's attempts (up to TAB_LIMIT per prompt).
    # WRONG_CHAT: the engine found the tab's answer under another prompt (comms/engine.py _ours). "model menu": the
    # page would not open its model menu, retry after retry on one tab (2026-10-16), which burnt prompts' attempts.
    TAB_PROBLEM = re.compile(r"BUSY|ELEMENT_NOT_FOUND|TAB_NOT_READY|THINKING_NOT_SET|waiting for new chat|NO_TAB|"
                             r"EXTENSION_NOT_CONNECTED|input area|WRONG_CHAT|model menu")
    MAYBE_SENT = re.compile(r"SEND_NOT_ACCEPTED|response to complete|TIMEOUT")
    TAB_LIMIT = 6

    def worker(tab_id: int):
        acct = acct_state[acct_of[tab_id]]
        strikes = 0   # consecutive tab problems on this tab

        def retire() -> None:
            with lock:
                acct["workers"] -= 1
                if all(a["workers"] <= 0 for a in acct_state.values()):
                    stop.set()

        # an answer to one of our prompts left on the tab by a stopped run (finished or not) is kept
        found = last_prompt_key(tab_id)
        if found and not answered(found):
            salvage(tab_id)
        try:
            st = g.call("status", {"tabId": tab_id}, timeout=20)
            if not (st.get("elements") or {}).get("textarea", {}).get("found") and not st.get("generating"):
                to_chat(tab_id)
        except Exception:  # noqa: BLE001
            to_chat(tab_id)
        while not stop.is_set():
            # an account that is paused takes nothing from the queue: the other account's free tabs do
            while time.time() < acct["until"] and not stop.is_set():
                time.sleep(5)
            if acct["limits"] >= 3:
                log(f"tab {tab_id}: account /u/{acct_of[tab_id]} was refused three times, its tabs stop")
                retire()
                return
            try:
                key, attempt, tab_probs = queue.get(timeout=2)
            except Empty:
                if all(settled(k) for k in todo):
                    return
                continue   # a prompt is still out on another tab and may come back to the queue
            if stop.is_set():
                return
            if answered(key):
                continue   # found on a tab meanwhile
            if not ready(tab_id):
                to_chat(tab_id)
                if not ready(tab_id):
                    strikes += 1
                    queue.put((key, attempt, tab_probs))
                    log(f"tab {tab_id}: not ready ({strikes})")
                    if strikes >= 4:
                        log(f"tab {tab_id}: retired after {strikes} problems in a row")
                        retire()
                        return
                    time.sleep(15)
                    continue
            wait_turn(tab_id)
            if time.time() < acct["until"] or stop.is_set():   # refused while this tab waited for its turn
                queue.put((key, attempt, tab_probs))
                continue
            t0 = time.time()
            try:
                if job:
                    result = job(key, TabClient(g, tab_id, lambda: wait_turn(tab_id), model, thinking))
                    save(key, "", tab_id, result.get("model"), result.get("thinking"), t0, result=result)
                    strikes = 0
                    log(f"ok {key} ({time.time() - t0:.0f}s, tab {tab_id}, {result.get('status')})")
                    continue
                params = {"text": prompts[key], "wait": True, "newChat": True, "tabId": tab_id,
                          "timeoutMs": timeout_s * 1000}
                if model:
                    params["model"] = model
                if mode:
                    params["mode"] = mode
                if skills:
                    params["skills"] = skills
                if thinking:
                    params["thinking"] = thinking
                r = g.call("send", params, timeout=timeout_s + 60)
                text = str(r.get("textRaw") or r.get("text") or "")
                if LIMIT_RX.search(text) and len(text) < 600:
                    raise GeminiError("GEMINI_ERROR", "usage limit: " + text[:200])
                if thinking and not r.get("thinking"):
                    # an add-on older than 0.3.2 ignores the parameter: never keep such an answer
                    raise GeminiError("THINKING_NOT_SET", "the add-on did not confirm the thinking level")
                save(key, text, tab_id, r.get("model"), r.get("thinking"), t0)
                strikes = 0
                log(f"ok {key} ({time.time() - t0:.0f}s, tab {tab_id})")
            except Exception as error:  # noqa: BLE001 - one prompt never stops the pool
                msg = f"{type(error).__name__}: {error}"[:300]
                if not job and MAYBE_SENT.search(msg) and sent_late(tab_id, key):
                    text = wait_answer(tab_id)
                    if text and not (LIMIT_RX.search(text) and len(text) < 600):
                        save(key, text, tab_id, None, level_now(tab_id), t0, recovered=msg[:80])
                        strikes = 0
                        log(f"ok {key} (tab {tab_id}, recovered after: {msg[:60]})")
                        continue
                throttled = False
                if GENERIC_ERROR_RX.search(msg):
                    with lock:
                        acct["errors"] = [t for t in acct["errors"] if time.time() - t < GENERIC_WINDOW_S] + [time.time()]
                        throttled = len(acct["errors"]) >= GENERIC_ERRORS
                        if throttled:
                            acct["errors"] = []
                if LIMIT_RX.search(msg) or throttled:
                    with lock:
                        if time.time() >= acct["until"]:   # tabs of one account refused in the same moment count once
                            acct["limits"] += 1
                            wait = 1800 * acct["limits"]
                            acct["until"] = time.time() + wait
                            status.update(limits=sum(a["limits"] for a in acct_state.values()),
                                          pausedUntil=min(a["until"] for a in acct_state.values()), lastError=msg)
                            log(f"usage limit or refusal #{acct['limits']} (tab {tab_id}, account /u/{acct_of[tab_id]}): "
                                f"pausing that account {wait // 60} min: {msg[:120]}")
                    queue.put((key, attempt, tab_probs))
                elif "response to complete" in msg and tab_probs < TAB_LIMIT:
                    # 2026-10-16 evening: two tabs timed out on prompt after prompt for an hour while a third tab on
                    # the same account answered in minutes. The page is at fault, not the prompt: stop and reload it,
                    # give the prompt back without using an attempt, and retire the tab after three in a row.
                    strikes += 1
                    status.update(**{"+tabProblems": 1}, lastError=msg)
                    log(f"tab {tab_id}: no complete answer in {timeout_s}s ({strikes} in a row), {key} goes back in the queue")
                    queue.put((key, attempt, tab_probs + 1))
                    halt(tab_id)
                    if strikes >= 3:
                        log(f"tab {tab_id}: retired after {strikes} timeouts in a row")
                        retire()
                        return
                elif TAB_PROBLEM.search(msg) and tab_probs < TAB_LIMIT:
                    strikes += 1
                    status.update(**{"+tabProblems": 1}, lastError=msg)
                    log(f"tab {tab_id} problem ({strikes} in a row), {key} goes back in the queue: {msg}")
                    queue.put((key, attempt, tab_probs + 1))
                    if strikes >= 3 or "WRONG_CHAT" in msg:
                        to_chat(tab_id)
                    if strikes >= 6:
                        log(f"tab {tab_id}: retired after {strikes} problems in a row")
                        retire()
                        return
                    time.sleep(min(60, 10 * strikes))
                elif attempt < 2:
                    status.update(**{"+retries": 1}, lastError=msg)
                    log(f"retry {key} (tab {tab_id}): {msg}")
                    queue.put((key, attempt + 1, tab_probs))
                else:
                    status.update(**{"+failed": 1}, lastError=msg)
                    (answers / f"{key}.error.txt").write_text(msg, encoding="utf-8")
                    log(f"gave up {key} (tab {tab_id}): {msg}")

    threads = [threading.Thread(target=worker, args=(tid,), daemon=True) for tid in ids]
    for i, t in enumerate(threads):
        t.start()
        time.sleep(3 if i < len(threads) - 1 else 0)  # stagger the first prompts
    for t in threads:
        t.join()
    s = status.s
    summary = (f"{title}: {s['done']} answered, {s['failed']} failed, {s['skipped']} were already done, "
               f"{s['limits']} usage-limit pauses{' (stopped early)' if stop.is_set() else ''}")
    status.update(finished=True)
    (out_dir / "summary.txt").write_text(summary + "\n", encoding="utf-8")
    toast(title, summary)
    log(summary)
    g.close()
    return s
