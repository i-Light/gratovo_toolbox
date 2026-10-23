"""The daemon's surface: its routing, its argv, and every answer checked against main's schemas.

What is pinned here is the surface main and the other modules code against, not the behaviour
behind it: the module names and signatures, that the daemon routes
`bridge.browser_info|ensure_window|install_addon` to the browser manager and
`action.gem_create|gem_update|gem_read` to gems.py, that a body which raises
`NotImplementedError` is answered as `NOT_IMPLEMENTED` (a normal response, never a crash), that
`generate_keywords` sends `chats > 1` to `keywords_batch` and leaves everything else alone, and
the `emit` plumbing from the daemon through `run_action` to an action.

New here: the argv main sends (`gemini-service.ts`, `bridgeArgs`), what the browser calls answer
while the extension is not in the app yet (plan D3), and the real results of every typed method,
produced by a daemon talking to a fake extension, checked against `gemini.schema.json`'s
`results` (plan D4). The old file also tested the add-on packer (`gemini_extension/tools/
build_addon.py`); that comes with the extension in step 6 (plan D13), so those two tests are gone.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import io
import json
import logging
import sys
import textwrap
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fake_extension import THREAD_PREFIXES, FakeExtension, Scripted, wait_until
from test_gemini_bridge import STATUS
from test_gemini_daemon import DaemonProcess, gemini_problems

from gratovo_pipeline import paths as pipeline_paths
from gratovo_pipeline.gemini import actions, errors, gems, keywords_batch, progress
from gratovo_pipeline.gemini import daemon as daemon_module
from gratovo_pipeline.gemini.browser import manager as browser_manager
from gratovo_pipeline.gemini.browser.manager import BrowserPaths
from gratovo_pipeline.gemini.daemon import Daemon, Out
from gratovo_pipeline.gemini.errors import ElementNotFound, GeminiError, error_from_payload

BRIDGE_METHODS: dict[str, tuple[Any, str]] = {
    # daemon method: (module, function)
    "bridge.browser_info": (browser_manager, "browser_info"),
    "bridge.ensure_window": (browser_manager, "ensure_window"),
    "bridge.install_addon": (browser_manager, "install_addon"),
}
ACTION_METHODS: dict[str, tuple[Any, str]] = {
    "action.gem_create": (gems, "gem_create"),
    "action.gem_update": (gems, "gem_update"),
    "action.gem_read": (gems, "gem_read"),
}
ALL_METHODS = {**BRIDGE_METHODS, **ACTION_METHODS}

#: Stands in for the `Gemini` an action is handed, where the action under test never touches it.
NO_GEMINI: Any = None


def example_paths() -> BrowserPaths:
    return BrowserPaths(
        profile_dir=Path("profile-dir-for-test"), extension_dir=Path("extension-dir-for-test")
    )


def make_daemon() -> tuple[Daemon, io.StringIO]:
    """A daemon over an in-memory stdout: it has never started a server, so there is nothing to
    stop."""
    stream = io.StringIO()
    daemon = Daemon(
        port=0, data_dir=Path("data-dir-for-test"), out=Out(stream), paths=example_paths()
    )
    return daemon, stream


def lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


def is_stub(fn: Callable[..., Any]) -> bool:
    """True while the function's body is a docstring and `raise NotImplementedError` (or the
    bridge's own `NotImplementedYet`), perhaps after a `del` of its parameters."""
    node = ast.parse(textwrap.dedent(inspect.getsource(fn))).body[0]
    assert isinstance(node, ast.FunctionDef)
    body = [
        statement
        for statement in node.body
        if not isinstance(statement, ast.Delete)
        and not (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant))
    ]
    if len(body) != 1 or not isinstance(body[0], ast.Raise):
        return False
    exc = body[0].exc
    exc = exc.func if isinstance(exc, ast.Call) else exc
    return isinstance(exc, ast.Name) and exc.id in ("NotImplementedError", "NotImplementedYet")


@pytest.fixture(autouse=True)
def no_threads_left_behind() -> Iterator[None]:
    yield
    deadline = time.monotonic() + 2
    ours: list[str] = []
    while time.monotonic() < deadline:
        ours = [t.name for t in threading.enumerate() if t.name.startswith(THREAD_PREFIXES)]
        if not ours:
            return
        time.sleep(0.05)
    raise AssertionError(f"threads left behind: {ours}")


# --- the names and signatures other modules code against ---


def shape(fn: Callable[..., Any]) -> list[tuple[str, str, object]]:
    return [
        (
            p.name,
            p.kind.name,
            p.default if p.default is not inspect.Parameter.empty else "<required>",
        )
        for p in inspect.signature(fn).parameters.values()
    ]


