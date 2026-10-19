// jsdom tests for content/locators.js and content/content.js.
// Run: cd pipeline/gemini_extension/test && npm install && npm test
import { test } from 'node:test';
import assertStrict from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import fx from './fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const locatorsSrc = fs.readFileSync(path.join(here, '..', 'content', 'locators.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
function parseRect(el) {
  const v = el.getAttribute && el.getAttribute('data-rect');
  if (!v) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = v.split(',').map(Number);
  return { x, y, w, h };
}

// jsdom has no layout: "visible" = connected and nothing up the tree hides it.
function testVisible(el) {
  if (!el || !el.isConnected || el.nodeType !== 1) return false;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hasAttribute('hidden')) return false;
    if (e.style && (e.style.display === 'none' || e.style.visibility === 'hidden')) return false;
  }
  return true;
}

function load(t, html, opts = {}) {
  const dom = new JSDOM(html, { url: opts.url || 'https://gemini.google.com/app', runScripts: 'outside-only' });
  const w = dom.window;
  if (opts.userAgent) Object.defineProperty(w.navigator, 'userAgent', { value: opts.userAgent, configurable: true });
  w.eval(locatorsSrc);
  w.eval(contentSrc);
  const GB = w.GB;
  GB.env.isVisible = testVisible;
  GB.env.rect = parseRect;
  GB.env.log = () => {};
  if (t) t.after(() => w.close());
  return { dom, w, d: w.document, GB, GBC: w.GBC };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Objects built inside the jsdom realm have another Object.prototype, which
// deepStrictEqual rejects; compare their JSON shape instead.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const assert = Object.assign((v, m) => assertStrict.ok(v, m), assertStrict, {
  deepEqual: (a, b, m) => assertStrict.deepEqual(plain(a), plain(b), m),
});

// Makes a fixture behave like Gemini: input toggles mic/send, send starts a
// scripted generation, stop finishes it, the model menu opens/closes, new
// chat clears the conversation.
function simulateGemini(w, opts = {}) {
  const d = w.document;
  const box = () => d.querySelector('[contenteditable="true"]');
  const trailing = () => d.querySelector('.trailing-actions-wrapper');
  const timers = [];
  const later = (ms, fn) => timers.push(w.setTimeout(fn, ms));
  const html = (s) => { const t = d.createElement('template'); t.innerHTML = s; return t.content.firstElementChild; };

  function setButton(kind) {
    const wrap = trailing();
    if (!wrap) return;
    wrap.querySelectorAll('.send-button, .mic-button').forEach((b) => b.remove());
    const b = kind === 'stop'
      ? html('<button class="mat-mdc-icon-button send-button stop" aria-label="Stop response" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="stop">stop</mat-icon></button>')
      : kind === 'send'
        ? html('<button class="mat-mdc-icon-button send-button submit" aria-label="Send message" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="send">send</mat-icon></button>')
        : html('<button class="mat-mdc-icon-button mic-button" aria-label="Use microphone" data-rect="1000,900,48,48"><mat-icon data-mat-icon-name="mic">mic</mat-icon></button>');
    wrap.appendChild(b);
  }

  function finishLast() {
    const last = Array.from(d.querySelectorAll('model-response')).pop();
    if (!last) return;
    last.querySelectorAll('mat-progress-bar').forEach((n) => n.remove());
    if (!last.querySelector('message-actions')) {
      last.querySelector('.response-container').appendChild(html('<message-actions><div class="buttons-container"><button class="mat-mdc-icon-button" aria-label="Good response" data-rect="300,500,40,40"><mat-icon data-mat-icon-name="thumb_up">thumb_up</mat-icon></button><button class="mat-mdc-icon-button copy-button" aria-label="Copy" data-rect="380,500,40,40"><mat-icon data-mat-icon-name="content_copy">content_copy</mat-icon></button></div></message-actions>'));
    }
    setButton(box() && box().textContent.trim() ? 'send' : 'mic');
  }

  d.addEventListener('input', (ev) => {
    if (ev.target !== box()) return;
    if (d.querySelector('.send-button.stop')) return;
    setButton(box().textContent.trim() ? 'send' : 'mic');
  });

  d.addEventListener('click', (ev) => {
    const el = ev.target.closest ? ev.target : ev.target.parentElement;
    const btn = el && el.closest('button, a');
    if (!btn) return;
    if (btn.matches('.send-button:not(.stop)')) {
      if (opts.sequence === 'none') return; // dead button
      const prompt = box().textContent;
      box().innerHTML = '<p><br></p>';
      const conv = d.querySelector('.conversation-container');
      const snack = (text) => d.querySelector('.cdk-overlay-container').appendChild(html('<mat-snack-bar-container><div>' + text + '</div></mat-snack-bar-container>'));
      if (opts.sequence === 'refused') {
        // live 2026-10-14: the prompt flashes in the chat, comes back to the box, and a toast shows
        const q = html(fx.userQuery(prompt));
        conv.appendChild(q);
        later(80, () => { q.remove(); box().innerHTML = '<p>' + prompt + '</p>'; setButton('send'); snack('Please check your internet connection and try again.'); });
        return;
      }
      if (opts.sequence === 'notice') {
        // live 2026-10-16: a "Prompt copied" toast while Gemini thinks, before the answer's container exists
        conv.appendChild(html(fx.userQuery(prompt)));
        setButton('stop');
        later(30, () => snack('Prompt copied'));
        later(250, () => conv.appendChild(html(fx.modelResponse({ generating: true, html: '<p>Hello world</p>' }))));
        later(450, finishLast);
        return;
      }
      conv.appendChild(html(fx.userQuery(prompt)));
      conv.appendChild(html(fx.modelResponse({ generating: true, html: '' })));
      setButton('stop');
      const md = () => Array.from(d.querySelectorAll('model-response .markdown')).pop();
      later(100, () => { md().innerHTML = '<p>Hello</p>'; });
      later(200, () => { md().innerHTML = '<p>Hello world</p>'; });
      if (opts.sequence === 'error') later(350, () => { d.querySelector('.cdk-overlay-container').appendChild(html('<mat-snack-bar-container><div>Something went wrong. Try again later.</div></mat-snack-bar-container>')); finishLast(); });
      else if (opts.sequence !== 'hang') later(350, finishLast);
    } else if (btn.matches('.send-button.stop')) {
      timers.forEach((id) => w.clearTimeout(id));
      finishLast();
    } else if (btn.matches('[data-test-id="bard-mode-menu-button"]')) {
      const overlay = d.querySelector('.cdk-overlay-container');
      if (!overlay.querySelector('[role="menu"]')) overlay.innerHTML = fx.modelMenuOverlay(d.querySelector('.mode-title').textContent);
    } else if (btn.matches('.mat-mdc-menu-item')) {
      d.querySelector('bard-mode-switcher .mode-title').textContent = btn.querySelector('.mode-title').textContent;
      d.querySelector('.cdk-overlay-container').innerHTML = '';
    } else if (btn.closest('[data-test-id="new-chat-button"]')) {
      d.querySelector('.conversation-container').innerHTML = '';
      box().innerHTML = '<p><br></p>';
      setButton('mic');
    }
  });

  d.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') d.querySelector('.cdk-overlay-container').innerHTML = '';
  });
}

