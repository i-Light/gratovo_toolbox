# Gemini Bridge — working context (handoff)

Written 2026-09-19 during the session that built this. Read this first if you
are picking the work up; `PROTOCOL.md` (extension ↔ Python) and `DAEMON.md`
(app ↔ Python) are the contracts, this is the story around them: what was
asked, what the finished thing looks like, what exists, where the work
stands, and the steps left.

> **Update 2026-10-18 (decision old-files).** The old Gemini drafting path was
> removed: `action.draft_email`, `qa_email`, `lint_email`, `draft_reply`,
> `parse_draft`, `draft_rules`, `outreach_knobs`, `outreach_preview`, the drafter
> and QA skill files, the "Draft with Gemini" dialog, the `Gemini (browser)` AI
> provider and the drafter / QA gem settings (only the keywords gem remains).
> Drafting now happens in the app's Comms queue through `action.comms_propose`
> (asks Gemini, runs the course-built `gratovo-comms` skill and `gratovo-moments`)
> and `action.comms_check` (no Gemini call; re-checks text a person edited).
> Nothing is ever sent automatically. Where this story below describes the old
> path, it is history and says so.

---

## 1. What was asked

A browser extension that lets the Gratovo app drive **Gemini in the browser**
(the team's signed-in Gemini web app, in **Microsoft Edge**), with:

1. **Self-healing element finding** with clear diagnostics — the new-chat
   button, the prompt box, the send button (which is also the stop button
   while generating, so it tells us whether an answer is still streaming),
   the model name (currently shown next to the prompt box), the username,
   and the page URL (`/u/N/` account index: walking `/u/0..9` and seeing a
   redirect to a lower index or to no index means that account isn't signed
   in).
2. **A prompt queue.**
3. **Model switching.**
4. **A straightforward Python API** so the app can run actions — generating
   emails, keywords, classifying channels — through Gemini.

Then, in the same session: **UI changes in the app** to use it, keywords and
emails first, other ideas welcome.

Owner's explicit requirements (their words, paraphrased):

- "This extension needs to be super reliable."
- "Don't build based on [the live] DOM" — it must keep working when Gemini's
  markup changes significantly, and when it can't, it must "point me to what's
  missing without confusion and how it used to get it."
- Their Gemini/Edge may be used **for testing only**, not as the source of
  selectors.
- "Do the UI in parallel now and connect them after they both finish."

---

## 2. The end result (what "done" looks like)

**For a team member, day to day:**

- Edge has the *Gemini Bridge* extension loaded once (edge://extensions →
  Developer mode → Load unpacked → `pipeline/gemini_extension`). Its popup
  shows "connected", the account, the model, and which strategy found each
  element; nothing else to think about.
- In the app, **Settings → AI Providers → "Gemini in browser"** shows
  *connected as <name> · model <name>*. If Gemini's UI changes and something
  can't be found, the same card shows *what* is missing, *how it used to be
  found*, and numbered suggestions with an **Apply fix** button. No code, no
  Python, no guessing.
- **Search page → Generate keywords**: type a topic, get ~100 long-tail
  phrases that avoid everything the pipeline has already searched, untick
  the ones you don't want, add to the list, press Start.
- **Outreach → Comms queue**: drafting happens here. `action.comms_propose`
  asks Gemini (the course-built `gratovo-comms` skill, deployed as a Gemini
  skill, plus `gratovo-moments`) for a proposal; `action.comms_check`
  re-checks text a person edited, with no Gemini call. Nothing is ever sent
  automatically. (The original "Draft with Gemini" button, which ran the
  manual loop from `data/gemini skills/WORKFLOW.md`, was removed 2026-10-18.)
  The composer's "Copy brief for AI" still puts a brief on the clipboard.
- The **Anthropic key stays optional**: the Gemini features run through the
  bridge's actions. (The "Gemini (browser)" `AiProvider` was removed
  2026-10-18.)