def test_the_skeleton_signatures_are_the_contracts() -> None:
    # The paths came from module constants in the old repository; now the daemon's argv
    # gives them (plan D2, D3), so each browser call takes them as a required keyword.
    assert browser_manager.GEMINI_ADDON_ID == "gemini-bridge@gratovo.app"
    assert shape(browser_manager.browser_info) == [
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("paths", "KEYWORD_ONLY", "<required>"),
        ("data_dir", "KEYWORD_ONLY", None),
    ]
    assert shape(browser_manager.ensure_window) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("paths", "KEYWORD_ONLY", "<required>"),
        ("emit", "KEYWORD_ONLY", None),
    ]
    assert shape(browser_manager.install_addon) == [
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("paths", "KEYWORD_ONLY", "<required>"),
        ("data_dir", "KEYWORD_ONLY", None),
        ("emit", "KEYWORD_ONLY", None),
    ]
    for fn in (gems.gem_create, gems.gem_update, gems.gem_read):
        assert shape(fn) == [
            ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"),
            ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
            ("emit", "POSITIONAL_OR_KEYWORD", None),
        ], fn.__name__
    assert shape(keywords_batch.generate) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("emit", "POSITIONAL_OR_KEYWORD", None),
    ]
    assert shape(actions.run_action) == [
        ("gemini", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("name", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("params", "POSITIONAL_OR_KEYWORD", "<required>"),
        ("emit", "POSITIONAL_OR_KEYWORD", None),
    ]


def test_the_new_actions_are_registered() -> None:
    for name in ("gem_create", "gem_update", "gem_read"):
        assert name in actions.ACTIONS, name
    # The ones that existed are still there (the old drafting actions went with decision
    # old-files).
    for name in ("generate_keywords", "classify_channel"):
        assert name in actions.ACTIONS, name


def test_every_skeleton_is_importable_from_the_package() -> None:
    for module in ("browser.manager", "gems", "keywords_batch", "progress", "daemon"):
        name = f"gratovo_pipeline.gemini.{module}"
        assert importlib.import_module(name).__name__ == name


# --- the new error codes ---


@pytest.mark.parametrize(
    ("code", "class_name"),
    [
        ("BROWSER_NOT_FOUND", "BrowserNotFound"),
        ("ADDON_UNSIGNED", "AddonUnsigned"),
        ("ADDON_INSTALL_FAILED", "AddonInstallFailed"),
        ("BROWSER_LAUNCH_FAILED", "BrowserLaunchFailed"),
        ("GEM_UI_NOT_FOUND", "GemUiNotFound"),
        ("GEM_SAVE_FAILED", "GemSaveFailed"),
        ("NOT_IMPLEMENTED", "NotImplementedYet"),
    ],
)
def test_new_error_codes_round_trip_to_their_class(code: str, class_name: str) -> None:
    # Was `getattr(gemini_bridge, ...)` plus its `__all__`: every class lives in errors.py now.
    cls = cast("type[GeminiError]", getattr(errors, class_name))
    assert cls.code == code
    error = error_from_payload({"code": code, "message": "m", "details": {"k": 1}})
    assert type(error) is cls
    assert (error.code, error.message, error.details) == (code, "m", {"k": 1})
    # Raising one with only a message fills the code in, like every other subclass.
    assert cls(message="x").code == code


def test_a_missing_gem_element_is_an_element_not_found() -> None:
    error = error_from_payload(
        {
            "code": "GEM_UI_NOT_FOUND",
            "message": "no instructions box",
            "details": {"element": "gemInstructions", "tried": []},
        }
    )
    assert isinstance(error, ElementNotFound)
    assert isinstance(error, GeminiError)
    assert error.details["element"] == "gemInstructions"


# --- the daemon routes the new methods ---


def recorder(seen: dict[str, dict[str, Any]], name: str) -> Callable[..., dict[str, Any]]:
    def fake(*args: Any, **kwargs: Any) -> dict[str, Any]:
        seen[name] = {"args": args, "kwargs": kwargs}
        return {"answered": name}

    return fake


def test_the_daemon_routes_each_bridge_method_to_browser_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    daemon, stream = make_daemon()
    seen: dict[str, dict[str, Any]] = {}

    def any_browser(_browser: str | None) -> None:
        return None

    monkeypatch.setattr(daemon.gemini.server, "set_browser", any_browser)
    for method, (module, function) in BRIDGE_METHODS.items():
        monkeypatch.setattr(module, function, recorder(seen, method))
    for n, method in enumerate(BRIDGE_METHODS):
        daemon.handle({"id": f"r{n}", "method": method, "params": {"browser": "firefox"}})

    replies = {line["id"]: line for line in lines(stream)}
    for n, method in enumerate(BRIDGE_METHODS):
        assert replies[f"r{n}"] == {
            "type": "response",
            "id": f"r{n}",
            "ok": True,
            "result": {"answered": method},
        }

    info = seen["bridge.browser_info"]
    assert info["args"] == ({"browser": "firefox"},)
    assert info["kwargs"] == {"paths": daemon.paths, "data_dir": daemon.gemini.data_dir}
    ensure = seen["bridge.ensure_window"]
    assert ensure["args"] == (daemon.gemini, {"browser": "firefox"})
    assert ensure["kwargs"] == {"paths": daemon.paths, "emit": daemon.emit}
    install = seen["bridge.install_addon"]
    assert install["args"] == ({"browser": "firefox"},)
    assert install["kwargs"] == {
        "paths": daemon.paths,
        "data_dir": daemon.gemini.data_dir,
        "emit": daemon.emit,
    }


def test_the_daemon_routes_each_new_action(monkeypatch: pytest.MonkeyPatch) -> None:
    daemon, stream = make_daemon()
    seen: dict[str, dict[str, Any]] = {}
    for method, (module, function) in ACTION_METHODS.items():
        monkeypatch.setattr(module, function, recorder(seen, method))
    for n, method in enumerate(ACTION_METHODS):
        daemon.handle({"id": f"a{n}", "method": method, "params": {"gem": "abc"}})

    replies = {line["id"]: line for line in lines(stream)}
    for n, method in enumerate(ACTION_METHODS):
        assert replies[f"a{n}"]["result"] == {"answered": method}, method
    for method in ("action.gem_create", "action.gem_update", "action.gem_read"):
        # Given the gemini, the params, and the daemon's emit.
        assert seen[method]["args"] == (daemon.gemini, {"gem": "abc"}), method
        assert seen[method]["kwargs"] == {"emit": daemon.emit}, method


# --- NOT_IMPLEMENTED ---


def test_a_body_that_raises_not_implemented_is_answered_as_not_implemented(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    daemon, stream = make_daemon()

    def unwritten(*_args: Any, **_kwargs: Any) -> Any:
        raise NotImplementedError

    for module, function in ALL_METHODS.values():
        monkeypatch.setattr(module, function, unwritten)
    for n, method in enumerate(ALL_METHODS):
        daemon.handle({"id": f"n{n}", "method": method, "params": {}})

    replies = {line["id"]: line for line in lines(stream)}
    assert len(replies) == len(ALL_METHODS)
    for n, method in enumerate(ALL_METHODS):
        assert replies[f"n{n}"] == {
            "type": "response",
            "id": f"n{n}",
            "ok": False,
            "error": {
                "code": "NOT_IMPLEMENTED",
                "message": "not implemented yet",
                "details": {"method": method},
            },
        }, method


def test_not_implemented_yet_names_the_method_too() -> None:
    # The comms actions raise the bridge's own NotImplementedYet until task B5; DAEMON.md §2
    # gives NOT_IMPLEMENTED the details `{method}` either way.
    daemon, stream = make_daemon()
    if not is_stub(actions.comms_check):
        pytest.skip("action.comms_check has its body now (task B5)")
    daemon.handle({"id": "c", "method": "action.comms_check", "params": {}})
    assert lines(stream)[0]["error"] == {
        "code": "NOT_IMPLEMENTED",
        "message": "not implemented yet",
        "details": {"method": "action.comms_check"},
    }


def test_other_exceptions_are_still_internal_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    daemon, stream = make_daemon()

    def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(browser_manager, "browser_info", broken)
    daemon.handle({"id": "x", "method": "bridge.browser_info", "params": {}})
    reply = lines(stream)[0]
    assert reply["error"]["code"] == "INTERNAL"
    assert "RuntimeError: boom" in reply["error"]["message"]


def test_an_internal_error_message_fits_mains_schema(
    monkeypatch: pytest.MonkeyPatch, check_from_gemini: Callable[[str], dict[str, Any]]
) -> None:
    daemon, stream = make_daemon()

    def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("x" * 10_000)

    monkeypatch.setattr(browser_manager, "browser_info", broken)
    daemon.handle({"id": "x", "method": "bridge.browser_info", "params": {}})
    reply = check_from_gemini(stream.getvalue())
    assert reply["error"]["code"] == "INTERNAL"
    assert reply["error"]["message"].startswith("RuntimeError: xxx")


@pytest.mark.parametrize("request_id", [7, "", "x" * 101, None])
def test_an_id_main_could_not_have_sent_is_answered_without_one(
    request_id: object, check_from_gemini: Callable[[str], dict[str, Any]]
) -> None:
    daemon, stream = make_daemon()
    daemon.handle({"id": request_id, "method": "bridge.shutdown", "params": {}})
    assert check_from_gemini(stream.getvalue())["id"] is None


@pytest.mark.usefixtures("loopback")
def test_the_real_daemon_answers_every_stubbed_method_as_not_implemented(
    tmp_path: Path, gemini_schema: dict[str, Any]
) -> None:
    candidates: list[tuple[str, dict[str, Any], Callable[..., Any]]] = [
        ("bridge.browser_info", {}, browser_manager.browser_info),
        ("bridge.ensure_window", {}, browser_manager.ensure_window),
        ("bridge.install_addon", {}, browser_manager.install_addon),
        (
            "action.gem_create",
            {"name": "n", "description": "d", "instructions": "i"},
            gems.gem_create,
        ),
        ("action.gem_update", {"gem": "abc", "name": "n"}, gems.gem_update),
        ("action.gem_read", {"gem": "abc"}, gems.gem_read),
        # A batch request goes to keywords_batch; while that is a stub it says so too.
        ("action.generate_keywords", {"topic": "ai tools", "chats": 3}, keywords_batch.generate),
        ("action.comms_propose", {}, actions.comms_propose),
        ("action.comms_check", {}, actions.comms_check),
    ]
    stubs = {method: params for method, params, fn in candidates if is_stub(fn)}

    daemon = DaemonProcess(tmp_path, gemini_schema)
    try:
        first = daemon.first()
        assert first["event"] == "daemon", first
        assert first["data"]["state"] == "listening", first
        for n, (method, params) in enumerate(stubs.items()):
            daemon.send({"id": f"s{n}", "method": method, "params": params})
        # The pool answers concurrently, so the replies come back in any order: collect by id.
        replies: dict[str, dict[str, Any]] = {}
        while len(replies) < len(stubs):
            line = daemon.next_line()
            if line and line.get("type") == "response":
                replies[line["id"]] = line
        for n, method in enumerate(stubs):
            reply = replies[f"s{n}"]
            assert reply["ok"] is False, method
            assert reply["error"] == {
                "code": "NOT_IMPLEMENTED",
                "message": "not implemented yet",
                "details": {"method": method},
            }, method
        # The daemon is still up and answering after all of them.
        daemon.send({"id": "alive", "method": "bridge.status"})
        assert daemon.response("alive")["ok"] is True
    finally:
        if daemon.proc.poll() is None:
            daemon.close()


# --- generate_keywords: chats > 1 goes to keywords_batch, nothing else does ---


def test_a_batch_request_goes_to_keywords_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Any, dict[str, Any], Any]] = []

    def fake(gemini: Any, params: dict[str, Any], emit: Any = None) -> dict[str, Any]:
        calls.append((gemini, params, emit))
        return {"keywords": ["batched"]}

    monkeypatch.setattr(keywords_batch, "generate", fake)
    marker: Any = object()

    def emit(_event: str, _data: dict[str, Any]) -> None:
        return None

    result = actions.run_action(
        marker, "action.generate_keywords", {"topic": "ai", "chats": 3, "perChat": 25}, emit=emit
    )
    assert result == {"keywords": ["batched"]}
    assert calls == [(marker, {"topic": "ai", "chats": 3, "perChat": 25}, emit)]

    # The string form JSON sometimes carries counts too.
    actions.run_action(marker, "action.generate_keywords", {"topic": "ai", "chats": "2"})
    assert len(calls) == 2
    assert calls[1][2] is None


@pytest.mark.parametrize(
    "extra",
    [{}, {"chats": None}, {"chats": 1}, {"chats": "1"}, {"chats": 0}, {"chats": "junk"}],
)
def test_a_single_chat_request_is_the_action_it_always_was(
    monkeypatch: pytest.MonkeyPatch, extra: dict[str, Any]
) -> None:
    def not_here(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("routed to keywords_batch")

    def ask(*_args: Any, **_kwargs: Any) -> tuple[str, str]:
        return "alpha beta\ngamma delta\n", "Pro"

    monkeypatch.setattr(keywords_batch, "generate", not_here)
    monkeypatch.setattr(actions, "_ask", ask)
    result = actions.run_action(NO_GEMINI, "action.generate_keywords", {"topic": "ai", **extra})
    assert result["keywords"] == ["alpha beta", "gamma delta"]
    assert result["model"] == "Pro"
    assert "chats" not in result
    assert "partial" not in result


# --- the new actions resolve their bodies at call time ---


def test_the_registered_actions_call_their_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, dict[str, Any], Any]] = []

    def read(_gemini: Any, params: dict[str, Any], emit: Any = None) -> dict[str, Any]:
        seen.append(("read", params, emit))
        return {"r": 1}

    monkeypatch.setattr(gems, "gem_read", read)

    def emit(_event: str, _data: dict[str, Any]) -> None:
        return None

    assert actions.run_action(NO_GEMINI, "action.gem_read", {"gem": "abc"}, emit=emit) == {"r": 1}
    assert seen == [("read", {"gem": "abc"}, emit)]
    # Without an emit the body still gets its default.
    actions.run_action(NO_GEMINI, "action.gem_read", {"gem": "abc"})
    assert seen[-1] == ("read", {"gem": "abc"}, None)


