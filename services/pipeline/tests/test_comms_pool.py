"""The Gemini tab pool (comms/pool.py) against a scripted fake bridge.

Pinned, from the first full call-mining run (2026-10-14): ten half-loaded tabs took sends that
looked failed but went through, then every send met BUSY and the workers burnt the prompts' retries
in a loop.

  * a tab still answering one of our prompts is waited for and the answer kept under the right key,
    matched by the end of the prompt (all prompts share a long instruction header);
  * BUSY and other tab problems put the prompt back without using its attempts;
  * a send that looked refused but went through is recovered, never sent twice;
  * every answer records the thinking level confirmed.
"""

from __future__ import annotations

import inspect
import json
import threading
import time as real_time
from collections.abc import Callable
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from gratovo_pipeline.comms import pool
from gratovo_pipeline.gemini.errors import BridgeTimeout, Busy, GeminiPageError, SendNotAccepted

HEADER = "Extract the coaching advice. " * 20  # identical in every prompt, like the real ones
START = 1_000_000.0


class FakeTime:
    """A clock that jumps on sleep, so the pool's waits cost nothing."""

    def __init__(self) -> None:
        self.now = START
        self.lock = threading.Lock()

    def time(self) -> float:
        with self.lock:
            self.now += 0.01
            return self.now

    def sleep(self, s: float) -> None:
        with self.lock:
            self.now += max(s, 0.01)

    def strftime(self, fmt: str) -> str:
        return real_time.strftime(fmt)


class Tab:
    def __init__(self) -> None:
        self.account = 0
        self.convo: list[dict[str, str]] = []
        self.answer = ""
        self.polls_left = 0
        self.late: tuple[str, int] | None = (
            None  # (prompt text, conversation reads before it shows)
        )
        # reports "generating" whatever is done to it (run-02, 2026-10-16: tab 4 for five hours)
        self.stuck = False
        # never completes an answer (2026-10-16 evening: two tabs, an hour)
        self.times_out = False


