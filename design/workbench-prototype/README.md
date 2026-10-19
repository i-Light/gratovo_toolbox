# Workbench prototype

The approved, clickable design of the new app, running on example data. It is the specification for the rebuild (migration plan, ground rule 2). Published copy: https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn (version 3).

## Open it

Open `index.html` in a browser. It loads React 18.3.1 and htm 3.1.1 from public CDNs. Copies of those three files are in `vendor/` for the tests, which work offline. Fonts come from Google Fonts.

## What's in it

| File | Holds |
|---|---|
| `index.html` | Every style: design tokens for light and dark, components, layout, motion. The token values are what step 3c ports. |
| `js/core.js` | The runtime: the store (`W.act` with undo snapshots, `W.ui`, `W.bg`), navigation history, the key stack with barriers, toasts, menus, formatting, icons. |
| `js/data.js` | The example business: about 34 AI channels, 10 brands, 8 deals, threads, drafts, runs, mailboxes, the team. |
| `js/engine.js` | Lookups, fit scoring with reasons, **the Today next-action engine** (`W.items`), every action (`W.A.*`), problems, search jobs. |
| `js/proto.js` | Who is using it (account name), **prototype mode** (live data set aside, scenarios, view-as) and the comment store. |
| `js/ui.js`, `js/records.js` | Shared components: buttons, tags, avatars, channel banners, the draft card, thread, AI reading, deal checklist, money, ladder, triage, records. |
| `js/today.js`, `find.js`, `reach.js`, `close.js`, `deliver.js`, `more.js` | The screens: Today, Find, Reach, Close, Deliver, and Insights, Toolbox and Team. |
| `js/settings.js` | Settings: sections, search, scope labels, saved-in-place, prototype mode controls. |
| `js/comments.js` | The comment tool: pick, compose, pins, the list, copy for Claude. |
| `js/plan.js` | The Plan page and the design-note layer. It also holds the data behind the parity checklist: principles, coverage of the 127 tasks, quality-of-life list, feedback map, lag causes, roadmap, open questions. |
| `js/app.js` | The frame: rail, account menu, top bar, prototype controls, bars, trays, peek, palette, shortcuts, global keys, boot. |
| `test/` | Playwright checks (Python). |
| `notes/` | Build notes from 2026-10-19 (history). |

The code is plain ES5 on a global `W`, written for a no-build prototype. Port the behaviour and the design into the real app's structure ([architecture.md](../../docs/architecture.md)). Don't copy the structure.

## Run the tests

```bash
pip install playwright && python -m playwright install chromium
cd design/workbench-prototype
python test/smoke.py today find reach close deliver insights toolbox team plan settings   # every screen and tab; add --dark or --wide 400
python test/flows.py          # core flows: design notes, gates, send, undo, triage, palette, focus, wrap-up
python test/find_flow.py      # search console, gallery, saved views, drill-down, contacts
python test/proto_flow.py     # settings, account menu, prototype mode, scenarios, view-as, comments, banners
python test/review_fixes.py   # regressions for the 27 review findings
```

Each test prints `no errors` and `0 failed` when green. On 2026-10-19 all of them passed in light, dark and at 400 px.

## Comments from the owner

With prototype mode on (Settings › Prototype mode), the owner pins comments to any element. On the published artifact they are stored in its `comments` collection, readable with the `ArtifactData` tool. Locally they stay in the browser's storage, and "Copy open for Claude" exports them as text.
