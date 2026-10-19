# Gemini Bridge — the app ↔ daemon contract

How the Flutter app drives Gemini. The app never talks to the extension; it
starts one long-lived Python process and talks JSON lines to it:

```
Flutter app  ── stdin: one request per line ──►  python -m gemini_bridge daemon  ──WebSocket──►  extension ──► Gemini tab
             ◄── stdout: responses + events ──                 (gemini_bridge/)
```

Why a daemon and not one process per call: the extension connects to the
Python side, so the Python side has to stay up for the connection to exist.
Why stdin/stdout and not HTTP: the app already launches Python and streams its
stdout (`ScraperProcess`, `GmailBridge`), so this needs no ports, no auth, and
dies with the app.

The wire shapes are the same as the extension protocol in `PROTOCOL.md` §1,
proxied, plus a few Python-level methods (`bridge.*`) and higher-level
**actions** (`action.*`) whose prompts live in Python (`gemini_bridge/actions.py`)
so the app never composes a prompt.

---

## 1. Process

```
python -m gemini_bridge daemon [--port 8765] [--data-dir <path to data/>]
```

- Working directory: `pipeline/` (so `data/gemini skills/` and the `comms`
  package resolve). `--data-dir` overrides where the skill files
  are read from (default `../data` relative to `pipeline/`).
- **stdout** carries only protocol lines (UTF-8, `\n`-terminated JSON objects).
  **stderr** carries logs. The first stdout line is always
  `{"type":"event","event":"daemon","data":{"state":"listening","port":8765,"pid":1234,"version":"0.1.0"}}`.
  If the port is taken, the first line is
  `{"type":"event","event":"daemon","data":{"state":"failed","reason":"port_in_use","port":8765}}` and the process exits 2.
- **stdin**: `{"id":"<any unique string>","method":"…","params":{…}}` per line.
  A blank line is ignored. A line that is not valid JSON gets
  `{"type":"response","id":null,"ok":false,"error":{"code":"BAD_PARAMS","message":"…","details":{}}}`.
- Requests run concurrently on a small thread pool (4), so a 3-minute `bridge.ask`
  does not block a `bridge.status`. Responses can therefore arrive **out of
  order** — always correlate by `id`.
- EOF on stdin, or `bridge.shutdown`, stops the server and exits 0.
- Events from the extension (`hello`, `job`, `status`, `log`) are forwarded
  verbatim as `{"type":"event","event":…,"data":…}`. The daemon adds its own
  `daemon` events: `{"state":"extension_connected","hello":{…}}` and
  `{"state":"extension_disconnected"}`.

## 2. Responses and errors

```json
{"type":"response","id":"…","ok":true,"result":{…}}
{"type":"response","id":"…","ok":false,"error":{"code":"…","message":"…","details":{…}}}
```

Error codes are the extension's (`PROTOCOL.md` §2) plus:

| code | meaning | details |
|---|---|---|
| `EXTENSION_NOT_CONNECTED` | no extension is connected to the daemon | `{port}` |
| `ACCOUNT_NOT_FOUND` | `bridge.ensure_account` walked `/u/0..9` without a match | `{wanted, tried: [{index, account}]}` |
| `NO_SUGGESTION` | `bridge.heal` had nothing to apply | `{element}` |
| `ACTION_PARSE_FAILED` | Gemini answered but the reply could not be parsed into the action's result | `{raw}` |
| `ACTION_REFUSED` | Gemini answered with its generic refusal ("I'm having a hard time fulfilling your request") twice in a row — usually a long skill prompt on a small model; use a gem or `model: "Pro"` | `{raw, model}` |
| `SKILL_FILE_MISSING` | an action needed a skill file from `data/gemini skills/` that isn't there | `{path}` |
| `BROWSER_NOT_FOUND` | the configured browser is not installed, or its path is not a browser | `{browser, tried}` |
| `ADDON_UNSIGNED` | release Firefox refuses an unsigned permanent add-on and no temporary install was possible | `{browser, channel, hint}` |
| `ADDON_INSTALL_FAILED` | installing or updating the add-on failed | `{method, reason}` |
| `BROWSER_LAUNCH_FAILED` | the browser process did not start, or exited | `{browser, exitCode?, reason}` |
| `GEM_UI_NOT_FOUND` | an element of the gem editor could not be found (an `ELEMENT_NOT_FOUND` for the gem pages) | the standard element diagnostics (`element`, `tried`, `lastKnown`, `suggestions`) |
| `GEM_SAVE_FAILED` | the gem editor did not accept the save | `{reason, fieldErrors?}` — `reason` ∈ `field errors` (the editor showed errors), `save disabled` (Save never enabled after the edit: the form did not register it), `no confirmation` (Save was clicked but the save state never read "saved" within the deadline) |
| `NOT_IMPLEMENTED` | the method is registered but nobody has written its body yet; the message is always "not implemented yet" | `{method}` |

