"""Tests for the Gemini contract's Python skeletons (CONTRACT_GEMINI.md section 6).

Run with:  python -m pytest -q tests/test_gemini_contract.py    (from pipeline/)

What is pinned here is the surface the other agents code against, not any
behaviour behind it: the module names and signatures, that the daemon routes
`bridge.browser_info|ensure_window|install_addon` and
`action.gem_create|gem_update|gem_read` to them, that a body which
still raises `NotImplementedError` is answered as `NOT_IMPLEMENTED` (a normal
response, never a crash), that `generate_keywords` sends `chats > 1` to
`keywords_batch` and leaves everything else alone, and the `emit` plumbing
from the daemon through `run_action` to an action.

The tests that involve a body are written so they keep passing once an owner
replaces the skeleton: they patch the target function rather than relying on
it being a stub, and the one real-subprocess check only asserts
`NOT_IMPLEMENTED` for the functions that still are stubs.
"""

from __future__ import annotations

import ast
import importlib
import importlib.util
import inspect
import io
import json
import sys
import textwrap
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_gemini_daemon import DaemonProcess  # noqa: E402

import gemini_bridge  # noqa: E402
from gemini_bridge import (  # noqa: E402
    ElementNotFound, GeminiError, actions, browser_manager, error_from_payload,
    gems, keywords_batch, progress)
from gemini_bridge.daemon import Daemon, _Out  # noqa: E402

BRIDGE_METHODS = {
    # daemon method: (module, function, keyword the daemon passes besides `params`)
    "bridge.browser_info": (browser_manager, "browser_info"),
    "bridge.ensure_window": (browser_manager, "ensure_window"),
    "bridge.install_addon": (browser_manager, "install_addon"),
}
ACTION_METHODS = {
    "action.gem_create": (gems, "gem_create"),
    "action.gem_update": (gems, "gem_update"),
    "action.gem_read": (gems, "gem_read"),
}
ALL_METHODS = {**BRIDGE_METHODS, **ACTION_METHODS}


def make_daemon() -> tuple[Daemon, io.StringIO]:
    """A daemon over an in-memory stdout: it has never started a server, so there is nothing to stop."""
    stream = io.StringIO()
    return Daemon(port=0, data_dir=Path("data-dir-for-test"), out=_Out(stream)), stream


def lines(stream: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


def is_stub(fn) -> bool:
    """True while the function's body is just a docstring and `raise NotImplementedError`."""
    body = ast.parse(textwrap.dedent(inspect.getsource(fn))).body[0].body
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
            and isinstance(body[0].value.value, str):
        body = body[1:]
    if len(body) != 1 or not isinstance(body[0], ast.Raise):
        return False
    exc = body[0].exc
    exc = exc.func if isinstance(exc, ast.Call) else exc
    return isinstance(exc, ast.Name) and exc.id == "NotImplementedError"


# --- the names and signatures other agents code against ------------------------------

def shape(fn) -> list[tuple[str, str, object]]:
    return [(p.name, p.kind.name, p.default if p.default is not inspect.Parameter.empty else "<required>")
            for p in inspect.signature(fn).parameters.values()]


def contract_shape(fn, n: int) -> list[tuple[str, str, object]]:
    """The contract's first n parameters; anything the owner added after them must be optional (a compatible extension)."""
    full = shape(fn)
    assert all(default != "<required>" for _, _, default in full[n:]), f"{fn.__name__}: new parameters must be optional"
    return full[:n]


def test_the_skeleton_signatures_are_the_contracts():
    assert browser_manager.GEMINI_ADDON_ID == "gemini-bridge@gratovo.app"
    assert shape(browser_manager.browser_info) == [
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"), ("data_dir", "KEYWORD_ONLY", None)]
    assert shape(browser_manager.ensure_window) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"), ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("emit", "KEYWORD_ONLY", None)]
    assert shape(browser_manager.install_addon) == [
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"), ("data_dir", "KEYWORD_ONLY", None),
        ("emit", "KEYWORD_ONLY", None)]
    for fn in (gems.gem_create, gems.gem_update, gems.gem_read):
        assert shape(fn) == [
            ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"), ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
            ("emit", "POSITIONAL_OR_KEYWORD", None)], fn.__name__
    assert shape(keywords_batch.generate) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"), ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("emit", "POSITIONAL_OR_KEYWORD", None)]
    assert shape(actions.run_action) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"), ("name", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"), ("emit", "POSITIONAL_OR_KEYWORD", None)]


