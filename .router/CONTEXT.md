# Step 3c context: port the app frame from the prototype

Spec: `design/workbench-prototype/` (plain ES5 on global `W`, React via htm). Paths below are relative to that folder unless absolute. "l." = line. Everything here was read from source; "unclear:" marks what is not settled by the code.

## 0. Target and existing code

- `apps/desktop/src/renderer/main.tsx`: imports `@gratovo/ui/tokens.css` and `./base.css`, mounts `<App/>` in StrictMode, sets `document.title` from `strings.appName`.
- `apps/desktop/src/renderer/app.tsx` (10 lines): placeholder `<main className="frame"><h1 className="frame-title">`. Comment says step 3c builds the real frame. Replace it.
- `apps/desktop/src/renderer/strings.ts` (4 lines): `export const strings = { appName: "Gratovo Toolbox" } as const`. All UI words go here (CLAUDE.md rule).
- `apps/desktop/src/renderer/base.css` (36 lines): reset, `body` uses `var(--bg)`, `var(--ink)`, `font: 400 var(--fs)/1.45 var(--f-ui)`; `.frame` grid centred; `.frame-title`.
- `apps/desktop/src/renderer/env.d.ts` (8 lines): declares `window.gratovo: Bridge` (typed preload IPC from `@gratovo/ipc/bridge`). Data from main goes through `window.gratovo.invoke` (handoff step 7).
- `apps/desktop/src/renderer/index.html`: `<div id="root">`, `<script type="module" src="./main.tsx">`. Title is set from strings.
- `packages/ui/src/tokens.css` (213 lines): all colour, font, radius, frame-size, density, motion-curve tokens, plus `data-input="kbd"`, `data-motion="reduce"`, `data-size`, `data-density`, `data-theme` rules. `packages/ui/src/tokens.test.ts` compares values with the prototype.
- `apps/desktop/e2e/fixtures.ts` (56 lines): Electron `test` fixture with `app` (fresh copy, own `GRATOVO_USER_DATA` temp dir) and `page` (waits for `app://gratovo/index.html`). Exports `appPage` and `expect`. Runs on Windows only (`pnpm test:e2e`).
- Other e2e specs already present: `e2e/smoke.spec.ts`, `e2e/security.spec.ts`, `e2e/fuses.spec.ts`.
- Handoff notes for 3c (docs/handoff.md "Next: step 3c"): fonts must be files served from `app://` (CSP is `font-src 'self'`, no Google Fonts link); hash routes `#/today` (ADR 0008); pure key-stack and undo logic goes to `packages/core` with unit tests.
- Plan step 3c acceptance (docs/migration-plan.md l.102-110): frame matches prototype at 1440 and 400 px in light and dark; Playwright tests for palette, peek, undo, menus, Esc order, key barriers; no layout shift or animation on keyboard actions.

## 1. The frame: `js/app.js` (438 lines)

Render tree (`App`, l.374-420). Root `div.app` with classes `rail-min` (`u.railMin`), `rail-open` (`u.railOpen`), `why-on`, `proto-on`, `cmt-panel-on`. Children in order:
- `<Rail>` (l.24-62, `nav.rail`).
- `div.scrim.only-narrow` (inline z 85) when `u.railOpen` (l.401), closes drawer.
- `div.main` > `<Top>` (`header.top`, l.76-105), `div.bars` (`ViewAsBar` if proto on and viewing someone else; `SysBar`), `div.body` (`.has-peek` when `u.peek`) > `main.content#content` (screen from `W.screens[route.s]`, else `<Missing>` l.368) and `<Peek>` (`aside.peek`, l.166-180).
- Overlays: `<Tray>` if `u.tray`; `<Palette>` if `u.palette`; `<Shortcuts>` if `u.shortcuts`; `<Handoff>` if `u.handoff`; `<Menu key=x,y>` if `u.menu`; `<W.WhyLayer>` if `u.why`; `<W.CommentLayer>` if proto on; `div.toasts[data-cmt-ui]`; `<Tip>` last.

### 1a. Rail (`nav.rail[aria-label=Main][data-why=rail]`)
- Brand: `.brand` > `.logo` (conic-gradient mark) + `<b>Gratovo</b><small>Workbench</small>`.
- Items via `nav(k,label,sub,count,hot)` (l.29-38), `button.nav` with `style --hue`, `aria-current="page"` when `route.s===k` or rec opened from k. Click: `W.go(k, lastTab[k] || first tab)`. Inside: `.nic` (26 px icon tile), `.nl` (`b` label, `small` sub), `.cnt` badge (`.hot` on Today, `.bump` animation when value changes), `.cnt-dot` (shown only collapsed).
- Order: Today (sub `"{W.dur(planned)} planned"` or `"All clear"`, count `items.length`, hot), `.nav-h` "Pipeline", Find, Reach, Close, Deliver (counts from `W.phaseCounts`), `.nav-h` "Workbench", Insights, Toolbox, Team (no counts), `span.sp` spacer, The plan (`map` icon).
- Hues: Today `var(--accent)`, Find `--find`, Reach `--reach`, Close `--close`, Deliver `--deliver`, others `--ink-2` (SCREENS, l.8-20).
- Foot `.rail-foot`: button `.me` (`aria-haspopup=menu`, `aria-label="Your account: <name>"`, `data-tip` when collapsed). Contains `W.Av` (status online or away), `.nl` with `b` = name or "Add your name" (when `d.me==="u1"` and no name), `small` = `role + " · viewing as"` or `" · online"`, `chevU` icon `.me-chev`. Click opens `accountMenu` (l.64-73).
- Collapse button `.iconbtn.rail-tog.hide-narrow` (`aria-label` "Collapse the sidebar"/"Expand the sidebar", `data-kbd="["`), toggles `W.pref.set("rail", "min"|"")`.
- Account menu items (in order): who row (`{who}`, click opens Settings › profile name), Settings (hint "Ctrl ,", goes to settings/profile), Appearance (hint Dark/Light/System, settings/appearance), Keyboard shortcuts (hint "?", sets `u.shortcuts`), separator, Notifications (settings/notifications), Connections (settings/connections).

### 1b. Top bar (`header.top`, l.76-105, `z-index:30`)
- Order: `button.iconbtn.only-narrow` "Menu" (toggles `u.railOpen`, narrow only); `div.row.hide-narrow` with two `W.IconBtn`: Back (`chevL`, kbd "Alt ←", disabled when `histI<=0`) and Forward (`chevR`, "Alt →", disabled at end); `nav.crumbs.hide-narrow[aria-label="You are here"]`; `button.cmdk[data-why=cmdk]` (search icon, text "Search or run a command", `span.kbd` "Ctrl K"; opens palette); right group `div.row`:
  - Jobs `button.iconbtn[data-why=jobs][aria-pressed]`: ring SVG `.ring-prog` (progress of `jobs[0]`, min 8 %) or `layers` icon; `.badge` with count of running jobs. Toggles `u.tray="jobs"`. Label `jobs[0].label` or "Background jobs".
  - Bell `W.IconBtn` "Notifications" with `badge` = unread count (`!read && W.notifShown`), `pressed` when tray is notifs. Toggles `u.tray="notifs"`.
  - Prototype controls (`ProtoControls`, l.108-123) only when `W.protoOn()`: `.proto-chip` (flask icon, scenario short name, chevD; opens menu: scenario list, "See the app as" list, Comment on something (C), All comments, Prototype settings, Turn prototype mode off) and chat `IconBtn` (kbd "C", badge = open comments).
  - Map `IconBtn` "Why is this here? Show the design notes", `pressed=u.why` (toggles `u.why`, clears `whyOpen`).
  - Save state `span.save[role=status][data-why=save]`: `.busy` class and text "Saving…" while `u.saving`, else "Saved"; `<i>` dot (warn when busy, good otherwise); `data-tip` "Saved on this computer and synced {W.ago(savedAt)}". Hidden narrow.
  - Presence `span.avs` with `W.Av size="s"` for each team member with `status==="online"` and not me. Hidden narrow.

