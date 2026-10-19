# Gemini Bridge — Firefox / Edge / Chrome extension

The browser half of the Gemini Bridge. It lives on `https://gemini.google.com/*`
and lets the Python package in `pipeline/gemini_bridge/` drive the Gemini web
UI over a localhost WebSocket: find elements self-healingly, type prompts,
send, wait for the answer, switch models, detect the signed-in account and
run a prompt queue.

The contract between the two halves is `pipeline/gemini_bridge/PROTOCOL.md`.
Read that first; this file only covers what is specific to the extension.

```
pipeline/gemini_extension/
  manifest.json          MV3 manifest (no build step, plain JavaScript)
  background.js          service worker: WebSocket client, tabs, routing, queue, overrides
  content/locators.js    self-healing locator engine + builtin strategies (chrome-free, unit-tested)
  content/content.js     DOM actions (status, send state machine, models, account, ...)
  popup/                 status page (connection, port, bridge tab, elements, queue, diagnostics)
  test/                  jsdom tests: cd test && npm install && npm test
```

## Loading it (Chrome or Microsoft Edge)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → pick the `pipeline/gemini_extension/` folder.
4. Start the Python side (`python -m gemini_bridge serve`, default port 8765).
   The extension connects on its own and reconnects with backoff
   (1 s → 2 s → 4 s → 8 s → 15 s) whenever the socket drops; a
   `chrome.alarms` alarm re-checks every minute in case the service worker
   was put to sleep.
5. Open `https://gemini.google.com/app` (or let a bridge call open it).

After editing any file the extension must be reloaded, and so must the
Gemini tab: the browser keeps delivering messages to the tab's *old* content
script after an extension reload (`diagnostics.extensionVersion` tells you
which version a tab is running). Two ways that need no clicking:

```
python -m gemini_bridge watch          # reloads extension + tab whenever a file here changes
python -c "from gemini_bridge import Gemini; Gemini().connect().reload_extension()"
```

On first use the background moves the Gemini tab into a window of its own —
that is deliberate: Edge freezes background tabs within seconds and a frozen
content script answers nothing, while the active tab of a window is never
frozen. `settings.ownWindow: false` in `chrome.storage.local` turns it off.
See PROTOCOL.md §4b for the whole liveness story.

## Firefox (the app's default browser)