def test_the_new_actions_are_registered():
    for name in ("gem_create", "gem_update", "gem_read"):
        assert name in actions.ACTIONS, name
    # The ones that existed are still there (the old drafting actions went with decision old-files).
    for name in ("generate_keywords", "classify_channel"):
        assert name in actions.ACTIONS, name


def test_every_skeleton_is_importable_from_the_package():
    for module in ("browser_manager", "gems", "keywords_batch", "progress"):
        assert importlib.import_module(f"gemini_bridge.{module}").__name__ == f"gemini_bridge.{module}"


# --- the new error codes ----------------------------------------------------------------

@pytest.mark.parametrize("code, class_name", [
    ("BROWSER_NOT_FOUND", "BrowserNotFound"),
    ("ADDON_UNSIGNED", "AddonUnsigned"),
    ("ADDON_INSTALL_FAILED", "AddonInstallFailed"),
    ("BROWSER_LAUNCH_FAILED", "BrowserLaunchFailed"),
    ("GEM_UI_NOT_FOUND", "GemUiNotFound"),
    ("GEM_SAVE_FAILED", "GemSaveFailed"),
    ("NOT_IMPLEMENTED", "NotImplementedYet"),
])
def test_new_error_codes_round_trip_to_their_class(code, class_name):
    cls = getattr(gemini_bridge, class_name)
    assert class_name in gemini_bridge.__all__
    assert cls.code == code
    error = error_from_payload({"code": code, "message": "m", "details": {"k": 1}})
    assert type(error) is cls
    assert (error.code, error.message, error.details) == (code, "m", {"k": 1})
    # Raising one with only a message fills the code in, like every other subclass.
    assert cls(message="x").code == code


def test_a_missing_gem_element_is_an_element_not_found():
    error = error_from_payload({"code": "GEM_UI_NOT_FOUND", "message": "no instructions box",
                                "details": {"element": "gemInstructions", "tried": []}})
    assert isinstance(error, ElementNotFound) and isinstance(error, GeminiError)
    assert error.details["element"] == "gemInstructions"


# --- the daemon routes the new methods --------------------------------------------------------

def test_the_daemon_routes_each_bridge_method_to_browser_manager(monkeypatch):
    daemon, stream = make_daemon()
    seen: dict[str, dict] = {}

    def record(name):
        def fake(*args, **kwargs):
            seen[name] = {"args": args, "kwargs": kwargs}
            return {"answered": name}
        return fake

    for method, (module, function) in BRIDGE_METHODS.items():
        monkeypatch.setattr(module, function, record(method))
    for n, method in enumerate(BRIDGE_METHODS):
        daemon.handle({"id": f"r{n}", "method": method, "params": {"browser": "firefox"}})

    replies = {line["id"]: line for line in lines(stream)}
    for n, method in enumerate(BRIDGE_METHODS):
        assert replies[f"r{n}"] == {"type": "response", "id": f"r{n}", "ok": True,
                                    "result": {"answered": method}}

    info = seen["bridge.browser_info"]
    assert info["args"] == ({"browser": "firefox"},)
    assert info["kwargs"] == {"data_dir": daemon.gemini.data_dir}
    ensure = seen["bridge.ensure_window"]
    assert ensure["args"] == (daemon.gemini, {"browser": "firefox"})
    assert ensure["kwargs"] == {"emit": daemon.emit}
    install = seen["bridge.install_addon"]
    assert install["args"] == ({"browser": "firefox"},)
    assert install["kwargs"] == {"data_dir": daemon.gemini.data_dir, "emit": daemon.emit}


