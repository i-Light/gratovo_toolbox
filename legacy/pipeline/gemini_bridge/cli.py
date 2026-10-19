"""`python -m gemini_bridge <command>` -- the bridge from a terminal.

    python -m gemini_bridge serve                 # does the extension connect?
    python -m gemini_bridge status
    python -m gemini_bridge diag newChat          # why can't it find New chat?
    python -m gemini_bridge heal newChat --pick 0 # apply the first suggestion
    python -m gemini_bridge ask "Five keywords about solar panels" --new-chat
    python -m gemini_bridge keywords "AI coding tools" --count 50
    python -m gemini_bridge daemon                # what the Flutter app runs (DAEMON.md)

Every command takes `--port`, `--timeout` (how long to wait for the
extension to connect) and `--json` (raw result on stdout, raw error details
on stderr). A `GeminiError` exits 1 with `CODE: message` on stderr, which is
what a shell script or another program should key on.

`--timeout` AFTER `ask`, `model`, `new-chat` or `queue wait` is that
operation's own wait (how long to give Gemini), because that is what a person
typing the command means by it; the connect timeout for those goes before
the command: `python -m gemini_bridge --timeout 30 ask --timeout 300 "..."`.
"""

from __future__ import annotations

import argparse
import functools
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from . import __version__, daemon
from .client import Gemini
from .errors import GeminiError
from .server import DEFAULT_PORT, BridgeServer

PROG = "python -m gemini_bridge"


# --- output helpers ------------------------------------------------------------