// ---------------------------------------------------------------------------
// Resolution in every fixture state
// ---------------------------------------------------------------------------
test('every element resolves in the canonical fixtures with its first strategy', (t) => {
  const typed = load(t, fx.textTyped());
  // The fixture mirrors the live page: no data-test-id on the send button, so
  // its first *matching* strategy is the structural css (#2).
  for (const [name, strategy, index] of [['textarea', 'css#1', 0], ['sendButton', 'css#2', 1], ['newChat', 'css#1', 0], ['modelSwitcher', 'css#1', 0], ['account', 'css#1', 0]]) {
    const r = typed.GB.resolve(name);
    assert.ok(r.el, name + ' found');
    assert.equal(r.strategy.label, strategy, name + ' strategy');
    assert.equal(r.strategyIndex, index);
  }
  assert.equal(typed.GB.find('stopButton'), null, 'no stop button while idle');

  const gen = load(t, fx.generating());
  assert.equal(gen.GB.resolve('stopButton').strategy.label, 'css#2');
  assert.equal(gen.GB.findAll('responses').length, 1);
  assert.equal(gen.GB.findAll('userQueries').length, 1);
  assert.equal(gen.GB.find('sendButton'), null, 'send button is the stop button while generating');

  const fin = load(t, fx.finished());
  assert.ok(fin.GB.responseActionsVisible(fin.GB.lastResponse().el));
  assert.equal(fin.GB.resolveList('responseActions', { scope: fin.GB.lastResponse().el }).strategy.label, 'css#1');

  const menu = load(t, fx.modelMenuOpen());
  assert.equal(menu.GB.findAll('modelMenuItems').length, 3);

  const out = load(t, fx.signedOut(), { url: 'https://gemini.google.com/' });
  assert.ok(out.GB.find('signInControl'));
  assert.equal(out.GB.find('textarea'), null);
});

test('empty chat: send button absent, mic present, prompt box resolves', (t) => {
  const { GB } = load(t, fx.emptyChat());
  assert.ok(GB.find('textarea'));
  assert.equal(GB.find('sendButton'), null);
  assert.equal(GB.find('stopButton'), null);
});

test('alternate layout resolves through the deeper fallbacks', (t) => {
  const { GB, GBC } = load(t, fx.alternate());
  const ta = GB.resolve('textarea');
  assert.equal(ta.strategy.label, 'attr#3', 'no ql-editor → aria-label strategy');
  const send = GB.resolve('sendButton');
  assert.equal(send.strategy.label, 'icon#3', 'icons rank above localized aria-labels');
  const sw = GB.resolve('modelSwitcher');
  assert.ok(['fn#4', 'text#5'].includes(sw.strategy.label), 'pill found by heuristic, got ' + sw.strategy.label);
  assert.equal(sw.strategy.name, sw.strategy.label === 'fn#4' ? 'menuButtonNearTextarea' : undefined);
  assert.equal(GBC.getModel().name, 'Pro');
  const nc = GB.resolve('newChat');
  assert.equal(nc.strategy.label, 'attr#2');
  assert.equal(nc.el.className, 'nc-btn');
});

test('fn heuristics: largestContentEditable and buttonNearTextarea need layout to guess', (t) => {
  const { GB, d } = load(t, fx.textTyped());
  assert.equal(GB.FNS.largestContentEditable(d)[0], d.querySelector('.ql-editor'));
  // A "send" class on the button is a structural hint that needs no layout.
  assert.equal(GB.FNS.buttonNearTextarea()[0], d.querySelector('button.send-button'));
  const sendBtn = d.querySelector('button.send-button');
  sendBtn.className = sendBtn.className.replace('send-button', 'submit-button');
  // With data-rect layout the trailing-edge non-mic/upload button is the send button:
  // right-most in LTR, left-most in RTL (an Arabic page mirrors the toolbar).
  const other = d.createElement('button');
  other.setAttribute('data-rect', '300,900,48,48'); other.textContent = 'x';
  sendBtn.parentElement.insertBefore(other, sendBtn.parentElement.firstChild);
  assert.equal(GB.FNS.buttonNearTextarea()[0], sendBtn, 'LTR: right-most button');
  d.documentElement.setAttribute('dir', 'rtl');
  assert.equal(GB.FNS.buttonNearTextarea()[0], other, 'RTL: left-most button');
  d.documentElement.removeAttribute('dir');
  other.remove();
  d.querySelectorAll('[data-rect]').forEach((el) => el.removeAttribute('data-rect'));
  assert.deepEqual(GB.FNS.buttonNearTextarea(), [], 'no layout → refuse to guess');
});

