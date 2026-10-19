# Gemini Bridge — protocol and design contract

This document is the contract between the two halves of the bridge:

- `pipeline/gemini_extension/` — a Chrome MV3 extension that lives on
  `https://gemini.google.com/*` and does the DOM work.
- `pipeline/gemini_bridge/` — a Python package that drives it.

```
Python (gemini_bridge)                     Chrome
┌────────────────────┐   WebSocket    ┌────────────────────┐  runtime msgs  ┌──────────────────────┐
│ BridgeServer       │◄──────────────►│ background.js (SW) │◄──────────────►│ content script (tab) │
│ ws://127.0.0.1:8765│  JSON frames   │ queue, tabs, WS    │  JSON messages │ locators + actions   │
└────────────────────┘                └────────────────────┘                └──────────────────────┘
```

**Python is the WebSocket server, the extension is the client.** The service
worker connects to `ws://127.0.0.1:<port>` (default port `8765`) and reconnects
with backoff (1s → 2s → 4s → … capped at 15s) whenever the connection drops.
Nothing needs registering in the browser beyond loading the unpacked
extension. The most recent extension connection wins; older ones are closed.

The port is configurable in the popup and stored in `chrome.storage.local`
under `settings.port`.

---

## 1. Wire format

One JSON object per WebSocket text frame. Four frame types.

### Request (Python → extension)

```json
{"type": "request", "id": "a3f1…", "method": "status", "params": {}}
```

`id` is any unique string (Python uses uuid4 hex). `params` is always an
object (possibly empty). Unknown `method` → error `BAD_PARAMS`.

### Response (extension → Python)

```json
{"type": "response", "id": "a3f1…", "ok": true,  "result": { … }}
{"type": "response", "id": "a3f1…", "ok": false, "error": {"code": "ELEMENT_NOT_FOUND", "message": "…", "details": { … }}}
```

Exactly one response per request. `details` is always an object (may be `{}`).

### Event (extension → Python, unsolicited)

```json
{"type": "event", "event": "hello",  "data": {"extensionVersion": "0.1.0", "port": 8765}}
{"type": "event", "event": "job",    "data": { <job object> }}
{"type": "event", "event": "status", "data": { <status object> }}
{"type": "event", "event": "log",    "data": {"level": "info|warn|error", "message": "…", "context": { … }}}
```

- `hello` is sent immediately after the socket opens.
- `job` is sent every time a job changes state (queued → running → done/error/cancelled).
- `status` is sent when `generating`, `model`, `account`, or `url` changes (debounced ≥ 500 ms), and never more than once per second.
- `log` is diagnostic chatter; Python surfaces it through `logging`.

### Keepalive (both directions)

```json
{"type": "ping"}   →   {"type": "pong"}
```

Python pings every 15 s. The extension answers `pong` and *also* sends its own
`ping` if the socket has been idle for 20 s. This traffic is what keeps the
MV3 service worker alive (Chrome ≥ 116 extends the worker's life on WebSocket
activity). The extension additionally has a `chrome.alarms` alarm every
minute that reconnects if the socket is closed.

---

## 2. Error codes

| code | meaning | `details` |
|---|---|---|
| `NO_TAB` | no `gemini.google.com` tab exists and `open` wasn't allowed/possible | `{}` |
| `TAB_NOT_READY` | the tab exists but the content script did not answer (page loading, tab discarded, extension just reloaded). The background tries `chrome.scripting.executeScript` once before giving up. | `{tabId, url, status}` |
| `SIGNED_OUT` | the tab is on a sign-in page, the Gemini landing page, or the app shows a "Sign in" control and no prompt box | `{url, signal}` |
| `ELEMENT_NOT_FOUND` | none of the locator strategies matched | `{element, tried: [{strategy, matched, visible}], candidates: [ <element summary> ]}` |
| `GEMINI_ERROR` | the page is showing an error (toast, inline "Something went wrong", limit reached) | `{signal, text}` |
| `BUSY` | Gemini is still generating and the call did not ask to interrupt | `{}` |
| `TIMEOUT` | the waited-for condition did not happen in time | `{phase, elapsedMs, partial?}` |
| `SEND_NOT_ACCEPTED` | send was clicked but nothing happened (no new response, not generating, text still there) | `{diagnostics}` |
| `TYPE_FAILED` | text typed into the prompt box does not read back as expected | `{expected, actual}` |
| `MODEL_NOT_FOUND` | `set_model` could not match a menu entry | `{wanted, available: [..]}` |
| `BAD_PARAMS` | unknown method or invalid params | `{}` |
| `INTERNAL` | unexpected exception | `{stack}` |
| `GEM_UI_NOT_FOUND` | an element of the gem editor could not be found — `ELEMENT_NOT_FOUND` for the gem pages (see "gem_* methods") | as `ELEMENT_NOT_FOUND` |
| `GEM_SAVE_FAILED` | the gem editor did not accept the save | `{reason, fieldErrors?}` |