Python: every one of these is a class in `errors.py` (`BrowserNotFound`, `AddonUnsigned`, `AddonInstallFailed`,
`BrowserLaunchFailed`, `GemUiNotFound` — an `ElementNotFound` —, `GemSaveFailed`, `NotImplementedYet`), so the owners raise them and never
edit that file. A body that raises `NotImplementedError` is answered as `NOT_IMPLEMENTED` by `Daemon.handle`. Dart: `GeminiFailure.browserNotFound`,
`addonUnsigned`, `addonInstallFailed`, `browserLaunchFailed`, `gemUiNotFound`, `gemSaveFailed`, `notImplemented`.

## 3. Methods

### Proxied (any extension method)

`status`, `diagnostics`, `get_account`, `get_model`, `list_models`, `set_model`,
`new_chat`, `send`, `stop`, `is_generating`, `get_last_response`,
`get_conversation`, `queue_add`, `queue_list`, `queue_get`, `queue_cancel`,
`queue_clear`, `queue_pause`, `queue_resume`, `get_selectors`, `set_selectors`,
`tabs`, `open`, `focus`, `navigate`, `switch_account`, `reload_page` — same
params and results as `PROTOCOL.md` §3. They fail with
`EXTENSION_NOT_CONNECTED` when nothing is connected.

### `bridge.*` (Python-level)

| method | params | result |
|---|---|---|
| `bridge.status` | `{}` | `{listening, port, extensionConnected, hello: {…}\|null, status: <status object>\|null}` — **never throws**; `status` is the extension's status object when connected and reachable, else `null` with `statusError: {code, message}` |
| `bridge.ensure_account` | `{match}` | `{name, email, index}` |
| `bridge.heal` | `{element, pick?: 0}` | `{element, strategy, suggestions}` |
| `bridge.open_gem` | `{gem}` (a gem id or a full `https://gemini.google.com/gem/…` URL; `/u/N/` is inserted to match the current account) | `{url, tabId}` |
| `bridge.ask` | `{prompt, newChat?: true, model?, gem?, timeoutS?: 240, interrupt?: false}` | `{text, html, model, durationMs}` |
| `bridge.wait` | `{jobId, timeoutS?: 300}` | job object |
| `bridge.browser_info` | `{}` | which browsers are here, the add-on's state, the profile — see "bridge.browser_info / ensure_window / install_addon" below |
| `bridge.ensure_window` | `{browser?, focus?, timeoutS?, url?}` | an extension connection and a Gemini tab, or why not — see below |
| `bridge.install_addon` | `{browser?, mode?, force?}` | `{state, version, method, restartNeeded, message}` — see below |
| `bridge.shutdown` | `{}` | `{ok: true}` then exit |

### `action.*` (prompts live in Python)

