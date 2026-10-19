# Gemini Bridge (Python half)

Drives the Gemini web UI from Python through a browser extension. Python runs
a small WebSocket server on `127.0.0.1`; the extension in
`../gemini_extension/` connects to it and does the clicking and typing in a
`gemini.google.com` tab. This package is the server, a synchronous `Gemini`
facade, a CLI, the JSON-lines daemon the Flutter app runs, and the
`action.*` prompts (keywords, classification, the Comms queue's
`comms_propose` / `comms_check`).

```
gemini_bridge/
  PROTOCOL.md    the wire contract with the extension (read this first)
  DAEMON.md      the stdin/stdout contract with the Flutter app
  server.py      BridgeServer: the WebSocket server on its own thread
  client.py      Gemini: the sync facade (status, ask, queue, ensure_account, heal, ...)
  actions.py     action.*: prompts that live here so the app never composes one
  daemon.py      python -m gemini_bridge daemon  (JSON lines for the app)
  cli.py         python -m gemini_bridge <command>
  errors.py      GeminiError and one subclass per wire error code
```

## Install

```
cd pipeline
pip install -r requirements.txt        # the bridge only needs `websockets`
```

Then load the extension: see `../gemini_extension/README.md` (unpacked
extension, `chrome://extensions` → Developer mode → Load unpacked). Its popup
shows the port it dials; the default is `8765` on both sides.

Check the two halves see each other before writing any code:

```
python -m gemini_bridge serve          # prints "extension ... says hello" when it connects
python -m gemini_bridge status         # the tab's state, the elements found, the queue
```

## Quickstart

```python
from gemini_bridge import Gemini, GeminiError

with Gemini() as g:                              # starts the server, waits for the extension
    g.ensure_account("moustafa")                 # switch to the account whose name/email contains this
    text = g.ask("Five keywords about solar panels", new_chat=True, model="Flash")
    print(text)

    job = g.queue("Classify this channel: ...", new_chat=True, meta={"channel_id": 12})
    print(g.wait(job, timeout=300))              # runs in the browser even if Python goes away

    keywords = g.generate_keywords("AI coding tools", count=50)["keywords"]
```

Every failure is a `GeminiError` with `.code`, `.message` and `.details`
(the wire error, PROTOCOL.md §2), and a subclass per code so you can catch
what you mean: `ElementNotFound`, `SignedOut`, `GeminiPageError`, `Busy`,
`BridgeTimeout`, `NoTab`, `TabNotReady`, `ModelNotFound`, `SendNotAccepted`,
`TypeFailed`, `BadParams`, `InternalError`; plus the Python-side
`ExtensionNotConnected`, `JobFailed` (`.job`), `AccountNotFound` (`.tried`)
and the action errors `ActionParseFailed`, `SkillFileMissing`.

## API reference