# --- emit plumbing ---


def test_run_action_hands_emit_only_to_actions_that_take_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    def takes_emit(_gemini: Any, _params: Any, emit: Any = None) -> dict[str, Any]:
        seen["takes"] = emit
        return {}

    def takes_none(_gemini: Any, _params: Any) -> dict[str, Any]:
        seen["none"] = True
        return {}

    def takes_kwargs(_gemini: Any, _params: Any, **kwargs: Any) -> dict[str, Any]:
        seen["kwargs"] = kwargs
        return {}

    def takes_keyword_only(_gemini: Any, _params: Any, *, emit: Any = None) -> dict[str, Any]:
        seen["kwonly"] = emit
        return {}

    def other_keyword(_gemini: Any, _params: Any, *, emitter: Any = None) -> dict[str, Any]:
        seen["other"] = emitter
        return {}

    for name, fn in (
        ("t_takes", takes_emit),
        ("t_none", takes_none),
        ("t_kwargs", takes_kwargs),
        ("t_kwonly", takes_keyword_only),
        ("t_other", other_keyword),
    ):
        monkeypatch.setitem(actions.ACTIONS, name, fn)

    def emit(_event: str, _data: dict[str, Any]) -> None:
        return None

    for name in ("t_takes", "t_none", "t_kwargs", "t_kwonly", "t_other"):
        actions.run_action(NO_GEMINI, f"action.{name}", {}, emit=emit)
    assert seen["takes"] is emit
    assert seen["none"] is True
    assert seen["kwargs"] == {"emit": emit}
    assert seen["kwonly"] is emit
    assert seen["other"] is None

    # No emit given: nobody is handed one, and the old three-argument call still works.
    seen.clear()
    actions.run_action(NO_GEMINI, "action.t_takes", {})
    assert seen["takes"] is None
    actions.run_action(NO_GEMINI, "t_none", None)
    assert seen["none"] is True