// ---------------------------------------------------------------------------
// tried / candidates / overrides
// ---------------------------------------------------------------------------
test('ELEMENT_NOT_FOUND carries tried bookkeeping, ranked candidates and suggestions', (t) => {
  const { GB } = load(t, fx.emptyChat());
  let err;
  try { GB.resolve('stopButton'); } catch (e) { err = e; }
  assert.equal(err.code, 'ELEMENT_NOT_FOUND');
  assert.equal(err.details.element, 'stopButton');
  assert.equal(err.details.tried.length, GB.BUILTIN.stopButton.length);
  for (const tr of err.details.tried) {
    assert.equal(tr.matched, 0);
    assert.equal(tr.visible, 0);
    assert.match(tr.describe, /^(css|attr|icon|text|fn) /);
  }
  assert.equal(err.details.tried[3].describe, 'attr aria-label ~ /^stop( response| generating)?$|cancel response|^إيقاف/i on button');
  assert.ok(err.details.candidates.length > 0 && err.details.candidates.length <= 40);
  for (const c of err.details.candidates) {
    assert.ok(typeof c.score === 'number');
    assert.ok(Array.isArray(c.why) && c.why.length);
    assert.ok(['button', 'a', 'div'].includes(c.tag));
    assert.ok(c.rect && 'x' in c.rect && c.path.length);
  }
  assert.ok(err.details.suggestions.length <= 3);
  for (const s of err.details.suggestions) assert.ok(s.strategy.type && s.candidate && typeof s.score === 'number');
  assert.equal(err.details.lastKnown, null);
});

test('overrides are prepended and win; clearing restores builtin order', (t) => {
  const { GB, d } = load(t, fx.textTyped());
  assert.equal(GB.resolve('newChat').strategy.label, 'css#1');
  GB.setOverrides({ newChat: [{ type: 'css', value: 'a.conversation', name: 'my-fix' }] });
  const list = GB.strategiesFor('newChat');
  assert.equal(list[0].label, 'my-fix');
  assert.equal(list[0]._override, true);
  assert.equal(list.length, GB.BUILTIN.newChat.length + 1);
  const r = GB.resolve('newChat');
  assert.equal(r.el, d.querySelector('a.conversation'));
  assert.equal(r.strategy.label, 'my-fix');
  assert.equal(r.strategyIndex, 0);
  assert.deepEqual(GB.getOverrides(), { newChat: [{ type: 'css', value: 'a.conversation', name: 'my-fix' }] });
  GB.setOverrides({});
  assert.equal(GB.resolve('newChat').strategy.label, 'css#1');
});