Common optional params on every Gemini-calling action: `model` (set before
sending), `gem` (open this gem first; when absent the action **prepends the
matching skill file** from `data/gemini skills/` to the prompt so a plain chat
behaves like the gem), `newChat` (default `true`), `timeoutS` (default `240`).
Every result carries `raw` (Gemini's full reply text) and `model`.

| method | params | result |
|---|---|---|
| `action.generate_keywords` | `{topic, count?:100, exclusions?:[…], styles?:[…], language?, avoid?:[…], notes?}` — one keyword per line, no numbering; `avoid` is deduped client-side too (case-insensitive, trimmed); only the last 300 of `avoid` go into the prompt with "and anything close to these" | `{keywords:[…], dropped:n, raw, model}` |
| `action.classify_channel` | `{channel:{handle, title?, description?, country?, subscriberCount?, recentVideoTitles?:[…]}, niche, criteria?:[…]}` | `{niche, audience, language, brandFit:1-5, reasons:[…], redFlags:[…], raw, model}` |

Drafting moved to the Comms queue (`action.comms_propose`, which asks Gemini and runs the `gratovo-comms` and
`gratovo-moments` skills, and `action.comms_check`, which makes no Gemini call and re-checks text a person edited;
Dart: `commsPropose` / `commsCheck` in `lib/core/native/comms_protocol.dart`; nothing is ever sent automatically); the
old drafting actions were removed on 2026-10-18 (decision old-files).

Added since: `action.gem_create`, `action.gem_update`, `action.gem_read`, the `skills_list` / `skill_*` actions, and the
`chats` / `perChat` / `angles` params of `action.generate_keywords` — see the sections below the JSON-extraction note.

JSON extraction for actions is tolerant: a ```json fence, or the first balanced
`{…}` object in the reply; anything else → `ACTION_PARSE_FAILED` with `raw`.

> **Gemini contract additions (2026-09-29): status and deviations.** The sections below, down to "progress
> events", were written from `CONTRACT_GEMINI.md` by the contract agent and are the copy of record for those
> shapes from now on. Each names the agent that owns and refines it. Everything is ADDITIVE: no method above
> changed shape. Until an owner writes a body the daemon answers its method with `NOT_IMPLEMENTED` ("not
> implemented yet") — the registration, the params and the Dart typed calls are already in place, so the app
> side can be built and tested against `FakeGeminiBridge` meanwhile. Where this text departs from, or fills a gap
> in, the contract:
>
> - `action.generate_keywords`: the contract's heading mentions `parallel`, its body does not — only `chats`,
>   `perChat` and `angles` exist. `timeoutS` applies to EACH chat, so the app's own deadline for a batch is
>   `timeoutS × chats + 60 s`.
> - Dart: `installAddon` returns the add-on status object (`GeminiAddonStatus`; `bridge.install_addon`'s `version`
>   is read as the installed version, as is `version` in `ensure_window`'s short `addon` block), `ensureWindow`
>   also takes an optional `url`, and `GeminiAccountInfo` is the existing `GeminiAccount` under a second name.
> - **Gap in the contract:** how the daemon learns `browserPath` and `profileMode` from Settings is not
>   specified, and the typed calls send only `browser`. `bridge-runtime` decides; suggested: spawn arguments
>   (`--browser`, `--browser-path`, `--profile-mode`, `--profile-dir`) next to `--port` / `--data-dir`, with the
>   per-call `browser` param as an override.
> - Added for the owners' convenience: `gemini_bridge/progress.py` (`emit_progress`, frozen), every new error class
>   in `errors.py` (owners never edit it), `actions.run_action(..., emit=None)` handing `emit` only to actions that
>   have an `emit` parameter, `actions.generate_keywords` routing `chats > 1` to `keywords_batch.generate`, and
>   `GeminiGems.instant` in `content/gems.js` (PROTOCOL.md, "gem_* methods").

### bridge.browser_info / ensure_window / install_addon  (owner: bridge-runtime)

The browser and the extension inside it. None of these needs an extension connection to start —
`bridge.ensure_window` is what makes one exist — so the Dart typed calls never run `prepareForAction` first.
Python: `gemini_bridge/browser_manager.py` — `browser_info(params, *, data_dir=None)`,
`ensure_window(gemini, params, *, emit=None)`, `install_addon(params, *, data_dir=None, emit=None)`. The Firefox
add-on id is `gemini-bridge@gratovo.app` (`browser_manager.GEMINI_ADDON_ID`; Dart `geminiAddonId`). The add-on is
built from `pipeline/gemini_extension/` by `tools/build_addon.py` (`build_firefox`, `build_xpi`; stdlib only, so it
also runs inside the app's bundled interpreter). The managed profile lives in the per-user app-data folder
(`%LOCALAPPDATA%\gratovo\gemini-profile` on Windows), never inside the install.

**`bridge.browser_info`** — params `{}`; never throws: trouble is said in `addon.message` and per-browser fields.

```json
{
  "selected": "firefox",
  "browsers": [
    {"id": "firefox", "name": "Mozilla Firefox", "path": "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
     "version": "156.0.1", "channel": "release", "installed": true, "running": false, "canRunUnsigned": false}
  ],
  "addon": {
    "id": "gemini-bridge@gratovo.app", "shippedVersion": "0.2.0", "installedVersion": null,
    "state": "missing", "signed": false, "restartNeeded": false, "method": "none",
    "message": "Human sentence saying what is wrong and what will happen / what to do."
  },
  "profile": {"mode": "managed", "dir": "C:\\Users\\x\\AppData\\Local\\gratovo\\gemini-profile", "exists": false},
  "extensionDir": "C:\\...\\pipeline\\gemini_extension",
  "xpiPath": null
}
```

- `addon.state` ∈ `missing | temporary | installed | outdated | unsigned_blocked | unknown`;
  `addon.method` ∈ `none | rdp_temporary | profile_xpi | policy | unpacked`. (Dart: `GeminiAddonState`,
  `GeminiAddonMethod`, each with an `unknown` fallback for a value it has not heard of.)
- `browsers[].channel` ∈ `release | beta | esr | dev | nightly | unknown` (Firefox) or `stable | unknown` (the
  others); `canRunUnsigned` is true only on esr / dev / nightly / unbranded builds.
- `profile.mode` ∈ `managed` (a dedicated profile the app owns) | `existing` (the browser's default profile, only
  while that browser is not already running).

**`bridge.ensure_window`** — params `{browser?: string, focus?: false, timeoutS?: 45, url?: "https://gemini.google.com/app"}`.
Idempotent. Guarantees "the extension is connected and a Gemini tab exists", launching the browser and
installing / updating the add-on as needed. `focus: true` brings the window to the front (to sign in); a background
launch must not steal focus.

```json
{
  "connected": true, "launched": false, "reused": true, "browser": "firefox",
  "addon": {"state": "temporary", "version": "0.2.0", "method": "rdp_temporary"},
  "tab": {"tabId": 12, "url": "https://gemini.google.com/app"},
  "account": {"name": "Moustafa", "email": "x@gmail.com", "index": 1},
  "steps": [{"name": "daemon_listening", "ok": true, "ms": 3, "detail": ""}, {"name": "launch_browser", "ok": true, "ms": 1240}],
  "message": ""
}
```

- **Never throws for "could not get there"**: it returns `connected: false`, `steps` (each with `ok`, `ms`,
  `detail`) showing which step failed, and a `message` that says what is missing and what to do.
- `account` is `null` when unknown — including a first run where nobody has signed in to Google yet, in which case
  `connected` is true and `message` says to sign in in the window that just opened.
- While it works the daemon emits `daemon` events (see "progress events"): `browser_launching`, `browser_ready`,
  `addon_installing`.

**`bridge.install_addon`** — params `{browser?: string, mode?: "auto" | "temporary" | "permanent", force?: false}`.
Result `{state, version, method, restartNeeded, message}` (`state` / `method` as above; `version` is the version now
installed). `auto` picks the best available method (signed permanent > temporary). Failures that are the browser's
doing raise `ADDON_UNSIGNED`, `ADDON_INSTALL_FAILED`, `BROWSER_NOT_FOUND` or `BROWSER_LAUNCH_FAILED` (§2).

**Only the selected browser's extension is admitted.** `bridge.browser_info`, `bridge.ensure_window` and
`bridge.install_addon` with a `browser` param make that the daemon's browser (`BridgeServer.set_browser`); from then
on a connecting extension must say `hello` with that `browser` within 10 s or it is closed with WebSocket close
code **4003** (and one already connected from another browser is closed the same way). The extension waits 60 s
before retrying after a 4003 instead of its usual fast backoff. `system`, empty or no browser admits any. Without
this, an Edge with the unpacked extension still loaded took the port from the app's Firefox.

App-side deadlines (Dart): `browserInfo()` 30 s; `ensureWindow({browser, focus, timeout, url})` its `timeoutS` + 30 s so the
daemon's answer (which names the step that stalled) arrives first; `installAddon({browser, mode, force})` 120 s.

### action.gem_*  (owner: gemini-actions)

Create, change and read a Gemini gem through its editor page. Python: `gemini_bridge/gems.py`
(`gem_create/gem_update/gem_read(gemini, params, emit=None)`); the page work is the extension's `gem_read`,
`gem_create`, `gem_update` (PROTOCOL.md, "gem_* methods"). Like every Gemini-calling action, the Dart typed calls
prepare the account first.

| method | params | result |
|---|---|---|
| `action.gem_create` | `{name, description, instructions, model?, timeoutS?: 180}` | `{"url": "https://gemini.google.com/gem/<id>", "gemId": "<id>", "name": "…"}` |
| `action.gem_update` | `{gem, name?, description?, instructions?, timeoutS?}` — `gem` is a URL or an id; only the fields given change | `{"url": "…", "gemId": "…", "name": "…", "changed": ["name", "instructions"]}` |
| `action.gem_read` | `{gem, timeoutS?}` | `{"url": "…", "gemId": "…", "name": "…", "description": "…", "instructions": "…"}` — description and instructions verbatim |

Element failures carry the standard element diagnostics (`tried`, `lastKnown`, `suggestions`) so the existing heal
machinery applies: `GEM_UI_NOT_FOUND` for a missing element of the editor, `GEM_SAVE_FAILED` (`{reason, fieldErrors?}`)
when the editor refuses the save (reasons in §2). The editor is confirmed by its save state
(`div.save-state[role=status]`: "not saved" → "saving…" → "saved"), never by Save going disabled — it is disabled
while the save is in flight. Calibrated live on an edit page (Arabic UI, 2026-09-30); `gem_create` is not yet
calibrated live. App-side deadline: `timeoutS` + 60 s (defaults: create / update 180 s, read 90 s).
Dart: `createGem`, `updateGem`, `readGem` → `GemResult` / `GemDetails`.

### action.skill_* (Gemini 4 Argon skills; owner: comms workflow, 2026-10-14)

Python: `gemini_bridge/skills.py`; the page work is PROTOCOL.md "Gemini 4 Argon". A skill is a folder with SKILL.md
(front matter: kebab-case `name`, `description`) plus reference files and scripts; it is zipped under its name and
dropped on the Skills page. Remember: a skill with scripts only works in a task; using a skill turns it on.

| method | params | result |
|---|---|---|
| `action.skills_list` | `{}` | `{skills: [{name, description, active, state}]}` |
| `action.skill_read` | `{name, contents?}` | as `skill_read` |
| `action.skill_deploy` | `{folder, active?: false, verify?: true}` | `{name, description, files, sha256, bytes, zipBytes, hasScripts, mode: "create"\|"replace", active, verified, onPage}` — progress events `skill_upload` 0..3; `SKILL_INVALID` (`{problems}`) before anything is uploaded; `SKILL_VERIFY_FAILED` (`{missing, extra}`) when the page's files differ |
| `action.skill_set_active` | `{name, active}` | `{name, active, changed}` |
| `action.skill_delete` | `{name, confirm: true}` | `{name, deleted}` — without `confirm: true` it is `BAD_PARAMS` and nothing is touched |

`send` (proxied) also takes `mode` ("chat"\|"task") and `skills` ([name]); a task needs `timeoutMs` in minutes.
CLI: `skills`, `skill-read NAME [--contents]`, `skill-deploy FOLDER [--active] [--probe "q => expected"]`,
`skill-active NAME on|off`, `skill-delete NAME --yes`, `thinking [LEVEL]`, `ask --mode task --skill NAME`.

### action.generate_keywords batches (owner: gemini-actions)

`action.generate_keywords` keeps every param it had and adds `chats?: 1` (1–8), `perChat?: int` and
`angles?: [string]`. With `chats > 1` the daemon runs several SEPARATE new chats: it splits the request into
slices with distinct angles / sub-topics, feeds each later chat the running list as `avoid`, merges the answers,
dedupes case-insensitively and drops anything in `avoid`. A request with no `chats`, or `chats: 1`, is exactly the
single-chat action it always was. (`actions.generate_keywords` routes `chats > 1` to
`keywords_batch.generate(gemini, params, emit=None)`.)

- `timeoutS` is the allowance for EACH chat; `perChat` is how many keywords each chat is asked for (proposal: when
  absent, `ceil(count / chats)`); `angles` may be shorter than `chats` — the owner invents the rest.
- The daemon's result adds `chats` and `partial`:

```json
{"keywords": ["…"], "dropped": 3,
 "chats": [{"index": 0, "requested": 25, "received": 24, "ok": true, "error": null, "durationMs": 41000}],
 "partial": false, "raw": "…", "model": "…"}
```

- `partial: true` means some chats failed but at least one produced keywords: what came back is RETURNED, not raised.
  Every chat failing raises the last error. `error` on a chat is text (or `{code, message}`; the app reads both).
- Progress goes out as `progress` events (see "progress events"): `action: "generate_keywords"`, `done` / `total` in
  chats, `keywords` = how many so far, `message` like "chat 2 of 4 done".
- Dart: `generateKeywords(..., chats, perChat, angles)` → `KeywordsResult` with `chats: [KeywordChatResult]`,
  `partial`, `failedChats`; the app-side deadline is `timeoutS × chats + 60 s`. An old daemon's payload (no `chats`,
  no `partial`) still decodes.

### progress events (owner: contract, frozen)

Any long action may report how far it has got. The daemon writes, on stdout, between the request and its response:

```json
{"type": "event", "event": "progress", "data": {"action": "generate_keywords", "done": 2, "total": 4, "keywords": 137, "message": "chat 2 of 4 done"}}
```

- `action` is the action's name without the `action.` prefix; `done` / `total` count its steps (`total` 0 while unknown);
  `message` is a sentence for the person; an action may add fields of its own (`keywords`). Dart:
  `GeminiEvent.isProgress` / `GeminiEvent.progress` → `GeminiProgress` (`fraction` is 0–1, or null while `total` is
  unknown), on the same `events` stream as every other event.
- Python: an action takes an optional `emit(event, data)` callable — `actions.run_action(gemini, name, params,
  emit=None)` hands it to the actions that have an `emit` parameter, and the daemon passes one that writes an `event`
  line (`Daemon.emit`). `gemini_bridge/progress.py` `emit_progress(emit, action, done, total, message="", **extra)`
  builds the payload the same way everywhere and never raises: progress is advisory.
- The daemon's own `daemon` events gain three states while it gets a browser ready — `browser_launching`,
  `browser_ready`, `addon_installing` — each with `{"state": "…", "browser": "firefox", "message": "Starting Firefox…"}`,
  shown by the app as status text (Dart: `GeminiEvent.daemonBrowser`, `daemonMessage`). They join `listening`,
  `failed`, `extension_connected`, `extension_disconnected` and `stopped`.

## 4. What the app implements (Dart)

- `lib/core/native/gemini_protocol.dart` — pure Dart, no `dart:io`: request/
  response/event codecs, `GeminiFailure` (every code above + `unavailable`
  for "the interpreter never produced protocol lines"), and typed results
  (`GeminiBridgeStatus`, `GeminiDiagnostics` with per-element
  `found/strategy/tried/lastKnown/suggestions`, `KeywordsResult`,
  `ClassifyResult`, `GeminiJob`); the Comms queue's wire types are in
  `comms_protocol.dart`.
- `lib/core/native/gemini_bridge.dart` (+ `_io.dart` / `_stub.dart`) —
  starts the daemon with the same interpreter/`pipeline/` discovery as
  `ScraperProcess`, correlates responses by id, exposes `events`, a `state`
  (`stopped | starting | listening | connected | failed`), restarts on crash
  with backoff, and `stop()` on app exit.
- Riverpod: `geminiBridgeProvider`, `geminiBridgeStateProvider`.
- The browser / gem calls above are typed methods on the `GeminiBridge` base class (so `gemini_bridge_io.dart`
  needs no change for them): `browserInfo`, `ensureWindow`, `installAddon`, `createGem`, `updateGem`, `readGem`,
  plus new optional params on `generateKeywords` (`chats`, `perChat`, `angles`). Their result classes and codecs are
  in `gemini_protocol.dart`; `test/support/fake_gemini_bridge.dart` scripts every one of them (`answerBrowserInfo`,
  `answerEnsureWindow`, `answerInstallAddon`, `answerGemCreate` / `Update` / `Read`, `emitProgress`,
  `scriptProgress`).
- `lib/core/native/gemini_autostart.dart` — `geminiAutoStartProvider`, watched once by the app shell: brings the
  bridge up in the background at launch (`bridge-runtime` fills it in; a no-op until then).
