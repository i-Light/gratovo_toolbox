# Gemini Bridge: the browser add-on

The browser half of the Gemini bridge. It lives on `https://gemini.google.com/*` and lets the
Python package in `services/pipeline/src/gratovo_pipeline/gemini/` (ADR 0014,
`docs/decisions/0014-gemini-bridge-and-comms.md`) drive the Gemini web page over a localhost
WebSocket: find elements self-healingly, type prompts, send, wait for the answer, switch models,
detect the signed-in account and run a prompt queue.

It is ported as it was and kept in its legacy style (plain JavaScript, no build step); moving it
to TypeScript comes later (migration plan section 7).

```
services/gemini-extension/
  manifest.json          MV3 manifest, a plain Chrome/Edge extension
  background.js          service worker: WebSocket client, tabs, routing, queue, overrides
  compat.js              points `chrome` at `browser` on Firefox
  content/               locators (self-healing), content script, gems, skills
  popup/                 status page
  tools/build_addon.py   makes the Firefox build (folder and .xpi); standard library only
  test/                  jsdom tests (`pnpm --filter @gratovo/gemini-extension test`)
```

## Firefox (the app's default browser)

You load nothing by hand. The bridge calls `tools/build_addon.py`, which turns this folder into a
Firefox build (`manifest_version` 2, persistent background page, id `gemini-bridge@gratovo.app`,
`compat.js` first), starts Firefox with an app-managed profile and installs that build as a
temporary add-on on every launch. A temporary add-on needs no signature, and every launch installs
the current files, which is also how it stays up to date.

### The per-launch token

Each launch the bridge makes a random token (64 lowercase hex characters) and passes it to the
build. The build then writes `bridge-token.js` (`self.GB_BRIDGE_TOKEN = "<token>";`) into the built
folder and lists it first among the background scripts. `background.js` sends it as `token` in the
`hello` event, and the bridge refuses a hello without the right one (close code 4001, and the add-on
then waits 60 s before it tries again). The source folder never holds `bridge-token.js`. Without a
token the build has no such file and `hello.token` is `null`.

```
python tools/build_addon.py firefox --out build/firefox --token <64 hex>
```

### Firefox: MV2 or MV3

Measured on Firefox 156 (temporary add-ons, throwaway profiles, 200 s idle, a local WebSocket server):

| variant | background restarts | reconnects | notes |
|---|---|---|---|
| MV2, persistent background page | 0 | 0 | one connection for the whole run |
| MV2, event page | 3 | 4 | suspended and restarted while idle |
| MV3 event page | - | never connected | MV3 host permissions are opt-in on Firefox, so the socket to 127.0.0.1 never opened without a user grant |

So the Firefox build is MV2 with a persistent background page (`FIREFOX_MODE = "mv2"`).

## Chrome or Microsoft Edge

1. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked** and pick this folder, `services/gemini-extension/`.
3. The extension connects to the running bridge on its own and reconnects with backoff. A
   by-hand load has no token (it is a Firefox build step), so use it only against a bridge that
   does not require one.

After editing any file, reload the extension and the Gemini tab: the browser keeps delivering
messages to the tab's old content script after a reload (`diagnostics.extensionVersion` says which
version a tab runs).

## The popup

- **Connection** — green/orange/red dot, the port in use, the last socket
  error. Change the port and click *Save & reconnect*; it is stored in
  `chrome.storage.local` under `settings.port` and the worker reconnects
  immediately.
- **Bridge tab** — the tab calls are routed to (the bridge protocol §3 order:
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
them up immediately (no reload). A strategy looks like this (set through the bridge's `set_selectors` method):

```json
{"sendButton": [{"type": "attr", "attr": "aria-label", "match": "^Send prompt now$", "tags": ["button"]}]}
```

The fastest route is the suggestion list: pick `suggestions[N].strategy` from
the diagnostics and pass it straight to `set_selectors`. A strategy may carry `"name"`
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
pnpm --filter @gratovo/gemini-extension test      # the add-on's jsdom tests (also part of `pnpm test`)
uv run --directory services/pipeline pytest -q tests/test_build_addon.py   # the packer
```

The jsdom tests run `content/locators.js` and `content/content.js` against Gemini-like fixtures
(`test/fixture.js`). jsdom has no layout, so the tests plug in an `isVisible` hook and a `rect` hook
that reads `data-rect` attributes. `document.execCommand` does not exist in jsdom, so typing runs
through the DOM-write fallback there. `test/hello-token.test.mjs` loads `background.js` in a `vm`
sandbox with a stub `chrome` and checks that the hello carries the token.