test('cache is revalidated: a removed element re-resolves', (t) => {
  const { GB, d } = load(t, fx.textTyped());
  const first = GB.resolve('sendButton').el;
  first.remove();
  assert.equal(GB.find('sendButton'), null);
  d.querySelector('.trailing-actions-wrapper').insertAdjacentHTML('beforeend', '<button class="send-button" aria-label="Send message" data-rect="1,1,10,10"></button>');
  assert.notEqual(GB.resolve('sendButton').el, first);
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
test('account label parsing tolerates newlines and extra spaces', (t) => {
  const { GB } = load(t, fx.emptyChat());
  assert.deepEqual(GB.parseAccountLabel('Google Account: Jane Doe  \n(jane@gmail.com)'), { name: 'Jane Doe', email: 'jane@gmail.com' });
  assert.deepEqual(GB.parseAccountLabel('Google Account: Moustafa Khaled\n(moustafa@example.com)'), { name: 'Moustafa Khaled', email: 'moustafa@example.com' });
  assert.deepEqual(GB.parseAccountLabel('Google Account'), { name: null, email: null });
  assert.deepEqual(GB.parseAccountLabel(''), { name: null, email: null });
});

test('accountIndex from URLs', (t) => {
  const { GB } = load(t, fx.emptyChat());
  assert.equal(GB.accountIndexFromUrl('https://gemini.google.com/app'), 0);
  assert.equal(GB.accountIndexFromUrl('https://gemini.google.com/u/1/app/abc'), 1);
  assert.equal(GB.accountIndexFromUrl('https://gemini.google.com/u/12'), 12);
  assert.equal(GB.accountIndexFromUrl('https://gemini.google.com/u/x/app'), 0);
});

test('get_account combines aria-label, avatar alt and WIZ_global_data', (t) => {
  const a = load(t, fx.textTyped(), { url: 'https://gemini.google.com/u/2/app' });
  assert.deepEqual(a.GBC.getAccount(), { name: 'Jane Doe', email: 'jane@gmail.com', index: 2, strategy: 'css#1' });
  // Only the inline script knows the email.
  const b = load(t, fx.page({ header: '<header></header>', script: fx.wizScript('someone@gmail.com') }));
  const acc = b.GBC.getAccount();
  assert.equal(acc.email, 'someone@gmail.com');
  assert.equal(acc.name, null);
  assert.equal(acc.strategy, 'fn#4');
});

test('model menu item parsing and matching', (t) => {
  const { GB } = load(t, fx.modelMenuOpen('2.5 Flash'));
  const items = GB.findAll('modelMenuItems').map(GB.parseMenuItem);
  for (const it of items) { assert.ok(it.marks && Array.isArray(it.marks.icons), 'marks explain the selected verdict'); delete it.marks; }
  assert.deepEqual(items, [
    { name: '2.5 Flash', description: 'Fast all-round help', selected: true, submenu: false },
    { name: '2.5 Pro', description: 'Reasoning, math & code', selected: false, submenu: false },
    { name: 'Deep Research', description: 'Get in-depth reports', selected: false, submenu: false },
  ]);
  assert.equal(GB.matchModel(items, '2.5 pro').name, '2.5 Pro', 'exact, case-insensitive');
  assert.equal(GB.matchModel(items, 'flash').name, '2.5 Flash', 'substring on name');
  assert.equal(GB.matchModel(items, 'reports').name, 'Deep Research', 'substring on description');
  assert.equal(GB.matchModel(items, 'ultra'), null);
});

test('get_model strips the dropdown icon from the switcher label', (t) => {
  const { GBC } = load(t, fx.textTyped());
  assert.equal(GBC.getModel().name, '2.5 Pro');
});

// ---------------------------------------------------------------------------
// Generating detection
// ---------------------------------------------------------------------------
test('a leftover loading element in a finished answer is not "generating"; with the actions missing it is', (t) => {
  const page = (finished) => fx.page({ conversation: fx.userQuery('hi') + fx.modelResponse({ finished, html: '<p>Done.</p><div class="code-block loading-shimmer">x</div>' }), prompt: fx.promptBox() });
  const left = load(t, page(true));
  let now = 1_000_000;
  left.GB.env.now = () => now;
  left.GB.isGenerating();
  now += 1600;
  const g = left.GB.isGenerating();
  assert.equal(g.signals.spinner, true);
  assert.equal(g.signals.actionsMissing, false);
  assert.equal(g.generating, false, 'live 2026-10-14: such answers read as generating for good');
  assert.match(g.spinnerAt, /loading/);
  const running = load(t, page(false));
  const r = running.GB.isGenerating();
  assert.equal(r.signals.actionsMissing, true);
  assert.equal(r.generating, true);
});

test('generating detection in each state', (t) => {
  const idle = load(t, fx.emptyChat());
  assert.deepEqual(idle.GB.isGenerating(), { generating: false, signals: { stopButton: false, spinner: false, actionsMissing: false, textChanging: false } });

  const gen = load(t, fx.generating());
  const g = gen.GB.isGenerating();
  assert.equal(g.generating, true);
  assert.equal(g.signals.stopButton, true);
  assert.equal(g.signals.spinner, true);
  assert.equal(g.signals.actionsMissing, true);

  const fin = load(t, fx.finished());
  const f = fin.GB.isGenerating();
  assert.equal(f.generating, false);
  assert.deepEqual(f.signals, { stopButton: false, spinner: false, actionsMissing: false, textChanging: true });

  // No stop button, no spinner, no actions: only "text changed recently" says generating.
  const streaming = load(t, fx.page({ conversation: fx.userQuery('hi') + fx.modelResponse({ html: '<p>partial</p>' }), prompt: fx.promptBox() }));
  let fakeNow = 1_000_000;
  streaming.GB.env.now = () => fakeNow;
  assert.equal(streaming.GB.isGenerating().generating, true, 'first sight counts as a change');
  fakeNow += 1600;
  const settled = streaming.GB.isGenerating();
  assert.equal(settled.generating, false);
  assert.equal(settled.signals.actionsMissing, true);
  assert.equal(settled.signals.textChanging, false);
  streaming.d.querySelector('.markdown').innerHTML = '<p>partial more</p>';
  assert.equal(streaming.GB.isGenerating().generating, true, 'text grew → generating again');
});

test('pageError ignores the error words inside our prompt and inside a full answer', (t) => {
  const quote = 'because you have reached the limit of credits, so try again later';
  const longAnswer = '<p>' + ('The coach explains the outreach steps in detail. ').repeat(12) + '</p><p>Quote: ' + quote + '</p>';
  const page = load(t, fx.page({ conversation: fx.userQuery('TRANSCRIPT: ' + quote) + fx.modelResponse({ finished: true, html: longAnswer }), prompt: fx.promptBox() }));
  assert.equal(page.GB.pageError(), null, 'a transcript line is not a Gemini error (live 2026-10-14)');
  const short = load(t, fx.page({ conversation: fx.userQuery('hi') + fx.modelResponse({ finished: true, html: '<p>Something went wrong. Please try again later.</p>' }), prompt: fx.promptBox() }));
  assert.equal(short.GB.pageError().source, 'response', "Gemini's own short error answer still counts");
});

test('page-level signals: signedOut and pageError', (t) => {
  const out = load(t, fx.signedOut(), { url: 'https://gemini.google.com/' });
  assert.deepEqual(out.GB.signedOutState(), { signedOut: true, signal: 'landing page' });
  const out2 = load(t, fx.signedOut(), { url: 'https://gemini.google.com/app' });
  assert.equal(out2.GB.signedOutState().signedOut, true);
  assert.match(out2.GB.signedOutState().signal, /sign-in control/);
  assert.equal(out2.GBC.status().signedOut, true);
  const ok = load(t, fx.emptyChat());
  assert.equal(ok.GB.signedOutState().signedOut, false);
  assert.equal(ok.GB.pageError(), null);
  const toast = load(t, fx.withError('toast'));
  assert.deepEqual(toast.GB.pageError(), { text: 'Something went wrong. Please try again later.', source: 'toast' });
  const inline = load(t, fx.withError('response'));
  assert.deepEqual(inline.GB.pageError(), { text: 'Something went wrong.', source: 'response' });
  // confirmations are toasts too, and not errors (live 2026-10-16)
  const snack = (text) => fx.page({ overlay: '<mat-snack-bar-container><div>' + text + '</div></mat-snack-bar-container>', prompt: fx.promptBox() });
  for (const info of ['Prompt copied', 'Submitting this will enable the gratovo-comms skill', 'تم تفعيل المهارة']) {
    assert.equal(load(t, snack(info)).GB.pageError(), null, info);
  }
  for (const bad of ['Please check your internet connection and try again.', 'تعذّر تحميل المهارة', 'Copy failed']) {
    assert.equal(load(t, snack(bad)).GB.pageError().source, 'toast', bad);
  }
});

// ---------------------------------------------------------------------------
// Inspection methods
// ---------------------------------------------------------------------------
test('status() reports every element without throwing', (t) => {
  const { GBC } = load(t, fx.emptyChat(), { url: 'https://gemini.google.com/u/1/app/abc' });
  const s = GBC.status();
  assert.equal(s.url, 'https://gemini.google.com/u/1/app/abc');
  assert.equal(s.accountIndex, 1);
  assert.deepEqual(s.account, { name: 'Jane Doe', email: 'jane@gmail.com' });
  assert.deepEqual(s.model, { name: '2.5 Pro' });
  assert.equal(s.generating, false);
  assert.equal(s.signedOut, false);
  assert.equal(s.pageError, null);
  assert.equal(s.ready, true);
  assert.deepEqual(Object.keys(s.elements), ['newChat', 'textarea', 'sendButton', 'stopButton', 'modelSwitcher', 'account']);
  assert.equal(s.elements.sendButton.found, false);
  assert.match(s.elements.sendButton.note, /appears after typing/);
  assert.equal(s.elements.textarea.strategy, 'css#1');
});

test('get_conversation, get_last_response, get_text, get_url', (t) => {
  const { GBC } = load(t, fx.finished('Answer text'));
  assert.deepEqual(GBC.getConversation(), [{ role: 'user', text: 'Say hi' }, { role: 'model', text: 'Answer text' }]);
  const last = GBC.lastResponseResult();
  assert.equal(last.index, 0);
  assert.equal(last.text, 'Answer text');
  assert.equal(last.html, '<p>Answer text</p>');
  assert.equal(last.textRaw, 'Answer text');
  assert.equal(last.task, null, 'a chat answer has no task state');
  assert.equal(last.complete, true);
  assert.deepEqual(GBC.getText(), { text: '' });
  assert.deepEqual(GBC.getUrl(), { url: 'https://gemini.google.com/app', accountIndex: 0 });
  const empty = load(t, fx.emptyChat());
  assert.deepEqual(empty.GBC.lastResponseResult(), { index: -1, text: '', textRaw: '', html: '', complete: true, task: null });
});

test('set_text / clear_text verify by reading back (fallback path without execCommand)', async (t) => {
  const { GBC, d } = load(t, fx.emptyChat());
  const short = await GBC.setText({ text: 'Write 5 keywords' });
  assert.equal(short.text, 'Write 5 keywords');
  // Short text tries execCommand first; jsdom has none, so the DOM write takes over.
  assert.deepEqual(short.attempts.map((a) => [a.strategy, a.ok]), [['exec', false], ['dom', true]]);
  assert.equal(short.strategy, 'dom');
  assert.equal(d.querySelector('.ql-editor').innerHTML, '<p>Write 5 keywords</p>');
  assert.equal((await GBC.setText({ text: 'line one\nline two' })).text, 'line one\nline two');
  assert.deepEqual(GBC.clearText(), {});
  assert.deepEqual(GBC.getText(), { text: '' });
});

// A stand-in for the browser's execCommand('insertText'): what Quill ends up with after a real paste.
function fakeExecCommand(d) {
  d.execCommand = (name, _ui, value) => {
    const box = d.querySelector('.ql-editor');
    if (name === 'insertText') { box.innerHTML = String(value).split('\n').map((l) => '<p>' + (l || '<br>') + '</p>').join(''); return true; }
    if (name === 'delete') { box.innerHTML = '<p><br></p>'; return true; }
    return false;
  };
}

test('set_text: a long prompt is written straight into the DOM when the page takes it', async (t) => {
  const { w, GBC, d } = load(t, fx.emptyChat());
  simulateGemini(w); // the send button appears once the page registers text
  fakeExecCommand(d);
  const long = Array.from({ length: 400 }, (_, i) => 'rule ' + i + ': keep it short').join('\n');
  const r = await GBC.setText({ text: long });
  assert.equal(r.strategy, 'dom');
  assert.deepEqual(r.attempts.map((a) => [a.strategy, a.ok]), [['dom', true]]);
  assert.equal(d.querySelectorAll('.ql-editor p').length, 400);
});

test('set_text: a long prompt the page ignores falls back to execCommand, and exec goes first from then on', async (t) => {
  const { GBC, d } = load(t, fx.emptyChat());
  fakeExecCommand(d);
  // No simulateGemini: the page never reacts to the DOM write, so no send button appears.
  const long = 'x'.repeat(5000);
  const r = await GBC.setText({ text: long });
  assert.equal(r.strategy, 'exec');
  assert.deepEqual(r.attempts.map((a) => [a.strategy, a.ok]), [['dom', false], ['exec', true]]);
  assert.equal(GBC.getText().text, long);
  const again = await GBC.setText({ text: 'y'.repeat(5000) });
  assert.deepEqual(again.attempts.map((a) => a.strategy), ['exec']);
});

test('handle(): unknown method → BAD_PARAMS, thrown Error → INTERNAL with stack', async (t) => {
  const { GBC } = load(t, fx.emptyChat());
  const bad = await GBC.handle('nope', {});
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'BAD_PARAMS');
  GBC.METHODS.boom = () => { throw new Error('kaboom'); };
  const boom = await GBC.handle('boom', {});
  assert.equal(boom.error.code, 'INTERNAL');
  assert.equal(boom.error.message, 'kaboom');
  assert.ok(boom.error.details.stack.includes('kaboom'));
  const ok = await GBC.handle('get_url', {});
  assert.deepEqual(ok, { ok: true, result: { url: 'https://gemini.google.com/app', accountIndex: 0 } });
  const nf = await GBC.handle('get_text', {});
  assert.equal(nf.ok, true);
  const so = load(t, fx.signedOut(), { url: 'https://gemini.google.com/' });
  const r = await so.GBC.handle('send', { text: 'x' });
  assert.equal(r.error.code, 'SIGNED_OUT');
  assert.equal(r.error.details.signal, 'landing page');
});

test('browser detection: Edge vs Chrome vs Firefox vs other', (t) => {
  const edge = load(t, fx.emptyChat(), { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42' });
  assert.deepEqual(edge.GBC.browserInfo(), { browser: 'edge', version: '128.0.2739.42' });
  const chrome = load(t, fx.emptyChat(), { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36' });
  assert.deepEqual(chrome.GBC.browserInfo(), { browser: 'chrome', version: '129.0.0.0' });
  const firefox = load(t, fx.emptyChat(), { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0' });
  assert.deepEqual(firefox.GBC.browserInfo(), { browser: 'firefox', version: '156.0' });
  const other = load(t, fx.emptyChat(), { userAgent: 'Mozilla/5.0 SomethingElse/1.0' });
  assert.equal(other.GBC.browserInfo().browser, 'other');
});

// ---------------------------------------------------------------------------
// Model menu and new chat against a reactive fixture
// ---------------------------------------------------------------------------
test('list_models opens, reads and closes the menu; set_model switches; MODEL_NOT_FOUND lists options', async (t) => {
  const { w, d, GBC } = load(t, fx.emptyChat());
  simulateGemini(w);
  const models = await GBC.listModels();
  assert.deepEqual(models.map((m) => m.name), ['2.5 Flash', '2.5 Pro', 'Deep Research']);
  assert.equal(models[1].selected, true);
  assert.equal(d.querySelector('[role="menu"]'), null, 'menu closed with Escape');
  assert.deepEqual(await GBC.setModel({ model: 'flash' }), { name: '2.5 Flash' });
  assert.equal(d.querySelector('[role="menu"]'), null);
  let err;
  try { await GBC.setModel({ model: 'Ultra' }); } catch (e) { err = e; }
  assert.equal(err.code, 'MODEL_NOT_FOUND');
  assert.deepEqual(err.details, { wanted: 'Ultra', available: ['2.5 Flash', '2.5 Pro', 'Deep Research'] });
  assert.equal(d.querySelector('[role="menu"]'), null, 'menu closed after failure');
});

test('new_chat clicks the button and waits for an empty chat; missing button reports the fallback URL', async (t) => {
  const { w, d, GBC } = load(t, fx.finished(), { url: 'https://gemini.google.com/u/1/app/abc' });
  simulateGemini(w);
  assert.equal(d.querySelectorAll('model-response').length, 1);
  assert.deepEqual(await GBC.newChat({}), { url: 'https://gemini.google.com/u/1/app/abc' });
  assert.equal(d.querySelectorAll('model-response').length, 0);
  d.querySelector('bard-sidenav').remove();
  let err;
  try { await GBC.newChat({}); } catch (e) { err = e; }
  assert.equal(err.code, 'ELEMENT_NOT_FOUND');
  assert.equal(err.details.element, 'newChat');
  assert.equal(err.details.fallbackUrl, 'https://gemini.google.com/u/1/app');
});

// ---------------------------------------------------------------------------
// The send state machine
// ---------------------------------------------------------------------------
test('send: happy path — stop appears, text grows, actions appear, resolves with the text', async (t) => {
  const { w, d, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'complete' });
  const started = Date.now();
  const r = await GBC.send({ text: 'Say hi', timeoutMs: 5000 });
  assert.equal(r.index, 0);
  assert.equal(r.text, 'Hello world');
  assert.equal(r.html, '<p>Hello world</p>');
  assert.equal(r.model, '2.5 Pro');
  assert.ok(r.durationMs >= 300 && r.durationMs <= Date.now() - started + 5, 'durationMs ' + r.durationMs);
  assert.deepEqual(GBC.getConversation(), [{ role: 'user', text: 'Say hi' }, { role: 'model', text: 'Hello world' }]);
  assert.equal(d.querySelector('.send-button.stop'), null);
  assert.equal(GBC.isGenerating().generating, false);
  // A completed send re-baselines the component-tree fingerprint.
  assert.ok(Array.isArray(w.GB.lastKnown.get('__page').customElements));
});

test('send: wait:false returns {sent:true} once accepted; BUSY without interrupt; interrupt stops first', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'hang' });
  const first = await GBC.send({ text: 'first', wait: false });
  assert.deepEqual([first.sent, first.acceptedBy, typeof first.typing.strategy], [true, 'click', 'string']);
  await sleep(50);
  assert.equal(GBC.isGenerating().generating, true);
  let err;
  try { await GBC.send({ text: 'second' }); } catch (e) { err = e; }
  assert.equal(err.code, 'BUSY');
  const r = await GBC.send({ text: 'second', interrupt: true, wait: false });
  assert.deepEqual([r.sent, r.acceptedBy], [true, 'click']);
  assert.equal(w.document.querySelectorAll('user-query').length, 2);
});

test('send: SEND_NOT_ACCEPTED when the click does nothing, with diagnostics', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'none' });
  GBC.timeouts.acceptMs = 300;
  let err;
  try { await GBC.send({ text: 'Say hi' }); } catch (e) { err = e; }
  assert.equal(err.code, 'SEND_NOT_ACCEPTED');
  assert.equal(err.details.n0, 0);
  assert.ok(err.details.diagnostics && err.details.diagnostics.elements.sendButton.found === true);
  assert.ok(err.details.elapsedMs >= 300);
});