def test_the_daemon_routes_each_new_action(monkeypatch):
    daemon, stream = make_daemon()
    seen: dict[str, dict] = {}

    def record(name):
        def fake(*args, **kwargs):
            seen[name] = {"args": args, "kwargs": kwargs}
            return {"answered": name}
        return fake

    for method, (module, function) in ACTION_METHODS.items():
        monkeypatch.setattr(module, function, record(method))
    for n, method in enumerate(ACTION_METHODS):
        daemon.handle({"id": f"a{n}", "method": method, "params": {"gem": "abc"}})

    replies = {line["id"]: line for line in lines(stream)}
    for n, method in enumerate(ACTION_METHODS):
        assert replies[f"a{n}"]["result"] == {"answered": method}, method
    for method in ("action.gem_create", "action.gem_update", "action.gem_read"):
        # Given the gemini, the params, and the daemon's emit.
        assert seen[method]["args"] == (daemon.gemini, {"gem": "abc"}), method
        assert seen[method]["kwargs"] == {"emit": daemon.emit}, method


# --- NOT_IMPLEMENTED ----------------------------------------------------------------------------

def test_a_body_that_raises_not_implemented_is_answered_as_not_implemented(monkeypatch):
    daemon, stream = make_daemon()

    def unwritten(*args, **kwargs):
        raise NotImplementedError

    for method, (module, function) in ALL_METHODS.items():
        monkeypatch.setattr(module, function, unwritten)
    for n, method in enumerate(ALL_METHODS):
        daemon.handle({"id": f"n{n}", "method": method, "params": {}})

    replies = {line["id"]: line for line in lines(stream)}
    assert len(replies) == len(ALL_METHODS)
    for n, method in enumerate(ALL_METHODS):
        assert replies[f"n{n}"] == {
            "type": "response", "id": f"n{n}", "ok": False,
            "error": {"code": "NOT_IMPLEMENTED", "message": "not implemented yet",
                      "details": {"method": method}}}, method


def test_other_exceptions_are_still_internal_errors(monkeypatch):
    daemon, stream = make_daemon()

    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(browser_manager, "browser_info", broken)
    daemon.handle({"id": "x", "method": "bridge.browser_info", "params": {}})
    reply = lines(stream)[0]
    assert reply["error"]["code"] == "INTERNAL" and "RuntimeError: boom" in reply["error"]["message"]


def test_the_real_daemon_answers_every_stubbed_method_as_not_implemented():
    stubs = {method: params for method, params in (
        ("bridge.browser_info", {}), ("bridge.ensure_window", {}), ("bridge.install_addon", {}),
        ("action.gem_create", {"name": "n", "description": "d", "instructions": "i"}),
        ("action.gem_update", {"gem": "abc", "name": "n"}),
        ("action.gem_read", {"gem": "abc"}),
    ) if is_stub(getattr(ALL_METHODS[method][0], ALL_METHODS[method][1]))}
    # A batch request goes to keywords_batch; while that is a stub it says so too.
    if is_stub(keywords_batch.generate):
        stubs["action.generate_keywords"] = {"topic": "ai tools", "chats": 3}

    daemon = DaemonProcess()
    try:
        first = daemon.next_line()
        assert first["event"] == "daemon" and first["data"]["state"] == "listening", first
        for n, (method, params) in enumerate(stubs.items()):
            daemon.send({"id": f"s{n}", "method": method, "params": params})
        # The pool answers concurrently, so the replies come back in any order: collect by id.
        replies: dict[str, dict] = {}
        while len(replies) < len(stubs):
            line = daemon.next_line()
            if line and line.get("type") == "response":
                replies[line["id"]] = line
        for n, method in enumerate(stubs):
            reply = replies[f"s{n}"]
            assert reply["ok"] is False, method
            assert reply["error"] == {"code": "NOT_IMPLEMENTED", "message": "not implemented yet",
                                      "details": {"method": method}}, method
        # The daemon is still up and answering after all of them.
        daemon.send({"id": "alive", "method": "bridge.status"})
        assert daemon.response("alive")["ok"] is True
    finally:
        if daemon.proc.poll() is None:
            daemon.close()


