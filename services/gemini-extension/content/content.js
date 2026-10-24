/*
 * Gemini Bridge — content script: the DOM actions.
 *
 * Builds on `GB` (content/locators.js). Every action is exposed on
 * `globalThis.GBC` so jsdom tests can drive it; the chrome.* wiring
 * (message handler, cs_ready registration, status poller, storage) only
 * runs when `chrome.runtime` exists.
 *
 * Contract: services/pipeline/src/gratovo_pipeline/gemini/ (ADR 0014) §3 (methods), §5 (signals),
 * §6 (messaging).
 */
(function (root) {
  'use strict';

  const GB = root.GB;
  if (!GB) throw new Error('content/locators.js must be loaded before content/content.js');

  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  const DEFAULT_SEND_TIMEOUT = 180000;

  function doc() { return GB.env.doc(); }
  function win() { return GB.env.win(); }
  function now() { return GB.env.now(); }
  function url() { return win().location.href; }

  function log(level, message, context) {
    GB.env.log(level, message, context);
    if (hasChrome && (level === 'warn' || level === 'error')) {
      safeSendMessage({ type: 'cs_event', event: 'log', data: { level, message, context: context || {} } });
    }
  }

  function safeSendMessage(msg) {
    if (!hasChrome) return Promise.resolve();
    try {
      const p = chrome.runtime.sendMessage(msg);
      // No listener (worker asleep between calls) is not an error worth logging.
      if (p && typeof p.catch === 'function') return p.catch(() => undefined);
    } catch (_) { /* extension context invalidated */ }
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------
  function requireApp() {
    const so = GB.signedOutState(url());
    if (so.signedOut) throw GB.gbError('SIGNED_OUT', 'Gemini is signed out (' + so.signal + ')', { url: url(), signal: so.signal });
  }

  function num(v, dflt) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; }

  // resolve() for actions: give an element that is not there yet a moment
  // (controls render one after another after a navigation), then fail with
  // the full healing report exactly as resolve() would.
  async function need(name, timeoutMs) {
    const el = GB.find(name, { fresh: true });
    if (el) return el;
    try { return await GB.waitFor(() => GB.find(name, { fresh: true }), { timeoutMs: timeoutMs || timeouts.elementMs, phase: name + ' to appear' }); } catch (_) { /* fall through */ }
    return GB.resolve(name).el;
  }

  // ---------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------
  function getUrl() { return { url: url(), accountIndex: GB.accountIndexFromUrl(url()) }; }

  let wizEmailCache; // undefined = not scanned yet this page load
  function cachedWizEmail() {
    if (wizEmailCache === undefined) wizEmailCache = GB.wizEmail();
    return wizEmailCache;
  }

  function getAccount() {
    const r = GB.resolveDetailed('account');
    let name = null; let email = null;
    if (r.el) {
      const el = r.el;
      const aria = el.getAttribute('aria-label') || (el.closest && el.closest('[aria-label]') ? el.closest('[aria-label]').getAttribute('aria-label') : '');
      if (aria) ({ name, email } = GB.parseAccountLabel(aria));
      if (!name && el.tagName === 'IMG' && el.getAttribute('alt')) name = GB.norm(el.getAttribute('alt')) || null;
      if (!name && el.tagName === 'A') { const img = el.querySelector('img[alt]'); if (img) name = GB.norm(img.getAttribute('alt')) || null; }
    }
    if (!email) email = cachedWizEmail();
    return { name, email, index: GB.accountIndexFromUrl(url()), strategy: r.strategy ? r.strategy.label : null };
  }

  function getModel() {
    const r = GB.resolveDetailed('modelSwitcher');
    if (!r.el) return { name: null };
    const titled = r.el.querySelector('.mode-title, [class*="title"], [class*="label"]');
    const name = GB.labelText(titled || r.el) || GB.labelText(r.el) || null;
    return { name };
  }

  function isGenerating() { return GB.isGenerating(); }

  function getText() {
    const box = GB.resolve('textarea').el;
    return { text: readBox(box) };
  }

  function readBox(box) {
    // Quill keeps one <p> per line. innerText yields line breaks in a
    // browser; without it (jsdom) join the block children ourselves.
    let t;
    if (typeof box.innerText === 'string') t = box.innerText;
    else {
      const blocks = Array.from(box.children).filter((c) => /^(P|DIV)$/.test(c.tagName));
      t = blocks.length ? blocks.map((b) => b.textContent).join('\n') : box.textContent;
    }
    return String(t || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
  }

  // Waits the PROTOCOL fixes; tests shrink them to keep the suite fast.
  const timeouts = { sendButtonMs: 3000, acceptMs: 10000, interruptSettleMs: 5000, newChatMs: 10000, menuMs: 3000, appRenderMs: 10000, elementMs: 8000, mentionMs: 4000 };

  function lastResponseResult() {
    const { index, el } = GB.lastResponse();
    if (!el) return { index: -1, text: '', textRaw: '', html: '', complete: true, task: null };
    const gen = GB.isGenerating();
    return { index, text: GB.responseText(el), textRaw: GB.responseTextRaw(el), html: GB.responseHtml(el), complete: !gen.generating, task: GB.taskState(el) };
  }

  // The last response's task progress (null when it is a chat answer).
  function getTask() {
    const { index, el } = GB.lastResponse();
    const task = el ? GB.taskState(el) : null;
    return { index, url: url(), task, generating: GB.isGenerating().generating, textRaw: el ? GB.responseTextRaw(el) : '' };
  }

  function getConversation() {
    const items = [];
    for (const el of GB.userQueries()) {
      const q = el.querySelector('.query-text');
      items.push({ role: 'user', text: GB.textOf(q || el), el });
    }
    for (const el of GB.responses()) items.push({ role: 'model', text: GB.responseText(el), el });
    items.sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 /* FOLLOWING */) ? -1 : 1);
    return items.map(({ role, text }) => ({ role, text }));
  }

  function elementStatus(name, opts) {
    const r = GB.resolveDetailed(name, opts || {});
    return { found: !!r.el, strategy: r.strategy ? r.strategy.label : null };
  }

  // Cheap: cached elements, no menu opening. Also feeds the status poller.
  function status() {
    const u = url();
    const so = GB.signedOutState(u);
    const gen = GB.isGenerating();
    const account = getAccount();
    const elements = {
      newChat: elementStatus('newChat'),
      textarea: elementStatus('textarea'),
      sendButton: elementStatus('sendButton'),
      stopButton: elementStatus('stopButton', { fresh: true }),
      modelSwitcher: elementStatus('modelSwitcher'),
      account: { found: !!account.strategy, strategy: account.strategy },
    };
    if (!elements.sendButton.found && elements.textarea.found) elements.sendButton.note = 'prompt box empty; button appears after typing';
    if (!elements.stopButton.found) elements.stopButton.note = 'only present while generating';
    return {
      url: u,
      accountIndex: GB.accountIndexFromUrl(u),
      account: { name: account.name, email: account.email },
      model: getModel(),
      generating: gen.generating,
      signedOut: so.signedOut,
      pageError: GB.pageError(),
      elements,
      ready: true,
    };
  }

  function diagnostics() {
    const u = url();
    const so = GB.signedOutState(u);
    const fp = GB.pageFingerprint();
    const elements = {};
    for (const name of Object.keys(GB.BUILTIN)) {
      if (name === 'modelMenuItems' || name === 'mentionItems') continue; // only exist while their menu is open
      if (/^gem[A-Z]/.test(name) && !/\/gems\//.test(u)) continue; // gem editor elements: see gem_diagnostics
      if (/^skill/.test(name) && !/\/customize\//.test(u)) continue; // Skills page elements: see skills_diagnostics
      elements[name] = GB.elementReport(name, { includeCandidates: true });
    }
    GB.lastKnown.rememberPage(fp, false);
    return {
      url: u,
      title: doc().title,
      readyState: doc().readyState,
      extensionVersion: manifestVersion(),
      browser: browserInfo(),
      at: now(),
      signedOut: so.signedOut,
      signedOutSignal: so.signal,
      pageError: GB.pageError(),
      generating: GB.isGenerating(),
      elements,
      overrides: GB.getOverrides(),
      page: Object.assign(fp, GB.pageDiff(fp)),
      lastKnownPage: GB.lastKnown.get('__page'),
    };
  }

  function browserInfo() {
    const ua = (win().navigator && win().navigator.userAgent) || '';
    const edge = /Edg\/(\d+[\d.]*)/.exec(ua);
    const chromeM = /Chrome\/(\d+[\d.]*)/.exec(ua);
    const firefox = /Firefox\/(\d+[\d.]*)/.exec(ua);
    return { browser: edge ? 'edge' : (chromeM ? 'chrome' : (firefox ? 'firefox' : 'other')), version: edge ? edge[1] : (chromeM ? chromeM[1] : (firefox ? firefox[1] : null)) };
  }

  // ---------------------------------------------------------------------
  // Typing into Quill
  // ---------------------------------------------------------------------
  function execCommand(name, value) {
    const d = doc();
    if (typeof d.execCommand !== 'function') return false;
    try { return !!d.execCommand(name, false, value); } catch (_) { return false; }
  }

  function selectAll(box) {
    try {
      box.focus();
      const sel = doc().getSelection();
      if (sel) { sel.removeAllRanges(); sel.selectAllChildren(box); }
    } catch (_) { /* ignore */ }
  }

  function fireInput(box, inputType, data) {
    const w = win();
    let ev;
    try { ev = new w.InputEvent('input', { bubbles: true, inputType, data }); } catch (_) { ev = new w.Event('input', { bubbles: true }); }
    box.dispatchEvent(ev);
  }

  // Two ways to put text in the prompt box. `exec` = execCommand('insertText'),
  // what a user's paste does; Quill handles it, but on Edge it fires one input
  // event per line and freezes the page for seconds on a long prompt (80 KB:
  // ~3 s; measured on a Quill proxy). `dom` = one <p> per line + a single
  // input event; Quill's MutationObserver picks it up (80 KB: ~40 ms). Long
  // prompts try `dom` first and keep it only if the page reacts (the send
  // button is enabled); anything that does not read back falls through to the
  // next way. A page that rejected `dom` once gets `exec` first from then on.
  const DOM_FIRST_CHARS = 4000;
  let domRejected = false;

  function writeDom(box, text) {
    box.innerHTML = '';
    for (const line of text.split('\n')) {
      const p = doc().createElement('p');
      if (line === '') p.appendChild(doc().createElement('br')); else p.textContent = line;
      box.appendChild(p);
    }
    fireInput(box, 'insertFromPaste', text);
  }

  async function pageAccepted() {
    if (GB.isGenerating().generating) return true; // the button is a stop button now; read-back decides
    try {
      await GB.waitFor(() => GB.find('sendButton', { fresh: true, enabled: true }), { timeoutMs: 800, phase: 'send button to react to the text' });
      return true;
    } catch (_) {
      // Gemini shows the send button only once it has registered text, so a
      // missing or disabled button means the write went unseen. (A broken
      // sendButton locator lands here too: `exec` then, which is slow but safe.)
      return false;
    }
  }

  async function setText(params) {
    const text = String(params && params.text != null ? params.text : '');
    const box = GB.resolve('textarea').el;
    const started = now();
    const order = text.length >= DOM_FIRST_CHARS && !domRejected ? ['dom', 'exec'] : ['exec', 'dom'];
    const attempts = [];
    for (const strategy of order) {
      const t0 = now();
      selectAll(box);
      let ok;
      if (strategy === 'exec') ok = execCommand('insertText', text);
      else { writeDom(box, text); ok = true; }
      ok = ok && GB.norm(readBox(box)) === GB.norm(text);
      if (ok && strategy === 'dom' && text !== '' && order[0] === 'dom' && !(await pageAccepted())) {
        ok = false; domRejected = true;
      }
      attempts.push({ strategy, ok, ms: now() - t0 });
      if (ok) return { text: readBox(box), strategy, ms: now() - started, attempts };
    }
    const actual = readBox(box);
    throw GB.gbError('TYPE_FAILED', 'Prompt box does not read back the typed text', { expected: text, actual, attempts });
  }

  function clearText() {
    const box = GB.resolve('textarea').el;
    selectAll(box);
    execCommand('delete');
    if (GB.norm(readBox(box)) !== '') {
      box.innerHTML = '<p><br></p>';
      fireInput(box, 'deleteContentBackward', null);
    }
    if (GB.norm(readBox(box)) !== '') throw GB.gbError('TYPE_FAILED', 'Prompt box could not be cleared', { expected: '', actual: readBox(box) });
    return {};
  }

  // ---------------------------------------------------------------------
  // Model menu
  // ---------------------------------------------------------------------
  async function openModelMenu(timeoutMs) {
    const sw = await need('modelSwitcher');
    GB.robustClick(sw);
    const els = await GB.waitFor(() => { const l = GB.findAll('modelMenuItems'); return l.length ? l : null; }, { timeoutMs: timeoutMs || timeouts.menuMs, phase: 'model menu to open' });
    return { switcher: sw, items: els.map((el) => Object.assign(GB.parseMenuItem(el), { el })) };
  }

  async function closeModelMenu() {
    GB.pressEscape();
    try { await GB.waitFor(() => GB.findAll('modelMenuItems').length === 0, { timeoutMs: 2000, phase: 'model menu to close' }); } catch (_) {
      log('warn', 'model menu did not close after Escape');
    }
  }

  async function listModels() {
    requireApp();
    const { items } = await openModelMenu();
    const out = items.map(({ name, description, selected, submenu, marks }) => ({ name, description, selected, submenu, marks }));
    await closeModelMenu();
    return out;
  }

  // ---------------------------------------------------------------------
  // Thinking level (a submenu of the model menu on Argon, 2026-10)
  // ---------------------------------------------------------------------
  const THINKING_ROW = /thinking|reasoning|مستوى التفكير|التفكير/i;

  // The pointer moving onto `el`: what opens a hover submenu.
  function hover(el) {
    const w = win();
    let rc = { x: 0, y: 0, w: 0, h: 0 };
    try { rc = GB.env.rect(el); } catch (_) { /* no layout */ }
    const init = { bubbles: true, cancelable: true, composed: true, clientX: rc.x + rc.w / 2, clientY: rc.y + rc.h / 2 };
    const PE = w.PointerEvent || w.MouseEvent;
    for (const [C, type] of [[PE, 'pointerover'], [PE, 'pointerenter'], [w.MouseEvent, 'mouseover'], [w.MouseEvent, 'mouseenter'], [PE, 'pointermove'], [w.MouseEvent, 'mousemove']]) {
      try { el.dispatchEvent(new C(type, Object.assign({}, init, { bubbles: !/enter$/.test(type) }))); } catch (_) { /* ignore */ }
    }
    try { el.focus(); } catch (_) { /* ignore */ }
  }

  function menuPanels() {
    return Array.from(doc().querySelectorAll('.cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-container [role="menu"]')).filter((p) => GB.isVisible(p));
  }

  // Opens the model menu, then the thinking-level submenu; returns its rows.
  async function openThinkingMenu(timeoutMs) {
    const { items } = await openModelMenu(timeoutMs);
    const row = items.find((i) => i.submenu && THINKING_ROW.test(i.name)) || items.find((i) => THINKING_ROW.test(i.name)) || items.find((i) => i.submenu);
    if (!row) {
      await closeModelMenu();
      throw GB.gbError('ELEMENT_NOT_FOUND', 'The model menu has no thinking-level entry', { element: 'thinkingLevel', available: items.map((i) => i.name) });
    }
    // The pane the model menu lives in (whatever its classes): the thinking
    // row's own overlay pane / menu panel.
    const paneOf = (el) => (el && el.closest ? el.closest('.cdk-overlay-pane, .mat-mdc-menu-panel, [role="menu"]') : null);
    const panes = () => Array.from(doc().querySelectorAll('.cdk-overlay-container .cdk-overlay-pane, .cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-container [role="menu"]'))
      .filter((p) => GB.isVisible(p) && !Array.from(p.querySelectorAll('.cdk-overlay-pane, .mat-mdc-menu-panel, [role="menu"]')).some((inner) => GB.isVisible(inner)));
    const rowsOf = (panel) => Array.from(panel.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button.mat-mdc-menu-item, button')).filter((el) => GB.isVisible(el));
    const first = paneOf(row.el);
    const rowsBefore = new Set(first ? rowsOf(first) : []);
    const labelsBefore = first ? rowsOf(first).map((el) => GB.labelText(el)).join('|') : '';
    // Either a second pane opens next to the first, or the first drills down
    // and shows the levels in place of the models.
    const opened = () => {
      const list = panes();
      const other = list.find((p) => p !== first && !(first && (first.contains(p) || p.contains(first))) && rowsOf(p).length);
      if (other) return other;
      if (first && first.isConnected && rowsOf(first).length && rowsOf(first).map((el) => GB.labelText(el)).join('|') !== labelsBefore) return first;
      return null;
    };
    // Hover first: a submenu row opens on pointer-over, and a click on some
    // rows dismisses the whole menu (seen live 2026-10-14). Click only if
    // hovering did nothing and the menu is still open.
    let panel = null;
    const tried = [];
    for (const [how, act] of [['hover', () => hover(row.el)], ['click', () => GB.robustClick(row.el)]]) {
      if (how === 'click' && !(first && first.isConnected)) break;
      act();
      tried.push(how);
      panel = await GB.waitFor(opened, { timeoutMs: timeoutMs || timeouts.menuMs, phase: 'thinking-level submenu to open (' + how + ')' }).catch(() => null);
      if (panel) break;
    }
    if (!panel) {
      const ov = doc().querySelector('.cdk-overlay-container');
      const after = { tried, firstPane: first ? GB.cssPath(first, 4) : null, panes: panes().length, rows: panes().map((p) => rowsOf(p).map((el) => GB.labelText(el))), html: ov ? ov.innerHTML.replace(/\s+/g, ' ').slice(0, 5000) : '' };
      await closeAllMenus();
      throw GB.gbError('ELEMENT_NOT_FOUND', 'The thinking-level submenu did not open', { element: 'thinkingLevel', row: row.name, after });
    }
    // Levels rendered into the model menu's own pane (live, 2026-10-14) are the
    // rows that were not there before the hover; a drilled-down panel may keep
    // a "back" row (an arrow, no level name).
    const fresh = panel === first ? rowsOf(panel).filter((el) => !rowsBefore.has(el)) : rowsOf(panel);
    const rows = (fresh.length ? fresh : rowsOf(panel)).map((el) => Object.assign(GB.parseMenuItem(el), { el })).filter((r) => r.name && !r.submenu && !THINKING_ROW.test(r.name));
    return { row: row.name, levels: rows };
  }

  async function closeAllMenus() {
    for (let i = 0; i < 3 && menuPanels().length; i++) {
      GB.pressEscape();
      try { await GB.waitFor(() => menuPanels().length === 0, { timeoutMs: 800, phase: 'menus to close' }); } catch (_) { /* press again */ }
    }
  }

  async function listThinkingLevels() {
    requireApp();
    let opened = null;
    for (let pass = 0; pass < 3 && !opened; pass++) {
      try {
        opened = await openThinkingMenu();
      } catch (e) {
        await closeAllMenus();
        if (pass === 2) throw e;
        await GB.sleep(500 * (pass + 1));
      }
    }
    const { row, levels } = opened;
    await closeAllMenus();
    const out = levels.map(({ name, description, selected, marks }) => ({ name, description, selected, marks }));
    const current = out.find((l) => l.selected);
    return { menu: row, levels: out, current: current ? current.name : null };
  }

  // The level lives in the page: it survives a new chat, but every new tab,
  // reload or navigation starts again at the lowest level (live, 2026-10-14:
  // a whole batch ran on "low" because of this). So the level is set and read
  // back on every `send` that asks for one, and English names work on the
  // Arabic page.
  const THINKING_ALIASES = { low: ['low', 'منخفض'], medium: ['medium', 'متوسط'], high: ['high', 'مرتفع'] };

  function matchThinking(levels, wanted) {
    const hit = GB.matchModel(levels, wanted);
    if (hit) return hit;
    const w = GB.norm(wanted).toLowerCase();
    const key = Object.keys(THINKING_ALIASES).find((k) => THINKING_ALIASES[k].includes(w));
    for (const alias of key ? THINKING_ALIASES[key] : []) {
      const h = GB.matchModel(levels, alias);
      if (h) return h;
    }
    return null;
  }

  // Selects `wanted` and confirms it by reopening the menu and finding it
  // checked. A menu that did not open (a tab still loading), or that opened
  // on rows that are not the levels (live, right after a model switch), is
  // tried again.
  async function ensureThinking(wanted, timeoutMs) {
    let clicked = false;
    let last = null;
    let offered = null;
    for (let pass = 0; pass < 4; pass++) {
      let levels = null;
      try {
        ({ levels } = await openThinkingMenu(timeoutMs));
      } catch (e) {
        last = e;
      }
      const hit = levels ? matchThinking(levels, wanted) : null;
      if (levels && !hit) offered = levels.map((l) => l.name);
      if (hit && hit.selected) {
        await closeAllMenus();
        return { level: hit.name, changed: clicked, verified: true };
      }
      if (hit) {
        GB.robustClick(hit.el);
        clicked = true;
        await closeAllMenus();
        GB.clearCache();
        continue;
      }
      await closeAllMenus();
      await GB.sleep(400 * (pass + 1));
    }
    if (offered && !clicked) throw GB.gbError('MODEL_NOT_FOUND', 'No thinking level matches "' + wanted + '"', { wanted, available: offered });
    throw GB.gbError('THINKING_NOT_SET', 'Could not confirm thinking level "' + wanted + '"', { wanted, clicked, offered, last: last ? (last.message || String(last)) : null });
  }

  async function setThinkingLevel(params) {
    requireApp();
    const wanted = String(params && params.level || '');
    if (!wanted) throw GB.gbError('BAD_PARAMS', 'set_thinking_level needs {level}');
    return ensureThinking(wanted, num(params.timeoutMs, 5000));
  }

  // ---------------------------------------------------------------------
  // Chat / task mode and skill mentions (Gemini 4 Argon, calibrated 2026-10-14)
  // ---------------------------------------------------------------------
  const SEGMENT_SELECTED = /(^|\s)(gem-segmented-button-selected|selected|is-selected)(\s|$)/;

  function modeHosts() {
    return { chat: GB.find('modeChat', { fresh: true }), task: GB.find('modeTask', { fresh: true }) };
  }

  function segmentSelected(host) {
    if (!host) return false;
    if (SEGMENT_SELECTED.test(host.className || '')) return true;
    const pressed = host.getAttribute('aria-pressed') || host.getAttribute('aria-checked') || host.getAttribute('aria-selected');
    if (pressed === 'true') return true;
    const inner = host.querySelector('button, [role="radio"]');
    return !!inner && (inner.getAttribute('aria-pressed') === 'true' || inner.getAttribute('aria-checked') === 'true');
  }

  function getMode() {
    const { chat, task } = modeHosts();
    const mode = segmentSelected(task) ? 'task' : (segmentSelected(chat) ? 'chat' : null);
    return { mode, available: !!(chat && task) };
  }

  async function setMode(params) {
    requireApp();
    const wanted = String(params && params.mode || '').toLowerCase();
    if (wanted !== 'chat' && wanted !== 'task') throw GB.gbError('BAD_PARAMS', 'set_mode needs {mode: "chat" | "task"}');
    const timeoutMs = num(params.timeoutMs, 5000);
    let host = null;
    try { host = await GB.waitFor(() => modeHosts()[wanted], { timeoutMs, phase: 'the chat/task toggle' }); } catch (_) { host = null; }
    if (!host) {
      const r = GB.resolveDetailed(wanted === 'task' ? 'modeTask' : 'modeChat', { fresh: true });
      throw GB.gbError('ELEMENT_NOT_FOUND', 'No ' + wanted + ' toggle under the prompt box (tasks need a Google AI Pro/Ultra plan)', Object.assign({ element: wanted === 'task' ? 'modeTask' : 'modeChat' }, GB.healingReport(wanted === 'task' ? 'modeTask' : 'modeChat', r.tried)));
    }
    if (segmentSelected(host)) return { mode: wanted, changed: false };
    GB.robustClick(host.querySelector('button, [role="radio"]') || host);
    try {
      await GB.waitFor(() => segmentSelected(modeHosts()[wanted]), { timeoutMs, phase: 'the toggle to switch to ' + wanted });
    } catch (_) {
      throw GB.gbError('MODE_NOT_SET', 'Clicked the ' + wanted + ' toggle but it did not switch', { wanted, now: getMode().mode });
    }
    await settleInputArea(timeoutMs);
    GB.clearCache();
    return { mode: wanted, changed: true };
  }

  // Types `text` where the caret is (the end of the box after a mention):
  // what a key press does, through execCommand; when the page refuses that,
  // the text goes at the end of the last line and one input event tells Quill.
  function typeAtEnd(box, text) {
    try { box.focus(); } catch (_) { /* ignore */ }
    const before = readBox(box);
    if (execCommand('insertText', text) && readBox(box) !== before) return;
    let p = box.lastElementChild;
    if (!p || !/^(P|DIV)$/.test(p.tagName)) { p = doc().createElement('p'); box.appendChild(p); }
    const br = p.lastChild && p.lastChild.nodeName === 'BR' ? p.lastChild : null;
    if (br) br.remove();
    p.appendChild(doc().createTextNode(text));
    fireInput(box, 'insertText', text);
  }

  function mentionTitle(item) {
    const t = item.querySelector('.at-mentions-v2-item-title, [class*="item-title"], [class*="title"]');
    return GB.norm((t || item).textContent);
  }

  // Picks `name` from the `@` list into the prompt box. Typing "@name" as text
  // is NOT a mention (live check 2026-10-14: an inactive skill named in plain
  // text was ignored, the same skill picked from the list was used), so the
  // entry has to be chosen from the list. The list opens on a lone "@".
  async function insertMention(box, name) {
    const want = GB.norm(name).toLowerCase();
    const pick = () => GB.findAll('mentionItems', { fresh: true }).find((item) => mentionTitle(item).toLowerCase() === want) || null;
    const current = readBox(box);
    try { box.focus(); } catch (_) { /* ignore */ }
    if (current && !/\s$/.test(current)) typeAtEnd(box, ' ');
    typeAtEnd(box, '@');
    let item = await GB.waitFor(pick, { timeoutMs: timeouts.mentionMs, phase: 'the @ list to show "' + name + '"' }).catch(() => null);
    // What the unfiltered list offered: the useful part of the error if the name never shows up.
    const offered = GB.findAll('mentionItems', { fresh: true }).map(mentionTitle);
    if (!item) {
      // A long list may need filtering: type the name after the "@".
      typeAtEnd(box, name);
      item = await GB.waitFor(pick, { timeoutMs: timeouts.mentionMs, phase: 'the @ list to show "' + name + '"' }).catch(() => null);
    }
    if (!item) {
      const seen = offered.concat(GB.findAll('mentionItems', { fresh: true }).map(mentionTitle).filter((n) => !offered.includes(n)));
      clearText();
      throw GB.gbError('SKILL_NOT_FOUND', 'The @ list has no skill named "' + name + '"', { name, available: seen });
    }
    GB.robustClick(item);
    try {
      await GB.waitFor(() => GB.norm(readBox(GB.find('textarea', { fresh: true }) || box)).toLowerCase().includes('@' + want), { timeoutMs: timeouts.mentionMs, phase: 'the "' + name + '" mention to appear in the prompt box' });
    } catch (_) {
      throw GB.gbError('TYPE_FAILED', 'Picked "' + name + '" from the @ list but the prompt box does not show it', { name, actual: readBox(box) });
    }
  }

  // Skill mentions first, then the text after them on the same line.
  async function composeWithMentions(names, text) {
    const started = now();
    clearText();
    let box = GB.resolve('textarea').el;
    for (const name of names) {
      await insertMention(box, name);
      box = GB.find('textarea', { fresh: true }) || box;
    }
    if (text) typeAtEnd(box, ' ' + text);
    const actual = readBox(box);
    const missing = names.filter((n) => !GB.norm(actual).toLowerCase().includes('@' + GB.norm(n).toLowerCase()));
    if (missing.length || (text && !GB.norm(actual).includes(GB.norm(text).slice(0, 200)))) {
      throw GB.gbError('TYPE_FAILED', 'Prompt box does not read back the mentions and text', { expected: names.map((n) => '@' + n).join(' ') + ' ' + text, actual, missing });
    }
    return { text: actual, strategy: 'mentions', ms: now() - started, mentions: names };
  }

  function skillNames(params) {
    const raw = params.skills != null ? params.skills : params.skill;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.map((s) => String(s || '').trim()).filter(Boolean);
  }

  async function setModel(params) {
    requireApp();
    const wanted = String(params && params.model || '');
    if (!wanted) throw GB.gbError('BAD_PARAMS', 'set_model needs {model}');
    const timeoutMs = num(params.timeoutMs, 5000);
    const { items } = await openModelMenu(timeoutMs);
    const hit = GB.matchModel(items, wanted);
    if (!hit) {
      await closeModelMenu();
      throw GB.gbError('MODEL_NOT_FOUND', 'No model entry matches "' + wanted + '"', { wanted, available: items.map((i) => i.name) });
    }
    if (hit.selected) { await closeModelMenu(); return getModel(); }
    GB.robustClick(hit.el);
    try { await GB.waitFor(() => GB.findAll('modelMenuItems').length === 0, { timeoutMs, phase: 'model menu to close after selecting ' + hit.name }); } catch (e) { await closeModelMenu(); }
    GB.clearCache();
    return getModel();
  }

  // ---------------------------------------------------------------------
  // Chat actions
  // ---------------------------------------------------------------------
  function fallbackNewChatUrl() {
    const idx = GB.accountIndexFromUrl(url());
    return 'https://gemini.google.com' + (idx ? '/u/' + idx : '') + '/app';
  }

  async function newChat(params) {
    requireApp();
    const timeoutMs = num(params && params.timeoutMs, timeouts.newChatMs);
    let r;
    try { await need('newChat'); r = GB.resolve('newChat'); } catch (e) {
      // The background performs the navigation fallback (a page load would
      // kill this script before it could reply).
      e.details.fallbackUrl = fallbackNewChatUrl();
      throw e;
    }
    // An empty chat whose box still holds text (a long prompt typed but not
    // taken, live 2026-10-14) stays as it is when "new chat" is clicked:
    // clear the text instead, or the wait below can never succeed.
    const leftover = GB.responses().length === 0 && GB.find('textarea') && GB.norm(readBox(GB.find('textarea'))) !== '';
    if (leftover) await clearText();
    if (!GB.isEnabled(r.el)) return { url: url(), note: 'new chat button disabled: already on an empty chat' + (leftover ? ' (leftover text cleared)' : '') };
    if (leftover && GB.findAll('userQueries').length === 0) { await settleInputArea(timeoutMs); GB.tracker.reset(); GB.clearCache(); return { url: url(), note: 'empty chat: leftover text cleared' }; }
    GB.robustClick(r.el);
    try {
      await GB.waitFor(() => {
        const box = GB.find('textarea');
        return !!box && GB.norm(readBox(box)) === '' && GB.responses().length === 0;
      }, { timeoutMs, phase: 'new chat (empty prompt box, no responses)' });
    } catch (e) {
      // On an account whose chats are not saved the address stays on /app,
      // and "new chat" on /app does nothing (live 2026-10-14): the background
      // reloads the chat page instead (a page load would kill this script).
      if (e && e.code === 'TIMEOUT') {
        e.details = Object.assign({}, e.details, { element: 'newChat', fallbackUrl: fallbackNewChatUrl(), reason: 'new chat did not reset the page' });
      }
      throw e;
    }
    await settleInputArea(timeoutMs);
    GB.tracker.reset();
    GB.clearCache();
    return { url: url() };
  }

  // After a new chat (or a navigation) Gemini re-renders the input area a
  // moment after the prompt box first appears; text typed before that is
  // wiped. Wait until the same prompt-box node has been in place for a
  // while (no replacement) before anything is typed into it.
  async function settleInputArea(timeoutMs) {
    const stableMs = 700;
    let node = null; let since = now();
    await GB.waitFor(() => {
      const box = GB.find('textarea', { fresh: true });
      if (!box) { node = null; return false; }
      if (box !== node) { node = box; since = now(); return false; }
      return now() - since >= stableMs;
    }, { timeoutMs: timeoutMs || timeouts.newChatMs, phase: 'input area to settle' }).catch(() => { /* proceed; send verifies acceptance */ });
  }

  async function stop() {
    const el = GB.find('stopButton', { fresh: true });
    if (!el) return { stopped: false };
    GB.robustClick(el);
    try {
      await GB.waitFor(() => !GB.isGenerating().generating, { timeoutMs: 5000, phase: 'generation to stop' });
      return { stopped: true };
    } catch (_) {
      return { stopped: false, note: 'stop clicked but Gemini still reports generating' };
    }
  }

  // The `send` state machine — PROTOCOL §3, steps 1..11, implemented exactly.
  async function send(params) {
    params = params || {};
    const started = now();
    const wait = params.wait !== false;
    const timeoutMs = num(params.timeoutMs, DEFAULT_SEND_TIMEOUT);
    requireApp();

    // 1. prompt box
    await need('textarea');

    // 2. busy?
    if (GB.isGenerating().generating) {
      if (!params.interrupt) throw GB.gbError('BUSY', 'Gemini is still generating; pass interrupt:true to stop it first');
      await stop();
      await GB.waitFor(() => !GB.isGenerating().generating, { timeoutMs: timeouts.interruptSettleMs, phase: 'previous generation to settle after interrupt' });
    }

    // 3. model / new chat / chat-or-task (a new chat may reset the toggle, so
    // the mode comes after it)
    if (params.model) await setModel({ model: params.model, timeoutMs: 5000 });
    if (params.newChat) await newChat({ timeoutMs: timeouts.newChatMs });
    if (params.mode) await setMode({ mode: params.mode, timeoutMs: 5000 });
    // thinking level last: a tab that was reloaded or just opened is back on
    // the lowest level; nothing is typed unless the level reads back as asked
    const thinking = params.thinking ? (await ensureThinking(String(params.thinking), 5000)).level : null;

    // 4. text, after the skill mentions when there are any
    const skills = skillNames(params);
    let typed = null;
    if (skills.length) typed = await composeWithMentions(skills, params.text != null ? String(params.text) : '');
    else if (params.text != null) typed = await setText({ text: params.text });
    const boxNow = GB.resolve('textarea').el;
    if (GB.norm(readBox(boxNow)) === '') throw GB.gbError('BAD_PARAMS', 'Nothing to send: prompt box is empty and no text was given');

    // 5. snapshot: response count, user-query count, and the prompt box
    // node itself (a re-rendered box is a wipe, not a send).
    const n0 = GB.responses().length;
    const nq0 = GB.findAll('userQueries').length;
    const box0 = boxNow;
    let emptySince = null;
    GB.tracker.update();
    // A refused prompt flashes in the chat, the page puts it back in the box
    // and shows a toast (live 2026-10-14, every tab once the account was
    // throttled: "يُرجى التحقّق من الاتصال بالإنترنت ثم إعادة المحاولة" —
    // "check your internet connection"). A toast that was not there before the
    // submit, with no answer, ends the send at once with its text instead of
    // a wait that cannot succeed.
    // Not every toast is a refusal (2026-10-16): "Prompt copied" (someone
    // clicked copy on the prompt while Gemini thought) and "Submitting this
    // will enable the <skill> skill" came while the prompt was being answered.
    // A refusal leaves a state that holds: the prompt back in the box, nothing
    // generating, no answer. It counts once that has held for 800 ms.
    const toastNow = () => { const e = GB.pageError(); return e && e.source === 'toast' ? e.text : null; };
    const toast0 = toastNow();
    let refusedSince = null;
    const refused = () => {
      const t = toastNow();
      const box = GB.find('textarea', { fresh: true });
      const backInBox = !!box && GB.norm(readBox(box)) !== '';
      if (t && t !== toast0 && GB.responses().length <= n0 && backInBox && !GB.isGenerating().generating) {
        if (refusedSince == null) refusedSince = now();
        if (now() - refusedSince >= 800) throw GB.gbError('GEMINI_ERROR', t, { signal: 'toast', text: t, refused: true });
      } else refusedSince = null;
    };

    // A long prompt takes the page longer to register (a 68 KB coaching
    // transcript: the send button came late and the new query showed after the
    // 10 s acceptance window, so a send that went through looked refused,
    // 2026-10-14). Both waits grow with the text: +1 s per 20 KB for the
    // button, +1 s per 5 KB for acceptance.
    const textLen = GB.norm(readBox(boxNow)).length;
    const sendButtonMs = timeouts.sendButtonMs + Math.floor(textLen / 20);
    const acceptMs = timeouts.acceptMs + Math.floor(textLen / 5);

    // 6. send button (visible + enabled, ≤ 3 s, longer for long prompts)
    let sendEl;
    try {
      sendEl = await GB.waitFor(() => GB.find('sendButton', { fresh: true, enabled: true }), { timeoutMs: sendButtonMs, phase: 'send button to become visible and enabled' });
    } catch (e) {
      if (e && e.code === 'TIMEOUT') {
        const r = GB.resolveDetailed('sendButton', { fresh: true, enabled: true });
        throw GB.gbError('ELEMENT_NOT_FOUND', 'Send button not visible/enabled within 3 s of typing', Object.assign({ element: 'sendButton' }, GB.healingReport('sendButton', r.tried)));
      }
      throw e;
    }

    // 7. submit, then ≤ 10 s for any sign of acceptance. Three ways in,
    // escalating: click the button; Enter in the prompt box (Gemini's own
    // shortcut, independent of the page language); click again. A way that
    // already worked makes `accepted` true before the next one fires, so
    // escalating never double-sends. `acceptedBy` in the result says which
    // one the page needed — that is calibration data, not noise.
    const accepted = () => {
      refused();
      if (GB.responses().length > n0) return 'newResponse';
      if (GB.findAll('userQueries').length > nq0) return 'newQuery';
      if (GB.isGenerating().generating) return 'generating';
      // The weakest signal: the same box, emptied by the page, and still
      // empty a moment later. A box that was replaced does not count.
      const box = GB.find('textarea', { fresh: true });
      if (box && box === box0 && GB.norm(readBox(box)) === '') {
        if (emptySince == null) emptySince = now();
        if (now() - emptySince >= 800) return 'boxEmptied';
      } else emptySince = null;
      return null;
    };
    // Enter first: on the live page a synthetic click on the send button is
    // ignored while Enter in the prompt box submits every time (2026-09).
    const submits = [
      ['enter', () => GB.pressEnter(GB.find('textarea') || boxNow)],
      ['click', () => GB.robustClick(sendEl)],
      ['click2', () => GB.robustClick(GB.find('sendButton', { fresh: true, enabled: true }) || sendEl)],
    ];
    const perTry = Math.max(1000, Math.floor(acceptMs / submits.length));
    let acceptedBy = null;
    for (const [name, fire] of submits) {
      fire();
      try {
        await GB.waitFor(accepted, { timeoutMs: perTry, phase: 'Gemini to accept the prompt (' + name + ')' });
        acceptedBy = name;
        break;
      } catch (e) {
        if (!e || e.code !== 'TIMEOUT') throw e;
      }
    }
    if (!acceptedBy) {
      throw GB.gbError('SEND_NOT_ACCEPTED', 'Send was clicked (and Enter pressed) but nothing happened', { diagnostics: diagnostics(), n0, elapsedMs: now() - started, tried: submits.map((s) => s[0]) });
    }

    // 8. fire and forget
    const typing = typed ? { strategy: typed.strategy, ms: typed.ms } : null;
    if (!wait) return { sent: true, acceptedBy, typing, thinking };

    // 9. wait for the answer to complete
    const complete = () => {
      refused();
      if (GB.responses().length <= n0) return false;
      const gen = GB.isGenerating();
      if (gen.generating) return false;
      const { el } = GB.lastResponse();
      if (!el) return false;
      const actions = GB.responseActionsVisible(el);
      const settled = !GB.tracker.changedWithin(1500);
      return actions || settled;
    };
    await GB.waitFor(complete, {
      timeoutMs,
      phase: 'response to complete',
      partial: () => { const { el } = GB.lastResponse(); return el ? GB.responseText(el) : ''; },
    });

    // 10. error signals
    const err = GB.pageError();
    if (err) throw GB.gbError('GEMINI_ERROR', err.text, { signal: err.source, text: err.text });

    // 11. result
    const { index, el } = GB.lastResponse();
    GB.lastKnown.rememberPage(GB.pageFingerprint(), true); // a successful session = new baseline
    const task = GB.taskState(el);
    return { index, text: GB.responseText(el), textRaw: GB.responseTextRaw(el), html: GB.responseHtml(el), durationMs: now() - started, model: getModel().name, thinking, mode: task ? 'task' : (getMode().mode || 'chat'), task, url: url(), acceptedBy, typing };
  }

  // ---------------------------------------------------------------------
  // Selectors
  // ---------------------------------------------------------------------
  function getSelectors() { return { builtin: JSON.parse(JSON.stringify(GB.BUILTIN)), overrides: GB.getOverrides() }; }
  function applyOverrides(overrides) { GB.setOverrides(overrides || {}); return getSelectors(); }

  // ---------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------
  const METHODS = {
    ping: () => ({ pong: true, at: now() }),
    status,
    diagnostics,
    get_account: getAccount,
    get_model: getModel,
    list_models: listModels,
    set_model: setModel,
    is_generating: isGenerating,
    get_text: getText,
    set_text: setText,
    clear_text: clearText,
    get_last_response: lastResponseResult,
    get_conversation: getConversation,
    get_url: getUrl,
    get_task: getTask,
    get_mode: getMode,
    set_mode: setMode,
    list_thinking_levels: listThinkingLevels,
    set_thinking_level: setThinkingLevel,
    new_chat: newChat,
    send,
    stop,
    get_selectors: getSelectors,
    set_selectors: (p) => applyOverrides(p && p.overrides),
    get_last_known: () => GB.lastKnown.all(),
  };

  function normalizeError(e) {
    if (e && typeof e === 'object' && typeof e.code === 'string' && 'details' in e) {
      e.details = e.details && typeof e.details === 'object' ? e.details : {};
      return e;
    }
    return GB.gbError('INTERNAL', e && e.message ? e.message : String(e), { stack: e && e.stack ? String(e.stack) : '' });
  }

  // Methods that only read the page answer at once; the ones that need the
  // app's controls wait for it to render first (a call that lands right
  // after a navigation sees an empty shell for a second or two).
  const INSTANT_METHODS = new Set(['ping', 'get_url', 'status', 'diagnostics', 'get_selectors', 'set_selectors', 'get_last_known', 'is_generating', 'get_last_response', 'get_conversation', 'get_text', 'get_task', 'get_mode']);

  // Method groups other files contribute: content/gems.js registers
  // `GeminiGems = {handlers, instant}` and manifest.json loads it before this
  // file. They are merged into the tables above so the dispatcher, the
  // background's routing list and `GBC.METHODS` see one set of methods. A group
  // adds methods but never replaces a built-in one (the built-in wins, once
  // logged); `instant` names the group's methods that must not wait for the chat
  // page's prompt box, which a gem editor page does not have.
  const METHOD_GROUPS = ['GeminiGems', 'GeminiSkills'];
  const BUILTIN_METHODS = new Set(Object.keys(METHODS));
  const clashesLogged = new Set();
  function mergeMethodGroups() {
    for (const groupName of METHOD_GROUPS) {
      const group = root[groupName];
      if (!group || typeof group !== 'object') continue;
      const handlers = group.handlers;
      if (handlers && typeof handlers === 'object') {
        for (const name of Object.keys(handlers)) {
          if (typeof handlers[name] !== 'function') continue;
          if (BUILTIN_METHODS.has(name)) {
            if (!clashesLogged.has(groupName + '.' + name)) {
              clashesLogged.add(groupName + '.' + name);
              log('warn', groupName + ' tried to replace the built-in method "' + name + '"; ignored', { group: groupName, method: name });
            }
            continue;
          }
          METHODS[name] = handlers[name];
        }
      }
      if (Array.isArray(group.instant)) for (const name of group.instant) if (typeof name === 'string') INSTANT_METHODS.add(name);
    }
  }
  mergeMethodGroups();

  async function waitForApp() {
    if (GB.find('textarea')) return;
    try {
      await GB.waitFor(() => GB.find('textarea') || GB.signedOutState(url()).signedOut, { timeoutMs: timeouts.appRenderMs, phase: 'Gemini app to render' });
    } catch (_) { /* let the method report what is missing */ }
  }

  async function handle(method, params) {
    mergeMethodGroups(); // cheap and idempotent: also picks up a group registered after this file loaded
    const fn = METHODS[method];
    if (!fn) return { ok: false, error: GB.gbError('BAD_PARAMS', 'Unknown method "' + method + '"') };
    try {
      if (!INSTANT_METHODS.has(method)) await waitForApp();
      const result = await fn(params || {});
      return { ok: true, result: result === undefined ? {} : result };
    } catch (e) {
      const err = normalizeError(e);
      if (err.code === 'INTERNAL') log('error', 'method threw', { method, error: err.message, stack: err.details.stack });
      return { ok: false, error: err };
    }
  }

  // ---------------------------------------------------------------------
  // Status poller (1 s) with change-only, debounced events
  // ---------------------------------------------------------------------
  const poller = (function () {
    let lastSig = null; let lastSentAt = 0; let pending = null; let timer = null; let emit = null;

    function snapshot() {
      let s;
      try { s = status(); } catch (e) { s = { url: url(), accountIndex: GB.accountIndexFromUrl(url()), account: null, model: null, generating: false, signedOut: true, pageError: null, error: normalizeError(e).code }; }
      GB.tracker.update();
      return { url: s.url, accountIndex: s.accountIndex, account: s.account, model: s.model, generating: s.generating, signedOut: s.signedOut, pageError: s.pageError };
    }

    function tick() {
      const data = snapshot();
      const sig = JSON.stringify(data);
      if (sig === lastSig) return;
      lastSig = sig;
      const since = now() - lastSentAt;
      if (since >= 1000) { flush(data); return; }
      // Debounce: one trailing send once ≥ 500 ms have passed and never more
      // than once per second.
      pending = data;
      if (!timer) timer = win().setTimeout(() => { timer = null; if (pending) flush(pending); }, Math.max(500, 1000 - since));
    }

    function flush(data) { pending = null; lastSentAt = now(); if (emit) emit(data); }

    function start(fn) { emit = fn; win().setInterval(tick, 1000); }
    return { start, tick, snapshot };
  })();

  // ---------------------------------------------------------------------
  // Chrome wiring
  // ---------------------------------------------------------------------
  function installChrome() {
    // Selector overrides + last-known memory from storage; keep in sync.
    chrome.storage.local.get(['selectorOverrides', 'lastKnown']).then((v) => {
      if (v && v.selectorOverrides) GB.setOverrides(v.selectorOverrides);
      if (v && v.lastKnown) GB.lastKnown.load(v.lastKnown);
      GB.lastKnown.rememberPage(GB.pageFingerprint(), false);
    }).catch((e) => log('warn', 'storage read failed', { error: String(e) }));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.selectorOverrides) GB.setOverrides(changes.selectorOverrides.newValue || {});
    });

    GB.env.persistLastKnown = (all) => {
      // Merge with what other tabs stored so nobody clobbers the other.
      chrome.storage.local.get('lastKnown').then((v) => {
        const merged = Object.assign({}, v && v.lastKnown || {}, all);
        return chrome.storage.local.set({ lastKnown: merged });
      }).catch(() => undefined);
    };

    // cs_call handler; async reply keeps the channel open (return true).
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'cs_call') return false;
      handle(msg.method, msg.params).then(sendResponse, (e) => sendResponse({ ok: false, error: normalizeError(e) }));
      return true;
    });

    // cs_ready on load and on SPA URL changes (poll 500 ms + popstate).
    const announce = () => safeSendMessage({ type: 'cs_ready', url: url(), title: doc().title, at: now() });
    announce();
    let lastUrl = url();
    const urlCheck = () => { const u = url(); if (u !== lastUrl) { lastUrl = u; GB.clearCache(); wizEmailCache = undefined; announce(); } };
    win().setInterval(urlCheck, 500);
    win().addEventListener('popstate', urlCheck);

    poller.start((data) => safeSendMessage({ type: 'cs_event', event: 'status', data }));

    // Chromium does not freeze a page that holds a Web Lock (freezing it
    // could deadlock the lock's other waiters), so hold one for the page's
    // lifetime. Language- and layout-independent; harmless where unsupported.
    try {
      const nav = win().navigator;
      if (nav && nav.locks && nav.locks.request) nav.locks.request('gemini-bridge-awake', { mode: 'shared' }, () => new Promise(() => {})).catch(() => {});
    } catch (_) { /* no Web Locks */ }
  }

  // The version of the code actually running in this tab. After an
  // extension reload the browser keeps delivering messages to the old
  // content script until the page reloads, so this is how a stale tab shows.
  function manifestVersion() {
    try { if (hasChrome && chrome.runtime && chrome.runtime.getManifest) return chrome.runtime.getManifest().version; } catch (_) { /* orphaned */ }
    return GB.version;
  }

  root.GBC = { handle, METHODS, status, diagnostics, getAccount, getModel, listModels, setModel, isGenerating, getText, setText, clearText, lastResponseResult, getConversation, getUrl, getTask, getMode, setMode, listThinkingLevels, setThinkingLevel, composeWithMentions, newChat, send, stop, getSelectors, applyOverrides, poller, browserInfo, readBox, hasChrome, timeouts };

  if (hasChrome) {
    try { installChrome(); } catch (e) { log('error', 'content script init failed', { error: String(e), stack: e && e.stack }); }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