test('send: ELEMENT_NOT_FOUND(sendButton) when no send button appears after typing', async (t) => {
  const { w, d, GBC } = load(t, fx.emptyChat());
  // Gemini "forgot" to show the send button: no input reaction at all.
  GBC.timeouts.sendButtonMs = 200;
  let err;
  try { await GBC.send({ text: 'Say hi' }); } catch (e) { err = e; }
  assert.equal(err.code, 'ELEMENT_NOT_FOUND');
  assert.equal(err.details.element, 'sendButton');
  assert.ok(err.details.tried.length === w.GB.BUILTIN.sendButton.length);
  assert.ok(err.details.candidates.some((c) => c.aria === 'Use microphone'));
  assert.equal(d.querySelector('.ql-editor').textContent, 'Say hi', 'text stays in the box');
});

test('send: TIMEOUT carries phase and partial text', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'hang' });
  let err;
  try { await GBC.send({ text: 'Say hi', timeoutMs: 700 }); } catch (e) { err = e; }
  assert.equal(err.code, 'TIMEOUT');
  assert.equal(err.details.phase, 'response to complete');
  assert.equal(err.details.partial, 'Hello world');
  assert.ok(err.details.elapsedMs >= 700);
});

test('send: GEMINI_ERROR when an error toast appears with the answer', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'error' });
  let err;
  try { await GBC.send({ text: 'Say hi', timeoutMs: 3000 }); } catch (e) { err = e; }
  assert.equal(err.code, 'GEMINI_ERROR');
  assert.equal(err.details.signal, 'toast');
  assert.match(err.details.text, /Something went wrong/);
});