def test_the_daemons_emit_writes_progress_event_lines_before_the_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    daemon, stream = make_daemon()

    def long_action(_gemini: Any, _params: Any, emit: Any = None) -> dict[str, Any]:
        progress.emit_progress(emit, "long_action", 1, 3, "step 1 of 3 done", keywords=12)
        progress.emit_progress(emit, "long_action", 3, 3, "all done", keywords=40)
        return {"ok": True}

    monkeypatch.setitem(actions.ACTIONS, "long_action", long_action)
    daemon.handle({"id": "p1", "method": "action.long_action", "params": {}})

    assert lines(stream) == [
        {
            "type": "event",
            "event": "progress",
            "data": {
                "action": "long_action",
                "done": 1,
                "total": 3,
                "message": "step 1 of 3 done",
                "keywords": 12,
            },
        },
        {
            "type": "event",
            "event": "progress",
            "data": {
                "action": "long_action",
                "done": 3,
                "total": 3,
                "message": "all done",
                "keywords": 40,
            },
        },
        {"type": "response", "id": "p1", "ok": True, "result": {"ok": True}},
    ]


def test_the_daemon_emit_can_send_any_event() -> None:
    daemon, stream = make_daemon()
    daemon.emit(
        "daemon", {"state": "browser_launching", "browser": "firefox", "message": "Starting..."}
    )
    assert lines(stream) == [
        {
            "type": "event",
            "event": "daemon",
            "data": {"state": "browser_launching", "browser": "firefox", "message": "Starting..."},
        }
    ]


