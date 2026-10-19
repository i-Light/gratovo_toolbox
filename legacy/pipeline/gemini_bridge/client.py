"""`Gemini` -- the synchronous facade another program drives Gemini through.

    from gemini_bridge import Gemini

    with Gemini() as g:                      # starts the server, waits for the extension
        g.ensure_account("moustafa")
        print(g.ask("Five keywords about solar panels", new_chat=True))

Every method is a thin, blocking wrapper over one extension RPC
(PROTOCOL.md §3) plus a handful of compositions -- `ask`, `wait`,
`ensure_account`, `heal` -- that are spelled out in PROTOCOL.md §7. Nothing
here is clever on purpose: the value of the bridge is that a call either
returns the thing it says it returns or raises a `GeminiError` whose `.code`
says exactly why, and that the caller never has to think about threads.

Event callbacks (`on("job", fn)`) run on the bridge's dispatcher thread, not
the caller's; they may call back into the bridge freely.
"""

from __future__ import annotations

import logging
import queue
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional, Union

from . import actions
from .errors import (
    AccountNotFound,
    BadParams,
    BridgeTimeout,
    ExtensionNotConnected,
    GeminiError,
    JobFailed,
    SignedOut,
)
from .server import DEFAULT_PORT, NOT_CONNECTED_MESSAGE, BridgeServer

GEMINI_APP_URL = "https://gemini.google.com/app"
GEMINI_ORIGIN = "https://gemini.google.com"
# `/u/<n>/` right after the origin is Google's account selector in a URL.
_ACCOUNT_PATH = re.compile(r"^/u/\d+(?=/|$)")

#: Job statuses after which nothing else will happen to the job.
TERMINAL_STATUSES = frozenset({"done", "error", "cancelled"})

# `ensure_account` tries `/u/0` … `/u/9` -- Google itself caps the account
# chooser well below ten, and the redirect rule stops the loop early anyway.
MAX_ACCOUNT_INDEX = 9

# Head-room the RPC gets over the extension's own wait, so that when a `send`
# genuinely takes the full `timeoutMs` the *extension's* TIMEOUT (which
# carries `partial`) is the one that reaches the caller, not ours.
RPC_GRACE_SECONDS = 15.0


@dataclass
class Job:
    """A queued prompt, as the extension last reported it (`.raw` is the full dict)."""

    raw: dict = field(repr=False)

    @property
    def id(self) -> str:
        return str(self.raw.get("id", ""))

    @property
    def status(self) -> str:
        return str(self.raw.get("status", ""))

    @property
    def prompt(self) -> str:
        return str(self.raw.get("prompt", ""))

    @property
    def meta(self) -> dict:
        meta = self.raw.get("meta")
        return meta if isinstance(meta, dict) else {}

    @property
    def result(self) -> Optional[dict]:
        result = self.raw.get("result")
        return result if isinstance(result, dict) else None

    @property
    def error(self) -> Optional[dict]:
        error = self.raw.get("error")
        return error if isinstance(error, dict) else None

    @property
    def text(self) -> Optional[str]:
        """The answer's text once the job is done, else None."""
        result = self.result
        if result is None:
            return None
        text = result.get("text")
        return text if isinstance(text, str) else None

    @property
    def finished(self) -> bool:
        return self.status in TERMINAL_STATUSES

    def __repr__(self) -> str:
        return f"Job({self.id!r}, {self.status!r})"


JobRef = Union[Job, str, dict]


def _job_id(job: JobRef) -> str:
    if isinstance(job, Job):
        return job.id
    if isinstance(job, dict):
        return str(job.get("id", ""))
    return str(job)


def _account_matches(account: Optional[dict], needle: str) -> bool:
    if not isinstance(account, dict):
        return False
    for key in ("name", "email"):
        value = account.get(key)
        if isinstance(value, str) and needle in value.lower():
            return True
    return False


def _describe_account(account: Optional[dict]) -> str:
    if not isinstance(account, dict):
        return "unknown"
    name = account.get("name") or "?"
    email = account.get("email")
    return f"{name} ({email})" if email else str(name)