test('send: a refused prompt (back in the box, with a toast) ends at once as GEMINI_ERROR refused', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'refused' });
  let err;
  try { await GBC.send({ text: 'Say hi', timeoutMs: 20000 }); } catch (e) { err = e; }
  assert.equal(err.code, 'GEMINI_ERROR');
  assert.equal(err.details.refused, true);
  assert.match(err.details.text, /internet connection/);
});

test('send: a toast while Gemini thinks ("Prompt copied") is not a refusal', async (t) => {
  const { w, GBC } = load(t, fx.emptyChat());
  simulateGemini(w, { sequence: 'notice' });
  const r = await GBC.send({ text: 'Say hi', timeoutMs: 5000 });
  assert.match(r.text, /Hello world/);
});

test('send with newChat and model runs those steps first', async (t) => {
  const { w, d, GBC } = load(t, fx.finished());
  simulateGemini(w, { sequence: 'complete' });
  const r = await GBC.send({ text: 'Again', newChat: true, model: 'Flash', timeoutMs: 5000 });
  assert.equal(r.model, '2.5 Flash');
  assert.equal(r.index, 0, 'new chat → the answer is response #0');
  assert.equal(d.querySelectorAll('model-response').length, 1);
});

// ---------------------------------------------------------------------------
// Waiting / clicking primitives
// ---------------------------------------------------------------------------
test('waitFor resolves on mutation and rejects with TIMEOUT {phase, elapsedMs}', async (t) => {
  const { w, d, GB } = load(t, fx.emptyChat());
  const p = GB.waitFor(() => d.querySelector('.late'), { timeoutMs: 2000, intervalMs: 5000, phase: 'late element' });
  w.setTimeout(() => d.body.insertAdjacentHTML('beforeend', '<div class="late"></div>'), 30);
  const el = await p;
  assert.equal(el.className, 'late');
  let err;
  try { await GB.waitFor(() => false, { timeoutMs: 60, phase: 'never', partial: () => 'p' }); } catch (e) { err = e; }
  assert.equal(err.code, 'TIMEOUT');
  assert.equal(err.details.phase, 'never');
  assert.equal(err.details.partial, 'p');
  assert.ok(err.details.elapsedMs >= 55);
});