# --- generate_keywords: chats > 1 goes to keywords_batch, nothing else does -------------------

def test_a_batch_request_goes_to_keywords_batch(monkeypatch):
    calls = []

    def fake(gemini, params, emit=None):
        calls.append((gemini, params, emit))
        return {"keywords": ["batched"]}

    monkeypatch.setattr(keywords_batch, "generate", fake)
    marker = object()
    emit = lambda event, data: None  # noqa: E731
    result = actions.run_action(marker, "action.generate_keywords",
                                {"topic": "ai", "chats": 3, "perChat": 25}, emit=emit)
    assert result == {"keywords": ["batched"]}
    assert calls == [(marker, {"topic": "ai", "chats": 3, "perChat": 25}, emit)]

    # The string form JSON sometimes carries counts too.
    actions.run_action(marker, "action.generate_keywords", {"topic": "ai", "chats": "2"})
    assert len(calls) == 2 and calls[1][2] is None


@pytest.mark.parametrize("extra", [{}, {"chats": None}, {"chats": 1}, {"chats": "1"}, {"chats": 0},
                                   {"chats": "junk"}])
def test_a_single_chat_request_is_the_action_it_always_was(monkeypatch, extra):
    def not_here(*args, **kwargs):
        raise AssertionError("routed to keywords_batch")

    monkeypatch.setattr(keywords_batch, "generate", not_here)
    monkeypatch.setattr(actions, "_ask", lambda gemini, params, message, skill=None: ("alpha beta\ngamma delta\n", "Pro"))
    result = actions.run_action(None, "action.generate_keywords", {"topic": "ai", **extra})
    assert result["keywords"] == ["alpha beta", "gamma delta"]
    assert result["model"] == "Pro"
    assert "chats" not in result and "partial" not in result


# --- the new actions resolve their bodies at call time ---------------------------------------------

def test_the_registered_actions_call_their_modules(monkeypatch):
    seen = []
    monkeypatch.setattr(gems, "gem_read", lambda gemini, params, emit=None: seen.append(("read", params, emit)) or {"r": 1})
    emit = lambda event, data: None  # noqa: E731

    assert actions.run_action(None, "action.gem_read", {"gem": "abc"}, emit=emit) == {"r": 1}
    assert seen == [("read", {"gem": "abc"}, emit)]
    # Without an emit the body still gets its default.
    actions.run_action(None, "action.gem_read", {"gem": "abc"})
    assert seen[-1] == ("read", {"gem": "abc"}, None)


# --- emit plumbing -----------------------------------------------------------------------------------------

def test_run_action_hands_emit_only_to_actions_that_take_it(monkeypatch):
    seen: dict[str, object] = {}

    def takes_emit(gemini, params, emit=None):
        seen["takes"] = emit
        return {}

    def takes_none(gemini, params):
        seen["none"] = True
        return {}

    def takes_kwargs(gemini, params, **kwargs):
        seen["kwargs"] = kwargs
        return {}

    def takes_keyword_only(gemini, params, *, emit=None):
        seen["kwonly"] = emit
        return {}

    def other_keyword(gemini, params, *, emitter=None):
        seen["other"] = emitter
        return {}

    for name, fn in (("t_takes", takes_emit), ("t_none", takes_none), ("t_kwargs", takes_kwargs),
                     ("t_kwonly", takes_keyword_only), ("t_other", other_keyword)):
        monkeypatch.setitem(actions.ACTIONS, name, fn)
    emit = lambda event, data: None  # noqa: E731

    for name in ("t_takes", "t_none", "t_kwargs", "t_kwonly", "t_other"):
        actions.run_action(None, f"action.{name}", {}, emit=emit)
    assert seen["takes"] is emit
    assert seen["none"] is True
    assert seen["kwargs"] == {"emit": emit}
    assert seen["kwonly"] is emit
    assert seen["other"] is None

    # No emit given: nobody is handed one, and the old three-argument call still works.
    seen.clear()
    actions.run_action(None, "action.t_takes", {})
    assert seen["takes"] is None
    actions.run_action(None, "t_none", None)
    assert seen["none"] is True