**For the app (technically):** one long-lived `python -m gemini_bridge
daemon` per app session; the app speaks JSON lines to it; the daemon owns the
WebSocket the extension connects to; every AI feature is an `action.*` whose
prompt lives in Python next to the team's skill files. Results are always
proposals — nothing is auto-applied.

**Later (agreed as good ideas, not in scope now):** batch drafting from the
influencer list through the queue; "more keywords like the winners" from
per-keyword results; a channel classification card and auto-classify after a
search; a Gemini status dot in the app shell; critique → writing-rule suggestions in the Email Library.

---

## 3. Decisions and why

- **Python is the WebSocket server; the extension is the client**
  (`ws://127.0.0.1:8765`). Nothing to register in the browser beyond loading
  the unpacked extension; the extension reconnects with backoff; the MV3
  service worker stays alive on the keepalive traffic plus a 1-minute alarm.
- **Every element is an ordered list of strategies** (test-id → aria-label →
  icon → text → structural heuristic), declared as JSON so they can be
  overridden at runtime without redeploying. The resolver records which
  strategy matched, keeps a **last-known-good** record per element, and when
  nothing matches it returns every strategy tried (with a human `describe`),
  the last-known record, and **candidates ranked by similarity with
  ready-to-apply override suggestions**. `heal(element, pick)` applies one.
  This is the "one calibration pass" design: the first run against the live
  page tells us exactly what to patch, and the same mechanism handles future
  Gemini redesigns.
- **The queue lives in the extension's service worker** (persisted in
  `chrome.storage.local`) so it keeps running if Python disconnects; Python
  `wait()` uses events and polls as a fallback.
- **The app talks to one long-lived daemon** over stdin/stdout JSON lines
  (same pattern as the app's existing `GmailBridge` / `ScraperProcess`: no
  ports for the app, dies with the app), never to the extension directly.
- **Actions keep their prompts in Python** (`actions.py`): `generate_keywords`,
  `classify_channel`, and the Comms queue's `comms_propose` / `comms_check`
  (the original drafting actions `draft_email`, `qa_email`, `lint_email` and
  `draft_reply` were removed 2026-10-18). The keyword and classifier actions
  load the team's skill files from `data/gemini skills/` or open a Gem URL
  instead.
- **Gems are URLs**: `bridge.open_gem` navigates to a gem (the keywords gem);
  this replaces "paste into the gem" from the manual workflow.
- **The keyword prompt encodes the owner's `youtube-ai-keywords` rules**
  (long-tail 4–9 words, sub-topic + phrasing style + one angle, spread across
  sub-topics, vary the angle not the wording, dedupe against everything
  already searched).
- Three parallel agents (extension / Python / app UI) working against the
  written contracts, with the main session as integrator and reviewer.

---

## 4. Layout

```
pipeline/
  gemini_extension/        Chrome/Edge MV3 extension — load unpacked from here
    manifest.json, background.js, content/{locators,content}.js, popup/, test/ (jsdom)
  gemini_bridge/           Python package
    PROTOCOL.md            extension ↔ Python contract
    DAEMON.md              app ↔ daemon contract (+ the action shapes)
    CONTEXT.md             this file
    server.py client.py errors.py actions.py daemon.py cli.py
  tests/test_gemini_bridge.py, test_gemini_actions.py, test_gemini_daemon.py
lib/core/native/gemini_protocol.dart, gemini_bridge{,_io,_stub}.dart   (app side)
lib/core/native/comms_protocol.dart                                   (comms_propose / comms_check)
lib/features/settings/... "Gemini in browser" card (status, diagnostics, Apply fix)
lib/features/search/...   "Generate keywords" dialog
lib/features/outreach/... the Comms queue (proposals, checks, a person approves)
```

---

## 5. What has been done (in order)