test('robustClick fires pointer/mouse events and exactly one click', (t) => {
  const { d, GB } = load(t, fx.textTyped());
  const btn = d.querySelector('button.send-button');
  const seen = [];
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) btn.addEventListener(type, () => seen.push(type));
  GB.robustClick(btn);
  assert.deepEqual(seen, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
});

// ---------------------------------------------------------------------------
// Healing: last-known-good memory, ranked candidates, suggestions
// ---------------------------------------------------------------------------
test('lastKnown is recorded on resolution and persisted (throttled)', async (t) => {
  const { GB } = load(t, fx.textTyped());
  const writes = [];
  GB.env.persistLastKnown = (all) => writes.push(all);
  GB.resolve('sendButton');
  GB.resolve('textarea');
  const rec = GB.lastKnown.get('sendButton');
  assert.equal(rec.strategy, 'css#2');
  assert.equal(rec.strategyIndex, 1);
  assert.equal(rec.describe, 'css "gem-icon-button.send-button:not(.stop) button, .send-button-container:not(.stop) gem-icon-button:not(.stop) button, button.send-button:not(.stop)"');
  assert.equal(rec.element.tag, 'button');
  assert.equal(rec.element.aria, 'Send message');
  assert.equal(rec.element.icon, 'send');
  assert.equal(rec.url, 'https://gemini.google.com/app');
  assert.ok(rec.at > 0);
  await sleep(700);
  assert.equal(writes.length, 1, 'one batched write');
  assert.deepEqual(Object.keys(writes[0]).sort(), ['sendButton', 'textarea']);
  // Same strategy + same shape again → no new write.
  GB.clearCache();
  GB.resolve('sendButton');
  await sleep(700);
  assert.equal(writes.length, 1);
});

test('healing: a changed send button is ranked first and an attr strategy is suggested; applying it resolves', async (t) => {
  // Session 1: learn what the send button looked like.
  const good = load(t, fx.textTyped());
  good.GB.resolve('sendButton');
  const memory = good.GB.lastKnown.all();

  // Session 2: Gemini shipped a redesign; the memory came back from storage.
  const { GB, GBC } = load(t, fx.healingBroken());
  GB.lastKnown.load(memory);
  assert.equal(GB.find('sendButton'), null, 'no builtin strategy matches any more');

  const diag = GBC.diagnostics();
  const entry = diag.elements.sendButton;
  assert.equal(entry.found, false);
  assert.equal(entry.strategy, null);
  assert.equal(entry.lastKnown.strategy, 'css#2', 'how it used to get it');
  assert.equal(entry.lastKnown.element.aria, 'Send message');
  assert.equal(entry.tried.length, GB.BUILTIN.sendButton.length);
  assert.ok(entry.tried.every((tr) => tr.matched === 0 && typeof tr.describe === 'string'));

  const top = entry.candidates[0];
  assert.equal(top.aria, 'Send prompt now', 'the renamed button ranks first: ' + JSON.stringify(entry.candidates.slice(0, 3).map((c) => [c.aria, c.score])));
  assert.ok(top.score > entry.candidates[1].score);
  assert.ok(top.why.includes('same tag'));
  assert.ok(top.why.some((w) => /aria-label \d+% similar/.test(w)));

  const s = entry.suggestions[0];
  assert.equal(s.candidate.aria, 'Send prompt now');
  assert.deepEqual(s.strategy, { name: 'heal:aria', type: 'attr', attr: 'aria-label', match: '^Send prompt now$', tags: ['button'] });
  assert.equal(s.score, top.score);

  // `heal sendButton --pick 1` on the Python side → set_selectors with that strategy prepended.
  GBC.applyOverrides({ sendButton: [s.strategy] });
  const r = GB.resolve('sendButton');
  assert.equal(r.el.className, 'mat-mdc-icon-button submit-btn');
  assert.equal(r.strategy.label, 'heal:aria');
  assert.equal(GB.lastKnown.get('sendButton').strategy, 'heal:aria', 'memory now reflects the healed strategy');
  const after = await GBC.handle('send', { text: 'x', wait: false });
  assert.notEqual(after.error && after.error.code, 'ELEMENT_NOT_FOUND');
});