def test_the_daemons_emit_writes_progress_event_lines_before_the_response(monkeypatch):
    daemon, stream = make_daemon()

    def long_action(gemini, params, emit=None):
        progress.emit_progress(emit, "long_action", 1, 3, "step 1 of 3 done", keywords=12)
        progress.emit_progress(emit, "long_action", 3, 3, "all done", keywords=40)
        return {"ok": True}

    monkeypatch.setitem(actions.ACTIONS, "long_action", long_action)
    daemon.handle({"id": "p1", "method": "action.long_action", "params": {}})

    assert lines(stream) == [
        {"type": "event", "event": "progress",
         "data": {"action": "long_action", "done": 1, "total": 3, "message": "step 1 of 3 done", "keywords": 12}},
        {"type": "event", "event": "progress",
         "data": {"action": "long_action", "done": 3, "total": 3, "message": "all done", "keywords": 40}},
        {"type": "response", "id": "p1", "ok": True, "result": {"ok": True}},
    ]


def test_the_daemon_emit_can_send_any_event():
    daemon, stream = make_daemon()
    daemon.emit("daemon", {"state": "browser_launching", "browser": "firefox", "message": "Starting Firefox..."})
    assert lines(stream) == [{"type": "event", "event": "daemon", "data": {
        "state": "browser_launching", "browser": "firefox", "message": "Starting Firefox..."}}]


# --- the progress helper ---------------------------------------------------------------------------------------

def test_emit_progress_builds_the_frozen_payload():
    events = []
    progress.emit_progress(lambda event, data: events.append((event, data)), "generate_keywords", 2, 4,
                           "chat 2 of 4 done", keywords=137)
    assert events == [("progress", {"action": "generate_keywords", "done": 2, "total": 4,
                                    "message": "chat 2 of 4 done", "keywords": 137})]
    # Counts are ints on the wire, whatever was passed; the message is optional.
    events.clear()
    progress.emit_progress(lambda event, data: events.append((event, data)), "a", 1.0, "3")
    assert events == [("progress", {"action": "a", "done": 1, "total": 3, "message": ""})]


def test_emit_progress_is_a_no_op_without_emit_and_never_raises():
    progress.emit_progress(None, "a", 1, 2)

    def broken(event, data):
        raise OSError("the app is gone")

    progress.emit_progress(broken, "a", 1, 2)  # must not raise


# --- the add-on packer skeleton (pipeline/gemini_extension/tools/build_addon.py) -----------------------------

BUILD_ADDON = Path(__file__).resolve().parents[1] / "gemini_extension" / "tools" / "build_addon.py"


def load_build_addon():
    spec = importlib.util.spec_from_file_location("build_addon_under_test", BUILD_ADDON)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_addon_has_the_contracts_signatures():
    module = load_build_addon()
    assert contract_shape(module.build_firefox, 2) == [
        ("src_dir", "POSITIONAL_OR_KEYWORD", "<required>"), ("out_dir", "POSITIONAL_OR_KEYWORD", "<required>")]
    assert contract_shape(module.build_xpi, 2) == [
        ("src_dir", "POSITIONAL_OR_KEYWORD", "<required>"), ("out_file", "POSITIONAL_OR_KEYWORD", "<required>")]
    for fn in (module.build_firefox, module.build_xpi):
        if is_stub(fn):
            with pytest.raises(NotImplementedError):
                fn(Path("src"), Path("out"))


def test_build_addon_is_standard_library_only():
    """It runs inside the app's bundled interpreter at runtime: no Node, nothing to pip install."""
    tree = ast.parse(BUILD_ADDON.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imported.add(node.module.split(".")[0])
    assert imported <= set(sys.stdlib_module_names) | {"__future__"}, sorted(imported - set(sys.stdlib_module_names))
