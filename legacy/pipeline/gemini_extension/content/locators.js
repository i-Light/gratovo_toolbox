/*
 * Gemini Bridge — self-healing locator engine.
 *
 * Pure DOM code: no chrome.* calls, so it runs unchanged inside jsdom for
 * the unit tests. Everything is exposed on one global, `GB`, which
 * content.js (the DOM actions) builds on.
 *
 * Contract: pipeline/gemini_bridge/PROTOCOL.md §4 (locators, diagnostics)
 * plus the healing additions: last-known-good memory, ranked candidates and
 * ready-to-apply strategy suggestions when an element cannot be found.
 */
(function (root) {
  'use strict';

  const VERSION = '0.1.0';

  // ---------------------------------------------------------------------
  // Environment hooks. Tests override `isVisible`/`rect` because jsdom has
  // no layout; content.js overrides `persistLastKnown` to write storage.
  // ---------------------------------------------------------------------
  const env = {
    doc: () => root.document,
    win: () => root,
    now: () => Date.now(),
    isVisible: null, // set below (default = real layout check)
    rect: null,
    persistLastKnown: null, // (all) => void
    log: (level, msg, ctx) => {
      if (level === 'error' || level === 'warn') {
        try { console[level]('[GB]', msg, ctx || ''); } catch (_) { /* ignore */ }
      }
    },
  };

  function defaultRect(el) {
    try {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (_) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  // PROTOCOL §4: visible = connected, has client rects, non-zero box, and
  // the element itself is not display:none / visibility:hidden.
  function defaultIsVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.getClientRects !== 'function') return false;
    if (el.getClientRects().length === 0) return false;
    const r = env.rect(el);
    if (!(r.w > 0 && r.h > 0)) return false;
    try {
      const cs = env.win().getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    } catch (_) { /* no computed style available */ }
    return true;
  }

  env.isVisible = defaultIsVisible;
  env.rect = defaultRect;

  function isVisible(el) { return env.isVisible(el); }
  // 'rtl' or 'ltr' for the layout around `el`: computed style when the
  // browser gives one, else the nearest dir= attribute, else the document's.
  function pageDirection(el) {
    const doc = env.doc(); const win = env.win();
    try {
      if (el && win && win.getComputedStyle) { const d = win.getComputedStyle(el).direction; if (d === 'rtl' || d === 'ltr') return d; }
    } catch (_) { /* no computed style */ }
    const withDir = el && el.closest ? el.closest('[dir]') : null;
    const d = (withDir && withDir.getAttribute('dir')) || (doc.documentElement && doc.documentElement.getAttribute('dir')) || (doc.body && doc.body.getAttribute('dir')) || 'ltr';
    return /rtl/i.test(d) ? 'rtl' : 'ltr';
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------
  function gbError(code, message, details) {
    return { code, message: String(message || code), details: details && typeof details === 'object' ? details : {} };
  }

  // ---------------------------------------------------------------------
  // Builtin strategy table (PROTOCOL §4). Order matters: most specific first.
  // Extra field `visible: false` = accept a non-rendered match (scripts).
  // ---------------------------------------------------------------------
  const BUILTIN = {
    textarea: [
      { type: 'css', value: 'rich-textarea .ql-editor[contenteditable="true"]' },
      { type: 'css', value: 'div.ql-editor[contenteditable="true"][role="textbox"]' },
      { type: 'attr', attr: 'aria-label', match: 'enter a prompt|ask gemini|type a message|message gemini', tags: ['[contenteditable]', 'textarea'] },
      { type: 'attr', attr: 'data-placeholder', match: 'ask gemini|enter a prompt', tags: ['[contenteditable]'] },
      { type: 'css', value: '[role="textbox"][contenteditable="true"]' },
      { type: 'fn', name: 'largestContentEditable' },
    ],
    // Order matters for every element: data-test-id and structural classes,
    // then icons (ligature names are the same in every locale), then
    // aria-labels/text, which follow the page language and are only a
    // fallback (the Arabic UI says "إرسال رسالة", not "Send message").
    sendButton: [
      { type: 'css', value: 'button[data-test-id="send-button"]' },
      { type: 'css', value: 'gem-icon-button.send-button:not(.stop) button, .send-button-container:not(.stop) gem-icon-button:not(.stop) button, button.send-button:not(.stop)' },
      { type: 'icon', match: '^send$|^arrow_upward$', climb: 'button' },
      { type: 'attr', attr: 'aria-label', match: '^send( message| prompt)?$|submit|^إرسال', tags: ['button'] },
      { type: 'fn', name: 'buttonNearTextarea' },
    ],
    stopButton: [
      { type: 'css', value: 'button[data-test-id="stop-button"]' },
      { type: 'css', value: 'gem-icon-button.send-button.stop button, gem-icon-button.stop-button button, .send-button-container.stop button, button.send-button.stop, button.stop-button' },
      { type: 'icon', match: '^stop(_circle)?$', climb: 'button' },
      { type: 'attr', attr: 'aria-label', match: '^stop( response| generating)?$|cancel response|^إيقاف', tags: ['button'] },
    ],
    newChat: [
      { type: 'css', value: '[data-test-id="new-chat-button"]' },
      { type: 'attr', attr: 'aria-label', match: '^new chat', tags: ['button', 'a'] },
      { type: 'css', value: 'side-nav-action-button[data-test-id="new-chat-button"] button, side-nav-action-button button' },
      { type: 'text', match: '^new chat$', tags: ['button', 'a', 'span'], climb: 'button, a' },
      { type: 'icon', match: '^(edit_square|add_2|add|chat_add_on|edit)$', climb: 'button, a', within: 'bard-sidenav, mat-sidenav, nav, [role="navigation"]' },
      { type: 'css', value: 'a[href="/app"], a[href$="/app"]', within: 'bard-sidenav, mat-sidenav, nav, [role="navigation"]' },
    ],
    modelSwitcher: [
      { type: 'css', value: 'button[data-test-id="bard-mode-menu-button"]' },
      { type: 'css', value: 'bard-mode-switcher button, .mode-switcher button, [data-test-id="mode-switcher"] button' },
      { type: 'attr', attr: 'aria-label', match: 'model|mode|switch.*(model|mode)|select.*(model|mode)', tags: ['button[aria-haspopup]', 'button[aria-expanded]'] },
      { type: 'fn', name: 'menuButtonNearTextarea' },
      { type: 'text', match: '^(?:gemini\\s*)?(\\d(?:\\.\\d)?\\s*)?(flash|pro|thinking|fast|ultra|nano)(\\s*\\(.*\\))?$', tags: ['span', 'div'], climb: 'button' },
    ],
    modelMenuItems: [
      { type: 'css', value: '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"], [role="listbox"] [role="option"]' },
      { type: 'css', value: '.mat-mdc-menu-panel button.mat-mdc-menu-item, .cdk-overlay-container [role="menuitem"]' },
      { type: 'css', value: '.cdk-overlay-container button' },
    ],
    account: [
      { type: 'css', value: 'a[href*="accounts.google.com/SignOutOptions"]' },
      { type: 'attr', attr: 'aria-label', match: '^google account|^حساب google', tags: ['a', 'button'] },
      { type: 'css', value: 'a[href*="accounts.google.com"] img[alt]' },
      { type: 'fn', name: 'wizGlobalEmail', visible: false },
    ],
    responses: [
      { type: 'css', value: 'model-response' },
      { type: 'css', value: '.model-response-text, message-content' },
      { type: 'css', value: '[data-test-id="model-response"], .response-container' },
    ],
    userQueries: [
      { type: 'css', value: 'user-query' },
      { type: 'css', value: '.user-query-container' },
      { type: 'css', value: '[data-test-id="user-query"]' },
    ],
    responseActions: [
      { type: 'css', value: 'message-actions, .response-container-footer, [data-test-id="response-actions"]' },
      { type: 'attr', attr: 'aria-label', match: '^(copy|good response|bad response|share|more options)', tags: ['button'], climb: 'model-response, .response-container' },
    ],
    signInControl: [
      { type: 'css', value: 'a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]' },
      { type: 'text', match: '^sign in$|^تسجيل الدخول$', tags: ['a', 'button', 'span'], climb: 'a, button' },
    ],
    errorSignals: [
      { type: 'css', value: 'mat-snack-bar-container, [role="alert"], .error-message, .error-container, [data-test-id="error-message"]' },
      { type: 'text', match: "something went wrong|you.?ve reached your limit|reached (the|your) limit|try again later|can.?t help with that|not available in your|gemini is having trouble|couldn.?t (generate|complete)|is temporarily unavailable", tags: ['p', 'span', 'div', 'h1', 'h2', 'h3'] },
    ],
    // Chat <-> task toggle under the prompt box (Gemini 4 Argon, calibrated
    // 2026-10-14): two gem-segmented-button hosts with data-value 0 (chat) and
    // 40 (task); the selected one has the class gem-segmented-button-selected.
    modeChat: [
      { type: 'css', value: 'gem-segmented-button-row gem-segmented-button[data-value="0"]' },
      { type: 'text', match: '^(chat|دردشة)$', tags: ['gem-segmented-button', 'button', 'span'], climb: 'gem-segmented-button, [role="radio"], button', within: 'input-container, chat-window, main' },
    ],
    modeTask: [
      { type: 'css', value: 'gem-segmented-button-row gem-segmented-button[data-value="40"]' },
      { type: 'text', match: '^(task|tasks|مهمة|مهام)$', tags: ['gem-segmented-button', 'button', 'span'], climb: 'gem-segmented-button, [role="radio"], button', within: 'input-container, chat-window, main' },
    ],
    // The list `@` opens in the prompt box: skills, then connected apps. An
    // entry's title is its exact skill name.
    mentionItems: [
      { type: 'css', value: 'button.at-mentions-v2-item' },
      { type: 'css', value: 'at-mentions-menu-v2 button, [class*="at-mentions"] button[class*="item"]' },
    ],
  };

  const LIST_ELEMENTS = new Set(['modelMenuItems', 'responses', 'userQueries', 'errorSignals', 'mentionItems']);
  const INFO_TOAST = /\b(copied|enabled|will enable|turned (on|off)|disabled|saved|created|deleted|updated|added|removed|pinned|renamed)\b|^\s*تم\s/i;
  const ERROR_WORDS = /went wrong|try again|limit|unavailable|couldn.?t|can.?t|failed|error|connection|not available|تعذّر|تعذر|خطأ|الاتصال|حاول/i;
  const SPINNER_SELECTOR = 'mat-progress-bar, .loading-indicator, .thinking-indicator, [class*="loading"], [class*="spinner"], [aria-busy="true"]';
  const NAV_SELECTOR = 'bard-sidenav, mat-sidenav, nav, [role="navigation"], side-nav, [class*="sidenav"], [class*="side-nav"]';

  // ---------------------------------------------------------------------
  // Overrides (prepended per element; persisted by content.js/background)
  // ---------------------------------------------------------------------
  let overrides = {};
  function setOverrides(obj) {
    overrides = {};
    if (obj && typeof obj === 'object') {
      for (const [name, list] of Object.entries(obj)) {
        if (Array.isArray(list) && list.length) overrides[name] = list.filter((s) => s && typeof s === 'object' && s.type);
      }
    }
    cache.clear();
  }
  function getOverrides() { return JSON.parse(JSON.stringify(overrides)); }

  function strategiesFor(name) {
    const base = BUILTIN[name] || [];
    const extra = overrides[name] || [];
    // `label` is what diagnostics show. For fn strategies `name` is the
    // function (PROTOCOL), so their label falls back to fn#<n>.
    return extra.concat(base).map((s, i) => {
      const dflt = s.type + '#' + (i + 1);
      const label = s.label || (s.type === 'fn' ? dflt : (s.name || dflt));
      return Object.assign({}, s, { label, _index: i, _override: i < extra.length });
    });
  }

  // ---------------------------------------------------------------------
  // Strategy helpers
  // ---------------------------------------------------------------------
  function regex(match) {
    try { return new RegExp(match, 'i'); } catch (_) { return new RegExp(escapeRegex(String(match)), 'i'); }
  }
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Collapses whitespace and drops the bidi control marks Google wraps names
  // and model labels in ("\u200f Ahmed \u200f", "\u200e3.1 Pro").
  function norm(s) { return String(s == null ? '' : s).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim(); }

  function textOf(el) {
    if (!el) return '';
    // innerText honours layout (hidden parts skipped) in a browser; jsdom
    // returns undefined for it, so fall back to textContent.
    const t = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return norm(t);
  }

  // Text of a button minus its icon ligatures ("send", "arrow_drop_down").
  // The visible words of a control without its icon ligatures. Text nodes are
  // joined with a space: "<span>Flash</span><span>موسَّع</span>" reads
  // "Flash موسَّع", where textContent would glue the two.
  function labelText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('mat-icon, .material-symbols-outlined, .material-icons, [class*="icon"]').forEach((n) => n.remove());
    const parts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { const t = norm(n.nodeValue); if (t) parts.push(t); return; }
      for (const c of n.childNodes || []) walk(c);
    };
    walk(clone);
    return norm(parts.join(' '));
  }

  function iconName(iconEl) {
    if (!iconEl) return '';
    return norm(iconEl.getAttribute('data-mat-icon-name') || iconEl.getAttribute('fonticon') || iconEl.textContent);
  }
  function iconOf(el) {
    if (!el || !el.querySelector) return null;
    const ic = el.matches && el.matches('mat-icon, .material-symbols-outlined') ? el : el.querySelector('mat-icon, .material-symbols-outlined, .material-icons, [class*="icon"]');
    const n = ic ? iconName(ic) : '';
    return n || null;
  }

  function scopeRoots(strategy) {
    const doc = env.doc();
    if (strategy.within) {
      let list = [];
      try { list = Array.from(doc.querySelectorAll(strategy.within)); } catch (_) { list = []; }
      return list;
    }
    return [doc];
  }

  function queryAllSafe(rootEl, selector) {
    try { return Array.from(rootEl.querySelectorAll(selector)); } catch (e) {
      env.log('warn', 'bad selector', { selector, error: String(e) });
      return [];
    }
  }

  function climbAll(els, climb) {
    if (!climb) return els;
    const out = [];
    for (const el of els) {
      const c = el.closest ? el.closest(climb) : null;
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }

  function innermost(els) {
    return els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
  }

  function tagsSelector(tags) {
    return Array.isArray(tags) && tags.length ? tags.join(', ') : '*';
  }

  // Runs one strategy and returns the raw (unfiltered) matches, in DOM order.
  function runStrategy(strategy, scope) {
    const roots = scope ? [scope] : scopeRoots(strategy);
    let out = [];
    for (const r of roots) {
      let found = [];
      switch (strategy.type) {
        case 'css':
          found = queryAllSafe(r, strategy.value);
          break;
        case 'attr': {
          const re = regex(strategy.match || '');
          found = queryAllSafe(r, tagsSelector(strategy.tags)).filter((el) => el.hasAttribute && el.hasAttribute(strategy.attr) && re.test(norm(el.getAttribute(strategy.attr))));
          break;
        }
        case 'text': {
          const re = regex(strategy.match || '');
          // Ancestors contain the phrase too; keep only the innermost matches.
          found = innermost(queryAllSafe(r, tagsSelector(strategy.tags)).filter((el) => re.test(textOf(el))));
          break;
        }
        case 'icon': {
          const re = regex(strategy.match || '');
          found = queryAllSafe(r, 'mat-icon, .material-symbols-outlined, .material-icons, [class*="icon"]').filter((el) => re.test(iconName(el)));
          break;
        }
        case 'fn': {
          const fn = FNS[strategy.name];
          if (!fn) { env.log('warn', 'unknown fn strategy', { name: strategy.name }); break; }
          try { found = [].concat(fn(r) || []).filter(Boolean); } catch (e) { env.log('warn', 'fn strategy threw', { name: strategy.name, error: String(e) }); }
          break;
        }
        default:
          env.log('warn', 'unknown strategy type', { type: strategy.type });
      }
      found = climbAll(found, strategy.climb);
      for (const el of found) if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  function describeStrategy(s) {
    const w = s.within ? ' within "' + s.within + '"' : '';
    const c = s.climb ? ' climb ' + s.climb : '';
    switch (s.type) {
      case 'css': return 'css "' + s.value + '"' + w;
      case 'attr': return 'attr ' + s.attr + ' ~ /' + s.match + '/i on ' + tagsSelector(s.tags) + c + w;
      case 'text': return 'text ~ /' + s.match + '/i on ' + tagsSelector(s.tags) + c + w;
      case 'icon': return 'icon ~ /' + s.match + '/i' + c + w;
      case 'fn': return 'fn ' + s.name;
      default: return String(s.type);
    }
  }

  // ---------------------------------------------------------------------
  // Named heuristics (`fn` strategies)
  // ---------------------------------------------------------------------
  function promptContainer() {
    const ta = find('textarea');
    if (!ta) return null;
    // Climb until a container that holds more than one button (the toolbar
    // around the prompt box), max 8 levels; fall back to the outermost seen.
    let el = ta;
    let last = ta;
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      el = el.parentElement;
      last = el;
      if (el.tagName === 'FORM' || el.querySelectorAll('button').length >= 2) return el;
    }
    return last;
  }

  const FNS = {
    largestContentEditable(r) {
      const doc = env.doc();
      const win = env.win();
      const vh = (win && win.innerHeight) || 0;
      const els = queryAllSafe(r || doc, '[contenteditable="true"], textarea').filter(isVisible);
      if (!els.length) return [];
      const scored = els.map((el) => {
        const rc = env.rect(el);
        const lower = vh ? (rc.y + rc.h / 2 >= vh / 2 ? 1 : 0) : 1;
        return { el, area: rc.w * rc.h, lower };
      });
      scored.sort((a, b) => (b.lower - a.lower) || (b.area - a.area));
      return [scored[0].el];
    },
    // Last resort for the send button. Language-independent on purpose: a
    // class name containing "send" on the button or a wrapper first;
    // otherwise the button at the trailing edge of the prompt area — the
    // right edge in a left-to-right page, the LEFT edge in a right-to-left
    // one (Arabic, Hebrew, Persian). Buttons known by icon (mic, attach,
    // tools menu) are skipped; the aria word list only guards English pages.
    buttonNearTextarea() {
      const box = promptContainer();
      if (!box) return [];
      const notStop = (b) => !/(^|\s)stop(\s|$)/i.test(b.className || '') && !(b.closest && b.closest('.stop, [class*="stop-button"]'));
      const structural = queryAllSafe(box, '[class*="send"] button, button[class*="send"]').filter((b) => isVisible(b) && isEnabled(b) && notStop(b));
      if (structural.length) return [structural[0]];
      const skip = /mic|voice|upload|attach|add file|image|model|mode|menu|more|tools|gem|canvas|deep research|video|stop|cancel/i;
      const skipIcon = /^(mic|mic_none|add|attach_file|add_2|image|upload|more_vert|more_horiz|expand_more|arrow_drop_down|keyboard_voice|tune|stop|stop_circle|apps|build|construction)$/i;
      const rtl = pageDirection(box) === 'rtl';
      // Class names on the button and its wrappers are as language-neutral
      // as icons; Gemini's mic button, for one, has no icon ligature.
      const skipClass = /mic|dictation|voice|upload|attach|tools|toolbox|mode-?switch|model|menu|more|gem-?button-?wrapper/i;
      const classChain = (b) => { let out = ''; let n = b; for (let i = 0; n && i < 4; i++, n = n.parentElement) out += ' ' + (typeof n.className === 'string' ? n.className : '') + ' ' + (n.tagName || ''); return out; };
      const btns = queryAllSafe(box, 'button').filter((b) => isVisible(b) && isEnabled(b) && notStop(b))
        .filter((b) => !skip.test(norm(b.getAttribute('aria-label'))) && !skipIcon.test(iconOf(b) || '') && !b.getAttribute('aria-haspopup') && !skipClass.test(classChain(b)))
        .map((b, i) => { const rc = env.rect(b); return { b, i, edge: rtl ? -rc.x : rc.x + rc.w, area: rc.w * rc.h }; })
        .filter((c) => c.area > 0); // "at the edge" needs layout; never guess without it
      if (!btns.length) return [];
      btns.sort((a, c) => (c.edge - a.edge) || (c.i - a.i));
      return [btns[0].b];
    },
    menuButtonNearTextarea() {
      const doc = env.doc();
      const re = /flash|pro|thinking|fast|ultra|nano|\d\.\d|gemini/i;
      const sel = 'button[aria-haspopup="menu"], button[aria-haspopup="listbox"], button[aria-expanded]';
      const scopes = [promptContainer(), doc.querySelector('header, [role="banner"], .top-bar, bard-header, .header'), doc].filter(Boolean);
      for (const s of scopes) {
        const hit = queryAllSafe(s, sel).find((b) => isVisible(b) && re.test(labelText(b)));
        if (hit) return [hit];
      }
      return [];
    },
    wizGlobalEmail(r) {
      const scripts = queryAllSafe(r || env.doc(), 'script');
      return scripts.filter((s) => /"oPEP7c"\s*:\s*"[^"@]+@[^"]+"/.test(s.textContent || ''));
    },
  };

  function wizEmail() {
    const scripts = FNS.wizGlobalEmail(env.doc());
    for (const s of scripts) {
      const m = /"oPEP7c"\s*:\s*"([^"]+)"/.exec(s.textContent || '');
      if (m) return m[1];
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Element summaries and CSS paths (diagnostics)
  // ---------------------------------------------------------------------
  function cssPath(el, maxDepth) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < (maxDepth || 8)) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) p += '#' + cur.id;
      else {
        const cls = stableClasses(cur).slice(0, 2);
        if (cls.length) p += '.' + cls.join('.');
      }
      parts.unshift(p);
      if (cur.tagName === 'BODY') break;
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // Classes that look hand-written rather than generated by Angular/Material.
  function stableClasses(el) {
    const list = el && el.classList ? Array.from(el.classList) : [];
    return list.filter((c) => !/\d/.test(c) && !/^(ng|mat|mdc|cdk|gb)[-_]/.test(c) && c.length > 1);
  }

  function summarize(el) {
    if (!el || el.nodeType !== 1) return null;
    const rc = env.rect(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: el.className && typeof el.className === 'string' ? norm(el.className) : '',
      aria: el.getAttribute('aria-label') || null,
      testId: el.getAttribute('data-test-id') || null,
      text: textOf(el).slice(0, 80),
      icon: iconOf(el),
      rect: rc,
      path: cssPath(el, 8),
    };
  }

  // ---------------------------------------------------------------------
  // Resolver with cache + tried bookkeeping
  // ---------------------------------------------------------------------
  const cache = new Map(); // name -> {el, strategy, strategyIndex}

  function wantVisible(strategy) { return strategy.visible !== false; }

  function resolveDetailed(name, opts) {
    opts = opts || {};
    const strategies = strategiesFor(name);
    const tried = [];
    if (!strategies.length) return { el: null, strategy: null, strategyIndex: -1, tried };
    const enabled = !!opts.enabled;

    if (!opts.fresh) {
      const c = cache.get(name);
      if (c && c.el && c.el.isConnected && (wantVisible(c.strategy) ? isVisible(c.el) : true) && (!enabled || isEnabled(c.el))) {
        return { el: c.el, strategy: c.strategy, strategyIndex: c.strategyIndex, tried: [{ strategy: c.strategy.label, describe: describeStrategy(c.strategy), matched: 1, visible: 1, cached: true }] };
      }
      cache.delete(name);
    }

    for (const s of strategies) {
      const matches = runStrategy(s, opts.scope || null);
      const vis = wantVisible(s) ? matches.filter(isVisible) : matches;
      const ok = enabled ? vis.filter(isEnabled) : vis;
      tried.push({ strategy: s.label, describe: describeStrategy(s), matched: matches.length, visible: vis.length });
      if (ok.length) {
        const rec = { el: ok[0], strategy: s, strategyIndex: s._index };
        if (!opts.scope) { cache.set(name, rec); lastKnown.remember(name, rec); }
        return { el: ok[0], strategy: s, strategyIndex: s._index, tried };
      }
    }
    return { el: null, strategy: null, strategyIndex: -1, tried };
  }

  // Returns the element or throws ELEMENT_NOT_FOUND with healing details.
  function resolve(name, opts) {
    const r = resolveDetailed(name, opts);
    if (r.el) return r;
    throw gbError('ELEMENT_NOT_FOUND', 'Could not find element "' + name + '"', Object.assign({ element: name }, healingReport(name, r.tried)));
  }

  function find(name, opts) {
    return resolveDetailed(name, opts).el;
  }

  function resolveList(name, opts) {
    opts = opts || {};
    const tried = [];
    for (const s of strategiesFor(name)) {
      const matches = runStrategy(s, opts.scope || null);
      const vis = opts.visible === false ? matches : matches.filter(isVisible);
      tried.push({ strategy: s.label, describe: describeStrategy(s), matched: matches.length, visible: vis.length });
      if (vis.length) return { els: vis, strategy: s, strategyIndex: s._index, tried };
    }
    return { els: [], strategy: null, strategyIndex: -1, tried };
  }

  function findAll(name, opts) { return resolveList(name, opts).els; }

  // ---------------------------------------------------------------------
  // Last-known-good memory: "how it used to get it".
  // ---------------------------------------------------------------------
  const lastKnown = (function () {
    let store = {}; // name -> {strategy, strategyIndex, element, at, url}
    const lastWrite = {}; // name -> timestamp of last persisted write
    let dirty = false;
    let flushTimer = null;

    function schedule() {
      dirty = true;
      if (flushTimer || !env.persistLastKnown) return;
      flushTimer = env.win().setTimeout(() => {
        flushTimer = null;
        if (!dirty) return;
        dirty = false;
        try { env.persistLastKnown(all()); } catch (e) { env.log('warn', 'persistLastKnown failed', { error: String(e) }); }
      }, 500);
    }

    function sameShape(a, b) {
      if (!a || !b) return false;
      return a.tag === b.tag && (a.aria || null) === (b.aria || null) && (a.testId || null) === (b.testId || null) && a.classes === b.classes;
    }

    function remember(name, rec) {
      const summary = summarize(rec.el);
      if (!summary) return;
      const prev = store[name];
      const now = env.now();
      const changed = !prev || prev.strategy !== rec.strategy.label || !sameShape(prev.element, summary);
      // Throttle: persist only when something meaningful changed, at most
      // once per 10 s per element.
      if (!changed) return;
      if (prev && lastWrite[name] && now - lastWrite[name] < 10000) return;
      store[name] = { strategy: rec.strategy.label, strategyIndex: rec.strategyIndex, describe: describeStrategy(rec.strategy), element: summary, at: now, url: currentUrl() };
      lastWrite[name] = now;
      schedule();
    }

    function rememberPage(fp, force) {
      if (!fp) return;
      if (store.__page && !force) return;
      store.__page = { customElements: fp.customElements, buttons: fp.buttons, at: env.now(), url: currentUrl() };
      schedule();
    }

    function get(name) { return store[name] ? JSON.parse(JSON.stringify(store[name])) : null; }
    function all() { return JSON.parse(JSON.stringify(store)); }
    function load(obj) { store = obj && typeof obj === 'object' ? JSON.parse(JSON.stringify(obj)) : {}; }
    function clear() { store = {}; schedule(); }

    return { remember, rememberPage, get, all, load, clear };
  })();

  function currentUrl() {
    try { return env.win().location.href; } catch (_) { return ''; }
  }

  // ---------------------------------------------------------------------
  // Candidates, ranking and healing suggestions
  // ---------------------------------------------------------------------
  const CANDIDATE_SELECTOR = 'button, a, [role="button"], [contenteditable="true"], textarea, [role="textbox"]';

  function collectRawCandidates() {
    return queryAllSafe(env.doc(), CANDIDATE_SELECTOR).filter(isVisible).slice(0, 200);
  }

  function tokens(s) { return norm(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

  function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 0..1 similarity of two labels: max of normalised Levenshtein and token overlap.
  function labelSimilarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    const ta = new Set(tokens(a)); const tb = new Set(tokens(b));
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    const jac = shared / Math.max(1, new Set([...ta, ...tb]).size);
    // Edit distance on short labels credits unrelated strings ("Use
    // microphone" vs "Send message" ≈ 0.3), so it only counts when strong.
    return Math.max(lev >= 0.5 ? lev : 0, jac);
  }

  function scoreAgainstLastKnown(sum, lk) {
    let score = 0; const why = [];
    if (sum.tag === lk.tag) { score += 3; why.push('same tag'); }
    const lkc = new Set(norm(lk.classes).split(' ').filter(Boolean)); let shared = 0;
    for (const c of norm(sum.classes).split(' ').filter(Boolean)) if (lkc.has(c)) shared++;
    if (shared) { const pts = Math.min(3, shared); score += pts; why.push(shared + ' shared class' + (shared > 1 ? 'es' : '')); }
    if (sum.aria && lk.aria) {
      const sim = labelSimilarity(sum.aria, lk.aria);
      if (sim > 0.2) { const pts = Math.round(sim * 4 * 10) / 10; score += pts; why.push('aria-label ' + Math.round(sim * 100) + '% similar'); }
    }
    if (sum.testId && lk.testId && sum.testId === lk.testId) { score += 5; why.push('same data-test-id'); }
    if (sum.icon && lk.icon && sum.icon.toLowerCase() === lk.icon.toLowerCase()) { score += 4; why.push('same icon'); }
    if (lk.rect && sum.rect && (lk.rect.w || lk.rect.h)) {
      const dx = (sum.rect.x + sum.rect.w / 2) - (lk.rect.x + lk.rect.w / 2);
      const dy = (sum.rect.y + sum.rect.h / 2) - (lk.rect.y + lk.rect.h / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const pts = Math.round(Math.max(0, 2 * (1 - d / 600)) * 10) / 10;
      if (pts > 0) { score += pts; why.push('near last position (' + Math.round(d) + 'px)'); }
    }
    score += 1; why.push('visible');
    return { score: Math.round(score * 10) / 10, why };
  }

  const KIND_HINTS = {
    textarea: { re: /prompt|ask|message|textbox/i, iconRe: null },
    sendButton: { re: /send|submit/i, iconRe: /^(send|arrow_upward)$/i },
    stopButton: { re: /stop|cancel/i, iconRe: /^stop(_circle)?$/i },
    modelSwitcher: { re: /flash|pro|thinking|model|mode|\d\.\d|gemini/i, iconRe: /arrow_drop_down|expand_more/i },
    newChat: { re: /new chat|new conversation/i, iconRe: /^(edit_square|add_2|add|chat_add_on|edit)$/i },
    account: { re: /account|profile|avatar/i, iconRe: null },
    responseActions: { re: /copy|good response|bad response|share/i, iconRe: /content_copy|thumb/i },
    signInControl: { re: /sign in|login/i, iconRe: null },
  };

  function scoreByKind(name, el, sum, ctx) {
    let score = 0; const why = [];
    const hint = KIND_HINTS[name] || { re: regex(name.replace(/([A-Z])/g, ' $1')), iconRe: null };
    const label = [sum.aria, sum.text, sum.testId].filter(Boolean).join(' ');
    if (name === 'textarea') {
      if (sum.tag === 'textarea' || el.getAttribute('contenteditable') === 'true') { score += 5; why.push('editable'); }
      if (el.getAttribute('role') === 'textbox') { score += 2; why.push('role=textbox'); }
    } else if (sum.tag === 'button' || el.getAttribute('role') === 'button') { score += 1; why.push('button'); }
    if (['sendButton', 'stopButton', 'modelSwitcher'].includes(name) && ctx.promptBox && ctx.promptBox.contains(el)) { score += 4; why.push('inside prompt box'); }
    if (name === 'newChat' && el.closest && el.closest(NAV_SELECTOR)) { score += 4; why.push('inside nav'); }
    if (name === 'account' && sum.tag === 'a' && /accounts\.google/.test(el.getAttribute('href') || '')) { score += 5; why.push('accounts.google link'); }
    if (name === 'modelSwitcher' && (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded'))) { score += 2; why.push('has popup'); }
    if (hint.re && hint.re.test(label)) { score += 3; why.push('label matches ' + String(hint.re)); }
    if (hint.iconRe && sum.icon && hint.iconRe.test(sum.icon)) { score += 3; why.push('icon ' + sum.icon); }
    score += 1; why.push('visible');
    return { score, why };
  }

  function collectCandidates(name, lk) {
    const ctx = { promptBox: name === 'textarea' ? null : promptContainer() };
    const els = collectRawCandidates();
    const ranked = els.map((el) => {
      const sum = summarize(el);
      const kind = scoreByKind(name, el, sum, ctx);
      let s = kind;
      if (lk && lk.element) {
        // Similarity to what used to work leads; relevance to the element's
        // kind still counts at half weight so a same-shaped decoy loses.
        const lks = scoreAgainstLastKnown(sum, lk.element);
        s = { score: Math.round((lks.score + kind.score / 2) * 10) / 10, why: lks.why.concat(kind.why.filter((w) => w !== 'visible').map((w) => 'kind: ' + w)) };
      }
      return Object.assign(sum, { score: s.score, why: s.why });
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, 40);
  }

  function suggestionFor(name, cand) {
    const tag = cand.tag;
    const climb = tag === 'button' || tag === 'a' ? undefined : 'button, a';
    if (cand.testId) return { name: 'heal:testid', type: 'css', value: '[data-test-id="' + cand.testId.replace(/"/g, '\\"') + '"]' };
    if (cand.aria) return { name: 'heal:aria', type: 'attr', attr: 'aria-label', match: '^' + escapeRegex(cand.aria) + '$', tags: [tag] };
    if (cand.icon && !/^(arrow_drop_down|expand_more)$/i.test(cand.icon)) return { name: 'heal:icon', type: 'icon', match: '^' + escapeRegex(cand.icon) + '$', climb: 'button, a' };
    const cls = tokens(cand.classes).length ? cand.classes.split(' ').filter((c) => !/\d/.test(c) && !/^(ng|mat|mdc|cdk|gb)[-_]/.test(c) && c.length > 1) : [];
    if (cls.length) return { name: 'heal:css', type: 'css', value: tag + '.' + cls.slice(0, 3).join('.') };
    if (cand.text && cand.text.length <= 40) return { name: 'heal:text', type: 'text', match: '^' + escapeRegex(cand.text) + '$', tags: [tag], climb: climb };
    return { name: 'heal:path', type: 'css', value: cand.path };
  }

  function suggestions(name, candidates) {
    return (candidates || []).slice(0, 3).map((c) => ({ strategy: suggestionFor(name, c), candidate: c, score: c.score }));
  }

  // The "how it used to get it and what looks like it now" block.
  function healingReport(name, tried) {
    const lk = lastKnown.get(name);
    const candidates = collectCandidates(name, lk);
    return { lastKnown: lk, tried, candidates, suggestions: suggestions(name, candidates) };
  }

  // Diagnostics entry for one element (PROTOCOL §4 + healing fields).
  function elementReport(name, opts) {
    opts = opts || {};
    if (LIST_ELEMENTS.has(name)) {
      const r = resolveList(name);
      return { found: r.els.length > 0, count: r.els.length, strategy: r.strategy ? r.strategy.label : null, strategyIndex: r.strategyIndex, tried: r.tried, lastKnown: lastKnown.get(name) };
    }
    const r = resolveDetailed(name, { fresh: true, enabled: !!opts.enabled });
    const out = { found: !!r.el, strategy: r.strategy ? r.strategy.label : null, strategyIndex: r.strategyIndex, tried: r.tried, lastKnown: lastKnown.get(name) };
    if (r.el) out.element = summarize(r.el);
    else if (opts.includeCandidates !== false) Object.assign(out, healingReport(name, r.tried));
    return out;
  }

  // ---------------------------------------------------------------------
  // Page fingerprint (PROTOCOL §4 `page`) + component-tree diff.
  // ---------------------------------------------------------------------
  function pageFingerprint() {
    const doc = env.doc();
    const custom = new Set();
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const t = all[i].tagName.toLowerCase();
      if (t.includes('-')) custom.add(t);
    }
    return {
      buttons: doc.querySelectorAll('button').length,
      contentEditables: doc.querySelectorAll('[contenteditable="true"]').length,
      textareas: doc.querySelectorAll('textarea').length,
      customElements: Array.from(custom).sort(),
    };
  }

  function pageDiff(fp) {
    const prev = lastKnown.get('__page');
    if (!prev || !Array.isArray(prev.customElements)) return { customElementsAdded: [], customElementsRemoved: [], baselineAt: null };
    const was = new Set(prev.customElements); const now = new Set(fp.customElements);
    return {
      customElementsAdded: fp.customElements.filter((t) => !was.has(t)),
      customElementsRemoved: prev.customElements.filter((t) => !now.has(t)),
      baselineAt: prev.at || null,
    };
  }

  // ---------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------
  // "Google Account: Jane Doe  \n(jane@gmail.com)" -> {name, email}
  function parseAccountLabel(label) {
    const s = norm(label);
    const out = { name: null, email: null };
    if (!s) return out;
    const em = /\(([^()]*@[^()]*)\)/.exec(s);
    if (em) out.email = norm(em[1]);
    const colon = s.indexOf(':');
    let name = colon >= 0 ? s.slice(colon + 1) : '';
    const paren = name.indexOf('(');
    if (paren >= 0) name = name.slice(0, paren);
    name = norm(name);
    out.name = name && !/^google account$/i.test(name) ? name : null;
    if (!out.email) {
      const loose = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(s);
      if (loose) out.email = loose[0];
    }
    return out;
  }

  function accountIndexFromUrl(url) {
    const m = /\/u\/(\d+)(\/|$)/.exec(String(url || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  function parseMenuItem(el) {
    const titleEl = el.querySelector('.mode-title, .title') || innermost(queryAllSafe(el, '[class*="title"]'))[0] || null;
    const descEl = el.querySelector('.mode-desc') || innermost(queryAllSafe(el, '[class*="desc"]'))[0] || null;
    const lines = textOfLines(el);
    const name = titleEl ? textOf(titleEl) : (lines[0] || '');
    const description = descEl ? textOf(descEl) : (titleEl ? '' : lines.slice(1).join(' '));
    const cls = (typeof el.className === 'string' ? el.className : '') || '';
    const icons = Array.from(el.querySelectorAll('mat-icon, .material-symbols-outlined')).map((i) => ({ name: iconName(i), visible: isVisible(i) }));
    const hasCheck = icons.some((i) => /check/i.test(i.name) && i.visible);
    const ariaChecked = el.getAttribute('aria-checked'); const ariaSelected = el.getAttribute('aria-selected');
    // 'active' / 'highlighted' is the keyboard focus, not the selection.
    const selected = ariaChecked === 'true' || ariaSelected === 'true' || /(^|\s)(selected|is-selected)(\s|$)/i.test(cls) || hasCheck;
    // A row that opens another menu ("thinking level" on Argon, 2026-10) is
    // not a model: it has a popup marker or an arrow pointing into the submenu.
    const submenu = el.getAttribute('aria-haspopup') === 'menu' || el.getAttribute('aria-haspopup') === 'true'
      || /mat-mdc-menu-item-submenu-trigger/.test(cls)
      || icons.some((i) => /^(arrow_(left|right)|chevron_(left|right)|keyboard_arrow_(left|right)|arrow_(back|forward)_ios)$/.test(i.name));
    // `marks` is what `selected` was decided from — shown by `diag`/`models`
    // so a wrong verdict can be traced to the page, not guessed at.
    return { name, description: norm(description), selected: selected && !submenu, submenu, marks: { cls: norm(cls), ariaChecked, ariaSelected, icons } };
  }

  function textOfLines(el) {
    const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return String(raw || '').split(/\n+/).map(norm).filter(Boolean);
  }

  // Pick the menu item for `wanted`: exact name > substring in name > substring in description.
  function matchModel(items, wanted) {
    const w = norm(wanted).toLowerCase();
    if (!w) return null;
    items = items.filter((i) => !i.submenu);
    return items.find((i) => i.name.toLowerCase() === w)
      || items.find((i) => i.name.toLowerCase().includes(w))
      || items.find((i) => (i.description || '').toLowerCase().includes(w))
      || null;
  }

  // ---------------------------------------------------------------------
  // Responses, generating detection, page signals
  // ---------------------------------------------------------------------
  function responses() { return findAll('responses'); }
  function userQueries() { return findAll('userQueries'); }
  // The answer itself: the markdown panel, else the message body. A task's
  // response also holds its step list (spark-thinking-steps), which is not
  // the answer, so the whole response element is only the last resort.
  function answerEl(el) {
    return el.querySelector('.markdown') || el.querySelector('message-content') || el;
  }
  // The text of `el` with a line break around every block (paragraph, list
  // item, heading, code block, row, <br>): what innerText gives for laid-out
  // text, built from the DOM. textContent alone glues paragraphs together
  // ("CANNOT-RUNThe custom skill…", seen live 2026-10-14).
  const BLOCK_TAGS = /^(P|DIV|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE|TR|TABLE|SECTION|ARTICLE|HR)$/;
  function blockText(el) {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { out.push(n.nodeValue); return; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName)) return;
      if (n.tagName === 'BR') { out.push('\n'); return; }
      const block = BLOCK_TAGS.test(n.tagName);
      if (block) out.push('\n');
      for (const c of n.childNodes) walk(c);
      if (block) out.push('\n');
    };
    walk(el);
    return out.join('');
  }
  // innerText skips what is not laid out yet: an answer still in its reveal
  // animation (its paragraphs "pending") reads empty or short through it, while
  // the DOM already has all of it. The longer of the two is the answer.
  function answerString(md) {
    const inner = typeof md.innerText === 'string' ? md.innerText : '';
    const built = blockText(md);
    return norm(inner).length >= norm(built).length * 0.9 && inner ? inner : built;
  }
  function responseText(el) {
    if (!el) return '';
    return norm(answerString(answerEl(el)));
  }
  // Same answer with its line breaks kept (paragraphs of a drafted message):
  // only bidi marks and non-breaking spaces go, and runs of blank lines shrink.
  function responseTextRaw(el) {
    if (!el) return '';
    return String(answerString(answerEl(el)) || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // A task's progress, read from its response (Gemini 4 Argon, calibrated
  // 2026-10-14): the step list's header gets the class `done` and the last
  // step a check_circle icon when the task has finished; a task that needs
  // the user shows spark-waiting-for-user-banner with text. null = not a task.
  function taskState(el) {
    if (!el || !el.querySelector) return null;
    const steps = el.querySelector('spark-thinking-steps');
    const banner = el.querySelector('spark-waiting-for-user-banner');
    if (!steps && !banner) return null;
    const header = steps ? steps.querySelector('.thinking-header') : null;
    const icons = steps ? Array.from(steps.querySelectorAll('.step-row mat-icon, .step-row .mat-icon')).map(iconName) : [];
    const done = !!(header && /(^|\s)done(\s|$)/.test(header.className || '')) || icons.includes('check_circle');
    const waitingForUser = banner ? norm(banner.textContent) : '';
    const list = steps ? Array.from(steps.querySelectorAll('.step-text')).map((s) => norm(s.textContent)).filter(Boolean) : [];
    return { done, waitingForUser, headline: header ? norm(header.textContent) : '', steps: list };
  }
  function responseHtml(el) {
    if (!el) return '';
    const md = el.querySelector('.markdown');
    return (md || el).innerHTML;
  }
  function lastResponse() {
    const list = responses();
    return list.length ? { index: list.length - 1, el: list[list.length - 1] } : { index: -1, el: null };
  }

  function responseActionsVisible(responseEl) {
    if (!responseEl) return false;
    for (const s of strategiesFor('responseActions')) {
      const matches = runStrategy(s, responseEl);
      if (matches.some(isVisible)) return true;
    }
    return false;
  }

  // Tracks the last response's text so "text changed within 1500 ms" works.
  const tracker = {
    index: -1, text: '', changedAt: 0,
    update() {
      const { index, el } = lastResponse();
      const text = el ? responseText(el) : '';
      if (index !== this.index || text !== this.text) {
        this.index = index; this.text = text; this.changedAt = env.now();
      }
      return this;
    },
    changedWithin(ms) { return this.changedAt > 0 && env.now() - this.changedAt < ms; },
    reset() { this.index = -1; this.text = ''; this.changedAt = 0; },
  };

  function isGenerating() {
    const stopEl = find('stopButton', { fresh: true });
    const stopButton = !!stopEl;
    const { el } = lastResponse();
    const spinnerEl = el ? queryAllSafe(el, SPINNER_SELECTOR).find(isVisible) : null;
    const spinner = !!spinnerEl;
    const actionsMissing = !!el && !responseActionsVisible(el);
    tracker.update();
    const textChanging = !!el && tracker.changedWithin(1500);
    // A task never shows the answer's action buttons and keeps a progress bar
    // in its response long after it finished, so its own step list decides:
    // running until the header says done or the task waits for the user.
    // (Text still settling after "done" is the caller's to wait out: `send`
    // waits for 1.5 s without change before it reads the answer.)
    const task = taskState(el);
    if (task) {
      const running = !task.done && !task.waitingForUser;
      return { generating: running || (stopButton && !task.done), signals: { stopButton, spinner, actionsMissing, textChanging, task: true, taskDone: task.done, waitingForUser: !!task.waitingForUser } };
    }
    // A loading-looking element inside an answer whose action buttons are
    // shown, with no stop button and no text moving, is a leftover: Gemini
    // shows the actions only once the answer is finished. (Live, 2026-10-14:
    // two finished high-thinking answers kept such an element and read as
    // "generating" for good, so every send to their tabs was BUSY.)
    const out = { generating: stopButton || (spinner && (actionsMissing || textChanging)) || (actionsMissing && textChanging), signals: { stopButton, spinner, actionsMissing, textChanging } };
    if (spinnerEl) out.spinnerAt = cssPath(spinnerEl, 4);
    return out;
  }

  function signedOutState(url) {
    const u = String(url || currentUrl());
    let host = '', path = '';
    try { const p = new URL(u); host = p.hostname; path = p.pathname; } catch (_) { /* ignore */ }
    if (/accounts\.google\.com$/.test(host)) return { signedOut: true, signal: 'accounts.google.com' };
    if (host === 'gemini.google.com' && (path === '/' || path === '')) return { signedOut: true, signal: 'landing page' };
    const signIn = find('signInControl', { fresh: true });
    const box = find('textarea', { fresh: true });
    if (signIn && !box) return { signedOut: true, signal: 'sign-in control visible, no prompt box' };
    return { signedOut: false, signal: null };
  }

  function pageError() {
    const box = find('textarea');
    for (const s of strategiesFor('errorSignals')) {
      const matches = runStrategy(s).filter(isVisible).filter((el) => !(box && (box === el || box.contains(el) || el.contains(box))));
      for (const el of matches) {
        const text = textOf(el).slice(0, 300);
        if (!text) continue;
        // Our own prompt and a real answer can contain these words (a call
        // transcript: "you have reached the limit of credits" stopped a finished
        // mining answer and paused the run, live 2026-10-14). Gemini's own error
        // answers are a line or two.
        if (el.closest && el.closest('user-query, .user-query-container, .query-content')) continue;
        const resp = el.closest ? el.closest('model-response, .response-container, message-content') : null;
        if (resp && textOf(resp).length > 400) continue;
        let source = 'inline';
        if (el.closest && el.closest('mat-snack-bar-container, .cdk-overlay-container, [role="alert"]')) source = 'toast';
        else if (resp) source = 'response';
        // Gemini also uses toasts to confirm things (live 2026-10-16: "Prompt
        // copied" while an answer was on its way failed the send; "Submitting
        // this will enable the gratovo-comms skill"). A confirmation is not an
        // error unless it also carries error words.
        if (source === 'toast' && INFO_TOAST.test(text) && !ERROR_WORDS.test(text)) continue;
        return { text, source };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Waiting and clicking
  // ---------------------------------------------------------------------
  function waitFor(predicate, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs == null ? 10000 : opts.timeoutMs;
    const intervalMs = opts.intervalMs || 250;
    const phase = opts.phase || 'waitFor';
    const win = env.win();
    const started = env.now();
    return new Promise((resolve, reject) => {
      let done = false; let timer = null; let ticker = null; let mo = null;
      const finish = (fn, v) => {
        if (done) return; done = true;
        if (timer) win.clearTimeout(timer);
        if (ticker) win.clearInterval(ticker);
        if (mo) { try { mo.disconnect(); } catch (_) { /* ignore */ } }
        fn(v);
      };
      const check = () => {
        if (done) return;
        let v;
        try { v = predicate(); } catch (e) { finish(reject, e); return; }
        if (v) finish(resolve, v);
      };
      check();
      if (done) return;
      ticker = win.setInterval(check, intervalMs);
      timer = win.setTimeout(() => {
        const details = { phase, elapsedMs: env.now() - started };
        if (typeof opts.partial === 'function') { try { details.partial = opts.partial(); } catch (_) { /* ignore */ } }
        finish(reject, gbError('TIMEOUT', 'Timed out waiting for ' + phase, details));
      }, timeoutMs);
      const target = opts.observe === undefined ? env.doc().body : opts.observe;
      if (target && typeof win.MutationObserver === 'function') {
        try {
          mo = new win.MutationObserver(() => check());
          mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
        } catch (_) { mo = null; }
      }
    });
  }

  function sleep(ms) { return new Promise((r) => env.win().setTimeout(r, ms)); }

  // Angular Material listens to pointer/mouse events for ripples and to
  // `click` for the action; dispatch the former manually and let the
  // native click() fire exactly one click event.
  // A strategy may match a host element (e.g. side-nav-action-button); the
  // real handler sits on its single inner control, so click that instead.
  function clickTarget(el) {
    if (!el || !el.matches) return el;
    if (el.matches('button, a, input, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]')) return el;
    const inner = queryAllSafe(el, 'button, a, [role="button"]').filter(isVisible);
    return inner.length === 1 ? inner[0] : el;
  }

  function robustClick(target) {
    const el = clickTarget(target);
    if (!el) return false;
    const win = env.win();
    try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) { /* ignore */ }
    const rc = env.rect(el);
    const init = { bubbles: true, cancelable: true, composed: true, clientX: rc.x + rc.w / 2, clientY: rc.y + rc.h / 2, button: 0, buttons: 1 };
    const fire = (Ctor, type) => {
      try { el.dispatchEvent(new Ctor(type, init)); } catch (_) { try { el.dispatchEvent(new win.Event(type, { bubbles: true })); } catch (__) { /* ignore */ } }
    };
    const PE = win.PointerEvent || win.MouseEvent;
    fire(PE, 'pointerdown'); fire(win.MouseEvent, 'mousedown');
    fire(PE, 'pointerup'); fire(win.MouseEvent, 'mouseup');
    if (el.isConnected) el.click();
    return true;
  }

  // Enter in the prompt box. Gemini submits on keydown; the full sequence is
  // dispatched so a handler on any of the three sees a normal key press.
  function pressEnter(target) {
    const win = env.win();
    if (!target) return false;
    try { target.focus(); } catch (_) { /* ignore */ }
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      try { target.dispatchEvent(new win.KeyboardEvent(type, init)); } catch (_) { /* ignore */ }
    }
    return true;
  }

  function pressEscape() {
    const doc = env.doc(); const win = env.win();
    const target = doc.activeElement || doc.body;
    const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    try { target.dispatchEvent(new win.KeyboardEvent('keydown', init)); target.dispatchEvent(new win.KeyboardEvent('keyup', init)); } catch (_) { /* ignore */ }
    const backdrop = doc.querySelector('.cdk-overlay-backdrop');
    if (backdrop) { try { backdrop.click(); } catch (_) { /* ignore */ } }
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  root.GB = {
    version: VERSION,
    env, BUILTIN, LIST_ELEMENTS, FNS, SPINNER_SELECTOR, NAV_SELECTOR,
    gbError, isVisible, isEnabled,
    setOverrides, getOverrides, strategiesFor, describeStrategy, runStrategy,
    resolve, resolveDetailed, find, resolveList, findAll, clearCache: () => cache.clear(),
    summarize, cssPath, stableClasses,
    lastKnown, collectCandidates, suggestions, healingReport, elementReport,
    pageFingerprint, pageDiff,
    parseAccountLabel, accountIndexFromUrl, parseMenuItem, matchModel, wizEmail,
    responses, userQueries, responseText, responseTextRaw, responseHtml, lastResponse, responseActionsVisible, taskState,
    tracker, isGenerating, signedOutState, pageError, promptContainer,
    waitFor, sleep, robustClick, clickTarget, pressEnter, pressEscape,
    textOf, labelText, iconOf, norm, escapeRegex, labelSimilarity, levenshtein,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