`Gemini(port=8765, connect_timeout=60, call_timeout=30, auto_open=True, logger=None, data_dir=None)`
— a context manager. `auto_open` opens (or reuses) a Gemini tab as soon as the
extension connects, so the first call does not pay for page loading.
`data_dir` is where `gemini skills/` lives (default: the repo's `data/`).

| method | returns |
|---|---|
| `status()` | the status object (url, account, model, generating, elements, queue, ready) |
| `diagnostics()` | the diagnostics object (§4): every element, what was tried, candidates, suggestions |
| `account()` | `{"name", "email", "index"}` |
| `ensure_account(match)` | the matching account, switching `/u/N/` as needed; raises `AccountNotFound` |
| `switch_account(index)` | `{"requested", "landedIndex", "url", "redirected", "account"}` |
| `model()` / `models()` / `set_model(name)` | current label / the menu / the label after switching |
| `new_chat()` | `{"url"}` |
| `ask(prompt, new_chat=False, model=None, timeout=180, interrupt=False)` | the answer text |
| `send(text=None, wait=True, new_chat=False, model=None, interrupt=False, timeout=180)` | `{"index", "text", "html", "durationMs", "model"}` or `{"sent": True}` |
| `stop()` / `is_generating()` | `bool` |
| `last_response()` / `conversation()` | `{"index", "text", "html", "complete"}` / `[{"role", "text"}]` |
| `text()` / `set_text(s)` / `clear_text()` | the prompt box |
| `queue(prompt, new_chat=False, model=None, timeout=None, meta=None)` | a `Job` |
| `wait(job, timeout=300, poll=2)` / `wait_job(...)` | the result text / the finished `Job`; raises `JobFailed`, `BridgeTimeout` |
| `jobs()` / `job(id)` / `cancel(job)` / `clear_queue()` / `pause()` / `resume()` | queue control |
| `selectors()` / `set_selectors(overrides)` | `{"builtin", "overrides"}` |
| `heal(element, pick=0)` | applies a suggestion from `diagnostics()`; returns the strategy |
| `on(event, callback)` / `off(event, callback)` | `hello`, `status`, `job`, `log` (+ local `connected`, `disconnected`); callbacks run on a background thread |
| `call(method, params=None, timeout=None)` | any method by name, raw result |
| `tabs()` / `open(url=None, focus=False, new_tab=False)` / `focus()` / `navigate(url)` / `reload()` / `url()` | tab control |
| `open_gem(gem)` | opens a gem (id or URL) under the current account's `/u/N/`; `{"url", "tabId"}` |
| `generate_keywords(topic, count=100, exclusions=None, styles=None, language=None, avoid=None, notes=None, **opts)` | `{keywords, dropped, raw, model}` |
| `classify_channel(channel, niche, criteria=None, **opts)` | `{niche, audience, language, brandFit, reasons, redFlags, raw, model}` |

`**opts` on an action: `model`, `gem`, `newChat` (default `True`), `timeoutS`
(default 240). With `gem` the action opens that gem and sends only its
message; without one it prepends the matching skill file from
`data/gemini skills/` (`keyword generator skill.md`, `channel classifier skill.md`)
so a plain chat behaves like the gem. See DAEMON.md §3 for the exact params and
results.

Drafting moved to the Comms queue (`action.comms_propose`, `action.comms_check`;
they have no `Gemini` client method, the daemon calls them directly); the old
drafting actions were removed on 2026-10-18 (decision old-files).

`Job` wraps the job dict: `.id`, `.status`, `.result`, `.error`, `.text`,
`.meta`, `.finished`, `.raw`.

## The CLI

```
python -m gemini_bridge status | diag [ELEMENT] | heal ELEMENT [--pick N]
python -m gemini_bridge ask "..." [--new-chat] [--model NAME] [--timeout S]
python -m gemini_bridge new-chat | models | model NAME | account [MATCH]
python -m gemini_bridge queue add "..." | queue list | queue wait JOB_ID | queue clear
python -m gemini_bridge selectors | tabs | open | serve
python -m gemini_bridge keywords "topic" --count 50 [--avoid-file existing.txt]
python -m gemini_bridge daemon [--port N] [--data-dir PATH]
```

Global options: `--port`, `--timeout` (seconds to wait for the extension),
`--json` (raw result on stdout, error details on stderr), `--data-dir`.
A `GeminiError` exits 1 with `CODE: message` on stderr.

## When Gemini's UI changes: diag → heal

Every element the bridge needs (`textarea`, `sendButton`, `newChat`,
`modelSwitcher`, ...) is found by an ordered list of strategies
(PROTOCOL.md §4). When Google moves a button, the first symptom is an
`ELEMENT_NOT_FOUND` whose `details` name the element. Then:

```
python -m gemini_bridge diag newChat
```

prints, for the missing element: every strategy tried with its match
counts, the **last known** record (how the element used to be found and
what it looked like), the visible candidates on the page, and numbered
**suggestions** with the exact command to apply each:

```
python -m gemini_bridge heal newChat --pick 0
```

`heal` prepends the picked strategy to that element's overrides (the
extension keeps them in `chrome.storage.local` and tries them before its
builtin list) and reports whether the element is found now. A wrong pick is
undone with `set_selectors({})` (or `g.set_selectors({...})` with the list
you want). Overrides are also how you hand-write a fix from the candidates
when there is no suggestion:

```python
g.set_selectors({"newChat": [{"type": "css", "value": "button.my-fix"}]})
```

## How `ensure_account` decides an account is not signed in

Gemini addresses accounts by URL: `/u/0/`, `/u/1/`, ... in the order the
browser is signed into them. `ensure_account(match)` checks the current
account first, then navigates to `/u/0/app`, `/u/1/app`, ... reading the
account each time. Google answers a `/u/N` that has no account behind it by
**redirecting** to a lower index (or to a URL without `/u/` at all); that
redirect is the signal that every signed-in account has been seen, and the
walk stops there (it also stops on a sign-in page). Indexes above 9 are
never tried. The `AccountNotFound` it raises carries `.tried`, the
`(index, account)` pairs it did see, and its message lists them — so "not
found" also tells you which accounts *are* signed in.

## The daemon (for the app)

`python -m gemini_bridge daemon` speaks JSON lines on stdin/stdout for the
Flutter app: the first stdout line is `{"event": "daemon", "data": {"state":
"listening", "port": ...}}` (or `"failed"` with `"reason": "port_in_use"` and
exit code 2), requests run on a pool of 4 so a long `bridge.ask` does not
block a `bridge.status`, responses correlate by `id`, extension events are
forwarded, and EOF or `bridge.shutdown` exits 0. Logs go to stderr only.
DAEMON.md is the contract.

## Troubleshooting

**The extension never connects** (`ExtensionNotConnected`, or `serve` stays
quiet):

- Open the extension's popup and check the port matches (`8765` unless you
  passed `--port`). The extension reconnects with backoff on its own once the
  port is right.
- Is another bridge already running? Only one process can listen on the port:
  `python -m gemini_bridge status` while the app's daemon is up fails to start
  with "port in use". Stop one, or give the other a different port on both sides.
- The server binds `127.0.0.1` only; a firewall rule that blocks loopback (rare,
  but some corporate agents do) shows up as exactly this.
- The extension's service worker may be asleep after a browser restart: open a
  `gemini.google.com` tab or click the extension icon once.

**`TAB_NOT_READY` / `NO_TAB`**: there is no Gemini tab or its content script
has not answered; `python -m gemini_bridge open` opens one and waits for it.

**`SIGNED_OUT`**: the tab is on a sign-in page or the landing page. Sign in
in the browser, then `ensure_account(...)`.

**`ELEMENT_NOT_FOUND`**: the UI changed — see *diag → heal* above.

**`TIMEOUT` from `ask`**: `details.phase` says which wait gave up and
`details.partial` carries whatever text had arrived. Raise `timeout=` for
long answers; the RPC itself always waits 15 s longer than the extension.

**`BUSY`**: Gemini is still generating; pass `interrupt=True` to stop it first.