class Gemini:
    """Drives the Gemini web UI through the extension; use as a context manager."""

    def __init__(self, port: int = DEFAULT_PORT, connect_timeout: float = 60.0,
                 call_timeout: float = 30.0, auto_open: bool = True,
                 logger: Optional[logging.Logger] = None,
                 data_dir: Optional[Path] = None):
        self.connect_timeout = float(connect_timeout)
        self.call_timeout = float(call_timeout)
        # Where `data/gemini skills/` lives, for the actions that prepend a
        # skill file. None means the repo's `data/` (or $GRATOVO_DATA_DIR).
        self.data_dir: Optional[Path] = Path(data_dir) if data_dir else None
        # When True, `connect()` asks the extension to `open` (or reuse) a
        # Gemini tab before returning, so the first real call does not spend
        # its own timeout on page loading and "no browser" fails early and
        # clearly. The extension opens a tab on demand regardless (§3).
        self.auto_open = bool(auto_open)
        self.log = logger or logging.getLogger("gemini_bridge")
        self.server = BridgeServer(port=port, logger=self.log.getChild("server"))

    # --- lifecycle -----------------------------------------------------------

    def __enter__(self) -> "Gemini":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def connect(self) -> "Gemini":
        """Starts the server and waits up to `connect_timeout` for the extension; raises `ExtensionNotConnected`."""
        self.server.start()
        if not self.server.wait_for_extension(self.connect_timeout):
            self.server.stop()
            raise ExtensionNotConnected(
                message=(f"no extension connected to ws://127.0.0.1:{self.port} within "
                         f"{self.connect_timeout:g}s. " + NOT_CONNECTED_MESSAGE))
        if self.auto_open:
            try:
                self.open(focus=False)
            except BaseException:
                # `__enter__` is failing: do not leave the server thread behind.
                self.server.stop()
                raise
        return self

    def close(self) -> None:
        """Stops the server; the extension will keep reconnecting in the background."""
        self.server.stop()

    @property
    def port(self) -> int:
        """The port the server is bound to."""
        return self.server.port

    @property
    def connected(self) -> bool:
        """True while the extension's socket is open."""
        return self.server.connected

    def wait_for_extension(self, timeout: Optional[float] = None) -> bool:
        """Blocks until the extension connects; returns False on timeout."""
        return self.server.wait_for_extension(timeout)

    # --- the escape hatch ----------------------------------------------------

    def call(self, method: str, params: Optional[dict] = None,
             timeout: Optional[float] = None) -> Any:
        """Sends any method by name and returns its raw result."""
        return self.server.call(method, params or {},
                                self.call_timeout if timeout is None else timeout)

    def _call_waiting(self, method: str, params: dict, timeout: Optional[float]) -> Any:
        """A call whose extension-side wait is `timeout` seconds; the RPC gets a little longer."""
        if timeout is not None:
            params = {**params, "timeoutMs": int(timeout * 1000)}
            rpc_timeout = timeout + RPC_GRACE_SECONDS
        else:
            rpc_timeout = self.call_timeout
        return self.call(method, params, timeout=rpc_timeout)

    # --- inspection ----------------------------------------------------------

    def status(self) -> dict:
        """The status object (url, account, model, generating, elements, queue, ...)."""
        return self.call("status")

    def diagnostics(self) -> dict:
        """The diagnostics object (§4): every element, what was tried, candidates, overrides."""
        return self.call("diagnostics")

    def account(self) -> dict:
        """The signed-in account: `{"name", "email", "index"}` (name/email may be None)."""
        return self.call("get_account")

    def model(self) -> str:
        """The label on the model switcher, e.g. "2.5 Pro"."""
        return str(self.call("get_model").get("name", ""))

    def models(self) -> list:
        """The model menu: `[{"name", "description", "selected"}]`."""
        return list(self.call("list_models") or [])

    def is_generating(self) -> bool:
        """Whether Gemini is producing an answer right now."""
        return bool(self.call("is_generating").get("generating"))

    def last_response(self) -> dict:
        """The last model answer: `{"index", "text", "html", "complete"}` (index -1 when the chat is empty)."""
        return self.call("get_last_response")

    def conversation(self) -> list:
        """Every turn in page order: `[{"role": "user"|"model", "text"}]`."""
        return list(self.call("get_conversation") or [])

    def url(self) -> str:
        """The tab's current URL."""
        return str(self.call("get_url").get("url", ""))

    def text(self) -> str:
        """What is in the prompt box."""
        return str(self.call("get_text").get("text", ""))

    # --- actions -------------------------------------------------------------

    def set_model(self, name: str, timeout: Optional[float] = None) -> str:
        """Picks a model by (case-insensitive) name or substring; returns the label now shown."""
        result = self._call_waiting("set_model", {"model": name}, timeout)
        return str(result.get("name", ""))

    def new_chat(self, timeout: Optional[float] = None) -> dict:
        """Starts a new chat; returns `{"url"}`."""
        return self._call_waiting("new_chat", {}, timeout)

    def set_text(self, text: str) -> None:
        """Replaces the prompt box contents (verified by reading back)."""
        self.call("set_text", {"text": text})

    def clear_text(self) -> None:
        """Empties the prompt box."""
        self.call("clear_text")

    def send(self, text: Optional[str] = None, *, wait: bool = True,
             new_chat: bool = False, model: Optional[str] = None,
             interrupt: bool = False, timeout: float = 180.0,
             mode: Optional[str] = None, skills: Optional[list] = None,
             thinking: Optional[str] = None) -> dict:
        """Sends a prompt; with `wait` returns `{"index", "text", "textRaw", "html", "durationMs", "model", "thinking", "mode", "task"}`, else `{"sent": True}`.

        `mode` "task" runs it as a Gemini task (Pro/Ultra plans; minutes, not
        seconds: give `timeout` room); "chat" makes sure it is a plain chat.
        `skills` are picked from the prompt box's `@` list in front of the text
        (an inactive skill works too); `task` in the result is the task's step
        list (`done`, `waitingForUser`, `steps`) or None for a chat answer.
        `thinking` ("low" / "medium" / "high", or the page's own label) is set and
        read back before anything is typed (THINKING_NOT_SET if it cannot be
        confirmed): the level resets to the lowest on every new tab and reload,
        so a caller that cares passes it on every send; `thinking` in the
        result is the level confirmed.
        """
        params: dict = {"wait": bool(wait)}
        if text is not None:
            params["text"] = text
        if new_chat:
            params["newChat"] = True
        if model:
            params["model"] = model
        if interrupt:
            params["interrupt"] = True
        if mode:
            if mode not in ("chat", "task"):
                raise BadParams(message=f"mode must be 'chat' or 'task', not {mode!r}")
            params["mode"] = mode
        if skills:
            params["skills"] = [str(s) for s in skills]
        if thinking:
            params["thinking"] = str(thinking)
        # With `wait=False` the extension answers as soon as the send took;
        # `timeoutMs` still bounds the `newChat` / `model` steps before it.
        return self._call_waiting("send", params, timeout)

    def ask(self, prompt: str, new_chat: bool = False, model: Optional[str] = None,
            timeout: float = 180.0, interrupt: bool = False,
            mode: Optional[str] = None, skills: Optional[list] = None,
            thinking: Optional[str] = None) -> str:
        """Sends `prompt`, waits for the whole answer and returns its text."""
        result = self.send(prompt, wait=True, new_chat=new_chat, model=model,
                           interrupt=interrupt, timeout=timeout, mode=mode, skills=skills,
                           thinking=thinking)
        text = result.get("text") if isinstance(result, dict) else None
        return text if isinstance(text, str) else ""

    # --- Gemini 4 Argon: chat/task mode, thinking level ------------------------

    def mode(self) -> Optional[str]:
        """"chat" or "task" (the toggle under the prompt box), None when the page has no toggle."""
        return self.call("get_mode").get("mode")

    def set_mode(self, mode: str, timeout: Optional[float] = None) -> dict:
        """Switches the toggle; returns `{"mode", "changed"}`."""
        return self._call_waiting("set_mode", {"mode": mode}, timeout)

    def task(self) -> dict:
        """The last response's task progress: `{"index", "url", "task": {done, waitingForUser, headline, steps} | None, "generating", "textRaw"}`."""
        return self.call("get_task")

    def thinking_levels(self) -> dict:
        """The thinking-level submenu: `{"menu", "levels": [{name, description, selected}], "current"}`."""
        return self.call("list_thinking_levels", timeout=20.0)

    def set_thinking_level(self, level: str, timeout: Optional[float] = None) -> dict:
        """Picks a thinking level ("high" works on the Arabic page too) and reads it back; returns `{"level", "changed", "verified"}`."""
        return self._call_waiting("set_thinking_level", {"level": level}, timeout)

    def stop(self) -> bool:
        """Clicks Stop; returns whether there was something to stop."""
        return bool(self.call("stop").get("stopped"))

    # --- tabs ----------------------------------------------------------------

    def tabs(self) -> list:
        """Every Gemini tab: `[{"tabId", "url", "title", "active", "ready"}]`."""
        return list(self.call("tabs") or [])

    def open(self, url: Optional[str] = None, focus: bool = False,
             new_tab: bool = False, timeout: Optional[float] = None) -> dict:
        """Opens (or reuses) a Gemini tab and returns it."""
        params: dict = {"focus": bool(focus), "newTab": bool(new_tab)}
        if url:
            params["url"] = url
        return self._call_waiting("open", params, timeout)

    def focus(self) -> dict:
        """Brings the Gemini tab and its window to the front."""
        return self.call("focus")

    def navigate(self, url: str, timeout: Optional[float] = None) -> dict:
        """Loads `url` in the Gemini tab; returns `{"tabId", "url", "redirected", "requestedUrl"}`."""
        return self._call_waiting("navigate", {"url": url}, timeout)

    def reload(self, timeout: Optional[float] = None) -> dict:
        """Hard-reloads the Gemini tab and waits for it to be ready."""
        return self._call_waiting("reload_page", {}, timeout)

    def reload_extension(self, timeout: Optional[float] = None) -> dict:
        """Reloads the extension from disk (`chrome.runtime.reload()`) and waits
        for it to reconnect. Use after editing files under gemini_extension/."""
        result = self.call("reload_extension", {}, timeout=10.0)
        # The old socket closes a moment after the reply; wait for that so the
        # connected flag we then wait on belongs to the reloaded worker.
        deadline = time.monotonic() + 5.0
        while self.server.connected and time.monotonic() < deadline:
            time.sleep(0.1)
        if not self.wait_for_extension(timeout if timeout is not None else self.connect_timeout):
            raise ExtensionNotConnected(message="the extension did not reconnect after reload")
        # The browser keeps routing messages to the tab's OLD content script
        # after the reload; only a page reload swaps in the new one.
        try:
            self.reload(timeout)
        except GeminiError as e:
            self.log.warning("extension reloaded but the Gemini tab could not be reloaded: %s", e)
        return result

    def switch_account(self, index: int, timeout: Optional[float] = None) -> dict:
        """Navigates to `/u/<index>/app`; returns `{"requested", "landedIndex", "url", "redirected", "account"}`."""
        return self._call_waiting("switch_account", {"index": int(index)}, timeout)

    def open_gem(self, gem: str, timeout: Optional[float] = None) -> dict:
        """Opens a gem (id or full URL) under the current account's `/u/N/`; returns `{"url", "tabId"}`."""
        gem = (gem or "").strip()
        if not gem:
            raise BadParams(message="open_gem needs a gem id or URL")
        index = self.call("get_url").get("accountIndex")
        index = index if isinstance(index, int) and index >= 0 else 0
        if gem.startswith(("http://", "https://")):
            scheme, _, rest = gem.partition("://")
            host, slash, path = rest.partition("/")
            path = "/" + path if slash else "/"
            path = _ACCOUNT_PATH.sub("", path) or "/"
            url = f"{scheme}://{host}/u/{index}{path}"
        else:
            url = f"{GEMINI_ORIGIN}/u/{index}/gem/{gem.strip('/')}"
        landed = self.navigate(url, timeout=timeout)
        return {"url": landed.get("url", url), "tabId": landed.get("tabId")}

    def ensure_account(self, match: str) -> dict:
        """Makes sure the tab is on the account whose name or email contains `match` (case-insensitive).

        The current account is checked first. Otherwise `/u/0`, `/u/1`, ...
        are visited in turn until one matches. Google redirects a `/u/N` that
        has no account behind it to a lower index (or to a URL without
        `/u/` at all) -- that redirect is how the loop knows it has seen
        every signed-in account, and it is where the loop stops. A `/u/N`
        that lands on a sign-in page means the same thing.

        Raises `AccountNotFound` whose `.tried` lists every `(index, account)`
        seen, so the caller (or the CLI) can say which accounts ARE signed in.
        """
        needle = (match or "").strip().lower()
        if not needle:
            raise BadParams(message="ensure_account needs a non-empty name or email fragment")

        current = self.account()
        if _account_matches(current, needle):
            return current

        tried: list[tuple[int, dict]] = []
        for index in range(MAX_ACCOUNT_INDEX + 1):
            try:
                switched = self.switch_account(index)
            except SignedOut:
                break
            landed = switched.get("landedIndex")
            landed_index = landed if isinstance(landed, int) else index
            landed_url = str(switched.get("url") or "")
            if switched.get("redirected") and (landed_index < index or "/u/" not in landed_url):
                break
            account = switched.get("account")
            if not isinstance(account, dict):
                account = self.account()
            tried.append((index, account))
            if _account_matches(account, needle):
                return account

        signed_in = ", ".join(f"/u/{i}: {_describe_account(a)}" for i, a in tried) or "none"
        raise AccountNotFound(
            message=f"no signed-in account matches {match!r}; signed in: {signed_in}",
            details={"wanted": match}, tried=tried)

    # --- the queue -----------------------------------------------------------

    def queue(self, prompt: str, new_chat: bool = False, model: Optional[str] = None,
              timeout: Optional[float] = None, meta: Optional[dict] = None) -> Job:
        """Adds a prompt to the extension's queue and returns its `Job` (status "queued")."""
        params: dict = {"prompt": prompt}
        if new_chat:
            params["newChat"] = True
        if model:
            params["model"] = model
        if timeout is not None:
            params["timeoutMs"] = int(timeout * 1000)
        if meta:
            params["meta"] = dict(meta)
        return Job(self.call("queue_add", params))

    def job(self, job: JobRef) -> Job:
        """Fetches the current state of a job by id (or Job)."""
        return Job(self.call("queue_get", {"jobId": _job_id(job)}))

    def jobs(self) -> list[Job]:
        """Every job the extension still holds, oldest first (finished ones included)."""
        listed = self.call("queue_list") or {}
        return [Job(j) for j in listed.get("jobs", []) if isinstance(j, dict)]

    def cancel(self, job: JobRef) -> Job:
        """Cancels a queued job, or stops a running one; returns the job."""
        return Job(self.call("queue_cancel", {"jobId": _job_id(job)}))

    def clear_queue(self, include_running: bool = False) -> int:
        """Drops every queued job (and the running one if asked); returns how many."""
        result = self.call("queue_clear", {"includeRunning": bool(include_running)}) or {}
        return int(result.get("removed", 0))

    def pause(self) -> None:
        """Stops the queue from starting new jobs (the running one finishes)."""
        self.call("queue_pause")

    def resume(self) -> None:
        """Lets a paused queue run again."""
        self.call("queue_resume")

    def wait(self, job: JobRef, timeout: float = 300.0, poll: float = 2.0) -> str:
        """Blocks until `job` finishes and returns its text; raises `JobFailed` or `BridgeTimeout`."""
        return self.wait_job(job, timeout=timeout, poll=poll).text or ""

    def wait_job(self, job: JobRef, timeout: float = 300.0, poll: float = 2.0) -> Job:
        """Blocks until `job` is done and returns it; `JobFailed` on error/cancelled, `BridgeTimeout` on timeout.

        Two ways to learn the outcome, used together: `job` events as they
        arrive, and a `queue_get` every `poll` seconds. The poll is not a
        nicety -- the extension keeps working while Python is disconnected
        (PROTOCOL.md, queue rules), so the event for a job that finished
        during a reconnect is never sent. A disconnected or slow extension
        is waited out, up to `timeout` -- unless this bridge itself was
        stopped, which ends the wait at once.
        """
        job_id = _job_id(job)
        if not job_id:
            raise BadParams(message="wait() needs a job id")
        finished: queue.Queue = queue.Queue()

        def on_job(data: dict) -> None:
            if data.get("id") == job_id and data.get("status") in TERMINAL_STATUSES:
                finished.put(data)

        self.on("job", on_job)
        try:
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BridgeTimeout(
                        message=f"job {job_id} did not finish within {timeout:g}s",
                        details={"phase": "job", "jobId": job_id,
                                 "timeoutMs": int(timeout * 1000)})
                try:
                    latest = finished.get(timeout=min(poll, remaining))
                except queue.Empty:
                    try:
                        latest = self.call("queue_get", {"jobId": job_id})
                    except (ExtensionNotConnected, BridgeTimeout):
                        if not self.server.running:
                            raise
                        continue
                if isinstance(latest, dict) and latest.get("status") in TERMINAL_STATUSES:
                    return self._job_outcome(latest)
        finally:
            self.off("job", on_job)

    @staticmethod
    def _job_outcome(raw: dict) -> Job:
        job = Job(raw)
        if job.status == "done":
            return job
        error = job.error or {}
        if job.status == "cancelled":
            code = str(error.get("code") or "CANCELLED")
            message = str(error.get("message") or f"job {job.id} was cancelled")
        else:
            code = str(error.get("code") or "JOB_FAILED")
            message = str(error.get("message") or f"job {job.id} failed")
        details = error.get("details")
        details = dict(details) if isinstance(details, dict) else {}
        details["job"] = raw
        raise JobFailed(code, message, details)

    # --- self-healing --------------------------------------------------------

    def selectors(self) -> dict:
        """`{"builtin": {element: [strategy]}, "overrides": {element: [strategy]}}`."""
        return self.call("get_selectors")

    def set_selectors(self, overrides: dict) -> dict:
        """Replaces the override map (`{element: [strategy, ...]}`; `{}` clears) and returns `selectors()`."""
        return self.call("set_selectors", {"overrides": dict(overrides)})

    def heal(self, element: str, pick: int = 0) -> dict:
        """Applies the `pick`-th suggestion from `diagnostics()` for `element` as a new first override; returns it.

        The suggestion is PREPENDED to the element's existing overrides (which
        the extension in turn prepends to its builtin list), so a fix that
        turns out wrong is undone with `set_selectors` and nothing else is
        lost. Raises `GeminiError("NO_SUGGESTION")` when the diagnostics
        offer nothing to try.
        """
        return self._heal(element, pick)[0]

    def _heal(self, element: str, pick: int) -> tuple[dict, list]:
        """`heal` plus the full suggestion list it chose from (the daemon reports both)."""
        diag = self.diagnostics() or {}
        elements = diag.get("elements") or {}
        if element not in elements:
            raise BadParams(
                message=f"unknown element {element!r}; diagnostics know: {', '.join(sorted(elements)) or 'none'}",
                details={"element": element, "known": sorted(elements)})
        suggestions = [s for s in (elements[element].get("suggestions") or []) if isinstance(s, dict)]
        if not suggestions or not 0 <= pick < len(suggestions):
            raise GeminiError(
                "NO_SUGGESTION",
                f"no suggestion #{pick} for {element!r} ({len(suggestions)} available)",
                {"element": element, "pick": pick, "suggestions": suggestions})
        chosen = suggestions[pick]
        # A suggestion may be the bare strategy or wrap it as {"strategy": …}.
        strategy = chosen.get("strategy") if isinstance(chosen.get("strategy"), dict) else chosen
        overrides = diag.get("overrides")
        if not isinstance(overrides, dict):
            overrides = (self.selectors() or {}).get("overrides") or {}
        current = [s for s in (overrides.get(element) or []) if isinstance(s, dict)]
        new_overrides = {**overrides, element: [strategy] + [s for s in current if s != strategy]}
        self.set_selectors(new_overrides)
        return strategy, suggestions

    # --- actions (prompts live in actions.py) ---------------------------------

    def generate_keywords(self, topic: str, count: int = 100, exclusions: Optional[list] = None,
                          styles: Optional[list] = None, language: Optional[str] = None,
                          avoid: Optional[list] = None, notes: Optional[str] = None,
                          **options: Any) -> dict:
        """Asks for YouTube search keywords about `topic`; returns `{keywords, dropped, raw, model}`."""
        return actions.generate_keywords(self, {
            "topic": topic, "count": count, "exclusions": exclusions or [], "styles": styles or [],
            "language": language, "avoid": avoid or [], "notes": notes, **options})

    def classify_channel(self, channel: dict, niche: str, criteria: Optional[list] = None,
                         **options: Any) -> dict:
        """Judges a channel against a niche; returns `{niche, audience, language, brandFit, reasons, redFlags, raw, model}`."""
        return actions.classify_channel(self, {"channel": channel, "niche": niche,
                                               "criteria": criteria or [], **options})

    def action(self, name: str, params: Optional[dict] = None) -> dict:
        """Runs any `action.*` by name with wire-shaped params (what the daemon does)."""
        return actions.run_action(self, name, params)

    # --- events --------------------------------------------------------------

    def on(self, event: str, callback: Callable[[dict], Any]) -> None:
        """Registers `callback(data)` for `hello` / `status` / `job` / `log` (plus local `connected` / `disconnected`)."""
        self.server.on(event, callback)

    def off(self, event: str, callback: Callable[[dict], Any]) -> None:
        """Removes a listener added with `on()`."""
        self.server.off(event, callback)