1. Repo reconnaissance: the app already had the seams — `AiProvider` +
   per-task registry, the `GmailBridge` JSON-tool pattern, the AI brief
   builder, and the manual Gemini loop documented in `data/gemini skills/`
   (that workflow's documents were removed 2026-10-18).
2. Wrote `PROTOCOL.md`: wire format, error codes, every method, the
   per-element strategy lists, the diagnostics object, the 11-step `send`
   state machine, queue semantics, the Python API surface.
3. Spawned the extension agent and the Python agent in parallel; sent the
   extension agent the healing additions (last-known-good, ranked candidates,
   suggestions, Edge detection).
4. Proposed the app UI changes (keywords, emails, classification, status/heal
   panel, phasing); owner said build the UI in parallel too.
5. Wrote `DAEMON.md`: the app ↔ daemon contract and the action shapes,
   grounded at the time in the drafter skill's JSON mode and the blueprint
   lint (both since removed, 2026-10-18).
6. A rate limit cut both agents off; resumed both (Python agent additionally
   briefed on the daemon + actions) and spawned the app-UI agent.
7. Python half delivered and verified: 53 bridge tests + whole pipeline suite
   (300) green. Main session then rewrote the keyword prompt with the
   `youtube-ai-keywords` rules and made the keyword parser drop markdown
   headings/bold group labels.
8. This context file.

---

## 6. Where we are now (2026-09-20, ~03:45)

| Piece | State |
|---|---|
| Contracts (`PROTOCOL.md`, `DAEMON.md`) | done (§4b tab liveness, `reload_extension`, `set_debug`, `acceptedBy`, `marks`, `ACTION_REFUSED` added 2026-09-20) |
| Python package + daemon + actions + CLI | **done**, 53 tests green; `watch` subcommand; busy-port retry; refusal retry |
| Extension | **done**, 37 jsdom tests green, **calibrated on the owner's live Edge** (Arabic UI, account /u/1/) |
| App UI (Dart) | **done** at the time: settings card, keywords dialog (built, unwired by owner's choice), status dot (built, unwired); 708 tests green; analyze clean. (The draft stepper built then was removed 2026-10-18; drafting is the Comms queue.) |
| Plumbing smoke test | passed |
| Calibration on the owner's Edge | **passed**: `ask` → "pong" (6 s), `set_model` Pro⇄Flash, two queued prompts in order, account + email, model list with exactly one `selected` |
| Long skill prompt on the live page | the original drafter action **passed** on Pro (70 s) in 2026-09; on Flash the long skill prompt got the generic refusal → now retried once, then `ACTION_REFUSED`. Recommend `defaultModel: Pro` (or a gem URL). The drafter action itself was removed 2026-10-18 |
| Daemon over stdin/stdout | **passed**: listening → extension_connected → `bridge.status` → `bridge.shutdown` |
| App ↔ daemon in the running app | not yet exercised by a human at the time: Settings → Start → Test (drafting is now the Comms queue) |
| Docs | done (`PROJECT_STRUCTURE.md`, `pipeline/README.md`, `CHANGELOG.md`, extension README, PROTOCOL §4b) |
| Commit | **nothing is committed yet** |

### What the live page taught us (2026-09-20)

- **The page language is not fixed** (the owner's is Arabic). Every element
  now resolves by data-test-id / structural class / icon first; aria-label and
  text strategies are last and carry English + Arabic only as a fallback.
  `norm()` strips bidi marks; `labelText` joins text nodes with spaces.
- **Send**: a synthetic click on the send button is ignored; **Enter in the
  prompt box submits**. `send` tries Enter → click → click again and reports
  `acceptedBy`. Acceptance needs a new user-query / response / generating, or
  the *same* box node staying empty 800 ms (a re-rendered box is a wipe).
  New chat waits for the input area to stop being re-rendered before typing.
- **Edge freezes background tabs within seconds** → the bridge tab is moved
  to its own window on first use on Edge/Chrome (active tabs are never frozen; Firefox keeps every
  Gemini tab in one window), the content
  script holds a Web Lock, calls have deadlines, and an unresponsive tab is
  activated / re-injected / reloaded automatically (PROTOCOL §4b).
- **After an extension reload the tab keeps the old content script** —
  `reload_extension()` reloads the tab too; `diagnostics.extensionVersion`
  is the version running in the tab. `python -m gemini_bridge watch` does
  both on every file change.
- Controls render in stages after a load (textarea first, model switcher
  ~4 s later); actions wait ≤ 8 s per control.
- Model menu: the selected row has class `selected` + a visible check;
  `active` is just keyboard focus. "تفكير موسّع" (extended thinking) is a
  toggle row, not a model.
- The old drafter needed `sender_name`; the composer passes the mailbox's
  display name into the brief (it was missing for the clipboard path too).

The working tree also carries unrelated uncommitted dashboard changes from
before this work (`lib/app.dart`, `dashboard_screen.dart`,
`my_day_section.dart`, `debug_scale.dart`, `holo_card.dart`) — keep them out
of the bridge commit.

---

## 7. Steps to reach the end result

Each step has the check that says it is done.

1. ✅ **Extension review + tests.** Compare against `PROTOCOL.md`: method
   names, `hello` first after connect, `ping`/`pong`, `tried[].describe`,
   `lastKnown`, `suggestions`, `browser` in `hello`. Run
   `cd pipeline/gemini_extension/test && npm install && npm test`. Done when
   the tests pass and the report's deviations are either accepted or fixed.
2. ✅ **Dart review + tests.** Compare against `DAEMON.md` (method names and
   params the app sends, result fields it reads). `flutter analyze
   --fatal-infos` → 0; `flutter test` → green including the new tests.
3. ✅ **Plumbing smoke test** without the owner's account: launch Edge or Chrome
   with a temp `--user-data-dir` and `--load-extension=pipeline/gemini_extension`
   (Chrome ≥ 137 needs `--disable-features=DisableLoadExtensionCommandLineSwitch`;
   Edge may not), run `python -m gemini_bridge serve` → expect the `hello`
   event; `python -m gemini_bridge status` on the signed-out landing page →
   `signedOut: true` with no crash. Done when the round trip works.
4. ✅ **Calibration on the owner's Edge** (the one manual step): owner loads the
   unpacked extension in their Edge profile. Then `python -m gemini_bridge
   diag` → every element found, or heal the missing ones (`heal <element>
   --pick N`, and fold the better strategy into the builtin list so nobody
   else needs the override). Then `account`, `models`, `model Pro`,
   `new-chat`, `ask "Reply with exactly: pong"` → "pong". Then a queued pair
   of prompts finishing in order. Done when all of those pass on the live
   page.
5. **Connect the app.** Settings card → Start → *connected as …* → Test;
   Search → Generate keywords on a real topic → phrases added; the Comms
   queue on a real channel → a proposal from `action.comms_propose` whose
   checks come back clean (`action.comms_check`). Fix whatever mismatches appear between the
   Dart and Python sides (both were built against `DAEMON.md`, so expect
   small ones, not redesigns).
6. **Docs ✅ + commit.** `PROJECT_STRUCTURE.md` §5 (two new folders),
   `pipeline/README.md` (the bridge, the daemon, the actions), a
   `CHANGELOG.md` entry, the extension README's load steps. Commit the bridge
   work by itself.
7. **Then the later ideas** from §2, starting with batch drafting through the
   queue and classification after a search, since both reuse everything above.

---

## 8. Subagent work

Three agents were run in parallel from the main session; each got the
contract files plus a brief. The briefs are summarised here so any of them
can be re-briefed from scratch if a session is cut off (it happened once: a
rate limit stopped agents 1 and 2 mid-work; both were resumed with context).

### Agent 1 — the extension (`pipeline/gemini_extension/`) — DONE

Brief: MV3, plain JS, no build step. `manifest.json`, `background.js`
(WebSocket client, backoff, keepalive, `chrome.alarms` fallback, tab
management, on-demand content-script injection, persisted queue + processor,
selector overrides, event forwarding), `content/locators.js` (strategy engine
+ builtin table from `PROTOCOL.md` §4, chrome-free so jsdom can test it),
`content/content.js` (all DOM methods incl. the 11-step `send` state
machine, `cs_ready`, the 1 s status poller), `popup/` (state, port, element
table, queue, diagnostics), `README.md`, and `test/` (jsdom fixtures for
every UI state + an "alternate layout" + tests for the send state machine).
Second message added: last-known-good memory per element; ranked candidates
(tag/classes/aria/test-id/icon/position similarity) with `why`; top-3
`suggestions` as ready strategy objects (prefer data-test-id → aria-label →
icon → stable css → text); `page.customElements` diff vs last session; Edge
detection (`browser: edge|chrome|other`). Verify: `node --check`, `npm test`.

Report (agent 1 stopped by rate limits; verified by the main session 2026-09-20): all 37 jsdom tests pass; the method table matches PROTOCOL.md. The main session then calibrated it on the live page and added: structural/icon-first strategy order with EN+AR label fallbacks, bidi-safe `norm`, direction-aware `buttonNearTextarea`, Enter-first escalating submit with `acceptedBy`, stronger acceptance signals, `settleInputArea` after new chat, `need()` waits per control, `marks` on model rows, own-window + Web Lock + deadline/activate/inject/reload liveness (PROTOCOL §4b), `reload_extension`, `set_debug`, a connect() race fix, manifest 0.1.1.

### Agent 2 — the Python package (`pipeline/gemini_bridge/`) — DONE

Brief: `errors.py`, `server.py` (websockets 17 asyncio server on a daemon
thread, newest connection wins, sync `call()` with id correlation, JSON ping
15 s, dispatcher thread for events, `port=0` support), `client.py` (`Gemini`
facade per `PROTOCOL.md` §7 incl. `ensure_account`, `wait` with event +
poll fallback, `heal`), `cli.py` (`status diag heal ask new-chat models model
account queue selectors serve tabs open`), README, tests with a
`FakeExtension`. Second message added `DAEMON.md`: `daemon.py` (JSON lines,
4-thread pool, out-of-order responses, `bridge.*`), `actions.py` (all
`action.*`, skill-file prepend or Gem, tolerant JSON extraction), CLI
`keywords`, `daemon` (the first version also had the drafting actions, the
`lint_email` blueprint lint and the CLI `draft-email` / `lint`; all removed
2026-10-18); daemon subprocess tests.

Report (verified by the main session: 53 bridge tests + 300 whole-suite
green):

- Files: `__init__.py`, `errors.py` (every wire code + `ExtensionNotConnected`,
  `JobFailed(.job)`, `AccountNotFound(.tried)`,
  `ActionParseFailed`, `SkillFileMissing`; `error_from_payload`), `server.py`,
  `client.py` (+ `open_gem`, `wait_job`, `data_dir`, action wrappers),
  `actions.py`, `daemon.py`, `cli.py`, `__main__.py`, `README.md`; tests
  `test_gemini_bridge.py` (30), `test_gemini_actions.py` (19),
  `test_gemini_daemon.py` (4, real subprocess); `requirements.txt` gained
  `websockets>=13.0`.
- Deviations/interpretations: the websockets library ping (20 s) is the sole
  dead-connection detector, the JSON ping has no timeout; `ensure_account`
  also stops the walk on `SignedOut`; the current account is not duplicated
  into `.tried`; `heal` sends the full overrides map with the pick prepended;
  `auto_open` (not in PROTOCOL) opens a Gemini tab once after connect (CLI
  uses `auto_open=False`); `bridge.status` adds `statusError` when no
  extension; `extension_connected` is emitted on `hello`;
  when `gem` is given `newChat` is ignored (navigating is the new
  chat); `generate_keywords`/`classify_channel` have
  self-contained prompts (no skill file); default data dir honours
  `GRATOVO_DATA_DIR`; frames up to 32 MiB accepted; the daemon's last stdout
  line is `{"event":"daemon","data":{"state":"stopped"}}`; `bridge.shutdown`
  during a long `bridge.ask` fails that request with `EXTENSION_NOT_CONNECTED`.
- Needs from the extension: `hello` first after connect; answer JSON
  `{"type":"ping"}` with `pong`; per-element `suggestions` (strategy objects,
  optionally `{strategy, reason}`), `lastKnown` (`{strategy, at, element}`),
  and a `describe` string on each `tried` entry.
- Main-session edits after the report: `_keywords_message` rewritten with
  the `youtube-ai-keywords` rules; `_clean_keyword` now drops markdown
  headings and bold wrappers; one test assertion updated.

### Agent 3 — the app UI (Dart) — DONE (agent 4 finished it 2026-09-20)

Brief (priority order; stop at a boundary if budget runs out):
1. `lib/core/native/gemini_protocol.dart` — pure Dart codecs, `GeminiFailure`,
   typed results (`GeminiBridgeStatus`, `GeminiDiagnostics`,
   `KeywordsResult`, `ClassifyResult`, `GeminiJob`; the draft / QA / lint /
   reply results built then were removed 2026-10-18), tests.
2. `gemini_bridge.dart` + `_io`/`_stub` — spawns the daemon (same interpreter/
   `pipeline/` discovery as `ScraperProcess`), id correlation, `events`,
   `state` (stopped/starting/listening/connected/failed), restart with
   backoff, typed helpers; `geminiBridgeProvider`, `geminiBridgeStateProvider`;
   `test/support/fake_gemini_bridge.dart`; persisted settings (port,
   account match, keywords gem URL, default model); `ensure_account` once
   per daemon session.
3. (Removed 2026-10-18: `GeminiBrowserProvider`, the `gemini-browser`
   `AiProvider` that was backed by the old drafting action.)
4. Settings → AI Providers "Gemini in browser" card: state chip, Start/Stop,
   port, account match, keywords gem URL, default model, Test, Open Gemini, the
   Diagnostics panel (tried / how it used to be found / numbered suggestions
   with **Apply fix** → `bridge.heal`), copy JSON, load-extension hint with
   the absolute path.
5. Search: "Generate keywords" dialog (topic, count, exclusions, styles,
   language → checkbox list, already-searched greyed → "Add N to list";
   `avoid` = current list + all-keywords export).
6. (Removed 2026-10-18: the Outreach "Draft with Gemini" stepper and its
   draft / lint / QA actions. Drafting is the Comms queue:
   `action.comms_propose` and `action.comms_check`.)
7. Optional: shell status dot.
Rules: ARB en + ar for every string, `flutter gen-l10n`, `flutter analyze
--fatal-infos` clean, tests mirror `lib/`, nothing under `pipeline/`.

Report (agent 4, 2026-09-20): all of items 1–7a built and tested (22 new widget tests, 116 ARB keys en+ar). Wired: Settings → "Gemini in browser" card (in `accounts_card.dart` under AI Providers; full diagnostics panel with Apply fix); at the time also the Outreach composer's "Draft with Gemini" stepper, since removed (2026-10-18). Built but **unwired** at the owner's request: `search/.../generate_keywords_dialog.dart` (+controller, `readAllKeywordsFile`) — wire with one line in `keyword_input.dart` before `_SaveAllKeywordsButton`; `settings/.../gemini_bridge_status_dot.dart` — a `Positioned` in `app_shell.dart`. Shared presentation helpers in `lib/core/status/gemini_bridge_presentation.dart`.