### 1c. Bars under the top bar (`div.bars`, l.515-520 CSS)
- `SysBar` (problems, l.130-139): renders only if `W.problems()` non-empty. Shows `ps[0]` in `.sysbar.crit[role=alert][data-why=problems]` with alert icon, bold `p.text`, `.hide-narrow` sub, "+N more" `.linkbtn` toggling `.sys-more` (each extra with its own act link), and primary `.btn.sm` for `p.act.label`. Cannot be dismissed; disappears when the data is fixed.
- `ViewAsBar` (l.124-128): `.sysbar.info[role=status]`, eye icon, "Seeing the app as {name} · {role}. Their Today list…", `.btn.sm` "Back to you" (`W.setViewAs("u1")`). Only when proto on and `d.me !== "u1"`.
- `--bars-h` CSS var is set from `.bars` height by a ResizeObserver (l.394-398) so toasts sit below bars.

### 1d. Peek panel (`aside.peek[aria-label=Record][data-why=peek]`, l.164-180)
- Opens from `W.peek(t,id,list)`. Closed by `W.closePeek`, Esc, Close button, or any `W.go` (unless `keepPeek`).
- Header `.peek-h`: when `list.length>1`: `IconBtn` "Previous" (chevU, kbd "Alt ↑", disabled at start), "Next" (chevD, "Alt ↓"), counter `span.small.muted.num` "i of n"; spacer; `Btn` ghost "Full page" (external icon; `W.openRec` → route `rec`); `IconBtn` "Close" (x, kbd "Esc").
- Body `.peek-b` renders `<W.Record key=t+id refx>`.
- Width: `.body.has-peek` grid column `var(--peek-w)` (480 px). At max-width 1180 it becomes absolute overlay: `.peek{position:absolute; inset-block:0; inset-inline-end:0; width:min(var(--peek-w),100%); z-index:25; box-shadow:var(--shadow-3)}`.
- Enter animation `.peek` `slideIn .24s var(--ease-drawer)`.
- Keys registered only while open (l.168): `escape` closes; `alt+arrowdown` / `alt+arrowup` step through `list` (`peekStep`, l.165).
- Full-page route `rec` (l.181-187): `.page` max-width 1000 px, Back `Btn` (arrowL, `W.back`), `.card` with Record.

### 1e. Command palette (`Palette`, l.190-241)
- Opened by Ctrl K (toggle, global l.353), "/" (open only, l.354), or top-bar `.cmdk`. Closed by Ctrl K again, Esc (its input and the key), scrim click, or choosing an item (closes first, then runs).
- Barrier layer (`{barrier:true}`, l.194). Focus moves to input on mount (l.192).
- Markup: `.scrim` (click closes); `.pal[role=dialog][aria-label="Command palette"]` with inline `style animation:none` (so it never animates); `.pal-in` (search icon, `input` aria-label "Search or run a command", placeholder "Find a creator, brand or deal, or type a command", `.kbd` "Esc"); `.pal-list[role=listbox]` of `button.pal-i[role=option][aria-selected]` with `.pal-g` group headings; empty text `Nothing matches "q"`; `.pal-f` footer hints ("↑ ↓ move", "Enter open", "G then a letter jumps to a screen", "? all shortcuts").
- Keys in input: ArrowDown / ArrowUp move selection (`sel` index, mouse hover also moves), Enter runs `list[i]` after `W.kbdQuiet()`, Escape closes. Typing resets selection to 0.
- Empty query: `Recent` (up to 5 from `u.recent`, icon by kind), then first 5 Actions, then all 9 "Go to" screens (no `rec`).
- Query: filter over `acts + go + sets + recs` by `label + sub + words` substring (case-insensitive), max 14.
- Actions (l.196-206): Start focus (F; sets `u.focus` on Today), Wrap up the day (`u.wrap`), Resume today's search (`W.A.startRun("r3")`), Review new finds, Confirm contacts, Undo the last change (Ctrl Z), Show keyboard shortcuts (?), Show the design notes on this screen, Switch light / dark (`cycleTheme`), Open settings (Ctrl ,), Switch density.
- Go to hints: G T Today, G F Find, G R Reach, G C Close, G D Deliver, G I Insights, G X Toolbox, G M Team, G P The plan, G S Settings.
- Settings group: every `SETTINGS_ROWS` entry (sub = section name, words = search words), opens `W.openSetting`. Prototype rows only when proto on or account is owner (l.209).
- Records group: Creators (sub handle · stage · email, avatar), Brands (flag icon), Deals (box icon). Opens with `W.peek`.
- Prototype group when proto on: Comment on something (C), Show all comments.

### 1f. Shortcut sheet (`Shortcuts`, l.250-258)
- `.scrim` + `.modal[role=dialog][aria-label="Keyboard shortcuts"]` with `--mw:760px`. `h2` "Keyboard shortcuts", close `IconBtn`. Two-column `.grid2` of groups from `SHORTCUTS` (l.244-249): Everywhere (9 rows), Today (6), Reviewing finds (5), Records (2). Each row: `.kbd` key + text. Footer `p.hint` "Single-letter keys never fire while you are typing in a field."
- Barrier (l.252): Esc and "?" close. Opened by "?" or account menu.

### 1g. Hand-off note (`Handoff`, l.261-273)
- Opened by `u.handoff` (set from Today; not frame logic). `.modal[role=dialog][aria-label="Hand off"]` `--mw:480px`: `W.Av` + "Hand to {name}" + title; `W.Callout tone=warn` if recipient away; `textarea.ta` autofocus, aria "Note"; buttons `Btn kind=pri` "Hand it over" with kbd "Ctrl Enter", ghost "Cancel".
- Barrier (l.265): Esc closes, Ctrl Enter (`mod+enter`) submits (`W.A.handOff`).

### 1h. Menus (`Menu`, l.276-296)
- Opened by `W.menu(event, items, {align})` (core.js l.208-211); `u.menu = {x, y, right, top, items, align}` from trigger rect (`y = rect.bottom + 4`).
- Item shapes: `{label, icon, hint, run, danger, checked}`, `{sep:true}`, `{head:"..."}`, `{who, unnamed, run}`. Checked items use `role=menuitemradio` + `aria-checked`; others `menuitem`. `danger` colours `var(--crit)`.
- Placement: `useLayoutEffect` clamps x to 8 px inside viewport; flips above trigger if it overflows bottom; starts `visibility:hidden` until measured; focuses first button.
- Keys (barrier, l.286-288): ArrowDown / ArrowUp move focus between `button`s; Escape closes.
- Closes on: outside `mousedown` (listener added after `setTimeout 0`), item click, `W.go` (sets `menu=null`), Escape.
- CSS: `.menu` fixed z 85, `dropIn .12s`, `button` rows 13 px, hover/focus `var(--sunk)`, `.mh` group heads, `hr` separators, `.mwho` account row (Av size l + name + role), `.mcheck` check mark.