class FakeBridge:
    def __init__(
        self, ntabs: int, script: dict[str, list[str]], refused_accounts: tuple[int, ...] = ()
    ) -> None:
        self.tabs_ = {i: Tab() for i in range(1, ntabs + 1)}
        self.refused_accounts = set(refused_accounts)  # accounts whose every send is refused
        self.script = script  # key -> list of behaviours for successive sends
        self.sent: list[tuple[int, str]] = []  # (tab, key) for every prompt that reached a page
        self.lock = threading.Lock()
        self.blocked_until: float | None = None  # the account refuses every send until then
        self.on_send: Callable[[dict[str, Any]], None] | None = None

    def key_of(self, text: str) -> str:
        return text.rsplit("CALL:", 1)[-1].strip()

    def tabs(self) -> list[dict[str, Any]]:
        return [
            {"tabId": i, "url": f"https://gemini.google.com/u/{t.account}/app"}
            for i, t in self.tabs_.items()
        ]

    def open(self, *, url: str | None = None, new_tab: bool = True) -> dict[str, Any]:
        i = max(self.tabs_) + 1
        self.tabs_[i] = Tab()
        if url:
            self.tabs_[i].account = int(url.split("/u/")[1].split("/")[0])
        return {"tabId": i}

    def close(self) -> None:
        pass

    def start_answer(self, tab: Tab, text: str, polls: int) -> None:
        tab.convo = [{"role": "user", "text": text}]
        tab.answer = "ANSWER " + self.key_of(text)
        tab.polls_left = polls

    def call(
        self, method: str, params: dict[str, Any] | None = None, timeout: float | None = None
    ) -> Any:
        params = params or {}
        tab = self.tabs_.get(params.get("tabId", 0)) or Tab()
        if method == "status":
            return {
                "generating": tab.polls_left > 0 or tab.stuck,
                "model": {"name": "Argon مرتفع"},
                "elements": {"textarea": {"found": True}, "modelSwitcher": {"found": True}},
            }
        if method == "get_last_response":
            if tab.polls_left > 0:
                tab.polls_left -= 1
                return {"text": "partial", "complete": False}
            return {"textRaw": tab.answer, "complete": True}
        if method == "get_conversation":
            if tab.late:
                text, reads = tab.late
                tab.late = (text, reads - 1) if reads > 1 else None
                if reads <= 1:
                    self.start_answer(tab, text, polls=2)
            return tab.convo
        if method == "list_thinking_levels":
            return {"current": "مرتفع"}
        if method in ("get_url", "navigate", "stop"):
            return {"accountIndex": tab.account}
        if method == "send":
            if self.on_send:
                self.on_send(params)
            key = self.key_of(params["text"])
            assert params["thinking"] == "high"
            if tab.times_out:
                raise BridgeTimeout(message="Timed out waiting for response to complete")
            with self.lock:
                plan = self.script.get(key) or []
                step = plan.pop(0) if plan else "ok"
            if (
                step == "refused"
                or tab.account in self.refused_accounts
                or (self.blocked_until and clock() < self.blocked_until)
            ):
                raise GeminiPageError(message="يُرجى التحقّق من الاتصال بالإنترنت ثم إعادة المحاولة.")
            if step == "busy":
                raise Busy(
                    message="Gemini is still generating; pass interrupt:true to stop it first"
                )
            if step == "error1":
                raise GeminiPageError(message="حدث خطأ (1)")
            with self.lock:
                self.sent.append((params["tabId"], key))
            if step == "refused_shows_late":
                tab.late = (params["text"], 3)
                raise SendNotAccepted(
                    message="Send was clicked (and Enter pressed) but nothing happened"
                )
            if step == "refused_but_sent":
                self.start_answer(tab, params["text"], polls=3)
                raise SendNotAccepted(
                    message="Send was clicked (and Enter pressed) but nothing happened"
                )
            self.start_answer(tab, params["text"], polls=0)
            return {"textRaw": tab.answer, "thinking": "مرتفع", "model": "Argon مرتفع"}
        raise AssertionError(method)


def quiet_toast(_title: str, _text: str) -> None:
    pass


def prompt(key: str) -> str:
    return f"{HEADER}\nCALL: {key}"


def clock() -> float:
    return pool.time.time()


type RunPool = Callable[..., tuple[dict[str, Any], dict[str, dict[str, Any]]]]


def read_answers(folder: Path) -> dict[str, dict[str, Any]]:
    return {
        p.stem: json.loads(p.read_text(encoding="utf-8"))
        for p in (folder / "answers").glob("*.json")
    }