test('healing without memory ranks by element kind and prefers data-test-id in suggestions', (t) => {
  const { GB, d } = load(t, fx.emptyChat());
  const report = GB.healingReport('newChat', []);
  assert.equal(report.lastKnown, null);
  assert.equal(report.candidates[0].aria, 'New chat');
  assert.ok(report.candidates[0].why.includes('inside nav'));
  const s = report.suggestions[0];
  // The button itself has no data-test-id (its host element does) → aria strategy.
  assert.deepEqual(s.strategy, { name: 'heal:aria', type: 'attr', attr: 'aria-label', match: '^New chat$', tags: ['button'] });
  d.querySelector('side-nav-action-button button').setAttribute('data-test-id', 'nc');
  const s2 = GB.healingReport('newChat', []).suggestions[0];
  assert.deepEqual(s2.strategy, { name: 'heal:testid', type: 'css', value: '[data-test-id="nc"]' });
  // textarea kind: contenteditables outrank buttons.
  const ta = GB.healingReport('textarea', []).candidates[0];
  assert.equal(ta.tag, 'div');
  assert.ok(ta.why.some((w) => /editable/.test(w)), JSON.stringify(ta.why));
});

test('suggestion falls back to icon, stable classes, then text', (t) => {
  const { GB } = load(t, fx.emptyChat());
  const c = (o) => Object.assign({ tag: 'button', id: '', classes: '', aria: null, testId: null, text: '', icon: null, rect: { x: 0, y: 0, w: 0, h: 0 }, path: 'body > button', score: 1, why: [] }, o);
  assert.deepEqual(GB.suggestions('x', [c({ icon: 'edit_square' })])[0].strategy, { name: 'heal:icon', type: 'icon', match: '^edit_square$', climb: 'button, a' });
  assert.deepEqual(GB.suggestions('x', [c({ classes: 'mat-mdc-button ng-tns-c12 send-button abc123 primary' })])[0].strategy, { name: 'heal:css', type: 'css', value: 'button.send-button.primary' });
  assert.deepEqual(GB.suggestions('x', [c({ classes: 'ng-star-inserted', text: 'Run it' })])[0].strategy, { name: 'heal:text', type: 'text', match: '^Run it$', tags: ['button'], climb: undefined });
  assert.deepEqual(GB.suggestions('x', [c({ aria: 'Send (now)' })])[0].strategy.match, '^Send \\(now\\)$');
});

test('page fingerprint and component-tree diff against the stored baseline', (t) => {
  const { GB, GBC, d } = load(t, fx.textTyped());
  const fp = GB.pageFingerprint();
  assert.equal(fp.contentEditables, 1);
  assert.equal(fp.textareas, 0);
  assert.ok(fp.buttons >= 4);
  assert.deepEqual(fp.customElements, ['bard-mode-switcher', 'bard-sidenav', 'chat-app', 'input-container', 'mat-icon', 'mat-sidenav', 'rich-textarea', 'side-nav-action-button']);
  const diag1 = GBC.diagnostics();
  assert.deepEqual([diag1.page.customElementsAdded, diag1.page.customElementsRemoved], [[], []], 'first sight = no diff');
  assert.ok(diag1.lastKnownPage && diag1.lastKnownPage.customElements.length === fp.customElements.length);
  d.querySelector('bard-mode-switcher').remove();
  d.body.insertAdjacentHTML('beforeend', '<model-picker></model-picker>');
  const diag2 = GBC.diagnostics();
  assert.deepEqual(diag2.page.customElementsAdded, ['model-picker']);
  assert.deepEqual(diag2.page.customElementsRemoved, ['bard-mode-switcher']);
  assert.equal(diag2.elements.modelSwitcher.found, false);
  assert.ok(diag2.elements.modelSwitcher.candidates.length > 0);
});

test('diagnostics object shape', (t) => {
  const { GBC } = load(t, fx.textTyped());
  const dg = GBC.diagnostics();
  for (const k of ['url', 'title', 'readyState', 'extensionVersion', 'browser', 'at', 'signedOut', 'pageError', 'elements', 'overrides', 'page']) assert.ok(k in dg, k);
  assert.equal(dg.extensionVersion, '0.1.0');
  assert.ok(!('modelMenuItems' in dg.elements));
  const ta = dg.elements.textarea;
  assert.equal(ta.found, true);
  assert.equal(ta.strategy, 'css#1');
  assert.equal(ta.strategyIndex, 0);
  assert.deepEqual(ta.tried, [{ strategy: 'css#1', describe: 'css "rich-textarea .ql-editor[contenteditable="true"]"', matched: 1, visible: 1 }]);
  assert.equal(ta.element.tag, 'div');
  assert.equal(ta.element.aria, 'Enter a prompt here');
  assert.deepEqual(ta.element.rect, { x: 300, y: 880, w: 650, h: 40 });
  assert.match(ta.element.path, /rich-textarea[^>]* > div\.ql-editor/);
  assert.equal(dg.elements.responses.found, false);
  assert.equal(dg.elements.responses.count, 0);
});