def _configure_console() -> None:
    """UTF-8 on Windows consoles, and never crash on a glyph the codepage lacks."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False, default=str)


def _read_file(path: str) -> str:
    """A text file as the tools read it: BOM-aware (PowerShell's `>` writes UTF-16), LF-normalised."""
    if path == "-":
        return sys.stdin.read().replace("\r\n", "\n")
    data = Path(path).read_bytes()
    for bom, encoding in ((b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be"),
                          (b"\xef\xbb\xbf", "utf-8-sig")):
        if data.startswith(bom):
            return data.decode(encoding).lstrip("\ufeff").replace("\r\n", "\n")
    return data.decode("utf-8", "replace").replace("\r\n", "\n")


def _yes_no(value: Any) -> str:
    return "yes" if value else "no"


def _account_line(account: Any, index: Any = None) -> str:
    if not isinstance(account, dict):
        return "unknown"
    name = account.get("name") or "?"
    email = account.get("email")
    text = f"{name} ({email})" if email else str(name)
    if index is None:
        index = account.get("index")
    return f"{text}  /u/{index}" if index is not None else text


def describe_strategy(strategy: Any) -> str:
    """One line a person can read for a locator strategy (PROTOCOL.md §4)."""
    if not isinstance(strategy, dict):
        return repr(strategy)
    kind = strategy.get("type", "?")
    parts: list[str] = [str(kind)]
    if kind == "css":
        parts.append(repr(strategy.get("value", "")))
    elif kind == "attr":
        parts.append(f"{strategy.get('attr', '?')} ~ /{strategy.get('match', '')}/")
    elif kind in ("text", "icon"):
        parts.append(f"~ /{strategy.get('match', '')}/")
    elif kind == "fn":
        parts.append(str(strategy.get("name", "?")))
    else:
        extra = {k: v for k, v in strategy.items() if k not in ("type", "name")}
        parts.append(json.dumps(extra, ensure_ascii=False))
    if strategy.get("tags"):
        parts.append("on " + ", ".join(map(str, strategy["tags"])))
    if strategy.get("climb"):
        parts.append(f"climb {strategy['climb']!r}")
    if strategy.get("within"):
        parts.append(f"within {strategy['within']!r}")
    line = " ".join(parts)
    if strategy.get("name"):
        line = f"[{strategy['name']}] {line}"
    return line


def describe_element(summary: Any) -> str:
    """One line for an element summary from the diagnostics object."""
    if not isinstance(summary, dict):
        return repr(summary)
    head = str(summary.get("tag") or "?")
    if summary.get("id"):
        head += f"#{summary['id']}"
    classes = str(summary.get("classes") or "").split()
    if classes:
        head += "." + ".".join(classes[:4]) + (" …" if len(classes) > 4 else "")
    bits = [head]
    if summary.get("testId"):
        bits.append(f"testId={summary['testId']!r}")
    if summary.get("aria"):
        bits.append(f"aria={str(summary['aria'])[:60]!r}")
    if summary.get("text"):
        bits.append(f"text={str(summary['text'])[:40]!r}")
    rect = summary.get("rect")
    if isinstance(rect, dict):
        bits.append(f"@{rect.get('x')},{rect.get('y')} {rect.get('w')}x{rect.get('h')}")
    line = " ".join(bits)
    if summary.get("path"):
        line += f"\n        {summary['path']}"
    return line


# --- the commands ------------------------------------------------------------

def _gemini(args: argparse.Namespace) -> Gemini:
    # The extension opens a Gemini tab on demand for any method that needs
    # one (PROTOCOL.md §3), so the CLI never opens one eagerly -- `status`
    # on a browser with no Gemini tab should say so, not create one.
    return Gemini(port=args.port, connect_timeout=args.connect_timeout, auto_open=False,
                  data_dir=args.data_dir)


def _emit(args: argparse.Namespace, data: Any, human: Optional[Callable[[Any], None]] = None) -> None:
    if args.json:
        print(_dump(data))
    elif human is not None:
        human(data)
    else:
        print(_dump(data))


def cmd_status(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        status = g.status()
    _emit(args, status, print_status)
    return 0


def print_status(status: dict) -> None:
    model = status.get("model")
    print(f"url:         {status.get('url', '?')}")
    print(f"account:     {_account_line(status.get('account'), status.get('accountIndex'))}")
    print(f"model:       {model.get('name') if isinstance(model, dict) else model}")
    print(f"generating:  {_yes_no(status.get('generating'))}    signed out: "
          f"{_yes_no(status.get('signedOut'))}    ready: {_yes_no(status.get('ready'))}")
    page_error = status.get("pageError")
    if isinstance(page_error, dict):
        print(f"page error:  {page_error.get('text')} ({page_error.get('source')})")
    else:
        print(f"page error:  {page_error or 'none'}")
    q = status.get("queue") or {}
    print(f"queue:       {q.get('length', 0)} queued, running: {q.get('running') or 'none'}, "
          f"paused: {_yes_no(q.get('paused'))}")
    elements = status.get("elements") or {}
    if elements:
        print("elements:")
        for name, info in elements.items():
            info = info if isinstance(info, dict) else {}
            state = "found" if info.get("found") else "MISSING"
            via = info.get("strategy") or ""
            note = info.get("note") or ""
            print(f"  {name:<14} {state:<8} {via:<12} {note}".rstrip())


def cmd_diag(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        diag = g.diagnostics()
        # The strategy names in `tried` are only names; the definitions
        # behind them come from the selector lists.
        try:
            selectors = g.selectors()
        except GeminiError:
            selectors = {}
    if args.element and args.element not in (diag.get("elements") or {}):
        known = ", ".join(sorted(diag.get("elements") or {})) or "none"
        print(f"BAD_PARAMS: unknown element {args.element!r}; known: {known}", file=sys.stderr)
        return 1
    if args.json:
        if args.element:
            print(_dump(diag["elements"][args.element]))
        else:
            print(_dump(diag))
        return 0
    print_diagnostics(diag, selectors, only=args.element, port=args.port)
    return 0


def _strategy_definitions(element: str, selectors: dict, diag: dict) -> dict[str, dict]:
    """name -> strategy for one element, so `tried` lines can show what each name means.

    Names default to `<type>#<index>` with a 1-based index over the combined
    list (overrides first, then builtin) -- that is what the diagnostics
    example in PROTOCOL.md §4 shows (`css#1` at `strategyIndex` 0). A
    strategy that carries its own `name` is listed under that.
    """
    overrides = (diag.get("overrides") or {}) if isinstance(diag.get("overrides"), dict) else {}
    if not overrides and isinstance(selectors.get("overrides"), dict):
        overrides = selectors["overrides"]
    builtin = selectors.get("builtin") if isinstance(selectors.get("builtin"), dict) else {}
    combined = list(overrides.get(element) or []) + list(builtin.get(element) or [])
    names: dict[str, dict] = {}
    for i, strategy in enumerate(combined):
        if not isinstance(strategy, dict):
            continue
        names[f"{strategy.get('type', '?')}#{i + 1}"] = strategy
        if strategy.get("name"):
            names[str(strategy["name"])] = strategy
    return names


def print_diagnostics(diag: dict, selectors: dict, only: Optional[str] = None,
                      port: int = DEFAULT_PORT) -> None:
    if not only:
        print(f"url:          {diag.get('url', '?')}")
        print(f"title:        {diag.get('title', '?')}")
        print(f"ready state:  {diag.get('readyState', '?')}    extension: "
              f"{diag.get('extensionVersion', '?')}    signed out: {_yes_no(diag.get('signedOut'))}")
        page_error = diag.get("pageError")
        if isinstance(page_error, dict):
            print(f"page error:   {page_error.get('text')} ({page_error.get('source')})")
        else:
            print(f"page error:   {page_error or 'none'}")
        page = diag.get("page") or {}
        if page:
            customs = page.get("customElements") or []
            print(f"page:         {page.get('buttons', '?')} buttons, "
                  f"{page.get('contentEditables', '?')} contentEditables, "
                  f"{page.get('textareas', '?')} textareas")
            if customs:
                print(f"custom tags:  {', '.join(map(str, customs))}")
        overrides = diag.get("overrides") or {}
        if overrides:
            print("overrides:    " + ", ".join(f"{k} ({len(v or [])})" for k, v in overrides.items()))
        print()

    elements = diag.get("elements") or {}
    port_flag = "" if port == DEFAULT_PORT else f" --port {port}"
    for name, info in elements.items():
        if only and name != only:
            continue
        info = info if isinstance(info, dict) else {}
        definitions = _strategy_definitions(name, selectors, diag)
        if info.get("found"):
            strategy = info.get("strategy")
            definition = definitions.get(str(strategy))
            via = f"via {strategy}" + (f"  {describe_strategy(definition)}" if definition else "")
            print(f"{name:<16} found  {via}")
            if isinstance(info.get("element"), dict):
                print(f"    {describe_element(info['element'])}")
            continue

        print(f"{name:<16} MISSING")
        tried = info.get("tried") or []
        if tried:
            print("  tried:")
            for entry in tried:
                if not isinstance(entry, dict):
                    print(f"    {entry}")
                    continue
                label = str(entry.get("strategy", "?"))
                if entry.get("describe"):
                    described = str(entry["describe"])
                elif label in definitions:
                    described = describe_strategy(definitions[label])
                else:
                    described = ""
                counts = f"matched {entry.get('matched', '?')}, visible {entry.get('visible', '?')}"
                print(f"    {label:<10} {counts:<24} {described}".rstrip())
        last_known = info.get("lastKnown")
        if isinstance(last_known, dict):
            when = last_known.get("at")
            if isinstance(when, (int, float)):
                when = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(when / 1000))
            print(f"  last known (how it used to get it): {last_known.get('strategy', '?')}"
                  + (f" at {when}" if when else ""))
            definition = definitions.get(str(last_known.get("strategy")))
            if definition:
                print(f"    {describe_strategy(definition)}")
            if isinstance(last_known.get("element"), dict):
                print(f"    {describe_element(last_known['element'])}")
        candidates = info.get("candidates") or []
        if candidates:
            print(f"  candidates ({len(candidates)}):")
            for candidate in candidates[:12]:
                print(f"    {describe_element(candidate)}")
            if len(candidates) > 12:
                print(f"    … {len(candidates) - 12} more (use --json)")
        suggestions = info.get("suggestions") or []
        if suggestions:
            print("  suggestions:")
            for i, suggestion in enumerate(suggestions):
                strategy = suggestion.get("strategy") if isinstance(suggestion, dict) \
                    and isinstance(suggestion.get("strategy"), dict) else suggestion
                reason = suggestion.get("reason") if isinstance(suggestion, dict) else None
                print(f"    [{i}] {describe_strategy(strategy)}" + (f"  -- {reason}" if reason else ""))
                print(f"        {PROG}{port_flag} heal {name} --pick {i}")
        else:
            print("  suggestions: none -- use the candidates above to write an override "
                  "(see README.md, healing)")
        print()


def cmd_heal(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        strategy = g.heal(args.element, pick=args.pick)
        after = (g.status().get("elements") or {}).get(args.element) or {}
    if args.json:
        print(_dump({"element": args.element, "applied": strategy, "found": bool(after.get("found")),
                     "strategy": after.get("strategy")}))
        return 0
    print(f"applied to {args.element}: {describe_strategy(strategy)}")
    if after.get("found"):
        print(f"{args.element} is now found via {after.get('strategy')}")
    else:
        print(f"{args.element} is STILL missing -- try `diag {args.element}` again or another --pick")
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        if args.json:
            result = g.send(args.prompt, wait=True, new_chat=args.new_chat, model=args.model,
                            timeout=args.op_timeout, mode=args.mode, skills=args.skill)
            print(_dump(result))
        else:
            print(g.ask(args.prompt, new_chat=args.new_chat, model=args.model,
                        timeout=args.op_timeout, mode=args.mode, skills=args.skill))
    return 0


# --- Gemini 4 Argon: skills, thinking level --------------------------------------------

def cmd_skills(args: argparse.Namespace) -> int:
    from . import skills
    with _gemini(args) as g:
        items = skills.list_skills(g)

    def human(rows: list) -> None:
        for s in rows:
            mark = "on " if s.get("active") else "off"
            print(f" [{mark}] {s.get('name')}  -- {str(s.get('description') or '')[:90]}")

    _emit(args, items, human)
    return 0


def cmd_skill_read(args: argparse.Namespace) -> int:
    from . import skills
    with _gemini(args) as g:
        result = skills.read(g, args.name, contents=args.contents)

    def human(r: dict) -> None:
        print(f"{r.get('name')} ({'on' if r.get('active') else 'off'}): {r.get('description')}")
        for f in r.get("files") or []:
            size = f" ({len(f['content'])} chars)" if "content" in f else ""
            print(f"  {f.get('path')}{size}")

    _emit(args, result, human)
    return 0


def cmd_skill_deploy(args: argparse.Namespace) -> int:
    from . import skills
    with _gemini(args) as g:
        result = skills.deploy(g, Path(args.folder), active=args.active, check=not args.no_verify)
        if args.probe:
            question, _, expect = args.probe.partition("=>")
            result["probe"] = skills.probe(g, result["name"], question.strip(), expect.strip(),
                                           mode="task" if result.get("hasScripts") else "chat")
    _emit(args, result, lambda r: print(f"{r['mode']}d {r['name']} ({len(r['files'])} files, sha256 {r['sha256'][:12]}), "
                                        f"{'on' if r.get('active') else 'off'}, verified={r.get('verified')}"))
    return 0


def cmd_skill_active(args: argparse.Namespace) -> int:
    from . import skills
    with _gemini(args) as g:
        result = skills.set_active(g, args.name, args.state == "on")
    _emit(args, result, lambda r: print(f"{r['name']}: {'on' if r['active'] else 'off'}"
                                        f"{'' if r.get('changed') else ' (already)'}"))
    return 0


def cmd_skill_delete(args: argparse.Namespace) -> int:
    from . import skills
    if not args.yes:
        print("skill-delete cannot be undone; pass --yes", file=sys.stderr)
        return 2
    with _gemini(args) as g:
        result = skills.delete(g, args.name)
    _emit(args, result, lambda r: print(f"deleted {r['name']}"))
    return 0


def cmd_thinking(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        result = g.set_thinking_level(args.level) if args.level else g.thinking_levels()

    def human(r: dict) -> None:
        if "levels" in r:
            for lv in r["levels"]:
                print(f" {'*' if lv.get('selected') else ' '} {lv.get('name')}  -- {lv.get('description', '')}")
        else:
            print(f"thinking level: {r.get('level')}{'' if r.get('changed') else ' (already)'}")

    _emit(args, result, human)
    return 0


def cmd_new_chat(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        result = g.new_chat(timeout=args.op_timeout)
    _emit(args, result, lambda r: print(f"new chat: {r.get('url', '')}"))
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        models = g.models()

    def human(items: list) -> None:
        for m in items:
            mark = "*" if m.get("selected") else " "
            desc = f"  -- {m['description']}" if m.get("description") else ""
            print(f" {mark} {m.get('name', '?')}{desc}")

    _emit(args, models, human)
    return 0


def cmd_model(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        name = g.set_model(args.name, timeout=args.op_timeout)
    _emit(args, {"name": name}, lambda r: print(f"model: {r['name']}"))
    return 0


def cmd_account(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        account = g.ensure_account(args.match) if args.match else g.account()
    _emit(args, account, lambda a: print(_account_line(a)))
    return 0


def cmd_queue_add(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        job = g.queue(args.prompt, new_chat=args.new_chat, model=args.model)
    _emit(args, job.raw, lambda j: print(f"{job.id}  {job.status}"))
    return 0


def cmd_queue_list(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        listed = g.call("queue_list") or {}

    def human(state: dict) -> None:
        jobs = state.get("jobs") or []
        print(f"paused: {_yes_no(state.get('paused'))}    running: {state.get('running') or 'none'}"
              f"    jobs: {len(jobs)}")
        for j in jobs:
            prompt = str(j.get("prompt", "")).replace("\n", " ")
            if len(prompt) > 60:
                prompt = prompt[:57] + "..."
            error = j.get("error") or {}
            tail = f"  ({error.get('code')})" if error else ""
            print(f"  {str(j.get('id', '?')):<10} {str(j.get('status', '?')):<10} {prompt}{tail}")

    _emit(args, listed, human)
    return 0


def cmd_queue_wait(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        text = g.wait(args.job_id, timeout=args.op_timeout)
        raw = g.job(args.job_id).raw if args.json else None
    if args.json:
        print(_dump(raw))
    else:
        print(text)
    return 0


def cmd_queue_clear(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        removed = g.clear_queue(include_running=args.include_running)
    _emit(args, {"removed": removed}, lambda r: print(f"removed {r['removed']} job(s)"))
    return 0


def cmd_selectors(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        selectors = g.selectors()

    def human(sel: dict) -> None:
        overrides = sel.get("overrides") or {}
        builtin = sel.get("builtin") or {}
        for element in sorted(set(builtin) | set(overrides)):
            print(element)
            for s in overrides.get(element) or []:
                print(f"  override  {describe_strategy(s)}")
            for s in builtin.get(element) or []:
                print(f"  builtin   {describe_strategy(s)}")

    _emit(args, selectors, human)
    return 0


def cmd_tabs(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        tabs = g.tabs()

    def human(items: list) -> None:
        if not items:
            print("no Gemini tabs")
        for t in items:
            flags = ("active " if t.get("active") else "") + ("ready" if t.get("ready") else "not ready")
            print(f"  {str(t.get('tabId', '?')):<6} {flags:<14} {t.get('url', '')}   {t.get('title', '')}")

    _emit(args, tabs, human)
    return 0


def cmd_open(args: argparse.Namespace) -> int:
    with _gemini(args) as g:
        tab = g.open(url=args.url, focus=True, new_tab=args.new_tab)
    _emit(args, tab, lambda t: print(f"tab {t.get('tabId')}: {t.get('url')}"))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    server = BridgeServer(port=args.port)
    server.start()
    if args.json:
        def show(event: str, data: dict) -> None:
            print(json.dumps({"event": event, "data": data}, ensure_ascii=False, default=str), flush=True)
    else:
        print(f"listening on ws://127.0.0.1:{server.port} -- waiting for the extension "
              f"(Ctrl-C to stop)", flush=True)

        def show(event: str, data: dict) -> None:
            stamp = time.strftime("%H:%M:%S")
            if event == "hello":
                line = f"extension {data.get('extensionVersion', '?')} says hello (its port: {data.get('port', '?')})"
            elif event == "status":
                model = data.get("model")
                line = (f"model={model.get('name') if isinstance(model, dict) else model} "
                        f"generating={_yes_no(data.get('generating'))} "
                        f"signedOut={_yes_no(data.get('signedOut'))} url={data.get('url', '')}")
            elif event == "job":
                error = data.get("error") or {}
                line = f"{data.get('id')} {data.get('status')}" + (f" ({error.get('code')})" if error else "")
            elif event == "log":
                line = f"{data.get('level', 'info')}: {data.get('message', '')}"
                if data.get("context"):
                    line += "  " + json.dumps(data["context"], ensure_ascii=False, default=str)
            elif event == "disconnected":
                line = f"code={data.get('code')} reason={data.get('reason')!r}"
            else:
                line = json.dumps(data, ensure_ascii=False, default=str)
            print(f"[{stamp}] {event:<12} {line}", flush=True)

    for event in ("connected", "hello", "status", "job", "log", "disconnected"):
        server.on(event, functools.partial(show, event))
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
    return 0


EXTENSION_DIR = Path(__file__).resolve().parent.parent / "gemini_extension"
_WATCH_SKIP = {"node_modules", "test", ".git"}


def _extension_snapshot(root: Path) -> dict[str, float]:
    """Path → mtime for every file that ships with the extension (tests and
    node_modules are not loaded by the browser, so they are ignored)."""
    out: dict[str, float] = {}
    for f in root.rglob("*"):
        if not f.is_file() or _WATCH_SKIP & set(f.relative_to(root).parts):
            continue
        try:
            out[str(f.relative_to(root))] = f.stat().st_mtime
        except OSError:
            pass
    return out


def cmd_watch(args: argparse.Namespace) -> int:
    """Reload the unpacked extension in the browser whenever one of its files
    changes. The server is only up during the reload, so the CLI and the app's
    daemon can still take the port in between."""
    root = Path(args.dir).resolve() if args.dir else EXTENSION_DIR
    if not (root / "manifest.json").is_file():
        print(f"no manifest.json in {root}", file=sys.stderr)
        return 2
    before = _extension_snapshot(root)
    print(f"watching {root} ({len(before)} files) -- Ctrl-C to stop", flush=True)

    def reload(changed: list[str]) -> None:
        stamp = time.strftime("%H:%M:%S")
        print(f"[{stamp}] changed: {', '.join(changed[:6])}{' ...' if len(changed) > 6 else ''}", flush=True)
        try:
            with Gemini(port=args.port, connect_timeout=args.connect_timeout, auto_open=False) as g:
                g.reload_extension()
                hello = g.call("hello", {})
                print(f"[{time.strftime('%H:%M:%S')}] reloaded -> extension {hello.get('extensionVersion', '?')} "
                      f"back on port {hello.get('port', '?')}", flush=True)
        except GeminiError as e:
            print(f"[{time.strftime('%H:%M:%S')}] reload failed: {e.code}: {e.message}", flush=True)

    try:
        while True:
            time.sleep(args.interval)
            now = _extension_snapshot(root)
            changed = sorted(k for k in set(before) | set(now) if before.get(k) != now.get(k))
            if not changed:
                continue
            # Let an editor finish writing (several files, temp-file renames).
            time.sleep(0.4)
            now = _extension_snapshot(root)
            before = now
            reload(changed)
    except KeyboardInterrupt:
        return 0


def cmd_daemon(args: argparse.Namespace) -> int:
    daemon._configure_streams()  # noqa: SLF001 - the daemon's own stdout contract
    logging.getLogger().setLevel(logging.DEBUG if args.verbose else logging.INFO)
    return daemon.serve(port=args.port, data_dir=args.data_dir)


def _action_options(args: argparse.Namespace) -> dict:
    options: dict = {}
    if getattr(args, "gem", None):
        options["gem"] = args.gem
    if getattr(args, "model", None):
        options["model"] = args.model
    if getattr(args, "op_timeout", None):
        options["timeoutS"] = args.op_timeout
    return options


def cmd_keywords(args: argparse.Namespace) -> int:
    avoid: list[str] = []
    if args.avoid_file:
        avoid = [line.strip() for line in _read_file(args.avoid_file).splitlines() if line.strip()]
    with _gemini(args) as g:
        result = g.generate_keywords(
            args.topic, count=args.count, exclusions=args.exclude, styles=args.style,
            language=args.language, avoid=avoid, notes=args.notes, **_action_options(args))
    if args.json:
        print(_dump(result))
    else:
        for keyword in result["keywords"]:
            print(keyword)
        print(f"# {len(result['keywords'])} keywords, {result['dropped']} dropped as duplicates",
              file=sys.stderr)
    return 0


# --- the parser --------------------------------------------------------------

def _add_common(parser: argparse.ArgumentParser, connect_timeout: bool = True) -> None:
    """The global options, repeated on each subcommand so they work in either position."""
    suppress = argparse.SUPPRESS
    parser.add_argument("--port", type=int, default=suppress,
                        help=f"the server port the extension dials (default {DEFAULT_PORT})")
    parser.add_argument("--json", action="store_true", default=suppress,
                        help="raw JSON on stdout; error details as JSON on stderr")
    parser.add_argument("--data-dir", type=Path, default=suppress,
                        help="where `gemini skills/` lives (default: the repo's data/)")
    if connect_timeout:
        parser.add_argument("--timeout", dest="connect_timeout", type=float, default=suppress,
                            help="seconds to wait for the extension to connect (default 60)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG, description="Drive the Gemini web UI through the browser extension.")
    parser.add_argument("--version", action="version", version=f"gemini_bridge {__version__}")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"the server port the extension dials (default {DEFAULT_PORT})")
    parser.add_argument("--timeout", dest="connect_timeout", type=float, default=60.0,
                        help="seconds to wait for the extension to connect (default 60)")
    parser.add_argument("--json", action="store_true", default=False,
                        help="raw JSON on stdout; error details as JSON on stderr")
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="where `gemini skills/` lives (default: the repo's data/)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="show the bridge's and the extension's log lines on stderr")
    sub = parser.add_subparsers(dest="command", metavar="command")

    def add(name: str, func: Callable, help_text: str, connect_timeout: bool = True,
            parent: Any = sub) -> argparse.ArgumentParser:
        p = parent.add_parser(name, help=help_text, description=help_text)
        _add_common(p, connect_timeout=connect_timeout)
        p.set_defaults(func=func)
        return p

    add("status", cmd_status, "print the status object")

    p = add("diag", cmd_diag, "diagnostics: every element, what was tried, candidates, suggestions")
    p.add_argument("element", nargs="?", help="only this element (e.g. newChat)")

    p = add("heal", cmd_heal, "apply a suggested selector from `diag` as a new override")
    p.add_argument("element")
    p.add_argument("--pick", type=int, default=0, help="which suggestion (default 0)")

    p = add("ask", cmd_ask, "send a prompt, wait for the answer, print it", connect_timeout=False)
    p.add_argument("prompt")
    p.add_argument("--new-chat", action="store_true", help="start a new chat first")
    p.add_argument("--model", help="switch to this model first (name or substring)")
    p.add_argument("--mode", choices=("chat", "task"), help="run as a plain chat or a Gemini task (tasks take minutes)")
    p.add_argument("--skill", action="append", help="pick this skill from the @ list first (repeatable)")
    p.add_argument("--timeout", dest="op_timeout", type=float, default=180.0,
                   help="seconds to wait for the answer (default 180; give a task 600)")

    add("skills", cmd_skills, "list the account's Gemini skills (on/off)")
    p = add("skill-read", cmd_skill_read, "show a skill's files as the Skills page has them")
    p.add_argument("name")
    p.add_argument("--contents", action="store_true", help="read every file's text too")
    p = add("skill-deploy", cmd_skill_deploy, "package a skill folder, upload (create or replace), set on/off, verify")
    p.add_argument("folder")
    p.add_argument("--active", action="store_true", help="leave it on (default off: used by @-mention only)")
    p.add_argument("--no-verify", action="store_true", help="skip reading the file list back")
    p.add_argument("--probe", help='"question => expected text": ask the skill afterwards, until the answer has it')
    p = add("skill-active", cmd_skill_active, "turn a skill on or off")
    p.add_argument("name")
    p.add_argument("state", choices=("on", "off"))
    p = add("skill-delete", cmd_skill_delete, "delete a skill for good")
    p.add_argument("name")
    p.add_argument("--yes", action="store_true", help="really delete it")
    p = add("thinking", cmd_thinking, "list Argon's thinking levels, or pick one")
    p.add_argument("level", nargs="?", help="level name or substring (e.g. مرتفع / high)")

    p = add("new-chat", cmd_new_chat, "start a new chat", connect_timeout=False)
    p.add_argument("--timeout", dest="op_timeout", type=float, default=None,
                   help="seconds to wait for the fresh chat")

    add("models", cmd_models, "list the models in the switcher menu")

    p = add("model", cmd_model, "switch model", connect_timeout=False)
    p.add_argument("name", help="model name or substring, case-insensitive")
    p.add_argument("--timeout", dest="op_timeout", type=float, default=None,
                   help="seconds to wait for the switch")

    p = add("account", cmd_account, "print the current account, or switch to one that matches MATCH")
    p.add_argument("match", nargs="?", help="name or email fragment, case-insensitive")

    p = add("queue", lambda a: 2, "the extension's prompt queue")
    qsub = p.add_subparsers(dest="queue_command", metavar="subcommand")

    p = add("add", cmd_queue_add, "queue a prompt", parent=qsub)
    p.add_argument("prompt")
    p.add_argument("--new-chat", action="store_true")
    p.add_argument("--model")

    add("list", cmd_queue_list, "list the jobs", parent=qsub)

    p = add("wait", cmd_queue_wait, "wait for a job and print its answer", connect_timeout=False,
            parent=qsub)
    p.add_argument("job_id")
    p.add_argument("--timeout", dest="op_timeout", type=float, default=300.0,
                   help="seconds to wait for the job (default 300)")

    p = add("clear", cmd_queue_clear, "drop every queued job", parent=qsub)
    p.add_argument("--include-running", action="store_true", help="also stop the running one")

    add("selectors", cmd_selectors, "print the builtin and override locator strategies")
    add("serve", cmd_serve, "run the server and print events until Ctrl-C (does the extension connect?)")
    p = add("watch", cmd_watch, "reload the unpacked extension in the browser whenever a file under gemini_extension/ changes")
    p.add_argument("--dir", help="the extension folder (default: pipeline/gemini_extension)")
    p.add_argument("--interval", type=float, default=1.0, help="seconds between checks (default 1)")
    add("tabs", cmd_tabs, "list the Gemini tabs")

    p = add("open", cmd_open, "open (or focus) the Gemini tab")
    p.add_argument("--url", help="default https://gemini.google.com/app")
    p.add_argument("--new-tab", action="store_true", help="always open a new tab")

    def add_action_options(p: argparse.ArgumentParser) -> None:
        p.add_argument("--gem", help="open this gem (id or URL) instead of prepending the skill file")
        p.add_argument("--model", help="switch to this model first")
        p.add_argument("--timeout", dest="op_timeout", type=float, default=None,
                       help="seconds to wait for the answer (default 240)")

    p = add("keywords", cmd_keywords, "generate YouTube search keywords, one per line",
            connect_timeout=False)
    p.add_argument("topic")
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--exclude", action="append", default=[], help="a topic to leave out (repeatable)")
    p.add_argument("--style", action="append", default=[], help="an angle to cover (repeatable)")
    p.add_argument("--language")
    p.add_argument("--notes", help="free-form guidance appended to the prompt")
    p.add_argument("--avoid-file", help="a file with one existing keyword per line to avoid")
    add_action_options(p)

    add("daemon", cmd_daemon, "JSON lines on stdin/stdout for the app (see DAEMON.md)")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    """Runs one command; returns the process exit code."""
    _configure_console()
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None) or args.command is None:
        parser.print_help()
        return 2
    if args.command == "queue" and not getattr(args, "queue_command", None):
        parser.parse_args(["queue", "--help"])
        return 2
    if not hasattr(args, "op_timeout"):
        args.op_timeout = None

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        stream=sys.stderr, format="%(name)s: %(message)s")

    try:
        return int(args.func(args) or 0)
    except GeminiError as error:
        print(f"{error.code}: {error.message}", file=sys.stderr)
        if args.json and error.details:
            print(_dump(error.details), file=sys.stderr)
        return 1
    except OSError as error:
        print(f"could not start the bridge server on port {args.port}: {error}\n"
              f"Is another bridge (or `serve`) already running on that port?", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