@pytest.fixture
def run_pool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> RunPool:
    monkeypatch.setattr(pool, "time", FakeTime())
    monkeypatch.setattr(pool, "toast", quiet_toast)

    def go(
        keys: list[str], bridge: FakeBridge, tabs: int, accounts: list[int] | None = None
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        monkeypatch.setattr(pool, "connect", lambda port=8765: bridge)
        stats = pool.run(
            {k: prompt(k) for k in keys},
            tmp_path,
            tabs=tabs,
            log=lambda _m: None,
            timeout_s=600,
            accounts=accounts,
        )
        return stats, read_answers(tmp_path)

    return go


def test_a_tab_already_answering_one_of_our_prompts_is_kept_under_the_right_key(
    run_pool: RunPool,
) -> None:
    bridge = FakeBridge(1, {})
    bridge.start_answer(bridge.tabs_[1], prompt("beta"), polls=5)  # left running by an earlier run
    _stats, answers = run_pool(["alpha", "beta"], bridge, tabs=1)
    assert set(answers) == {"alpha", "beta"}
    assert answers["beta"]["text"] == "ANSWER beta"
    assert answers["beta"]["recovered"]
    assert answers["alpha"]["text"] == "ANSWER alpha"
    assert [k for _, k in bridge.sent] == ["alpha"], "beta was never sent again"
    assert all(a["thinking"] == "مرتفع" for a in answers.values())


def test_a_finished_answer_left_on_a_tab_by_a_stopped_run_is_kept(run_pool: RunPool) -> None:
    bridge = FakeBridge(1, {})
    bridge.start_answer(bridge.tabs_[1], prompt("beta"), polls=0)  # done, never saved
    _stats, answers = run_pool(["alpha", "beta"], bridge, tabs=1)
    assert answers["beta"]["text"] == "ANSWER beta"
    assert answers["beta"]["recovered"]
    assert [k for _, k in bridge.sent] == ["alpha"]


def test_busy_never_uses_up_a_prompts_attempts(run_pool: RunPool) -> None:
    bridge = FakeBridge(1, {"alpha": ["busy", "busy", "busy", "busy"]})
    stats, answers = run_pool(["alpha"], bridge, tabs=1)
    assert answers["alpha"]["text"] == "ANSWER alpha"
    assert stats["failed"] == 0
    assert stats["retries"] == 0
    assert stats["tabProblems"] == 4


def test_a_send_that_looked_refused_but_went_through_is_recovered_not_resent(
    run_pool: RunPool,
) -> None:
    bridge = FakeBridge(2, {"alpha": ["refused_but_sent"]})
    _stats, answers = run_pool(["alpha", "beta", "gamma"], bridge, tabs=2)
    assert set(answers) == {"alpha", "beta", "gamma"}
    assert answers["alpha"]["recovered"].startswith("SendNotAccepted")
    assert sorted(k for _, k in bridge.sent) == ["alpha", "beta", "gamma"], (
        "each prompt reached a page once"
    )


def test_a_slow_prompt_that_shows_up_late_is_waited_for_not_sent_twice(run_pool: RunPool) -> None:
    bridge = FakeBridge(2, {"alpha": ["refused_shows_late"]})
    stats, answers = run_pool(["alpha", "beta"], bridge, tabs=2)
    assert answers["alpha"]["recovered"].startswith("SendNotAccepted")
    assert sorted(k for _, k in bridge.sent) == ["alpha", "beta"]
    assert stats["retries"] == 0


def test_an_answer_without_a_confirmed_level_is_asked_again(
    run_pool: RunPool, tmp_path: Path
) -> None:
    (tmp_path / "answers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "answers" / "alpha.json").write_text(
        json.dumps({"key": "alpha", "text": "old", "thinking": None}), encoding="utf-8"
    )
    (tmp_path / "answers" / "beta.json").write_text(
        json.dumps({"key": "beta", "text": "kept", "thinking": "مرتفع"}), encoding="utf-8"
    )
    bridge = FakeBridge(1, {})
    _stats, answers = run_pool(["alpha", "beta"], bridge, tabs=1)
    assert [k for _, k in bridge.sent] == ["alpha"]
    assert answers["alpha"]["thinking"] == "مرتفع"
    assert answers["beta"]["text"] == "kept"


def test_a_refusal_pauses_the_run_once_however_many_tabs_meet_it(run_pool: RunPool) -> None:
    bridge = FakeBridge(3, {})
    bridge.blocked_until = clock() + 120  # the fixture already put the fake clock in place
    stats, answers = run_pool(["alpha", "beta", "gamma"], bridge, tabs=3)
    assert set(answers) == {"alpha", "beta", "gamma"}
    assert stats["limits"] == 1
    assert stats["failed"] == 0
    assert stats["retries"] == 0


def test_sends_are_spaced_account_wide(run_pool: RunPool) -> None:
    starts: list[float] = []
    bridge = FakeBridge(3, {})
    bridge.on_send = lambda _params: starts.append(clock())
    run_pool(["a", "b", "c", "d"], bridge, tabs=3)
    gaps = [b - a for a, b in pairwise(starts)]
    assert len(starts) == 4
    assert min(gaps) >= 59.9, gaps


def test_two_accounts_get_three_tabs_each_and_no_other_tab(run_pool: RunPool) -> None:
    bridge = FakeBridge(3, {})  # three tabs already open, all on /u/0
    keys = [f"k{i}" for i in range(12)]
    _stats, answers = run_pool(keys, bridge, tabs=3, accounts=[0, 1])
    assert sorted(answers) == sorted(keys)
    assert len(bridge.tabs_) == 6
    assert sorted(t.account for t in bridge.tabs_.values()) == [0, 0, 0, 1, 1, 1]
    assert {a["account"] for a in answers.values()} == {0, 1}


def test_an_account_that_is_refused_never_holds_back_the_other(run_pool: RunPool) -> None:
    bridge = FakeBridge(3, {}, refused_accounts=(1,))
    keys = [f"k{i}" for i in range(9)]
    _stats, answers = run_pool(keys, bridge, tabs=3, accounts=[0, 1])
    assert sorted(answers) == sorted(keys)
    assert {a["account"] for a in answers.values()} == {0}


def test_a_job_holds_a_conversation_on_its_own_tab_and_every_send_is_paced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # the scenario runner (2026-10-15): engine.propose sends a case, then repairs in the same chat
    monkeypatch.setattr(pool, "time", FakeTime())
    monkeypatch.setattr(pool, "toast", quiet_toast)
    bridge = FakeBridge(2, {})
    sends: list[tuple[float, int, bool, str | None]] = []
    bridge.on_send = lambda p: sends.append((clock(), p["tabId"], p["newChat"], p.get("model")))
    monkeypatch.setattr(pool, "connect", lambda port=8765: bridge)

    def job(key: str, client: pool.TabClient) -> dict[str, Any]:
        first = client.call("send", {"text": prompt(key), "newChat": True})
        again = client.call("send", {"text": "fix it " + key, "newChat": False})
        return {
            "status": "ready",
            "model": first["model"],
            "thinking": again["thinking"],
            "tab": client.tab_id,
        }

    stats = pool.run(
        {k: prompt(k) for k in ["a", "b", "c"]},
        tmp_path,
        tabs=2,
        log=lambda _m: None,
        job=job,
    )
    answers = read_answers(tmp_path)
    assert set(answers) == {"a", "b", "c"}
    assert stats["done"] == 3
    assert all(
        a["result"]["status"] == "ready" and a["thinking"] == "مرتفع" for a in answers.values()
    )
    starts = sorted(t for t, _, _, _ in sends)
    assert len(sends) == 6
    assert min(b - a for a, b in pairwise(starts)) >= 59.9
    # the model is chosen only when a chat starts; a repair stays in the chat it repairs
    assert all((model == "Argon") == new for _, _, new, model in sends)


def test_a_tab_stuck_generating_gives_its_prompt_back_and_the_run_ends(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # run-02 base (2026-10-16): tab 4 kept reporting "generating" through stop; the pool waited out
    # 900 s again and again for five hours while holding the run's last case, and the other tabs had
    # already left
    monkeypatch.setattr(pool, "time", FakeTime())
    monkeypatch.setattr(pool, "toast", quiet_toast)
    bridge = FakeBridge(2, {})
    bridge.tabs_[1].stuck = True
    monkeypatch.setattr(pool, "connect", lambda port=8765: bridge)

    def job(key: str, client: pool.TabClient) -> dict[str, Any]:
        r = client.call("send", {"text": prompt(key), "newChat": True})
        return {"status": "ready", "model": r["model"], "thinking": r["thinking"]}

    stats = pool.run(
        {k: prompt(k) for k in ["a", "b", "c", "d"]},
        tmp_path,
        tabs=2,
        log=lambda _m: None,
        job=job,
        timeout_s=600,
    )
    answers = {p.stem for p in (tmp_path / "answers").glob("*.json")}
    assert answers == {"a", "b", "c", "d"}
    assert stats["done"] == 4
    assert {tab for tab, _ in bridge.sent} == {2}
    # hours of fake clock at most, not one 900 s wait per poll
    assert clock() - START < 4 * 3600


def test_gemini_errors_repeating_on_an_account_pause_it_like_a_refusal(run_pool: RunPool) -> None:
    # 2026-10-16: "حدث خطأ (1)" began on one account's tabs after nine hours of use; three within 15
    # minutes are a refusal of that account, one alone is retried
    bridge = FakeBridge(1, {"a": ["error1", "error1"], "b": ["error1"]})
    stats, answers = run_pool(["a", "b", "c"], bridge, tabs=1)
    assert stats["limits"] == 1
    assert set(answers) == {"a", "b", "c"}
    lone = FakeBridge(1, {"z": ["error1"]})
    stats, answers = run_pool(["z"], lone, tabs=1)
    assert stats["limits"] == 0
    assert "z" in answers


def test_a_tab_that_never_completes_an_answer_hands_its_prompts_on_and_is_retired(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 2026-10-16 evening: two tabs timed out on every prompt while a third on the same account
    # answered; the timeouts used up the prompts' attempts while the broken tabs kept taking new
    # ones
    monkeypatch.setattr(pool, "time", FakeTime())
    monkeypatch.setattr(pool, "toast", quiet_toast)
    bridge = FakeBridge(2, {})
    bridge.tabs_[1].times_out = True
    monkeypatch.setattr(pool, "connect", lambda port=8765: bridge)

    def job(key: str, client: pool.TabClient) -> dict[str, Any]:
        r = client.call("send", {"text": prompt(key), "newChat": True})
        return {"status": "ready", "model": r["model"], "thinking": r["thinking"]}

    stats = pool.run(
        {k: prompt(k) for k in ["a", "b", "c", "d"]},
        tmp_path,
        tabs=2,
        log=lambda _m: None,
        job=job,
        timeout_s=600,
    )
    assert {p.stem for p in (tmp_path / "answers").glob("*.json")} == {"a", "b", "c", "d"}
    assert stats["failed"] == 0
    assert stats["retries"] == 0
    assert {tab for tab, _ in bridge.sent} == {2}


def test_the_pool_keeps_the_owners_pacing_defaults() -> None:
    sig = inspect.signature(pool.run)
    assert sig.parameters["tabs"].default == 3
    assert sig.parameters["gap_s"].default == 60
    assert sig.parameters["thinking"].default == "high"
    assert pool.GENERIC_ERRORS == 3
    assert pool.GENERIC_WINDOW_S == 900


def test_a_hand_run_tool_needs_the_browser_folders(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(pool.PROFILE_ENV, raising=False)
    monkeypatch.delenv(pool.EXTENSION_ENV, raising=False)
    with pytest.raises(SystemExit, match=pool.PROFILE_ENV):
        pool.browser_paths()


def test_connect_hands_the_browser_folders_to_the_manager(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from gratovo_pipeline.gemini.browser import manager

    monkeypatch.setenv(pool.PROFILE_ENV, str(tmp_path / "gemini-profile"))
    monkeypatch.setenv(pool.EXTENSION_ENV, str(tmp_path / "gemini-extension"))
    seen: list[manager.BrowserPaths] = []

    def ensure_window(
        _gemini: object, _params: dict[str, Any], *, paths: manager.BrowserPaths
    ) -> dict[str, Any]:
        seen.append(paths)
        return {"connected": False, "message": "no extension"}

    class FakeServer:
        def start(self) -> None:
            pass

    class FakeGemini:
        def __init__(self, **_kwargs: object) -> None:
            self.server = FakeServer()

    monkeypatch.setattr(manager, "ensure_window", ensure_window)
    monkeypatch.setattr(pool, "Gemini", FakeGemini)
    with pytest.raises(RuntimeError, match="no extension"):
        pool.connect(port=0, wait_s=1)
    assert seen == [
        manager.BrowserPaths(
            profile_dir=tmp_path / "gemini-profile", extension_dir=tmp_path / "gemini-extension"
        )
    ]