### 1i. Toasts (`Toast`, l.299-316; API core.js l.197-203)
- Container `div.toasts` (fixed, top `calc(var(--top-h) + 10px + var(--bars-h) + safe-area)`, right 16 px, width `min(440px, 100vw-32px)`, z 95, `pointer-events:none`).
- Each `div.toast[role=status]`: `span.ti` icon circle (`.good` green when tone good), `div.tm` message with `small` sub, action `button.btn.sm` (dismiss first, then run), dismiss `IconBtn` aria "Dismiss" (x), life bar `i.life` (`animationDuration = ms`, linear shrink).
- Auto dismiss: default `ms` 6500 (`W.toast` sets it when falsy). Ticks every 200 ms; pauses while hovered or when `document.hidden`.
- Max 3 visible (`slice(-3)`, core.js l.200). Enter `toastIn .32s var(--ease-drawer)`.
- Undo toasts from `W.act(label, fn, {toast:{msg, sub, icon, tone, ms, go:{label,run}, undo:false}})` (core.js l.96-99): actions = optional "View"/go label + "Undo" (kbd "Ctrl Z"). Undo runs `W.undo` only if no newer change exists (`S.undo.length === depth`), else toast "Newer changes came after this one".
- `W.undo` toast "Undone" (sub = label, undo icon, action "Redo" kbd "Ctrl Shift Z", 4000 ms); `W.redo` toast "Redone" (3000 ms).
- Toasts are cleared when prototype mode is switched (review_fixes #6, see §6).

### 1j. Trays (`Tray`, l.142-162; CSS `.tray` l.418)
- Fixed under top bar (top `calc(var(--top-h)+6px)`, right 12 px, width `min(380px,100vw-24px)`, z 60, `dropIn .14s`, max-height 70 vh, scrolls). Not a barrier.
- Closes on outside `mousedown` (ignored inside `.top`, so the top-bar buttons toggle), Esc (global, §1k), or toggling the same button.
- Jobs tray (`role=dialog aria "Background jobs"`): heading "Running in the background", hint "Keep working; you'll get a note when each finishes."; one `.tray-i` per job (icon scan for search, `at` for contacts, `checkc` when done) with label, small "Keyword n of total" or "Checking About pages, descriptions and linked sites" or "Finished", and a `W.Meter` while running. Empty: "Nothing of yours is running." Teammate search row from `d.mateRun` ("X is searching · keyword c of t"). Footer ghost "Open the search console" (`W.go find/search` and close).
- Notifications tray (`aria "Notifications"`): heading, ghost "Mark all read" (`W.act` with `log:false`), gear `IconBtn` "Choose what reaches the bell" (opens settings notifications/notify). List of `W.notifShown` items as `button.tray-i` (`.unread` class and a blue dot when unread). Click marks read, sets `u.todaySel` if `go.item`, closes tray, navigates `go.s/go.tab`. Empty: "Nothing new.".

### 1k. Keys (global, app.js l.349-388)
- `useGlobalKeys` registers at App mount, so it is the bottom of the key stack (§2): Ctrl K toggle palette; "/" palette; "?" shortcuts; Ctrl Z undo; Ctrl Shift Z redo; Ctrl Y redo; Alt ← / Alt → back / forward; "[" toggle rail; Ctrl , (settings: current tab if already on settings, else profile); `g` arms the go-prefix; Escape closes tray first, then the Why layer (returns true only then).
- Go-prefix (App `onKey`, l.377-382): after `g`, within 1200 ms, a letter `t f r c d i x m p s` navigates (`GO` map l.365). Not when a modifier is held, typing, `W.lettersOff`, or a barrier is open.
- `onKey` then calls `W.dispatchKey` (core.js l.180-194).
- `document` keydown listener and `setInterval(W.tickJobs, 900)` run in the same effect (l.377-388).
- Hash: on every route change `history.replaceState(null,"","#"+route.s)`; `lastTab` remembered per screen (l.389).

### 1l. Boot (l.422-437)
- `W.pref.boot()` (applies data-theme, density, size, motion from localStorage; sets `W.lettersOff`); `W.PRISTINE = clone(W.seed())`; `W.NOW0 = W.NOW`.
- Start screen = location hash if a valid screen other than `rec`, else `today`. Tab = first tab.
- `W.init(clone(PRISTINE), ui)` with ui: `route, hist:[route], histI:0, peek:null, toasts:[], menu:null, jobs:[], saving:false, savedAt: now-40000, palette, shortcuts, tray:null, why:false, whyOpen:null, railMin (pref rail==="min"), railOpen:false, handoff:null, proto:{on:false}, profile:{}, setFlash:null, todaySel:null, todayIdx:0, todayScope:"me", todayFilter:"all", collapsed:{}, focus:false, wrap:false, recent:[], lastTab:{}, viewers:{d5:"u2",c13:"u3",b5:"u2"}`.
- Then `W.loadProfile()`; `if wb-proto === "1"` → `W.setProto(true, true)`; render `<App/>` with `ReactDOM.createRoot` (no StrictMode).

## 2. The runtime: `js/core.js` (316 lines)

### 2a. htm and icons
- `W.h` wraps `React.createElement` mapping `class`→`className`, `for`→`htmlFor` (l.12-25). `W.html = htm.bind(h)` (l.26). Hooks re-exported on `W.useState|useEffect|useRef|useMemo|useCallback|useLayoutEffect|Fragment` (l.9).
- `W.Icon` (l.306-315): draws `<svg class="ic" viewBox="0 0 24 24">` with `stroke: currentColor; fill:none; stroke-width:1.8; round caps` (CSS `.ic`, index.html l.83). Default size 16. `aria-hidden="true"` unless `title` (then `role=img` + `<title>`). Path data strings are SVG `d`; entries `"c:x,y,r"` draw circle, `"r:x,y,w,h,rx"` draw rect.
- Icon set `W.ICONS` (l.223-304), one stroke weight, authored SVG. Icon names used by the frame: `sun scan send pen box chart wrench users map gear user` (screen icons), `sidebar layers bell flask chat list x external eye keyboard moon gauge chevU chevD chevR chevL search alert check checkc info forward copy pause play undo redo target coffee at flag rows wallet reply unlock sparkle mail clock arrowL arrowR`. Others exist (e.g. `dot` fallback for unknown name, `shield`, `lock`, `timer`).

### 2b. Time and formatting
- Fixed clock: `W.NOW = 2026-10-19 10:24` local (l.31); `W.now()` = NOW + elapsed since load (l.33). `W.at(dayOffset,h,m)`, `W.startOfDay`, `W.dayDiff`.
- Text helpers: `W.fmtDate` ("Mon 19 Oct"), `fmtShort`, `fmtTime` (HH:MM), `fmtDay` (Today/Tomorrow/Yesterday), `dueText`, `dueTone` (late/soon), `W.ago` ("just now", "n min ago", "n h ago", "yesterday", "n days ago"), `W.dur(min)` ("2 h 30 min").
- Numbers: `fmtK` (1.2K, 3M), `money` ("$1,200" or "$ hidden" when `!canSeeMoney`), `maskMoney`, `pct`, `plural(n, one, many)`, `cx(...)` class join, `hash` (FNV-1a), `initials`, `avColor(seed)` (10-colour palette), `uid(prefix)`, `clamp`, `sum`, `by`.

### 2c. Store (l.65-124)
- State `S.state = {data, ui}`. `data` = business (undoable). `ui` = where you are (not undoable). Subscribers via `W.subscribe`; `W.useApp()` = `useSyncExternalStore` over `S.ver` (l.74). `App` calls `W.useApp()`, so every `emit` re-renders the whole frame tree (note for speed rule, plan.js:214).
- `W.act(label, fn(data, ui), opts)` (l.85-103): deep-clones the whole `data` (structuredClone) as an undo snapshot; if `fn` returns `false` nothing is recorded. Pushes `{label, data:before, at}` to `S.undo` (cap 80, shift oldest), clears `S.redo`, prepends an activity-log entry to `data.log` unless `opts.log === false` (`who: data.me`, `text: label`, `ref: opts.ref`). Sets `ui.saving` (debounced `saving()` l.80-84: busy for 700 ms, then `savedAt = now`). Returns `fn`'s return value.
- `W.undo` (l.104-110): pops `S.undo`, pushes current data to `S.redo`, restores, toast "Undone". `W.redo` (l.111-117): mirror, toast "Redone".
- `W.ui(fn(ui, data))` (l.118): UI-only change, no snapshot.
- `W.bg(fn(data))` (l.119-124): applies `fn` to current data AND to every undo and redo snapshot, so a background job's result survives undoing an older action. Used by `tickJobs` and search runs.
- Hard-coded: `S.undo` cap 80 (l.91).

### 2d. Navigation (l.126-147)
- Route `{s, tab, rec?:{t,id}, from?}`. `W.go(s, tab, extra)` (l.130-141): de-duplicates identical current route; truncates forward history; pushes; sets `route`; clears `menu`; clears `peek` unless `extra.keepPeek`; sets `railOpen=false`; scrolls `.content` to top.
- `W.setTab(tab)` = `W.go` on same screen (note: also clears peek). `W.back`/`W.fwd` move `histI`, set `route`, clear peek (l.143-144). Hist list has no cap (unclear: no cap in prototype).
- `W.peek(t,id,list)` (l.146): opens peek, `list` = ids in on-screen order for Alt ↑/↓; pushes to `u.recent` (max 8, de-duplicated).
- `W.openRec(t,id)` (l.148): `W.go("rec", null, {rec, from: currentScreen})` and records recent.
- `W.screens` registry: each screen file sets `W.screens[key] = fn`.

### 2e. Keys: stack, barriers, typing (l.150-194)
- Module-level `keyStack` of `{get, barrier}` entries. `W.useKeys(map, active=true, {barrier})` (l.154-164): pushes an entry in an effect when `active !== false`; removes on cleanup. Map values are handlers `fn(e)`; `ref.current` keeps latest map.
- `W.dispatchKey(e)` (l.180-194):
  1. Ignore if `e.defaultPrevented` (a field or popup already handled it).
  2. `name = W.keyName(e)`: lowercased key, `mod+` for Ctrl or Meta, `alt+`, `shift+` only for multi-char keys (so Shift+letter is the letter), space → `space`. Examples: `mod+k`, `alt+arrowleft`, `escape`, `?`, `[`.
  3. `plain` = not `mod+`/`alt+`, not `escape`, not F-keys. If target is a field (INPUT, TEXTAREA, SELECT, contentEditable) and `plain`, return false. NOTE: this also blocks arrows and Enter inside fields, so fields must handle them.
  4. If `W.lettersOff` and name length 1, return false (Settings › Keyboard). This blocks `?`, `[`, `/`, `g`, `c`, `j`, etc., but not Esc, arrows, Enter, Ctrl/Alt keys.
  5. Walk `keyStack` from newest to oldest. If a handler exists and returns not `false`: `preventDefault`, `W.kbdQuiet()`, return true. If the entry is a barrier and did not handle it, return false (stop).
- `W.kbdQuiet()` (l.168): sets `html[data-input="kbd"]` for 400 ms, which zeroes all animation and transition durations (index.html l.606 and tokens.css l.187).
- `W.keyBarrier()` (l.165): true if any barrier is mounted (used by the go-prefix).
- Setting: `W.pref.set("letters","off")` sets `W.lettersOff` (settings.js l.20).

### 2f. Menus (l.206-212)
- `W.menu(e, items, {align})` anchors to `e.currentTarget` rect; `W.closeMenu()`. Details in §1h.

### 2g. Other helpers
- `W.copy(text, what)` (l.217-220): clipboard write, toast "Copied …" (2500 ms, icon copy).
- `W.css(text)` appends a `<style>` (l.215) so screens add styles; prototype used this, the port should use CSS modules or the tokens file.
- `W.clamp`, `W.by`, `W.sum`.

## 3. Settings shell: `js/settings.js` (228 lines)

- Preferences (device scope, localStorage via `W.LS`, applied as `html[data-*]`): `W.pref.get/set` (l.12-25). Keys and effects: `wb-theme` (`data-theme` light|dark, empty = system), `wb-density` (`data-density=compact`), `wb-size` (`data-size=large`), `wb-motion` (`data-motion=reduce`), `wb-letters` (`W.lettersOff`), `wb-rail` (`u.railMin`). Also `wb-name`, `wb-proto` ("1"), `wb-proto-scn`, `wb-comments`, `wb-welcomed`. None of the device prefs go through `W.act`, so none are undoable.
- `W.morning()` (l.26): snooze morning hour from `d.settings.morning` (default 9).
- Notification kinds (l.29-31): reply, money, handoff, search (+ problem, always shown). Kind from `n.icon` (reply → reply, wallet/unlock → money, forward → handoff, alert → problem, else search). `W.notifShown(n)` = problem or `settings.notify[kind] !== false`.
- Sections (l.34-46), shape `{k, g (group), name, icon, sub, kw (search words), owner?, realOwner?}`:
  - You: profile (user, "Your name and role"), appearance (moon), day (sun, "Your day"), keyboard (keyboard), notifications (bell).
  - Agency: search ("Search rules", scan), facts ("Agency facts", sliders, owner), writing ("Writing rules", pen), team ("Team and money", users, owner), connections ("Connections", gauge, owner).
  - Owner tools: prototype ("Prototype mode", flask, owner, realOwner).
- Row registry `ROWS` (l.51-59) `[section, id, label, words]`: profile name/role; appearance theme, density, size, motion, rail; day budget, morning, welcome; keyboard letters; notifications notify; team vamoney; prototype proto, scenario, viewas, comments.
- Scope labels `SCOPE` (l.48): `you` → "Just you", `device` → "This computer", `team` → "Whole team" (shown as `.set-scope` on `Row`).
- Saved-in-place: `flash(id)` (l.69-70) sets `u.setFlash={id, at}` for 1700 ms; the matching `Row` shows `.set-saved` "Saved" with check icon.
- Layout (`W.screens.settings`, l.203-227): `Page` with `PageHead` title "Settings", sub "How the Workbench behaves for you, on this computer and for the whole team. Changes apply at once; Ctrl Z undoes them.", right slot `label.set-search` (search icon, `input` aria "Find a setting", placeholder "Find a setting"; Esc clears and blurs). `div.set` grid 260 px nav + pane. Nav `nav.card.tight.set-nav[aria-label="Settings sections"]` with `.bucket`/`.bucket-h` per group (You, Agency, Owner tools); each `button.li` with `aria-current=page` on current; `span.cnt.hot` "On" next to Prototype when on. Pane `.card.set-pane` with `.tb-ic` icon, `h2`, note (`NOTE` l.188 for search, facts, writing, connections), then the section view.
- Keys: `mod+f` focuses the settings search (l.206).
- Search (`Results` l.190-198): query lowercased substring. Rows match `label + words + section name`; sections match `name + sub + kw`; both filtered by `visible()` and `rowShown()`. Row click: clear query, `W.openSetting(section,row)` (l.62-65: go to section, after 60 ms scroll row into view, `.hl` highlight animation `setHl 1.8s`, focus first input/button). Section click: go to section. No match: Empty "No setting matches “q”" with hint "Try a plainer word: dark, hours, keys, money, Gmail."
- Visibility: `visible(s)` hides `realOwner` sections unless the signed-in account is owner (`W.accountIsOwner`). Non-owner viewing `owner:true` sections sees `Locked` card "Only the owner changes {what}" (l.81).
- Section contents:
  - Profile: hero (`W.Av` xl, name, role), name input (aria "Your name"; Enter saves, Esc cancels, blur saves; sets `wb-name` via `W.setMyName`), role row with Tag and "Roles in Team" button.
  - Appearance: Theme (device; Seg: System/Light/Dark), Density (device; Comfortable/Compact), Text size (device; Normal/Large), Motion (device; Follow my computer/Reduce), Sidebar (device; Expanded/Collapsed).
  - Your day: working day length (you; `W.act` budget 120/180/240/300/360, undoable), snoozed-items morning (you; 08/09/10 via `W.act`), Welcome note (device; "Show it again" clears `wb-welcomed`).
  - Keyboard: Single-letter shortcuts switch (device, `W.pref.set("letters")`) and the shortcut groups from `W.SHORTCUTS`.
  - Notifications: four switches (`W.act` with `log:false`) plus a disabled "Problems" switch that is always on.
  - Team and money: `vamoney` (team; Hidden/Visible via `W.A.setVaMoney`; "Not decided yet, so it stays hidden.").
  - Prototype (owner): explainer (`.proto-how`, `.ph-flow`, `.ph-box`, `.ph-split`, `.ph-list`), `proto` switch (`W.setProto`), scenarios `.scn-grid`/`.scn` (`W.setScenario`), See the app as (`W.Seg`), Comments (Start commenting C, All comments, Copy open for Claude, pin and show-done switches).
  - Agency tools (search, facts, writing, connections) render `W.SearchRules`, `W.FactsTool`, `W.RulesTool`, `W.HealthTool` (defined in find.js:121 and more.js:741). Real content for them comes from those features.
- Layout CSS: `.set` 2-col grid 260 px, collapses to 1 col at 900 px; `.set-nav` becomes a horizontal chip row at ≤900 (`.set-nav .li small/.tb-ic` hidden). `.set-row` 2-col, 1 col at ≤900. `.scn-grid` 1 col at ≤560. Row `.set-t` `b` + `p`, `.set-c` control column. `.switch` (38×22, `role=switch`, `aria-checked`) and `.switch i` knob.
- Unclear: subtitle says "Ctrl Z undoes them", but only data settings (budget, morning, notifications) use `W.act`. Device and profile prefs are not undoable.

## 4. Design tokens and frame CSS in `index.html` (648 lines; CSS l.6-628)

### 4a. Tokens already in `packages/ui/src/tokens.css`
- Colours (light l.12-16; dark via `@media (prefers-color-scheme: dark)` l.27-38 and `:root[data-theme="dark"]` l.39-48): `--bg --panel --sunk --sunk-2 --line --line-2 --ink --ink-2 --muted --faint --accent --accent-ink --accent-soft --accent-line --accent-strong`, phase hues `--find --reach --close --deliver --money` (+ `-soft`), status `--good --warn --crit` (+ `-soft`). Accent light `#0079ba`, dark `#4cb6ef`.
- Shadows `--shadow-1|2|3`, `--scrim` (light rgba(9,25,41,.32), dark rgba(0,0,0,.5)).
- Fonts `--f-ui: "Readex Pro","Segoe UI",system-ui…`, `--f-mono: "IBM Plex Mono",ui-monospace,Consolas…`. Readex Pro weights 300-700, IBM Plex Mono 400/500/600 (Google Fonts link l.5).
- Radii `--r-s 6px`, `--r-m 9px`, `--r-l 13px`.
- Frame sizes `--rail-w 236px`, `--top-h 54px`, `--peek-w 480px` (l.22). Rail collapsed 64px is a class `.app.rail-min{--rail-w:64px}` (l.88), not a token.
- Density comfortable `--pad 20px --gap 14px --row-h 42px --fs 13.5px`; compact (`data-density=compact`) `--pad 14px --gap 10px --row-h 34px --fs 12.8px` (l.49). Large text: `data-size=large` `--fs 15px`, large+compact `14.2px` (l.609-610).
- Motion curves `--ease-out: cubic-bezier(.23,1,.32,1)`, `--ease-drawer: cubic-bezier(.32,.72,0,1)` (l.24). Durations are not tokens.
- Reduce motion: `data-motion="reduce"` and `prefers-reduced-motion` set all animation and transition to 0.01 ms (l.611-612). Keyboard quiet: `data-input="kbd"` zeroes durations (l.605-606).
- Focus ring (global, l.63): `:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:4px}`. Inputs use `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-soft)` on focus (l.161).
- Selection `::selection` accent-soft (l.64). Scrollbars 10 px, thumb `--line-2` (l.66).
- Body `overflow:hidden`; `.content` is the only scroller (l.133).

### 4b. Frame rules NOT yet tokens (component CSS still to port)
- Rail: `.app` grid `var(--rail-w) minmax(0,1fr)` with transition `grid-template-columns .2s var(--ease-drawer)` (l.87); `.rail` (l.89-90, padding 10 px, `overflow-y:auto`); `.brand`, `.logo` conic gradient (l.91-95); `.nav-h` (l.96); `.nav` (l.97-102, min-height 38 px, hover `--sunk`, current = `color-mix(hue 11%, panel)`, `.nic` 26×26); `.nl` (l.103-105); `.cnt` (l.106-108, mono 11px, `.hot`, `.bump` pop .45s); collapsed rules (l.109-112: hide `.nl`, `.cnt`, `.nav-h`, `.brand div`, `.me .nl`; `.cnt-dot` shown); `.rail-foot` (l.498), `.me` (l.499-507), `.me-chev` (504), `.rail-tog` uses `.iconbtn`.
- Top bar: `.main` grid rows `var(--top-h) auto minmax(0,1fr)` (l.115); `.top` (l.116-117, `z-index:30`, panel bg, bottom line); `.crumbs` (l.118-119); `.cmdk` (l.120-122, `flex:0 1 380px`, `margin-inline:auto`, height 34); `.iconbtn` (l.123-127, 34×34; `[aria-pressed=true]` accent-soft; `:disabled` opacity .4; `.badge` crit 10px mono); `.save` (l.128-130, `.busy i` warn + pulse 1s).
- Peek: `.body` (l.131), `.body.has-peek` (l.132), `.peek` (l.262, slideIn .24s), `.peek-h` (l.263), `.peek-b` (l.264), narrow overlay (l.265 at max-width 1180).
- Overlays: `.scrim` (l.390, fixed, `--scrim`, z 80, fadeIn .15s); `.pal` (l.391, top `calc(70px + safe-area)`, width `min(640px, 100vw-32px)`, z 81, max-height `min(560px, 100vh-120px)`, `dropIn .16s`); `.pal-in` (l.392), `.pal-in input` (l.393), `.pal-list` (l.394), `.pal-g` (l.395), `.pal-i` (l.396-398, `[aria-selected=true]` accent-soft), `.pal-f` (l.399); `.modal` (l.400, centred, `width:min(var(--mw,620px), 100vw-32px)`, max-height `100vh-64px`, radius 18 px, z 81, `modalIn .18s`); `.tip` (l.425, fixed, z 99, ink bg, 12 px, max-width 280, fadeIn .1s; `.tip .kbd` l.426).
- Menus: `.menu` (l.401, fixed z 85, radius 12, `dropIn .12s`), `.menu button` (l.402-404), hover/focus (l.403), `hr` (l.405), `.mh` (l.406), `.menu .mwho` (l.509-510), `.menu .mcheck` (l.511).
- Toasts: `.toasts` (l.407, top `calc(var(--top-h)+10px+var(--bars-h)+safe-area)`, z 95, width `min(440px,100vw-32px)`); `.toast` (l.408, ink bg, panel text, radius 13, `toastIn .32s`), `.ti` (l.409-411), `.tm` (l.412-413), `.toast .btn` (l.414-415), `.life` (l.416 bottom bar, `life` keyframe), hover pauses (l.417).
- Trays: `.tray` (l.418, z 60, `dropIn .14s`, max-height 70 vh), `.tray-i` (l.419-422, `.unread` accent 6 %), `.ring-prog` (l.424).
- Bars: `.bars` (l.515), `.sysbar` (l.516-517), `.sysbar.crit` (l.518, crit-soft), `.sysbar.info` (l.519, accent-soft), `.sys-more` (l.520), `.linkbtn` (l.512).
- Shared pieces: `.btn` (l.140-158), `.kbd` (l.158), `.tag` (l.166), `.av` (l.182-187; size classes unchecked), `.meter` (l.197), `.li` (l.213), `.inp`/`.ta` (l.159-161), `.empty` (l.200), `.callout` (l.203).
- Settings CSS: l.564-594 (`.set`, `.set-nav`, `.set-row`, `.set-search` l.576-578, `.set-saved` l.575, `.switch` l.580-581, `.set-row.hl` l.569-570, `.scn` l.533, `.proto-how` around l.524-531, `.proto-chip` l.523).
- Fonts: `.mono` (l.68), `.kbd`, `.cnt`, `.badge`, `.tip .kbd` use IBM Plex Mono. Everything else Readex Pro.
- `.flip` RTL mirror (l.82) and `[dir="rtl"]` overrides for rail, top, peek, toasts (l.90, 117, 481, 487, 619). Port keeps these.

### 4c. Z-index layers (prototype values)
| z | element |
|---|---|
| 99 | `.tip` |
| 95 | `.toasts` |
| 86 | `.rail` at ≤760 (drawer) |
| 85 | `.menu`; inline scrim for narrow rail drawer |
| 81 | `.pal`, `.modal` |
| 80 | `.scrim` |
| 60 | `.tray` |
| 30 | `.top` |
| 25 | `.peek` at ≤1180 (overlay) |
| 90 | `body::before` safe-area strip |
Why and comment layers (68-84) are not frame; they sit between the scrim and the tray.

### 4d. Breakpoints
- ≤1300: `.why-side` hidden; ≥1301 `.app.why-on .main` margin-right 324 px (l.436-437). Comment panel ≥1301 margin 354 px (l.555).
- ≤1180: `.body.has-peek` becomes one column; `.peek` overlays (l.265).
- ≤1100 `.dayband` 1 col; ≤980 `.split` 1 col (screen CSS).
- ≤900: `.grid2/.grid3` 1 col (l.81); settings nav becomes chip row, `.set` 1 col (l.586-593).
- ≤760 (phone; the 400 px check falls here): `.app` 1 col (l.617); `.rail` becomes fixed drawer 270 px, z 86, `translateX(-105%)`, `.app.rail-open .rail` slides in (l.618-620); `.only-narrow` shown (`display:grid`); `.hide-narrow` hidden (`display:none !important`) (l.622); `.cmdk` flex 1 1 auto, its `.kbd` hidden (l.623-624); `.page` padding 14 px (l.625).
- ≤560: `.scn-grid` and `.fr-steps` 1 col (l.594, 600).
- No 400 px rule exists; 400 px is tested as a viewport width (test/review_fixes.py uses 400; smoke.py `--wide 400`).

### 4e. Motion inventory (keyframes l.479-496)
- `fadeIn` (scrim .15s ease-out, tip .1s, set-saved .15s), `toastIn` (.32s drawer; RTL uses fadeIn), `modalIn` (.18s, scale .98), `dropIn` (menu .12s ease-out, palette .16s, tray .14s, comment pop), `slideIn` (peek .24s drawer, from translateX 24 px), `pop` (.45s on count bump, done tick), `pulse` (save busy 1 s), `life` (toast bar, linear, duration = toast ms), `spin` (`.spin`), `shimmer`, `doneFlash`, `flashT`, `setHl` (1.8 s settings highlight), `ringPulse`.
- Rail width transition .2s (l.87); rail drawer slide .2s drawer (l.618); `.meter>i` width .4s (l.198); `.switch` .16s (l.580-581); `.btn`/`.nav`/`.iconbtn` background .12 s.
- Rule: keyboard actions never animate (zero-duration rule on `data-input="kbd"`, 400 ms after a handled key, l.605-606). Palette inline `animation:none` on `.pal` (app.js l.231).

## 5. Design notes and WHY in `js/plan.js` (frame, keys, undo, toasts, palette)

- Layer: `W.WhyLayer` (plan.js l.373) pins notes to elements; toggled by the map button in the top bar; Esc closes (app.js l.362). Not the frame itself. Opening the comment mode clears `why` (comments.js l.214).
- Principles (plan.js l.43-50):
  - p3 routine work as a queue with keys, judgement calls open the full record.
  - p4 "Never lose your place": records open beside the list, back and forward work across screens, tabs remembered.
  - p5 every action answers four questions (did it work, where did it go, what next, how to undo); toasts say all four; Undo and redo for every change; Ctrl Z.
  - p6 gates only where mistakes are expensive; everything else undoable instead of confirmed.
  - p7 hands on the keyboard: every frequent action has a key, shown where it applies; single-letter keys never fire while typing; Ctrl K finds anything; `?` shows them all.
  - p10 fast and calm: every click answers within 100 ms; slow work in the background with visible progress; "No animation on keyboard actions"; nothing moves unless it means something.
- Coverage rows (plan.js l.112-145, "in" = built in prototype): Command palette, Shortcut sheet, G then a letter, Records beside the list with Alt ↑/↓, Back and forward, Undo and redo plus Undo on every toast, Account via picture, Settings apply at once and say Saved, Single-letter keys off setting, Collapsible sidebar `[`, Recent records in palette.
- Speed rules (plan.js l.211-216, function `Speed` l.523): every click under 100 ms; lists draw only what is on screen; one query per screen; "The frame does not rebuild when presence or sync ticks"; screens you leave stop working; DB work off the drawing thread. The prototype breaks the frame rule: `App` re-renders on every `W.emit`.
- Feature notes (plan.js l.310-364): `rail` (The rail is the IMA framework: Today then Find, Reach, Close, Deliver with counts), `cmdk` (one box to find anything; runs commands like Start focus or Resume the search), `focus` (hides list, shows elapsed time; J and K move, Esc leaves), `peek` (slides in on the right; Alt ↑/↓ walks; Full page opens on its own), `jobs` (background work with a progress ring; you get a note), `account` (picture opens account, Settings, appearance, shortcuts, bell, connections; collapsed keeps the picture).

## 6. Tests that pin frame behaviour (`test/*.py`, Playwright, Python)

Run commands (design/workbench-prototype/README.md): `python test/smoke.py <screens>`, `python test/flows.py`, `python test/find_flow.py`, `python test/proto_flow.py`, `python test/review_fixes.py`. Each prints "no errors" and "N failed"; they load React from `vendor/`. flows.py and smoke.py print values only (no asserts); proto_flow.py and review_fixes.py use `check()` and count FAILs.

Palette and key stack
- flows.py l.40-44: Ctrl K, type "agent", Enter → peek opens; Esc closes palette/peek (printed, not asserted).
- review_fixes #2 (l.43-46): peek open; Ctrl K then Esc → palette closes and peek stays open.
- review_fixes #3 (l.33-41): comment mode on, J does nothing (barrier); Esc leaves comment mode; "?" opens shortcuts, then J and F do nothing behind it; Esc closes shortcuts.
- proto_flow l.62-64: Ctrl K, type "text size" → `.pal-i` "Text size" listed (settings rows in palette); Esc.
- review_fixes #22 (l.58-63): a toast button works while comment mode is on (`.toast button` "Act" runs and no `.cmt-pop` opens).

Peek and Esc order
- review_fixes #4 (l.47-51): comment card open on top of a peek; first Esc closes the card (`W.U().proto.open` cleared) and the peek stays; second Esc closes peek.
- flows.py l.44-48: Esc, then F starts focus and Esc leaves it (printed only).
- review_fixes #2: see above.

Undo and toasts
- flows.py l.29-31: Ctrl+Enter sends a draft → toast; Ctrl+Z → "Undone" toast (printed only).
- review_fixes #9 (l.71-79): after a search run finishes, undo does not bring back a "running" run without a job.
- review_fixes #6 (l.103-109): switching prototype mode clears toasts (no `.toast` with "rejected"), live data keeps its own change.
- review_fixes #8 (l.81-88): send from a signed-out mailbox is blocked; toast "Not sent" appears; "Send from …" action sends from a working mailbox.
- proto_flow l.156: prototype off leaves no proto chip, no pins and no `.sysbar`.

Menus
- proto_flow l.40-45: click `.me` → `.menu .mwho` count 1; click "Settings" in menu → route is settings.
- review_fixes: none for menus besides account menu above. Arrow focus movement and outside-click close are not tested (unclear).

Rail
- proto_flow l.32-38: unnamed owner sees "Add your name"; `[` collapses; `.me .nl` hidden and `.me` width ≤ rail width minus 12 px; `[` again expands.
- proto_flow l.49: name set in Settings shows in sidebar; l.50 avatar initials "MT".
- review_fixes #11 (l.115-121): top bar fits at 400 px with prototype mode on (no horizontal overflow of `.top`, nor document).

Settings search and account
- proto_flow l.58-61: settings search "snooze" → one `.li` "Snoozed items come back at"; click → route tab `day`.
- proto_flow l.53-55: theme button "Dark" applies `data-theme=dark` at once; `.set-saved` count 1.
- proto_flow l.161-165: at 400 px, settings sections (profile…connections) do not scroll the `.content` sideways.
- proto_flow l.44-45: account menu "Settings" opens route settings.

Prototype and view-as (frame bars)
- proto_flow l.70-72: switch Prototype on → `.proto-chip` count 1.
- proto_flow l.102: view-as VA → `.sysbar.info` count 1 ("a bar says whose view this is").
- proto_flow l.91-94: scenario "broke" → `.sysbar.crit` count 1; clicking `.sysbar .btn` clears the first problem.
- review_fixes #13 (l.100): owner still reaches prototype settings while viewing as VA.
- review_fixes #7 (l.90-98): VA sees no dollar amounts on any screen; items filter.

Smoke (smoke.py): every screen and tab loads; every enabled `#content button` is counted; no console errors. Run with `--dark` and `--wide 400`.

Gaps (no test in prototype): key barrier when palette open (Esc and arrows), menu arrow keys, go-prefix `g`+letter, Alt+←/→, `[` in narrow drawer, toast max 3, toast auto-dismiss, tooltip delays, Tray outside-click, `lettersOff` behaviour, `Ctrl ,`, `/` opens palette, `W.kbdQuiet` no-animation. The 3c acceptance wants these covered.

## 7. What the frame needs from data (stub these in 3c; the data layer is 3d)

Fixed clock and seed
- Clock: `W.NOW` 2026-10-19 10:24, advancing with real time (core.js l.31-33). Seed data: `W.seed()` (data.js l.289-297) with `me:"u1"`, `team`, `notifs`, `mail`, `runs`, `mateRun`, `day.budget 240`, `settings`.

Rail
- Today count `W.items("me").length` and planned `W.sum(items, est)` (engine.js l.135 `W.items(scope)`; Today items are built there).
- Pipeline counts `W.phaseCounts(items)` (engine.js l.192-200): find = count of creators with `stage==="new"` for each find item, plus one per contacts item; reach = replies, sends, followups items; close = close items; deliver = everything else.
- Account: `W.member(d.me)` (engine.js l.16-20) → `d.team` (data.js l.266-270: u1 You/Owner/online, u2 Sara, u3 Omar, u4 Lina away). `W.myName()` (proto.js l.37) reads `ui.profile.local` (localStorage `wb-name`) or `ui.profile.acct`. `W.loadProfile()` (proto.js l.26-35) tries `window.claude.use("user")` (a platform hook; unclear in Electron, so stub it as empty). Account avatar: `ui.profile.avatar` photo else initials (`W.Av`, ui.js l.21-36).

Top bar
- Jobs: `ui.jobs` array of `{id, kind:"search"|"contacts", label, progress, total, done, run?, ids?, sub?, doneAt?}`; `W.startJob` (engine.js l.473); `W.tickJobs` runs every 900 ms (engine.js l.474-500) and advances progress; finished jobs stay 6 s. Ring shows `progress/total`.
- Teammate search: `d.mateRun` (data.js l.241) `{by, at, cur, total, kws}`.
- Notifications: `d.notifs` (data.js l.248-254) `{id, at, icon, text, sub, go:{s,tab?,item?}, read}`; unread count uses `W.notifShown`.
- Save state: `ui.saving`, `ui.savedAt` (core.js l.79-84); stub with 700 ms busy then saved.
- Presence: `d.team` entries with `status` online/away.

Bars
- Problems: `W.problems()` (engine.js l.538-545): (a) mailboxes `d.mail[].status === "error"` → "{local part} is signed out of Gmail." with act "Sign in again" (`A.reconnectMailbox`); (b) `d.health.gemini === "offline"` → "The Gemini bridge is offline." act "Reconnect"; (c) `d.runs[].status === "failed"` → "Today's search stopped at keyword n." act "Open the search". Normal seed has none; the "broke" scenario (proto.js l.76) sets these.
- View-as: `d.me` plus `W.canSeeMoney()` (engine.js l.22) decides the VA bar text.

Prototype (only when on)
- `W.protoOn()` (proto.js l.53) from `ui.proto.on`; scenarios `W.SCENARIOS` (proto.js l.46-51: normal, first, later, broke); `ui.proto.scenario`, `ui.proto.mode`, `ui.proto.panel`; open comments count from `W.CM.list` (comments store, proto.js l.145).

Palette and peek
- Recent: `ui.recent` (≤8). Creators, brands, deals lists: `d.creators`, `d.brands`, `d.deals` with `W.STAGE_LABEL`, `W.DEAL_FLOW`, `W.dealName`, `W.money` (engine.js and data.js). `W.rec(ref)`, `W.refName(ref)` (engine.js l.24-26).
- Settings rows: `W.SETTINGS_ROWS` (settings.js l.60).

Stubs in 3c: if the data layer is not ready, provide the seed shape above as a static object and stub `items`, `phaseCounts`, `problems`, jobs tick. Keep `items` as the only counts source for the rail.

## 8. Existing app code to build on (one or two lines each)

- `apps/desktop/src/renderer/main.tsx` (21 lines): imports tokens and base CSS, `StrictMode`, `createRoot`, sets title; keep this entry.
- `apps/desktop/src/renderer/app.tsx` (10 lines): placeholder; replace with the frame (the App component).
- `apps/desktop/src/renderer/strings.ts` (4 lines): the only string table; every frame label goes here.
- `apps/desktop/src/renderer/base.css` (36 lines): reset and body; `.frame` and `.frame-title` placeholder classes to remove.
- `apps/desktop/src/renderer/env.d.ts` (8 lines): `window.gratovo` bridge type; the frame calls only the bridge, never Node.
- `apps/desktop/src/renderer/index.html` (13 lines): `#root`, module script, empty `<title>`.
- `packages/ui/src/tokens.css` (213 lines): all tokens (see §4a). Missing from it: durations, z-index, breakpoints, all component CSS in §4b, `--bars-h` (set at runtime), `--mw` (per modal inline).
- `packages/ui/src/tokens.test.ts`: compares tokens with the prototype; extend it when tokens change.
- `apps/desktop/e2e/fixtures.ts` (56 lines): Electron fixture; `page` waits for `app://gratovo/index.html`. Use it for palette, peek, undo, menus, Esc order, key barriers (Windows only; CI runs it).
- `docs/handoff.md` "Next: step 3c" (l.39-50): the 8-point 3c list (tokens, fonts as files, hash routes, frame, keyboard in `packages/core` with unit tests, settings shell, data via `window.gratovo.invoke`, Playwright tests).

## 9. Unclear and open points (for the planner)

1. Esc order between tray and peek (inferred from stack order: peek registers later, so it wins) is not tested in the prototype.
2. The comment-mode barrier (comments.js l.251-252) registers with `active=true`; unclear whether it is mounted only while comment mode is on. Check comments.js around l.230-260 before porting.
3. Settings subtitle says Ctrl Z undoes changes; only data settings are undoable. Decide in 3c.
4. The prototype's `W.act` clones the whole data object for each action (perf: plan speed rules).
5. Hist list has no cap (back/forward length).
6. Narrow rail drawer has no Esc or focus trap in the prototype (scrim click closes it).
7. `W.lettersOff` also disables `?`, `[`, `/` and `g`, not only letters. Keep that or make it explicit.
8. Plain-key rule blocks arrows and Enter inside fields (dispatchKey l.183-185). The port must let fields own these keys.
9. Focus mode is a Today feature (today.js l.219-248, `.focusbar` index.html l.383), not in app.js. Port it with Today, not the frame; only Start focus (palette) and F set it.
10. `window.claude.use("user")` account hook (proto.js l.19-35) has no Electron equivalent here; account name comes from local setting only, unless the bridge offers one.

## 10. Step 3c-3: what the settings shell needs

Read-only recon. Prototype refs: `design/workbench-prototype/index.html` (CSS), `js/settings.js`, `js/ui.js`, `js/app.js`, `js/proto.js`, `js/data.js`. App refs under `apps/desktop/src/renderer/`. 

### 10.1 CSS the settings screen uses (prototype l.n = index.html)

Ported (already in `packages/ui/src` or `app/frame.css`):
- `.grid2` (l.78, 81): ported `packages/ui/src/base.css:164,179` (900 px rule included).
- `.cnt`, `.cnt.hot`: ported `frame.css:137,148`.
- `.page` (l.134, 625): ported `frame.css:278,457`.
- `.inp` (l.159-162): ported `controls.css:155-186`.
- `.tag` and variants (l.166-170): ported `controls.css:203-245`.
- `.seg`, `.seg button`, `[aria-pressed]` (l.175-177): ported `controls.css:272-300`.
- `.card`, `.card.tight` (l.188-190): ported `controls.css:382-396`; `.card-h` at 400.
- `.empty`, `.ei`, `b` (l.200-202): ported `controls.css:464-486`.
- `.li`, `.li .lt`, `.li .lt b/small` (l.213-218): ported `controls.css:542-590`.
- `.linkbtn` (l.512): ported `controls.css:600`.
- Utilities `.row`, `.col`, `.col.tight`, `.col.t2`, `.grow`, `.ell`, `.small`, `.tiny`, `.top` (l.70-77, 116): ported `base.css:115-158`, `frame.css:186`.

NOT ported (prototype line numbers):
- `.bucket`, `.bucket-h`, `.bucket-h .bi/.m` (l.222-226): nav groups. Not in any ported file.
- `.set` grid 260px/1fr (l.564); `.set-nav` (l.565-566); `.set-pane` (l.567); `.set-row` (l.568); `.set-row.hl` (l.569) and `@keyframes setHl` (l.570).
- `.set-t`, `.set-t b`, `.set-t p` (l.571-572); `.set-c` (l.573); `.set-scope` (l.574); `.set-saved` (l.575).
- `.set-search` and `:focus-within` / input (l.576-578); `.set-hero` (l.579).
- `.switch`, `.switch i`, checked and RTL and disabled states (l.580-585).
- `@media (max-width:900px)` settings block (l.586-592): `.set` one column, nav becomes a row of chips, `.set-row` one column. Ported base.css:179 only has the grid2 part.
- `@media (max-width:560px)` `.scn-grid` one column (l.594).
- `.tb-ic` icon tile (used in nav and search results): defined in JS at `js/more.js:60-61`, not in index.html, not ported.
- Prototype section also uses `.scn`, `.scn-grid`, `.proto-how`, `.ph-flow`, `.ph-split`, `.ph-box`, `.ph-list` (l.525-537), not ported.
- Mismatch: prototype nav uses `aria-current="page"` (`settings.js:216`, css l.566). Ported `.li` active rule is `[aria-current="true"]` only (`controls.css:561`). The active nav item would not highlight unless the port adds the `"page"` case.
- `.hl` on `.set-row` is set by `W.openSetting` via classList (`settings.js:64`).

### 10.2 Components (`js/ui.js` and settings.js)

- `W.Btn` (ui.js:7-11): `button.btn` with kind, size, icon, kbd, caret, tip, disabled. Ported as `Btn` (`packages/ui/src/btn.tsx:26`, exported in `index.ts`). Check prop names against `BtnProps` (kind is a string; size only "sm").
- `W.Tag` (ui.js:18-20): `span.tag` with tone (good/warn/crit/info/line), hue (adds `ph`), icon, children. NOT in packages/ui (no tag.tsx). Needs a port.
- `W.Av` (ui.js:21-29): avatar with id/name, size (s/l/xl), sq, status dot, tip. Owner's own photo or initials; reads `W.myName()` and `profile.avatar`. Ported as `Avatar` (`avatar-view.tsx`, exported). Owner logic needs a port.
- `W.Empty` (ui.js:57-59): `div.empty` with icon (default checkc), title, children as `p.hint`, action. Ported as `Empty` (`empty.tsx:18`).
- `W.PageHead` (ui.js:63-68): title, sub, hue, right. Ported as `PageHead` (`page-head.tsx:14`). Settings passes a search box in `right` (settings.js:212).
- `W.Seg` (ui.js:52-56): `div.seg role="group"` with aria-label; opts as `[value, label, icon?, tip?]`; onPick. NOT in packages/ui. Needs a port.
- `W.Icon`: ported as `Icon` (`icon.tsx:15`).
- Settings-local (settings.js, not in ui.js): `Row` (l.71-77: `div.set-row#set-<id>`, `.set-t` label/desc/scope/saved, `.set-c` children); `Switch` (l.78-80: `button role="switch" aria-checked`, aria-label, disabled); `Locked` (l.81: `.card.tight` + Empty with lock icon).
- Also used: `W.Fragment`, `W.useState`, `W.useKeys` (mod+f focuses search, settings.js:206), `W.act`, `W.go`.

### 10.3 Palette (`js/app.js` l.189-241)

- Settings rows in the palette: `app.js:209`, group label "Settings". Source is `W.SETTINGS_ROWS` (settings.js:51-60). Each item: icon = section icon, label = row label, sub = section name, words = search words. Choosing one runs `W.openSetting(section, rowId)`.
- The 17 rows (settings.js:52-58): profile name/role; appearance theme/density/size/motion/rail; day budget/morning/welcome; keyboard letters; notifications notify; team vamoney; prototype proto/scenario/viewas/comments (filtered out unless proto is on or account is owner, app.js:209).
- `W.openSetting` (settings.js:62-65): `W.go("settings", sec)`; if a row is given, after a timeout it scrolls `#set-<row>` into view at center, removes then re-adds `.hl`, and focuses the first input or button.
- Other settings entries in the palette: "Open settings" action (app.js:205, goes to profile, hint Ctrl ,); "Switch density" action (app.js:206); "Go to Settings" (app.js:208, G S). Palette filter is plain substring over label + sub + words (app.js:220).

### 10.4 Data the working sections touch

Prototype:
- `settings.notify`: `settings.js:130-131` reads `(W.D().settings||{}).notify`; a kind is on unless it is `false`. data.js:296 sets only `settings:{density:"comfortable"}`. So no notify default is stored.
- `settings.morning` (`settings.js:26`, default 9); `settings.vaMoney` (`settings.js:139`, more.js:799); `day.budget` (data.js:295, 240; settings.js:114).
- Name: `W.myName` = `ui.profile.local || ui.profile.acct` (`proto.js:37`). `W.setMyName` writes `localStorage "wb-name"` and `ui.profile.local` (`proto.js:38-42`). `profile.acct` and `profile.avatar` come from `usr.me()` (`proto.js` ~l.30-34). `profile.id` is set too.
- Members: `data.js:267-270`: u1 "You" Owner; u2 Sara Account manager; u3 Omar VA; u4 Lina VA · first week. `me:"u1"` (data.js:293).
- Notification kinds (`settings.js:29-31`): reply, money (wallet, unlock), handoff (forward), search (scan, pause, else). `alert` maps to "problem", which always shows and cannot be turned off (`settings.js:31`, switch disabled at l.135). Icon per kind in NOTIFY (settings.js:29): reply, wallet, forward, scan.
- Tray filter: `app.js:78` (unread count) and `app.js:157-158` (tray list) both use `W.notifShown`.
- Notification sample icons (data.js:248-254): reply, pause, alert, wallet, unlock, forward.

App (`apps/desktop/src/renderer/`):
- `lib/store.ts:113-128` AppData: `me`, `myName: string|null` (l.117, comment: null until set in Settings > Profile), `team`, `counts`, `notifications`, `log`, `creators`, `brands`, `deals`, `mateRun`. No `settings` object, no notify, no morning, no budget, no vaMoney.
- `lib/example-data.ts:19`: `myName: null`; team at l.21-32 (same people as prototype).
- Rail name: `app/rail.tsx:88,95-97`: `myName` from store; `shownName = me is u1 ? myName ?? rail.addName : member name`. Rail line 151 uses `rail.addName` when unnamed. No setter for `myName` exists yet.
- `lib/store.ts:117` `Notification` type in `store.ts:28-37` has `icon: IconName`; no kind field. `overlays/trays.tsx:124` already links to `settings/notifications`.

### 10.5 Current app

- `app/app.tsx:64`: `PlaceholderScreen` renders for every screen, including settings. `placeholder-screen.tsx:8-19` shows PageHead (title Settings, sub from routes) plus Empty "Settings is still being built". So Settings shows only the placeholder today.
- `lib/routes.ts:71`: `settings: screen("settings", "gear", ...)`; tabs come from `strings.ts:211-226` (profile, appearance, day, keyboard, notifications, search, facts, writing, team, connections). Note: prototype has also `prototype` (settings.js:45); not in strings.ts. `routes.ts:98` `s` goes to settings; `routeFromHash` (routes.ts:134-140) falls back to first tab for unknown tab.
- `lib/prefs.ts`: `Prefs` (l.5-15) keys theme (""/light/dark), density (""/compact), size (""/large), motion (""/reduce), letters (""/off), rail (""/min). Stored as one JSON under `gratovo.prefs` (l.18). `setPref` (l.103-119) applies, saves, notifies. `applyPrefs` (l.79-84) sets `data-theme`, `data-density`, `data-size`, `data-motion` on `<html>`, removing when empty. `letters` and `rail` are NOT applied to DOM: `usePref("rail")` in `rail.tsx:90` and `app.tsx:110`; letters has no consumer found in this recon.
- `main.tsx:23` calls `initPrefs()` once before render. Prototype equivalents: `settings.js:12-25` (`W.pref`, `wb-` localStorage keys, boot applies data attributes).
- Prototype `W.pref.set("letters")` also sets `W.lettersOff` (settings.js:20), which in the prototype also disables `?`, `[`, `/`, `g` (see handoff section 9, point 7).

### 10.6 The three biggest gaps

1. CSS for the whole screen is unported: `.set*`, `.switch`, `.bucket`, `.tb-ic`, `setHl`, both 900/560 media rules, `.scn`/`.proto-how`. Also fix the `aria-current="page"` case.
2. Components missing from `packages/ui`: `Seg` and `Tag` (no file), `Switch`, `Row` and `Locked`, plus the owner-aware `Av` wrapper. The Settings screen is still `PlaceholderScreen` (`app.tsx:64`).
3. Data and state: `AppData` has no `settings` (notify, morning, budget, vaMoney), no `setMyName` action, and the notification type has no kind. Prototype's name and notify live in `ui.profile` and `data.settings`. The Electron rail reads `myName` (`rail.tsx:88`), so it needs a writer and a persisted value.
