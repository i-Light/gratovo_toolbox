# 0019. Prototype mode and the comment tool, as built

- **Date:** 2026-10-27
- **Status:** accepted for step 7, part 2 (prototype mode and the comment tool, was 3f). It records the decisions of the step's plan (D1 to D12 in `.router/PLAN.md` while the step runs) as built. It builds ADR 0004 and changes it in three places, named under Consequences. ADR 0016's live gate stands.

## Context

ADR 0004 set what prototype mode is: the real app on example data, owner only, off by default, invisible when off, with scenarios and a comment tool. Steps 4 to 6 built the live app and its live gate, so the example data was reachable only on a build without Supabase settings. The owner asked for prototype mode and the comment tool on their own, before Today (part 1 of step 7).

## Decision

1. **A third database, `prototype.db`.** Turning prototype mode on opens it as a fresh example copy for the chosen scenario. `gratovo.db` (live) and `example.db` (a build without Supabase) are never touched, so turning it off reopens exactly what was open. Its pipeline folder is `prototype-pipeline`, emptied at every turn-on and scenario pick.
   *Why:* when the build has no Supabase settings, what was open is `example.db` itself; reseeding it would not restore it.
2. **A wrapper over the account** (`main/prototype/wrap.ts`). While on, `source()` answers the prototype copy and `findContext()` answers `{ mode: "example", workerId: "prototype", folder: "prototype-pipeline" }`. Everything else goes to the real account, typed member by member so a new member can't be skipped. The source watch reads the wrapped account, so a switch runs what a sign-in runs (the catalog rebuilds, Reach closes and reopens on the new source, the Gemini bridge stops). If the real account closes (sign-out, access lost), prototype mode turns itself off.
3. **Prototype mode is `mode: "example"`.** Every stand-in that exists for example data applies (sends recorded locally, drafts filled without Gemini, no mail job, the Python example search). No new mode exists for code to forget. `findContext()` gained `folder`, which the find service and the pipeline folder read.
4. **A switch reloads the window,** as a sign-in does. Toasts, undo history and the page's state go with it, so an Undo can't reach across. The confirming toast survives the reload through `sessionStorage`.
5. **Owner check in main:** core's `isOwner` on the real source's `me`. The page's Settings section shows only when main says `available`.
6. **Thirteen channels are refused while on** (`main/prototype/refused.ts`): `connections:set`, `connections:pick-folder`, `mail:connect`, `mail:check`, `gateways:deploy`, `gateways:remove`, the four `import:*`, `reach:send-test`, `gemini:start` and `gemini:open-window`. They throw before their handler runs. The file holds the audit of every other channel. `presence:set` is answered and ignored, and the bridge's start options are null while on. Turning on, or picking a scenario, stops a running search first, as signing out does.
7. **The live account keeps running in the background:** its session and its sync carry on into `gratovo.db`. Reach's queue, the reply checks and scheduled sends on live data wait until prototype mode is off, as if the app were closed, because Reach runs on whichever source is open.
8. **Off at every start.** The scenario is kept in `prototype.db` (`_meta` key `prototype_scenario`).
9. **Scenarios are seed variants** (`exampleSeed(now, scenario)` in `packages/core`, `example-scenarios.ts`): **normal** (the example seed), **first** (only you, no creators, one mailbox on day 1 of its warm-up), **later** (the seed built a week earlier, so everything is late) and **broke** (three alert notifications, the first mailbox signed out of Gmail, and drafting as if the Gemini bridge were off). The broken parts are in `local_settings` key `example.health`, read only on example data: Reach's mail state shows the mailbox signed out, and the drafter answers `off`, fills no drafts and refuses rewrites.
10. **Comments live in `prototype.db`,** table `comments` (migration 0005; the other databases get the empty table). The reseed doesn't clear it, so comments survive scenario picks and turning it off and on. Every `comments:*` call is refused while prototype mode is off. Main never logs a comment's text.
11. **Export for Claude** writes `docs/feedback/comments.json` in the repository: the open comments first, then the done ones, each with its number and where it was left. It works when the app runs from the repository (unpackaged); a packaged build answers `no_repo`. **Copy open for Claude** puts the open ones on the clipboard as text.
12. **Pins anchor to `data-ui` ids.** About 80 ids were added across the frame and every screen (`screen.part.thing`). An anchor keeps the nearest `data-ui` id, the `:nth-of-type` path inside it, the element's first 60 characters, a label and where it was clicked. To find it again: the same path with the same text, else the same tag and text inside that `data-ui` element, else the `data-ui` element itself, with the pin marked as moved.
13. **Off leaves no trace.** The page reads `prototype:status` once at start. The chip, the comment button, the comment layer (pins, picker, list) and the palette entries render only while on, and the C key is registered by the layer, so it does nothing when off. Unit tests and the Electron smoke test (`e2e/prototype.spec.ts`) check it.

## Consequences

- **Changes to ADR 0004:** prototype mode uses its own `prototype.db`, not `example.db`; "see the app as a teammate" moved to step T (T4); and turning it off restores the data exactly, but the undo history of the session goes with the reload.
- In prototype mode every screen shows, including those no step has wired yet (Today, Close, Deliver, Insights, Team). They show their placeholders until their steps build them.
- Find in a scenario starts empty until a search runs (the example search fills `prototype-pipeline`), as it does on example data. The broke scenario's stopped search is shown by its notification only.
- The problems bar stays empty: its feed is part of Today's work.
- The full prototype flow suite (`proto_flow.py`, `review_fixes.py` as Playwright tests) runs at the end of step 7, with Today.