Every error's `details` may additionally carry `diagnostics` (the full
diagnostics object from §4) when it helps.

---

## 3. Methods

All methods act on "the Gemini tab": `params.tabId` if given, else the tab
last used/opened by the bridge, else the most recently active
`https://gemini.google.com/*` tab, else (for every method except `tabs`)
the extension opens `https://gemini.google.com/app` in a new tab and waits
for the content script to report ready (≤ 20 s), then proceeds.

Times are milliseconds. Every method that waits accepts `timeoutMs`.

### Connection / tabs

| method | params | result |
|---|---|---|
| `hello` | `{}` | `{extensionVersion, chromeVersion, port, tabs: [tab]}` |
| `tabs` | `{}` | `[tab]` where `tab = {tabId, url, title, active, ready}` |
| `open` | `{url?}` (default `https://gemini.google.com/app`), `focus?: bool`, `newTab?: bool` | `tab` — reuses an existing Gemini tab unless `newTab` is true |
| `navigate` | `{url, timeoutMs?}` | `{tabId, url, redirected: bool, requestedUrl}` — waits for load *and* content-script ready |
| `focus` | `{}` | `tab` — brings the tab and its window to front |

### hello additions (owner: extension)

> Written by the contract agent from `CONTRACT_GEMINI.md` §4; the extension owner refines it. The old fields
> (`extensionVersion`, `port`, and the method's `chromeVersion` / `tabs`) are unchanged.

The `hello` event's `data`, and the `hello` method's result, gain four fields:

| field | value |
|---|---|
| `browser` | `firefox \| edge \| chrome \| other` — the browser the extension is running in |
| `manifestVersion` | `2` or `3` — the manifest version it is running under |
| `capabilities` | array of strings, today `["gems", "keepalive"]`: `gems` = the `gem_*` methods below exist (`content/gems.js` is loaded); `keepalive` = it answers `ping` and sends its own |
| `account` | `{name, email, index}` or `null` — the signed-in Google account the extension last saw |

An older extension sends none of them; the Python side and the app treat an absent field as unknown (Dart:
`GeminiBridgeStatus.extensionBrowser`, `manifestVersion`, `capabilities`, `helloAccount`).

`account` is refreshed from every `get_account` and `status` reply and kept in `storage.local` (`lastAccount`),
so a `hello` right after a browser restart already names the account.

The background context is an MV3 service worker on Chrome/Edge and an **MV2 persistent background page** on
Firefox (measured: MV3 event pages are suspended when idle and, with opt-in host permissions, never opened the
socket; see the extension README, "Firefox: MV2 or MV3"). The WebSocket protocol in §1 is the same either way.
Reconnect backoff is 0.5 / 1 / 2 / 3 / 5 s, then every 5 s, plus a 1-minute alarm as a safety net.

### Inspection

| method | params | result |
|---|---|---|
| `status` | `{}` | see status object below |
| `diagnostics` | `{}` | see §4 |
| `get_account` | `{}` | `{name, email, index}` — `name`/`email` may be `null` if not detectable; `index` is the `/u/N/` number (0 when absent) |
| `get_model` | `{}` | `{name}` — the label on the model switcher |
| `list_models` | `{}` | `[{name, description, selected, marks}]` (opens the menu, reads, closes with Escape). `marks` = `{cls, ariaChecked, ariaSelected, icons: [{name, visible}]}` is what `selected` was decided from (a `selected` class, `aria-checked`, or a *visible* check icon; `active` is only the keyboard highlight) |
| `is_generating` | `{}` | `{generating: bool, signals: {stopButton, spinner, actionsMissing, textChanging}}` |
| `get_text` | `{}` | `{text}` — the prompt box contents |
| `get_last_response` | `{}` | `{index, text, html, complete: bool}` or `{index: -1, text: "", html: "", complete: true}` when the chat is empty |
| `get_conversation` | `{}` | `[{role: "user"\|"model", text}]` in page order |
| `get_url` | `{}` | `{url, accountIndex}` |

**Status object**

```json
{
  "url": "https://gemini.google.com/u/1/app/abc123",
  "accountIndex": 1,
  "account": {"name": "Moustafa Khaled", "email": "x@gmail.com"},
  "model": {"name": "2.5 Pro"},
  "generating": false,
  "signedOut": false,
  "pageError": null,
  "elements": {
    "newChat":   {"found": true, "strategy": "testid"},
    "textarea":  {"found": true, "strategy": "aria"},
    "sendButton":{"found": false, "strategy": null, "note": "prompt box empty; button appears after typing"},
    "stopButton":{"found": false, "strategy": null},
    "modelSwitcher": {"found": true, "strategy": "testid"},
    "account":   {"found": true, "strategy": "aria"}
  },
  "queue": {"length": 2, "paused": false, "running": "job_7"},
  "ready": true
}
```

`status` never throws for missing elements — it reports them. It throws only
`NO_TAB`/`TAB_NOT_READY`.

### Actions

| method | params | result |
|---|---|---|
| `new_chat` | `{timeoutMs?}` | `{url}` — clicks New chat; falls back to navigating to `/u/N/app`; waits until the prompt box is empty and no `model-response` remains |
| `set_text` | `{text}` | `{text, strategy, ms, attempts}` — replaces the prompt box contents; verifies by reading back. `strategy` = `dom` (one `<p>` per line + one input event; tried first from 4000 characters, kept only if the page's send button reacts) or `exec` (`execCommand('insertText')`, what a paste does; slow on Edge for long text). `attempts` = `[{strategy, ok, ms}]`. A page that ignored `dom` once gets `exec` first for the rest of its life |
| `clear_text` | `{}` | `{}` |
| `send` | `{text?, newChat?: bool, model?: string, wait?: bool (default true), interrupt?: bool, timeoutMs? (default 180000)}` | `{index, text, html, durationMs, model, acceptedBy}` when `wait`; `{sent: true, acceptedBy}` otherwise; both also carry `typing: {strategy, ms}` (see `set_text`) when `text` was given. `acceptedBy` is which submit the page took: `enter` (Enter in the prompt box, tried first — the live page ignores a synthetic click), `click`, or `click2` |
| `stop` | `{}` | `{stopped: bool}` |
| `set_model` | `{model, timeoutMs?}` | `{name}` — case-insensitive; exact match on name wins, then substring, then substring on description |
| `switch_account` | `{index, timeoutMs?}` | `{requested, landedIndex, url, redirected, account}` — navigates to `https://gemini.google.com/u/<index>/app` |

`send` semantics (the content script's state machine — implement exactly):

1. Resolve the prompt box → else `ELEMENT_NOT_FOUND`.
2. If `generating`: `interrupt` ? call `stop()` and wait ≤ 5 s for it to settle : throw `BUSY`.
3. If `model` given → `set_model`. If `newChat` → `new_chat`.
4. If `text` given → `set_text` (verified) else use what's in the box.
5. Snapshot `n0 = responses().length`.
6. Resolve the send button; wait ≤ 3 s for it to become visible and enabled after typing → else `ELEMENT_NOT_FOUND` (element `sendButton`).
7. Click it. Wait ≤ 10 s for *any* of: `generating === true`, `responses().length > n0`, prompt box became empty. None → `SEND_NOT_ACCEPTED`.
8. If `wait === false` → return `{sent: true}`.
9. Wait ≤ `timeoutMs` for **all** of: `responses().length > n0`, `generating === false`, and *completion* — where completion is: the last response's action bar (copy / thumbs) is visible **or** its text has not changed for 1500 ms. Poll with a MutationObserver plus a 250 ms interval. On timeout → `TIMEOUT` with `details.partial = current text`.
10. Inspect the last response and the page for error signals (§5). If found → `GEMINI_ERROR` with the text.
11. Return `{index, text, html, durationMs, model: get_model().name}`.

### Queue (lives in the background worker, persisted in `chrome.storage.local` under `queue`)

| method | params | result |
|---|---|---|
| `queue_add` | `{prompt, newChat?, model?, timeoutMs?, meta?: object}` | `job` |
| `queue_list` | `{}` | `{paused, running, jobs: [job]}` |
| `queue_get` | `{jobId}` | `job` (throws `BAD_PARAMS` if unknown) |
| `queue_cancel` | `{jobId}` | `job` — a running job is stopped via `stop()` and marked `cancelled` |
| `queue_clear` | `{includeRunning?: bool}` | `{removed: n}` |
| `queue_pause` | `{}` | `{paused: true}` |
| `queue_resume` | `{}` | `{paused: false}` |

**Job object**

```json
{
  "id": "job_7",
  "prompt": "…",
  "options": {"newChat": true, "model": "Pro", "timeoutMs": 180000},
  "meta": {"anything": "python passed in"},
  "status": "queued | running | done | error | cancelled",
  "result": {"index": 3, "text": "…", "html": "…", "durationMs": 8123, "model": "2.5 Pro"},
  "error": {"code": "…", "message": "…", "details": {}},
  "createdAt": 1758290000000, "startedAt": null, "finishedAt": null,
  "attempts": 1
}
```

Queue rules:
- One job runs at a time, in insertion order, on the bridge's Gemini tab.
- The processor runs whether or not Python is connected; results are stored on the job and `job` events are emitted when connected. Python `wait()` therefore polls `queue_get` as a fallback.
- A job whose `send` fails with `TAB_NOT_READY` or `SEND_NOT_ACCEPTED` is retried once (`attempts: 2`) after 3 s; any other error fails the job.
- Job ids are `job_<n>` with `n` monotonically increasing and persisted.
- Finished jobs are kept (max 200, oldest dropped) so results can be fetched later.

### Self-healing controls

| method | params | result |
|---|---|---|
| `get_selectors` | `{}` | `{builtin: {element: [strategy]}, overrides: {element: [strategy]}}` |
| `set_selectors` | `{overrides: {element: [strategy]}}` | same as `get_selectors` — overrides are **prepended** to the builtin list for that element and persisted (`chrome.storage.local` → `selectorOverrides`). `{overrides: {}}` clears. |
| `reload_page` | `{timeoutMs?}` | `tab` — hard reload and wait for ready |
| `reload_extension` | `{}` | `{reloading: true}` — `chrome.runtime.reload()`: picks up edited extension files; the socket drops and reconnects within a few seconds. **The browser keeps routing messages to a tab's old content script after the reload**, so the Python `reload_extension()` also reloads the Gemini tab; `diagnostics.extensionVersion` is the version running *in the tab* |
| `set_debug` | `{enabled: bool}` | `{enabled}` — forward the background's `debug` log lines as `log` events (request routing, content-script calls, injection, wake-ups) |

### gem_* methods (owner: gemini-actions)

> Written by the contract agent from `CONTRACT_GEMINI.md` §3.4; `gemini-actions` owns and refines it. The result
> shapes below are the ones the Python actions return (they pass them through) and are a starting point.

Gem editor methods, implemented in `content/gems.js` and reached from Python through `gemini_bridge/gems.py`
(`action.gem_create|gem_update|gem_read`, DAEMON.md). Like every DOM method they run in the content script on the
Gemini tab; the background routes them there (they are in `CONTENT_METHODS`) with longer deadlines than an ordinary
call — `gem_read` 60 s, `gem_create` / `gem_update` 120 s, plus 15 s, and a request's own `timeoutMs` wins.

| method | params | result |
|---|---|---|
| `gem_read` | `{url}` | `{url, gemId, name, description, instructions}` |
| `gem_create` | `{name, description, instructions}` | `{url, gemId, name}` |
| `gem_update` | `{url, name?, description?, instructions?}` | `{url, gemId, name, changed: ["name", "instructions"]}` |

- Element failures return the same diagnostics object as every other element (`tried`, `lastKnown`,
  `suggestions`), so `diagnostics` / `heal` apply: `GEM_UI_NOT_FOUND` when an element of the editor is missing,
  `GEM_SAVE_FAILED` (`{reason, fieldErrors?}`) when the editor does not accept the save (§2).
- Until the handlers are written, `content/gems.js` registers an EMPTY group and these methods answer `BAD_PARAMS`
  (unknown method) — exactly what any unknown method did before the contract.
- **How a handler is registered.** `content/gems.js` sets `globalThis.GeminiGems = {handlers: {}, instant: []}`;
  `handlers[name] = async (params) => result`. `content.js` merges `handlers` into its method table when it loads
  (and again at the start of every call, so a group registered late still works) and never replaces one of its own
  methods — the built-in wins and the clash is logged once. `instant` lists methods that must NOT wait for the chat
  prompt box: `content.js` gives every other method up to 10 s for it to render, and a gem editor page has none.
  `manifest.json` loads `content/gems.js` after `content/locators.js` and before `content/content.js`, and
  `background.js`'s `CONTENT_FILES` lists the same order for on-demand injection. `gems.js` loads first, so a handler
  touches `GB` / `GBC` inside the handler, never at load time.

### Gemini 4 Argon: chat/task, skill mentions, thinking level, skills (owner: comms workflow, 2026-10-14)

Calibrated live on the owner's Pro account (Firefox, Arabic UI). Facts the code relies on:
the toggle under the prompt box is `gem-segmented-button-row` with `data-value` 0 (chat) / 40 (task) and the class
`gem-segmented-button-selected`; `@` in the prompt box opens `at-mentions-menu-v2` (skills, then connected apps) and
**only an entry picked from that list is a mention** — typing "@name" is plain text (an inactive skill named that way
was ignored; picked from the list it was used); a task's response carries `spark-thinking-steps` whose header gets the
class `done` (last step: check_circle "تم إنجاز المطلوب") minutes before the footer's `complete`, keeps a progress bar
and has no action buttons; "مستوى التفكير" (thinking level) in the model menu opens on **hover** (a click dismisses the
menu) and renders منخفض / متوسط / مرتفع (low / medium / high) into the same pane; a skill **with scripts** is refused in a
chat and runs in a task (Python 3.11); using a skill by mention turns it on. The thinking level lives in the page:
it survives a new chat but every new tab, reload or navigation starts on the lowest level (a whole batch ran on
"low" unnoticed because of this), and once it is high the model button reads "Argon مرتفع".

| method | params | result |
|---|---|---|
| `send` (additions) | `mode?: "chat"\|"task"`, `skills?: [name]` (or `skill`), `thinking?: "low"\|"medium"\|"high"` (or the page's label) | adds `textRaw` (paragraphs kept), `mode`, `thinking` (the level confirmed, `null` when none was asked), `task: {done, waitingForUser, headline, steps} \| null`, `url`. Mode is set after `newChat`, the thinking level after the mode and read back before anything is typed (`THINKING_NOT_SET`, nothing sent, when it cannot be confirmed); the skills are picked from the `@` list in front of the text. A task that stops for the user returns with `task.waitingForUser` (text) instead of hanging. Callers that care about quality pass `thinking` on **every** send |
| `get_mode` | `{}` | `{mode: "chat"\|"task"\|null, available}` (instant) |
| `set_mode` | `{mode, timeoutMs?}` | `{mode, changed}`; `ELEMENT_NOT_FOUND` (element `modeChat`/`modeTask`, with the healing report) when the page has no toggle — tasks need a Pro/Ultra plan |
| `get_task` | `{}` | `{index, url, task, generating, textRaw}` for the last response (instant) |
| `list_thinking_levels` | `{}` | `{menu, levels: [{name, description, selected}], current}` |
| `set_thinking_level` | `{level, timeoutMs?}` | `{level, changed, verified: true}` — English names work on the Arabic page; the menu is reopened to read the level back, and a menu that did not open or showed other rows is tried again (4 passes); `MODEL_NOT_FOUND` with `available`, `THINKING_NOT_SET` `{wanted, clicked, offered, last}` |
| `list_models` (change) | — | each row also has `submenu` (the thinking row); `set_model` never matches a submenu row |
| `get_last_response` (additions) | — | `textRaw`, `task` |

Skills page (`/u/N/customize/skills`), `content/skills.js` (group `GeminiSkills`, loaded after `gems.js`):

| method | params | result |
|---|---|---|
| `skills_list` | `{}` | `{url, skills: [{name, description, active, state}], templates}` — templates (cards with an "add" button) are not skills |
| `skill_read` | `{name, contents?, maxFileChars?}` | `{name, description, instructions, active, files: [{path, kind: "file"\|"folder", content?}]}` — walks every folder of the file navigator; SKILL.md's body is `instructions` |
| `skill_upload_open` | `{replace?: name}` | `{mode, dropZone, dropSelector}` — Create → Upload, or the card's Replace; `dropSelector` is a one-off `[data-gb-drop=…]` on the zone the resolver picked |
| `drop_files` (background) | `{selector, files: [{name, base64, type?}], waitMs?}` | `{dropped, files, bytes, target}` — dragenter/dragover/drop with a real `DataTransfer`, run in the page's own world (`scripting`, world MAIN: a content script's File is unreadable to the page on Firefox); `DROP_FAILED` |
| `skill_upload_finish` | `{expectName?, save?: true, timeoutMs?}` | `{mode, name, saved, progress, notice}` — follows "uploading N%" → "uploaded, saving metadata" → ("preparing the editor"); create lands in the editor and is saved there, replace has saved when the dialog closes (and turned the skill off) |
| `skill_set_active` | `{name, active}` | `{name, active, changed, notice}` |
| `skill_delete` | `{name}` | `{name, deleted, notice}` — confirms the dialog, waits for the card to go |
| `skills_diagnostics` | `{}` | element reports, cards, open dialog/menu text, buttons |

Errors: `SKILL_UI_NOT_FOUND` (element diagnostics as usual), `SKILL_NOT_FOUND` (`{name, available}`, also from `send`
when the `@` list lacks the skill — nothing is sent), `SKILL_UPLOAD_FAILED` (`{reason: refused|timeout|wrong name,
progress}`; a wrong name is never saved), `SKILL_SAVE_FAILED`, `SKILL_TOGGLE_FAILED`, `SKILL_DELETE_FAILED`,
`MODE_NOT_SET`, `THINKING_NOT_SET`, `DROP_FAILED`. Deadlines: `skill_read` / `skill_upload_finish` 180 s, `skill_set_active` /
`skill_delete` 40 s, `skills_list` / `skill_upload_open` 30 s, `set_mode` 10 s, `list_thinking_levels` 8 s, `set_thinking_level` 20 s (+15 s).

---

## 4. Locators (self-healing element finding)

Every element the bridge needs is described by an **ordered list of
strategies**. The resolver tries them in order and returns the first
**visible** match (`getClientRects().length > 0` and a non-zero bounding box,
and not `disabled` / `aria-disabled="true"` when the caller asks for
`enabled`). It records which strategy matched. Matches are cached and re-
validated (`isConnected` + visible) on every use; a stale cache re-resolves.

A strategy is a JSON object so it can be overridden from Python:

```json
{"type": "css",   "value": "button[data-test-id=\"new-chat-button\"]"}
{"type": "attr",  "attr": "aria-label", "match": "^new chat", "tags": ["button", "a"]}
{"type": "text",  "match": "^new chat$", "tags": ["button", "a", "span"], "climb": "button, a"}
{"type": "icon",  "match": "^(edit_square|add|add_2|chat_add_on)$", "climb": "button, a"}
{"type": "fn",    "name": "largestContentEditable"}
```

- `match` is always a **case-insensitive** regular expression, tested against the trimmed value.
- `tags` limits which elements are scanned (default: all).
- `climb` = after a text/icon/attr match, take `closest(climb)` (so "the button that contains this icon").
- `within` (optional, any strategy) = only search inside `document.querySelector(within)`.
- `icon` matches a `mat-icon`/`.material-symbols-outlined`/`[class*="icon"]` by its ligature text, `data-mat-icon-name`, or `fonticon` attribute.
- `fn` is a named built-in heuristic (listed below).
- Each strategy may carry `"name"` (defaults to `<type>#<index>`) — what shows up in diagnostics.

### The elements and their builtin strategies (starting point)

Keep this order: **most specific and least likely to change first, structural
heuristics last.** Text matches must be case-insensitive and tolerate
surrounding whitespace.

**`textarea`** — the prompt box
1. `css` `rich-textarea .ql-editor[contenteditable="true"]`
2. `css` `div.ql-editor[contenteditable="true"][role="textbox"]`
3. `attr` `aria-label` ~ `enter a prompt|ask gemini|type a message|message gemini` on `[contenteditable], textarea`
4. `attr` `data-placeholder` ~ `ask gemini|enter a prompt` on `[contenteditable]`
5. `css` `[role="textbox"][contenteditable="true"]`
6. `fn` `largestContentEditable` — the largest visible `[contenteditable="true"]` or `textarea` in the lower half of the viewport

**`sendButton`**
1. `css` `button.send-button:not(.stop)`
2. `attr` `aria-label` ~ `^send( message| prompt)?$|submit` on `button`
3. `css` `button[data-test-id="send-button"]`
4. `icon` ~ `^send$|^arrow_upward$` climb `button`
5. `fn` `buttonNearTextarea` — a visible enabled `button` inside the same container as the prompt box, at its right edge, that is not the mic/upload/model button

**`stopButton`**
1. `css` `button.send-button.stop, button.stop-button`
2. `attr` `aria-label` ~ `^stop( response| generating)?$|cancel response` on `button`
3. `css` `button[data-test-id="stop-button"]`
4. `icon` ~ `^stop(_circle)?$` climb `button`

**`newChat`**
1. `css` `[data-test-id="new-chat-button"]`
2. `attr` `aria-label` ~ `^new chat` on `button, a`
3. `css` `side-nav-action-button[data-test-id="new-chat-button"] button, side-nav-action-button button`
4. `text` ~ `^new chat$` climb `button, a`
5. `icon` ~ `^(edit_square|add_2|add|chat_add_on|edit)$` climb `button, a` within `bard-sidenav, mat-sidenav, nav, [role="navigation"]`
6. `css` `a[href="/app"], a[href$="/app"]` (inside the side nav)

**`modelSwitcher`** — the button that shows the current model name (Gemini has moved this between the top bar and the prompt box; try both)
1. `css` `button[data-test-id="bard-mode-menu-button"]`
2. `css` `bard-mode-switcher button, .mode-switcher button, [data-test-id="mode-switcher"] button`
3. `attr` `aria-label` ~ `model|mode|switch.*(model|mode)|select.*(model|mode)` on `button` (must also have `aria-haspopup` or `aria-expanded`)
4. `fn` `menuButtonNearTextarea` — a visible `button[aria-haspopup="menu"], button[aria-haspopup="listbox"], button[aria-expanded]` within the prompt box's container (or the header), whose text matches `flash|pro|thinking|fast|ultra|nano|\d\.\d|gemini`
5. `text` ~ `^(?:gemini\s*)?(\d(?:\.\d)?\s*)?(flash|pro|thinking|fast|ultra|nano)(\s*\(.*\))?$` on `span, div` climb `button`

**`modelMenuItems`** — the entries of the open menu (resolved as a **list**, not a single element)
1. `css` `[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"], [role="listbox"] [role="option"]`
2. `css` `.mat-mdc-menu-panel button.mat-mdc-menu-item, .cdk-overlay-container [role="menuitem"]`
3. `css` `.cdk-overlay-container button` (fallback — any button in the overlay opened by the switcher)

The item's **name** is its `.mode-title, .title, [class*="title"]` text if present else its first line of `innerText`; its **description** is `.mode-desc, [class*="desc"]` else the remaining lines. `selected` is `aria-checked="true"` or `aria-selected="true"` or class contains `selected|active` or it contains a `mat-icon` with `check`.

**`account`** — the signed-in user
1. `attr` `aria-label` ~ `^google account` on `a, button` (the header avatar — label looks like `Google Account: Name  (email)`; parse `name` = between `:` and `(`, `email` = inside the parentheses; be tolerant of newlines/extra spaces)
2. `css` `a[href*="accounts.google.com/SignOutOptions"]`
3. `css` `a[href*="accounts.google.com"] img[alt]` (alt is often the name)
4. `fn` `wizGlobalEmail` — scan inline `<script>` text for `"oPEP7c":"<email>"` (Google's `WIZ_global_data`) — email only, name `null`

**`responses`** — the list of model answers (list)
1. `css` `model-response`
2. `css` `.model-response-text, message-content`
3. `css` `[data-test-id="model-response"], .response-container`

The **text** of a response is the `innerText` of its `.markdown` descendant if any, else of the element. **`html`** is the corresponding `innerHTML`.

**`userQueries`** (list) — `user-query`, `.user-query-container`, `[data-test-id="user-query"]`; text = `.query-text` else `innerText`.

**`responseActions`** — the action bar that appears under a finished answer
1. `css` `message-actions, .response-container-footer, [data-test-id="response-actions"]`
2. `attr` `aria-label` ~ `^(copy|good response|bad response|share|more options)` on `button` climb `model-response, .response-container`

**`signInControl`** (used to detect signed-out)
1. `css` `a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]`
2. `text` ~ `^sign in$` on `a, button, span` climb `a, button`

**`errorSignals`** (list)
1. `css` `mat-snack-bar-container, [role="alert"], .error-message, .error-container, [data-test-id="error-message"]`
2. `text` ~ `something went wrong|you.?ve reached your limit|reached (the|your) limit|try again later|can.?t help with that|not available in your|gemini is having trouble|couldn.?t (generate|complete)|is temporarily unavailable` on `p, span, div, h1, h2, h3` (visible, inside the main content or overlay; **not** inside the prompt box)

**`generating`** is derived, not located: `true` if `stopButton` is visible **or** the last response contains a visible spinner/progress (`mat-progress-bar, .loading-indicator, .thinking-indicator, [class*="loading"], [class*="spinner"], [aria-busy="true"]`) **or** (the last response exists and has no visible `responseActions` and its text changed within the last 1500 ms). The `signals` object in `is_generating` reports each component.

### Diagnostics object (`diagnostics` method and `ELEMENT_NOT_FOUND.details`)

```json
{
  "url": "…", "title": "…", "readyState": "complete", "extensionVersion": "0.1.0", "at": 1758290000000,
  "signedOut": false, "pageError": null,
  "elements": {
    "textarea": {
      "found": true, "strategy": "css#1", "strategyIndex": 0,
      "tried": [{"strategy": "css#1", "matched": 1, "visible": 1}],
      "element": {"tag": "div", "id": "", "classes": "ql-editor textarea", "aria": "Enter a prompt here", "testId": null, "text": "", "rect": {"x": 300, "y": 900, "w": 700, "h": 40}, "path": "body > div > … > rich-textarea > div.ql-editor"}
    },
    "newChat": {
      "found": false, "strategy": null, "tried": [ "… every strategy with its match counts …" ],
      "candidates": [ "<element summary> … up to 40 visible buttons/links" ]
    }
  },
  "overrides": { "…the current selector overrides…": [] },
  "page": {"buttons": 42, "contentEditables": 1, "textareas": 0, "customElements": ["rich-textarea", "model-response", "bard-mode-switcher"]}
}
```

`page.customElements` is the sorted set of tag names containing a `-` that
are present in the document — a cheap fingerprint of Gemini's component tree
that tells us when the UI changed.

---

## 4b. Keeping the tab alive (Edge)

Edge freezes and sleeps a background tab within seconds of it losing focus
— the content script is still there but runs nothing, so a message to it
hangs. Three layers, all independent of page language and layout:

1. **Own window.** On first use the background moves the Gemini tab into a
   window of its own (`chrome.windows.create({tabId, focused: false})`), so
   it is always the *active* tab of a window, which the browser never
   freezes. Edge and Chrome only: on Firefox the default is off (its background tabs keep running,
   and its profile is Gemini's alone, so every tab stays in one window). `settings.ownWindow` (storage)
   overrides the default either way.
   The tab is also marked `autoDiscardable: false`.
2. **Web Lock.** The content script holds `navigator.locks.request(
   'gemini-bridge-awake', shared)` for the page's lifetime; Chromium's
   freezing policy exempts a page that holds a lock.
3. **Recovery.** Every content call has a deadline (15 s; long methods get
   their own `timeoutMs` + 15 s). No answer from an inactive tab → the
   background activates the tab and retries once. "Receiving end does not
   exist" → inject the content scripts; if `executeScript` itself does not
   settle in 5 s the renderer is frozen and the tab is reloaded (nothing of
   ours can be in flight in it), then the call is retried. All of it is
   logged as `log` events (`warn`).

A call that lands right after a navigation waits ≤ 10 s for the prompt box
to render, and each control needed by an action gets ≤ 8 s to appear (the
model switcher shows ~4 s after load) before `ELEMENT_NOT_FOUND`.

---

## 5. Page-level signals

- **signedOut**: the tab URL is on `accounts.google.com`, **or** the URL is
  `https://gemini.google.com/` (landing, no `/app`) **or** `signInControl` is
  visible and `textarea` is not. Reported in `status.signedOut`; methods that
  need the app throw `SIGNED_OUT`.
- **pageError**: the first visible `errorSignals` match, as `{text, source}`
  (`source` = `toast | inline | response`). Reported in `status.pageError`;
  `send` throws `GEMINI_ERROR` when a signal appears in/after the response.
- **accountIndex**: `/\/u\/(\d+)(\/|$)/` on the URL, else `0`.

---

## 6. Content-script ↔ background messages

The content script registers with `chrome.runtime.sendMessage({type: "cs_ready", url})`
on load and on every SPA URL change (poll `location.href` every 500 ms +
`popstate`). The background keeps `readyTabs: Map<tabId, {url, at}>`.

Background → content script: `chrome.tabs.sendMessage(tabId, {type: "cs_call", method, params})`
→ replies `{ok, result}` / `{ok: false, error}` (same shapes as the WS response,
minus `id`). Long-running methods (`send`, `new_chat`, `set_model`) keep the
`sendResponse` channel open (`return true`). Tab-level methods (`tabs`, `open`,
`navigate`, `focus`, `switch_account`, `reload_page`, queue methods,
`get_selectors`/`set_selectors` persistence) are handled in the background;
everything DOM-related runs in the content script.

If `chrome.tabs.sendMessage` rejects with "Receiving end does not exist", the
background injects the content scripts with `chrome.scripting.executeScript`
(files in manifest order), waits ≤ 3 s for `cs_ready`, and retries once.
Then `TAB_NOT_READY`.

---

## 7. Python API surface (what `gemini_bridge` must expose)

```python
from gemini_bridge import Gemini, GeminiError

with Gemini(port=8765, connect_timeout=60) as g:   # starts the server, waits for the extension
    g.status()                      # dict (status object)
    g.diagnostics()                 # dict
    g.account()                     # {"name", "email", "index"}
    g.ensure_account("moustafa")    # name/email substring, case-insensitive → account dict, or raises AccountNotFound
    g.model()                       # "2.5 Pro"
    g.models()                      # [{"name","description","selected"}]
    g.set_model("Pro")              # "2.5 Pro"
    g.new_chat()
    g.ask("Write 5 keywords about X", new_chat=True, model=None, timeout=180) -> str   # send + wait
    g.send("…", wait=False)         # fire and forget
    g.stop(); g.is_generating(); g.last_response(); g.conversation()
    job = g.queue("…", new_chat=True, model="Flash", meta={"channel_id": 12})   # -> Job
    g.wait(job, timeout=300) -> str  # result text; raises JobFailed with code/details
    g.jobs(); g.cancel(job); g.clear_queue(); g.pause(); g.resume()
    g.set_selectors({"newChat": [{"type": "css", "value": "button.my-fix"}]}); g.selectors()
    g.on("job", callback); g.on("status", callback)   # event listeners (called on a background thread)
    g.call("any_method", {...})     # raw escape hatch
```

`ensure_account(match)`: if the current account matches → return. Otherwise
for `i` in `0..9`: `switch_account(i)`; if the result `redirected` to a
**lower** index or to a URL without `/u/` → stop (there is no account `i`);
if the account matches → return it. Raise `AccountNotFound(tried=[…])` with
the list of `(index, account)` seen so the caller knows which accounts *are*
signed in.

`GeminiError` carries `.code`, `.message`, `.details`. Subclasses:
`ElementNotFound`, `SignedOut`, `GeminiPageError`, `Busy`, `BridgeTimeout`,
`NoTab`, `TabNotReady`, `ModelNotFound`, `SendNotAccepted`, `JobFailed`,
`AccountNotFound`, `ExtensionNotConnected`.

CLI: `python -m gemini_bridge <command>` with `status`, `diag`, `ask "…"`,
`new-chat`, `models`, `model NAME`, `account [MATCH]`, `queue add "…"`,
`queue list`, `queue clear`, `serve` (just runs the server and prints
events — for checking the extension connects). Every command accepts
`--port`, `--timeout`, `--json`.