# --- the progress helper ---


def test_emit_progress_builds_the_frozen_payload() -> None:
    events: list[tuple[str, dict[str, Any]]] = []

    def collect(event: str, data: dict[str, Any]) -> None:
        events.append((event, data))

    progress.emit_progress(collect, "generate_keywords", 2, 4, "chat 2 of 4 done", keywords=137)
    assert events == [
        (
            "progress",
            {
                "action": "generate_keywords",
                "done": 2,
                "total": 4,
                "message": "chat 2 of 4 done",
                "keywords": 137,
            },
        )
    ]
    # Counts are ints on the wire, whatever was passed; the message is optional.
    events.clear()
    progress.emit_progress(collect, "a", cast("int", 1.0), cast("int", "3"))
    assert events == [("progress", {"action": "a", "done": 1, "total": 3, "message": ""})]


def test_emit_progress_is_a_no_op_without_emit_and_never_raises() -> None:
    progress.emit_progress(None, "a", 1, 2)

    def broken(_event: str, _data: dict[str, Any]) -> None:
        raise OSError("the app is gone")

    progress.emit_progress(broken, "a", 1, 2)  # must not raise


# --- the argv main sends (gemini-service.ts, bridgeArgs) ---


def test_the_daemon_reads_the_argv_main_sends() -> None:
    args = daemon_module.build_parser().parse_args(
        [
            "--port",
            "8765",
            "--data-dir",
            "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline",
            "--profile-dir",
            "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\gemini-profile",
            "--extension-dir",
            "C:\\repo\\services\\gemini-extension",
            "--course-dir",
            "D:\\course",
            "--video-dir",
            "D:\\videos",
        ]
    )
    assert args.port == 8765
    assert args.data_dir == Path(
        "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline"
    )
    assert args.profile_dir == Path(
        "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\gemini-profile"
    )
    assert args.extension_dir == Path("C:\\repo\\services\\gemini-extension")
    assert (args.course_dir, args.video_dir) == (Path("D:\\course"), Path("D:\\videos"))
    assert args.verbose is False


def test_without_the_course_flags_there_is_no_course_and_the_port_is_8765() -> None:
    args = daemon_module.build_parser().parse_args(
        ["--profile-dir", "p", "--extension-dir", "e", "-v"]
    )
    assert args.port == 8765
    assert (args.data_dir, args.course_dir, args.video_dir) == (None, None, None)
    assert args.verbose is True