The app does not ask you to load anything in Firefox. `tools/build_addon.py` turns this folder into a
Firefox build (`manifest_version` 2, id `gemini-bridge@gratovo.app`, `compat.js` first so `chrome` is
`browser`), and the Gemini daemon starts Firefox with an app-managed profile and installs that build as a
*temporary add-on* over Firefox's remote-debugging protocol on every launch. A temporary add-on needs no
signature, which is why this works on release Firefox without AMO keys; it is also how the app keeps the
add-on up to date (every launch installs the current files). A permanent install in your everyday Firefox
profile needs an AMO-signed `.xpi` (the owner's API keys; see the bridge-runtime report).

### Firefox: MV2 or MV3

Measured on Firefox 156 (temporary add-ons, throwaway profiles, 200 s idle, a local WebSocket server):

| variant | background restarts | reconnects | notes |
|---|---|---|---|
| MV2, persistent background page | 0 | 0 | one connection for the whole run |
| MV2, event page | 3 | 4 | suspended and restarted while idle |
| MV3 event page (4 variants: plain, 20 s API ping, 20 s storage write, `persistent` flag) | — | never connected | MV3 host permissions are opt-in on Firefox, so the socket to 127.0.0.1 never opened without a user grant |

So the Firefox build is **MV2 with a persistent background page** (`FIREFOX_MODE = "mv2"`): never
suspended, no prefs needed, no permission prompt. Edge/Chrome keep this folder's MV3 service worker.

## The popup

- **Connection** — green/orange/red dot, the port in use, the last socket
  error. Change the port and click *Save & reconnect*; it is stored in
  `chrome.storage.local` under `settings.port` and the worker reconnects
  immediately.
- **Bridge tab** — the tab calls are routed to (PROTOCOL §3 order:
  `params.tabId` → remembered bridge tab → most recently active Gemini tab →
  open one). *Open Gemini* opens/focuses one.
- **Elements** — every element the bridge needs with found (green/red) and the
  strategy label that matched (`css#1`, `attr#2`, `fn#4`, or the name of an
  override such as `heal:aria`). A red row shows the last strategy that used
  to work, if any.
- **Queue** — queued / running / paused, with pause, resume and clear.
- **Run diagnostics** — the full diagnostics object (below) with a copy button.

## Reading diagnostics

`diagnostics` (method, popup button, or `ELEMENT_NOT_FOUND.details`) tells you
what could not be found, *how it used to be found*, and what looks like it now:

```jsonc
{
  "elements": {
    "sendButton": {
      "found": false, "strategy": null,
      "tried": [                                   // every strategy, in order
        {"strategy": "css#1",  "describe": "css \"button.send-button:not(.stop)\"", "matched": 0, "visible": 0},
        {"strategy": "attr#2", "describe": "attr aria-label ~ /^send( message| prompt)?$|submit/i on button", "matched": 0, "visible": 0},
        {"strategy": "fn#5",   "describe": "fn buttonNearTextarea", "matched": 0, "visible": 0}
      ],
      "lastKnown": {                               // how it used to get it
        "strategy": "css#1", "describe": "css \"button.send-button:not(.stop)\"",
        "element": {"tag": "button", "classes": "send-button", "aria": "Send message", "icon": "send", "rect": {...}, "path": "..."},
        "at": 1758290000000, "url": "https://gemini.google.com/app"
      },
      "candidates": [                              // visible buttons/links/editables, best first
        {"tag": "button", "classes": "send-btn", "aria": "Send prompt now", "icon": "arrow_forward",
         "score": 6.5, "why": ["same tag", "aria-label 25% similar", "near last position (0px)", "visible", "kind: label matches /send|submit/i"], ...}
      ],
      "suggestions": [                             // ready-to-apply strategies for the top 3
        {"strategy": {"name": "heal:aria", "type": "attr", "attr": "aria-label", "match": "^Send prompt now$", "tags": ["button"]},
         "candidate": {...}, "score": 6.5}
      ]
    }
  },
  "page": {
    "buttons": 42, "contentEditables": 1, "textareas": 0,
    "customElements": ["bard-mode-switcher", "model-response", "rich-textarea", ...],
    "customElementsAdded": ["model-picker"],       // vs the last successful session
    "customElementsRemoved": ["bard-mode-switcher"],
    "baselineAt": 1758290000000
  }
}
```

- `matched` is how many elements a strategy hit before the visibility check,
  `visible` how many survived it. `matched > 0, visible 0` means the element
  exists but is hidden (e.g. the send button before anything is typed).
- Candidates are ranked by similarity to `lastKnown.element` (same tag,
  shared classes, aria-label similarity, same data-test-id, same icon,
  distance from the old position) plus relevance to the element's kind. With
  no memory only the kind relevance is used.
- `customElementsAdded/Removed` is the one-glance "Gemini changed its
  component tree" signal. The baseline is stored the first time a page is
  seen and refreshed after every successful `send`.

## Hot-patching a selector when Gemini changes

Overrides are **prepended** to the builtin list for that element and persisted
in `chrome.storage.local` under `selectorOverrides`; the content script picks
them up immediately (no reload). Strategy format is PROTOCOL §4:

```python
g.set_selectors({"sendButton": [{"type": "attr", "attr": "aria-label", "match": "^Send prompt now$", "tags": ["button"]}]})
g.selectors()            # {"builtin": {...}, "overrides": {...}}
g.set_selectors({})      # clear
```

The fastest route is the suggestion list: pick `suggestions[N].strategy` from
the diagnostics and pass it straight to `set_selectors` (the Python CLI's
`heal <element> --pick N` does exactly that). A strategy may carry `"name"`
so the popup and diagnostics show it, and `"visible": false` when the match
is intentionally non-rendered (only the builtin `wizGlobalEmail` needs this).

Elements that are resolved as lists (`responses`, `userQueries`,
`modelMenuItems`, `errorSignals`) take the first strategy that yields at
least one visible match.

## What is stored where

| key (`chrome.storage.local`) | content |
|---|---|
| `settings.port` | WebSocket port (default 8765) |
| `selectorOverrides` | `{element: [strategy]}` |
| `lastKnown` | `{element: {strategy, strategyIndex, describe, element, at, url}, __page: {customElements, buttons, at, url}}` |
| `queue` | `{nextId, paused, running, jobs: [...]}` — finished jobs capped at 200 |

The bridge tab id lives in `chrome.storage.session` so it survives worker
restarts but not a browser restart.

## Tests

```
cd pipeline/gemini_extension/test
npm install
npm test
```

The tests run `content/locators.js` and `content/content.js` inside jsdom
against Gemini-like fixtures (`test/fixture.js`): every state of the prompt
box, generating/finished answers, signed-out landing, the open model menu, a
redesigned "alternate" layout, and a broken layout that exercises the healing
path. jsdom has no layout, so the tests plug in an `isVisible` hook (connected
and not hidden) and a `rect` hook that reads `data-rect` attributes; `fn`
heuristics that need real geometry (`buttonNearTextarea`) refuse to guess
when every rect is zero. `document.execCommand` does not exist in jsdom, so
typing runs through the DOM-write fallback there; the `execCommand` path is
only exercised in a real browser.