@pytest.mark.parametrize("missing", ["--profile-dir", "--extension-dir"])
def test_the_folders_have_no_default(missing: str, capsys: pytest.CaptureFixture[str]) -> None:
    # No path into the old repository or a guessed app-data folder: main always names them.
    argv = ["--profile-dir", "p", "--extension-dir", "e"]
    at = argv.index(missing)
    del argv[at : at + 2]
    with pytest.raises(SystemExit) as info:
        daemon_module.build_parser().parse_args(argv)
    assert info.value.code == 2
    assert missing in capsys.readouterr().err


def test_the_course_folders_reach_the_comms_course(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from gratovo_pipeline.comms import course

    seen: list[tuple[Path | None, Path | None]] = []

    def configure(course_dir: Path | None, video_dir: Path | None) -> None:
        seen.append((course_dir, video_dir))

    monkeypatch.setattr(course, "configure", configure)
    daemon_module.configure_course(tmp_path / "course", None)
    assert seen == [(tmp_path / "course", None)]
    # Neither flag: nothing to tell the course, and comms is not even imported for it.
    daemon_module.configure_course(None, None)
    assert seen == [(tmp_path / "course", None)]


def test_a_comms_package_that_does_not_import_is_logged_and_the_daemon_carries_on(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, tmp_path: Path
) -> None:
    # None in sys.modules makes the import fail, as a half-written comms package would.
    monkeypatch.setitem(sys.modules, "gratovo_pipeline.comms.course", None)
    with caplog.at_level(logging.WARNING, logger="gratovo_pipeline.gemini.daemon"):
        daemon_module.configure_course(tmp_path / "course", tmp_path / "videos")
    assert "course" in caplog.text


# --- while the extension is not in the app yet (plan D3) ---


def test_browser_info_says_the_extension_comes_later(tmp_path: Path) -> None:
    paths = BrowserPaths(profile_dir=tmp_path / "gemini-profile", extension_dir=tmp_path / "none")
    for browser in ("firefox", "edge", "chrome", "system"):
        info = browser_manager.browser_info({"browser": browser}, paths=paths)
        assert info["selected"] == browser
        addon = info["addon"]
        assert (addon["state"], addon["method"], addon["shippedVersion"]) == (
            "missing",
            "none",
            None,
        )
        assert "later update" in addon["message"]
        assert info["extensionDir"] == str(tmp_path / "none")
        assert info["profile"] == {
            "mode": "managed",
            "dir": str(tmp_path / "gemini-profile"),
            "exists": False,
        }
    assert not (tmp_path / "gemini-profile").exists(), "asking must not create the profile"


@pytest.mark.parametrize("browser", ["firefox", "edge", "system"])
def test_install_addon_and_ensure_window_fail_without_the_extension(
    tmp_path: Path, browser: str
) -> None:
    paths = BrowserPaths(profile_dir=tmp_path / "gemini-profile", extension_dir=tmp_path / "none")
    with pytest.raises(GeminiError) as info:
        browser_manager.install_addon({"browser": browser}, paths=paths)
    assert info.value.code == "ADDON_INSTALL_FAILED"
    assert info.value.details == {"method": "none", "reason": "no extension"}

    gemini: Any = object()  # never touched: the call stops before the browser
    with pytest.raises(GeminiError) as info:
        browser_manager.ensure_window(gemini, {"browser": browser}, paths=paths)
    assert info.value.code == "ADDON_INSTALL_FAILED"
    assert info.value.details == {"method": "none", "reason": "no extension"}
    assert not (tmp_path / "gemini-profile").exists()


def test_the_addon_packer_is_loaded_from_the_extension_folder_only_if_it_is_there(
    tmp_path: Path,
) -> None:
    extension = tmp_path / "gemini-extension"
    extension.mkdir()
    paths = BrowserPaths(profile_dir=tmp_path / "gemini-profile", extension_dir=extension)
    with pytest.raises(GeminiError) as info:
        browser_manager.build_firefox_addon(paths)
    assert info.value.code == "ADDON_INSTALL_FAILED"
    assert info.value.details["reason"] == "no_packer"

    tools = extension / "tools"
    tools.mkdir()
    (tools / "build_addon.py").write_text(
        "from pathlib import Path\n\n"
        "def build_firefox(src_dir, out_dir):\n"
        "    Path(out_dir).mkdir(parents=True, exist_ok=True)\n"
        "    (Path(out_dir) / 'from.txt').write_text(str(src_dir), encoding='utf-8')\n",
        encoding="utf-8",
    )
    out = browser_manager.build_firefox_addon(paths)
    # Built beside the profile, in the app's folder, never in the extension's source.
    assert out == tmp_path / "gemini-addon"
    assert (out / "from.txt").read_text(encoding="utf-8") == str(extension)


# --- every typed method's real result fits main's schema (plan D4) ---

KEYWORDS_STUB = "# KEYWORD GENERATOR STUB\n"
CLASSIFIER_STUB = "# CHANNEL CLASSIFIER STUB\n"
GEMINI_APP = "https://gemini.google.com/app"
ACCOUNT = {"name": "Ada Okafor", "email": "ada@example.com", "index": 0}


def answer(text: str) -> dict[str, Any]:
    return {"index": 0, "text": text, "html": "", "durationMs": 5, "model": "2.5 Pro"}


def send(params: dict[str, Any]) -> dict[str, Any]:
    """Gemini's reply to whichever prompt arrives: a classification or a keyword list."""
    prompt = str(params.get("text") or "")
    if CLASSIFIER_STUB.strip() in prompt:
        return answer(
            json.dumps(
                {
                    "niche": "AI coding tools",
                    "audience": "developers",
                    "language": "English",
                    "brandFit": 4,
                    "reasons": ["reviews AI code editors"],
                    "redFlags": [],
                }
            )
        )
    if KEYWORDS_STUB.strip() in prompt:
        n = len(prompt)  # a different list for every chat of a batch
        return answer(
            f"cursor vs copilot {n}\nclaude code tutorial {n}\nbest ai agent framework {n}\n"
        )
    return answer("Hello from Gemini.")


def extension_handlers() -> dict[str, Scripted]:
    state = {"url": "https://gemini.google.com/u/0/app"}

    def navigate(p: dict[str, Any]) -> dict[str, Any]:
        state["url"] = p["url"]
        return {"tabId": 3, "url": p["url"], "redirected": False, "requestedUrl": p["url"]}

    skill = {
        "name": "gratovo-comms",
        "description": "Creator and brand communication.",
        "active": False,
        "state": "inactive",
    }
    return {
        "status": STATUS,
        "send": send,
        "get_account": ACCOUNT,
        "open": {"tabId": 3, "url": GEMINI_APP},
        "get_url": lambda _p: {"url": state["url"], "accountIndex": 0},
        "navigate": navigate,
        "gem_create": lambda p: {
            "url": "https://gemini.google.com/gem/newgem123",
            "gemId": "newgem123",
            "name": p["name"],
        },
        "gem_update": {
            "url": "https://gemini.google.com/gem/abc123def",
            "gemId": "abc123def",
            "name": "AI news brief",
            "changed": ["instructions"],
        },
        "gem_read": {
            "url": "https://gemini.google.com/gem/abc123def",
            "gemId": "abc123def",
            "name": "AI news brief",
            "description": "Sums up the week in AI tools.",
            "instructions": "Be brief.",
        },
        "skills_list": {"skills": [skill]},
        "skill_read": lambda p: {
            **skill,
            "name": p["name"],
            "instructions": "x",
            "files": [{"path": "SKILL.md", "kind": "file"}],
        },
        "skill_set_active": lambda p: {
            "name": p["name"],
            "active": p["active"],
            "changed": True,
            "notice": None,
        },
        "skill_delete": lambda p: {"name": p["name"], "deleted": True, "notice": None},
        "skill_upload_open": lambda p: {
            "mode": "replace" if p.get("replace") else "create",
            "dropZone": True,
            "dropSelector": '[data-gb-drop="gbtest"]',
        },
        "drop_files": {"dropped": True, "files": 1, "bytes": 10, "target": "div.upload-area"},
        "skill_upload_finish": lambda p: {
            "mode": "replace",
            "name": p["expectName"],
            "saved": True,
            "progress": [],
            "notice": None,
        },
    }


class Live:
    """An in-process daemon with its server up, writing to memory; every line it writes is
    checked against main's schemas as it is read."""

    def __init__(self, folder: Path, schema: dict[str, Any]) -> None:
        self.schema = schema
        self.stream = io.StringIO()
        self.extension = folder / "gemini-extension"
        self.paths = BrowserPaths(
            profile_dir=folder / "gemini-profile", extension_dir=self.extension
        )
        self.daemon = Daemon(
            port=0, data_dir=folder / "example-pipeline", out=Out(self.stream), paths=self.paths
        )
        assert self.daemon.start()
        self.fakes: list[FakeExtension] = []
        self.offset = 0
        self.count = 0
        self.checked: set[str] = set()

    def read(self, method: str | None = None) -> list[dict[str, Any]]:
        text = self.stream.getvalue()
        new, self.offset = text[self.offset :], len(text)
        messages: list[dict[str, Any]] = []
        for line in new.splitlines(keepends=True):
            message = cast("dict[str, Any]", json.loads(line))
            assert line.endswith("\n")
            problems = gemini_problems(self.schema, message, method)
            assert problems == [], (problems, message)
            messages.append(message)
        return messages

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.count += 1
        request_id = f"r{self.count}"
        self.daemon.handle({"id": request_id, "method": method, "params": params})
        replies = [m for m in self.read(method) if m.get("id") == request_id]
        assert len(replies) == 1, replies
        if replies[0]["ok"]:
            self.checked.add(method)
        return replies[0]

    def attach(self, handlers: dict[str, Scripted]) -> FakeExtension:
        fake = FakeExtension(self.daemon.gemini.port, handlers).start()
        self.fakes.append(fake)
        wait_until(lambda: self.daemon.gemini.server.hello is not None, what="the hello")
        return fake

    def close(self) -> None:
        for fake in self.fakes:
            fake.stop()
        self.daemon.stop()
        self.read()


@pytest.fixture
def live(
    tmp_path: Path, gemini_schema: dict[str, Any], loopback: None, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Live]:
    skills = tmp_path / "gemini-skills"
    skills.mkdir()
    (skills / "keyword generator skill.md").write_text(KEYWORDS_STUB, encoding="utf-8")
    (skills / "channel classifier skill.md").write_text(CLASSIFIER_STUB, encoding="utf-8")
    monkeypatch.setattr(pipeline_paths, "GEMINI_SKILLS_DIR", skills)
    run = Live(tmp_path, gemini_schema)
    try:
        yield run
    finally:
        run.close()


def test_every_typed_result_the_daemon_produces_fits_mains_schema(
    live: Live, tmp_path: Path, gemini_schema: dict[str, Any]
) -> None:
    status = live.call("bridge.status", {})["result"]
    assert status["extensionConnected"] is False

    # No extension in the app yet (plan D3).
    info = live.call("bridge.browser_info", {})["result"]
    assert info["addon"]["state"] == "missing"
    for method in ("bridge.install_addon", "bridge.ensure_window"):
        error = live.call(method, {})["error"]
        assert error["code"] == "ADDON_INSTALL_FAILED", method
        assert error["details"] == {"method": "none", "reason": "no extension"}, method

    # The extension's folder arrives (step 6).
    live.extension.mkdir()
    (live.extension / "manifest.json").write_text('{"version": "0.2.0"}', encoding="utf-8")
    info = live.call("bridge.browser_info", {})["result"]
    assert info["addon"]["shippedVersion"] == "0.2.0"

    live.attach(extension_handlers())
    assert live.call("bridge.status", {})["result"]["status"] == STATUS
    window = live.call("bridge.ensure_window", {})["result"]
    assert (window["connected"], window["reused"]) == (True, True)
    assert window["tab"] == {"tabId": 3, "url": GEMINI_APP}
    assert window["account"]["email"] == "ada@example.com"
    assert live.call("bridge.ensure_account", {"match": "ada"})["result"]["name"] == "Ada Okafor"
    assert live.call("bridge.ask", {"prompt": "hi"})["result"]["text"] == "Hello from Gemini."

    keywords = live.call("action.generate_keywords", {"topic": "AI coding tools", "count": 3})
    assert len(keywords["result"]["keywords"]) == 3
    batch = live.call(
        "action.generate_keywords", {"topic": "AI coding tools", "count": 6, "chats": 2}
    )
    assert batch["ok"] is True, batch
    assert len(batch["result"]["chats"]) == 2
    channel = {"handle": "@ai-code-lab", "title": "AI Code Lab"}
    classified = live.call("action.classify_channel", {"channel": channel, "niche": "AI tools"})
    assert classified["result"]["brandFit"] == 4

    created = live.call(
        "action.gem_create",
        {"name": "AI news brief", "description": "AI tools", "instructions": "Be brief."},
    )
    assert created["result"]["gemId"] == "newgem123"
    updated = live.call("action.gem_update", {"gem": "abc123def", "instructions": "Shorter."})
    assert updated["result"]["changed"] == ["instructions"]
    assert live.call("action.gem_read", {"gem": "abc123def"})["result"]["name"] == "AI news brief"

    listed = live.call("action.skills_list", {})["result"]
    assert [s["name"] for s in listed["skills"]] == ["gratovo-comms"]
    assert live.call("action.skill_read", {"name": "gratovo-comms"})["ok"] is True
    toggled = live.call("action.skill_set_active", {"name": "gratovo-comms", "active": True})
    assert toggled["result"]["changed"] is True
    deleted = live.call("action.skill_delete", {"name": "gratovo-comms", "confirm": True})
    assert deleted["result"]["deleted"] is True

    # A browser that is not Firefox: the add-on is loaded by hand (and that browser is now the
    # only one admitted, so this goes last).
    unpacked = live.call("bridge.install_addon", {"browser": "edge"})["result"]
    assert (unpacked["state"], unpacked["method"]) == ("unknown", "unpacked")
    assert live.call("bridge.shutdown", {})["result"] == {"ok": True}

    # Every method main types has had a real answer checked here (skill_deploy just below).
    assert live.checked == set(gemini_schema["results"]) - {"action.skill_deploy"}


def test_a_deployed_skills_result_fits_mains_schema(live: Live, tmp_path: Path) -> None:
    live.attach(extension_handlers())
    skill_folder = tmp_path / "skills" / "gratovo-comms"
    skill_folder.mkdir(parents=True)
    (skill_folder / "SKILL.md").write_text(
        "---\nname: gratovo-comms\ndescription: Creator and brand communication.\n---\n\nBody.\n",
        encoding="utf-8",
    )
    deployed = live.call("action.skill_deploy", {"folder": str(skill_folder)})
    assert deployed["result"]["onPage"] == ["SKILL.md"]
