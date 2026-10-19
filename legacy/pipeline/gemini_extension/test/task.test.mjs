// jsdom tests for Gemini 4 Argon's composer additions in content/content.js:
// the chat/task toggle, skill mentions from the `@` list, task completion,
// raw answer text, and the thinking-level submenu of the model menu.
// Run: cd pipeline/gemini_extension/test && npm install && npm test
//
// Stand-ins for what the live page showed on 2026-10-14 (Arabic UI): the
// toggle is gem-segmented-button-row with data-value 0 (chat) / 40 (task) and
// the class gem-segmented-button-selected; `@` opens at-mentions-menu-v2 whose
// entries carry .at-mentions-v2-item-title; picking one puts a bold
// "@name" in the box; a task's response has spark-thinking-steps whose header
// gets the class `done` (and a check_circle last step) when it finishes, keeps
// a progress bar and never shows the answer's action buttons.
import { test } from 'node:test';
import assertStrict from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import fx from './fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8');
const locatorsSrc = read('content', 'locators.js');
const contentSrc = read('content', 'content.js');

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const assert = Object.assign((v, m) => assertStrict.ok(v, m), assertStrict, {
  deepEqual: (a, b, m) => assertStrict.deepEqual(plain(a), plain(b), m),
});

function testVisible(el) {
  if (!el || !el.isConnected || el.nodeType !== 1) return false;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hasAttribute('hidden')) return false;
    if (e.style && (e.style.display === 'none' || e.style.visibility === 'hidden')) return false;
  }
  return true;
}

const icon = (name) => `<mat-icon class="mat-icon" fonticon="${name}" data-mat-icon-name="${name}"></mat-icon>`;

function segmentedRow(selected) {
  const seg = (value, label) => `<gem-segmented-button class="gem-segmented-button${selected === value ? ' gem-segmented-button-selected' : ''}" data-value="${value}"><button class="gem-segmented-button-action"><span class="gem-segmented-button-content"><span class="gds-body-m">${label}</span></span></button></gem-segmented-button>`;
  return `<gem-segmented-button-row role="group" class="gem-segmented-button-row"><div class="gem-segmented-button-row-channel">${seg('0', 'دردشة')}${seg('40', 'مهمة')}</div></gem-segmented-button-row>`;
}

function taskResponse({ done, steps, answer, waiting }) {
  return `<model-response><div class="response-container">
    <spark-thinking-steps><div class="spark-thinking-container">
      <div role="button" class="thinking-header clickable${done ? ' done' : ''}"><span class="gds-body-l">${done ? 'Identified the secret word.' : 'ما زلتُ أفكّر'}</span></div>
      <div class="thinking-collapsible"><div class="steps-list">
        ${(steps || []).map((s) => `<div class="step-row is-history"><div class="step-marker"></div><div class="step-text">${s}</div></div>`).join('')}
        ${done ? `<div class="step-row is-history"><div class="step-marker">${icon('check_circle')}</div><span class="step-text">تم إنجاز المطلوب</span></div>` : ''}
      </div></div></div></spark-thinking-steps>
    <spark-waiting-for-user-banner>${waiting || ''}</spark-waiting-for-user-banner>
    <mat-progress-bar role="progressbar" class="mat-mdc-progress-bar"></mat-progress-bar>
    <message-content class="model-response-text">${answer ? `<div class="markdown markdown-main-panel">${answer}</div>` : ''}</message-content>
    <div class="response-footer${done ? ' complete' : ''}"></div>
  </div></model-response>`;
}

// A page that behaves like Gemini for these features. `skills`: the @ list.
function load(t, opts = {}) {
  const html = fx.page({ conversation: opts.conversation || '', prompt: fx.promptBox(), overlay: '' });
  const dom = new JSDOM(html, { url: 'https://gemini.google.com/u/1/app', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(locatorsSrc);
  w.eval(contentSrc);
  const GB = w.GB;
  GB.env.isVisible = testVisible;
  GB.env.log = () => {};
  w.GBC.timeouts.mentionMs = 600;
  const d = w.document;
  const ov = d.querySelector('.cdk-overlay-container');
  const later = (ms, fn) => w.setTimeout(fn, ms);
  const el = (s) => { const tpl = d.createElement('template'); tpl.innerHTML = s.trim(); return tpl.content.firstElementChild; };
  const box = () => d.querySelector('rich-textarea .ql-editor');
  const sent = [];
  const skills = opts.skills || ['gratovo-comms', 'cold-email-drafter'];

  // the toggle, above the prompt box
  d.querySelector('input-container').prepend(el(segmentedRow(opts.mode || '0')));
  d.querySelectorAll('gem-segmented-button').forEach((host) => host.querySelector('button').addEventListener('click', () => {
    d.querySelectorAll('gem-segmented-button').forEach((h) => h.classList.toggle('gem-segmented-button-selected', h === host));
  }));
  const mode = () => d.querySelector('gem-segmented-button.gem-segmented-button-selected').getAttribute('data-value') === '40' ? 'task' : 'chat';

  // typing: the send button follows the text; a trailing "@" opens the list
  function onInput() {
    const text = box().textContent;
    const wrap = d.querySelector('.trailing-actions-wrapper');
    wrap.querySelectorAll('.send-button, .mic-button').forEach((b) => b.remove());
    wrap.appendChild(el(text.trim()
      ? '<button class="mat-mdc-icon-button send-button submit" aria-label="Send message"><mat-icon data-mat-icon-name="send">send</mat-icon></button>'
      : '<button class="mat-mdc-icon-button mic-button" aria-label="Use microphone"><mat-icon data-mat-icon-name="mic">mic</mat-icon></button>'));
    ov.querySelectorAll('at-mentions-menu-v2').forEach((m) => m.remove());
    const m = /@([\w-]*)$/.exec(text);
    if (!m) return;
    const items = skills.filter((s) => s.startsWith(m[1]));
    const menu = el(`<at-mentions-menu-v2><infinite-scroller class="at-mentions-v2-panel"><div class="at-mentions-v2-group"><div class="at-mentions-v2-group-items">
      ${items.map((s) => `<button class="at-mentions-v2-item"><div class="at-mentions-v2-item-content"><span class="at-mentions-v2-item-title">${s}</span><span class="at-mentions-v2-item-subtitle">desc</span></div></button>`).join('')}
      <button class="at-mentions-v2-item"><div class="at-mentions-v2-item-content"><span class="at-mentions-v2-item-title">Gmail</span></div></button>
      </div></div></infinite-scroller></at-mentions-menu-v2>`);
    menu.querySelectorAll('button.at-mentions-v2-item').forEach((b) => b.addEventListener('click', () => {
      const name = b.querySelector('.at-mentions-v2-item-title').textContent;
      const p = box().lastElementChild;
      p.innerHTML = p.innerHTML.replace(/@[\w-]*$/, '') + '<strong>@' + name + '</strong>&nbsp;';
      menu.remove();
    }));
    ov.appendChild(menu);
  }
  d.addEventListener('input', onInput, true);

  // Enter submits: a chat answer, or a task that runs its steps and finishes
  box().addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const text = box().innerText !== undefined ? box().textContent : box().textContent;
    if (!text.trim()) return;
    // opts.refuse: like the throttled account (live 2026-10-14) — the prompt
    // flashes in the chat, goes back into the box, and a toast says to check
    // the connection
    if (opts.refuse) {
      sent.push({ text, refused: true });
      const q = el(fx.userQuery(text));
      d.querySelector('.conversation-container').appendChild(q);
      box().innerHTML = '<p><br></p>';
      later(120, () => {
        q.remove();
        box().innerHTML = '<p>' + text + '</p>';
        onInput();
        ov.appendChild(el('<mat-snack-bar-container><div>يُرجى التحقّق من الاتصال بالإنترنت ثم إعادة المحاولة.</div></mat-snack-bar-container>'));
      });
      return;
    }
    sent.push({ text, html: box().innerHTML, mode: mode(), level: (levels.find((l) => l[1]) || [null])[0] });
    const conv = d.querySelector('.conversation-container');
    conv.appendChild(el(fx.userQuery(text)));
    box().innerHTML = '<p><br></p>';
    onInput();
    if (mode() === 'chat') {
      conv.appendChild(el(fx.modelResponse({ generating: true, html: '<p>…</p>' })));
      later(150, () => { conv.lastElementChild.outerHTML = fx.modelResponse({ finished: true, html: '<p>Chat answer.</p>' }); });
      return;
    }
    const plan = opts.task || {};
    conv.appendChild(el(taskResponse({ done: false, steps: ['Looking for the secret word.'] })));
    later(120, () => { conv.lastElementChild.outerHTML = taskResponse({ done: false, steps: ['Looking for the secret word.', 'Using skill: gratovo-comms'] }); });
    if (plan.waiting) {
      later(260, () => { conv.lastElementChild.outerHTML = taskResponse({ done: false, steps: ['Looking for the secret word.'], waiting: plan.waiting, answer: '<p>Which mailbox should I use?</p>' }); });
      return;
    }
    later(plan.finishMs || 300, () => {
      conv.lastElementChild.outerHTML = taskResponse({ done: true, steps: ['Looking for the secret word.', 'Using skill: gratovo-comms', 'Executed scripts/hello.py'],
        answer: '<p>Secret word: ZEBRA-42</p><p>Script said: HELLO</p>' });
    });
  });

  // the model menu with Argon's thinking-level submenu
  const levels = opts.levels || [['منخفض', false], ['متوسط', true], ['مرتفع', false]];
  d.querySelector('button[data-test-id="bard-mode-menu-button"]').addEventListener('click', () => {
    ov.querySelectorAll('.mat-mdc-menu-panel').forEach((p) => p.remove());
    const panel = el(`<div class="mat-mdc-menu-panel" role="menu">
      <button class="mat-mdc-menu-item" role="menuitem"><span class="mode-title">3.1 Pro</span><span class="mode-desc">الاستدلال المتقدّم</span></button>
      <button class="mat-mdc-menu-item selected" role="menuitem"><span class="mode-title">4 Argon</span><span class="mode-desc">المهام المعقّدة</span>${icon('check')}</button>
      <button class="mat-mdc-menu-item thinking" role="menuitem"><span class="mode-title">مستوى التفكير</span>${icon('arrow_left')}</button>
    </div>`);
    // Live (2026-10-14): the levels open on HOVER and are rendered into the
    // same pane, under the models; a click on the row dismisses the whole menu.
    const thinking = panel.querySelector('.thinking');
    thinking.addEventListener('mouseover', () => {
      if (panel.querySelector('.level')) return;
      // opts.wrongFirst: the first hover shows rows that are not the levels
      // (seen live right after a model switch)
      if (opts.wrongFirst && !opts.wrongShown) {
        opts.wrongShown = true;
        panel.appendChild(el(`<button class="mat-mdc-menu-item level" role="menuitem"><span class="mode-title">3.8 Flash</span></button>`));
        return;
      }
      levels.forEach(([name, sel], i) => {
        const b = el(`<button class="mat-mdc-menu-item level${sel ? ' selected' : ''}" role="menuitem"><span class="mode-title">${name}</span><span class="mode-desc">d${i}</span>${sel ? icon('check') : ''}</button>`);
        // opts.stuck: the click closes the menu but the level does not change
        b.addEventListener('click', () => { if (!opts.stuck) levels.forEach((l, j) => { l[1] = j === i; }); ov.querySelectorAll('.mat-mdc-menu-panel').forEach((p) => p.remove()); });
        panel.appendChild(b);
      });
    });
    thinking.addEventListener('click', () => ov.querySelectorAll('.mat-mdc-menu-panel').forEach((p) => p.remove()));
    ov.appendChild(panel);
  });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.querySelectorAll('.mat-mdc-menu-panel').forEach((p) => p.remove()); });

  t.after(() => w.close());
  return { w, d, GB, GBC: w.GBC, sent, levels, mode };
}

test('get_mode / set_mode follow the segmented toggle', async (t) => {
  const { GBC, mode } = load(t);
  assert.deepEqual(GBC.getMode(), { mode: 'chat', available: true });
  const r = await GBC.handle('set_mode', { mode: 'task' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.result, { mode: 'task', changed: true });
  assert.equal(mode(), 'task');
  const again = await GBC.handle('set_mode', { mode: 'task' });
  assert.equal(again.result.changed, false);
  const bad = await GBC.handle('set_mode', { mode: 'deep' });
  assert.equal(bad.error.code, 'BAD_PARAMS');
});

test('a page without the toggle says so, with the healing report', async (t) => {
  const { GBC, d } = load(t);
  d.querySelector('gem-segmented-button-row').remove();
  const r = await GBC.handle('set_mode', { mode: 'task', timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'ELEMENT_NOT_FOUND');
  assert.equal(r.error.details.element, 'modeTask');
  assert.ok(Array.isArray(r.error.details.tried) && r.error.details.tried.length >= 2);
});

test('send with a skill picks it from the @ list and puts the text after it', async (t) => {
  const { GBC, sent } = load(t);
  const r = await GBC.handle('send', { text: 'Draft the reply.', skills: ['gratovo-comms'], timeoutMs: 5000 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /<strong>@gratovo-comms<\/strong>/, 'the mention is the picked entry, not typed text');
  assert.match(sent[0].text, /@gratovo-comms\s+Draft the reply\./);
  assert.equal(r.result.text, 'Chat answer.');
});

test('a skill that is not in the @ list is SKILL_NOT_FOUND with what the list offers, and nothing is sent', async (t) => {
  const { GBC, sent } = load(t);
  const r = await GBC.handle('send', { text: 'x', skills: ['no-such-skill'], timeoutMs: 3000 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SKILL_NOT_FOUND');
  assert.ok(r.error.details.available.includes('gratovo-comms'), JSON.stringify(r.error.details));
  assert.equal(sent.length, 0);
});

test('send as a task waits for the step list to finish and returns the answer, steps and raw text', async (t) => {
  const { GBC, sent } = load(t);
  const r = await GBC.handle('send', { text: 'Run the probe.', skills: ['gratovo-comms'], mode: 'task', timeoutMs: 8000 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(sent[0].mode, 'task');
  assert.equal(r.result.mode, 'task');
  assert.equal(r.result.task.done, true);
  assert.deepEqual(r.result.task.steps, ['Looking for the secret word.', 'Using skill: gratovo-comms', 'Executed scripts/hello.py', 'تم إنجاز المطلوب']);
  assert.equal(r.result.text, 'Secret word: ZEBRA-42 Script said: HELLO', 'the answer, not the step list');
  assert.ok(!/Looking for/.test(r.result.text));
});

test('a task that stops to ask the user returns with the question instead of hanging', async (t) => {
  const { GBC } = load(t, { task: { waiting: 'Gemini needs your input' } });
  const r = await GBC.handle('send', { text: 'Do it.', mode: 'task', timeoutMs: 8000 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.result.task.done, false);
  assert.equal(r.result.task.waitingForUser, 'Gemini needs your input');
  assert.equal(r.result.text, 'Which mailbox should I use?');
});

test('isGenerating: a running task is generating; a finished one is not, despite its progress bar and missing actions', (t) => {
  const running = load(t, { conversation: fx.userQuery('go') + taskResponse({ done: false, steps: ['a'] }) });
  assert.equal(running.GB.isGenerating().generating, true);
  assert.equal(running.GB.isGenerating().signals.task, true);
  const finished = load(t, { conversation: fx.userQuery('go') + taskResponse({ done: true, steps: ['a'], answer: '<p>ok</p>' }) });
  const g = finished.GB.isGenerating();
  assert.equal(g.signals.spinner, true, 'the progress bar is still there');
  assert.equal(g.signals.actionsMissing, true, 'tasks show no action buttons');
  assert.equal(g.generating, false);
  assert.deepEqual(finished.GBC.getTask().task, { done: true, waitingForUser: '', headline: 'Identified the secret word.', steps: ['a', 'تم إنجاز المطلوب'] });
});

test('textRaw keeps the paragraphs of the answer', (t) => {
  const { GBC, d } = load(t, { conversation: fx.userQuery('go') + fx.modelResponse({ finished: true, html: '<p>Hi Sam,</p><p>Line two.</p>' }) });
  // jsdom has no innerText: emulate the browser's paragraph breaks.
  Object.defineProperty(d.querySelector('.markdown').constructor.prototype, 'innerText', { configurable: true, get() { return Array.from(this.querySelectorAll('p')).map((p) => p.textContent).join('\n\n') || this.textContent; } });
  const last = GBC.lastResponseResult();
  assert.equal(last.text, 'Hi Sam, Line two.');
  assert.equal(last.textRaw, 'Hi Sam,\n\nLine two.');
});

test('list_models marks the thinking-level row as a submenu, never a model', async (t) => {
  const { GBC } = load(t);
  const r = await GBC.handle('list_models', {});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const rows = r.result.map(({ name, selected, submenu }) => ({ name, selected, submenu }));
  assert.deepEqual(rows, [
    { name: '3.1 Pro', selected: false, submenu: false },
    { name: '4 Argon', selected: true, submenu: false },
    { name: 'مستوى التفكير', selected: false, submenu: true },
  ]);
  const wrong = await GBC.handle('set_model', { model: 'مستوى التفكير' });
  assert.equal(wrong.error.code, 'MODEL_NOT_FOUND', 'a submenu row cannot be chosen as the model');
});

test('list_thinking_levels / set_thinking_level go through the submenu', async (t) => {
  const { GBC, levels, d } = load(t);
  const list = await GBC.handle('list_thinking_levels', {});
  assert.equal(list.ok, true, JSON.stringify(list.error));
  assert.deepEqual(list.result.levels.map((l) => l.name), ['منخفض', 'متوسط', 'مرتفع']);
  assert.equal(list.result.current, 'متوسط');
  assert.equal(d.querySelectorAll('.mat-mdc-menu-panel').length, 0, 'menus closed again');
  const set = await GBC.handle('set_thinking_level', { level: 'مرتفع' });
  assert.equal(set.ok, true, JSON.stringify(set.error));
  assert.deepEqual(set.result, { level: 'مرتفع', changed: true, verified: true });
  assert.deepEqual(levels.map((l) => l[1]), [false, false, true]);
  const missing = await GBC.handle('set_thinking_level', { level: 'extreme' });
  assert.equal(missing.error.code, 'MODEL_NOT_FOUND');
  assert.deepEqual(missing.error.details.available, ['منخفض', 'متوسط', 'مرتفع']);
});

test('set_thinking_level understands English level names on the Arabic page', async (t) => {
  const { GBC, levels } = load(t);
  const high = await GBC.handle('set_thinking_level', { level: 'high' });
  assert.equal(high.ok, true, JSON.stringify(high.error));
  assert.equal(high.result.level, 'مرتفع');
  assert.deepEqual(levels.map((l) => l[1]), [false, false, true]);
  const low = await GBC.handle('set_thinking_level', { level: 'LOW' });
  assert.equal(low.result.level, 'منخفض');
  const same = await GBC.handle('set_thinking_level', { level: 'low' });
  assert.deepEqual(same.result, { level: 'منخفض', changed: false, verified: true });
});

test('send with thinking sets the level and reads it back before typing, and reports it', async (t) => {
  const { GBC, sent, levels } = load(t, { levels: [['منخفض', true], ['متوسط', false], ['مرتفع', false]] });
  const r = await GBC.handle('send', { text: 'Mine this call.', thinking: 'high', newChat: true, timeoutMs: 5000 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].level, 'مرتفع', 'the level was already high when the prompt went out');
  assert.equal(r.result.thinking, 'مرتفع');
  assert.deepEqual(levels.map((l) => l[1]), [false, false, true]);
  const plain = await GBC.handle('send', { text: 'Again.', timeoutMs: 5000 });
  assert.equal(plain.result.thinking, null, 'no level asked, none claimed');
});

test('a level that does not take is THINKING_NOT_SET and nothing is sent', async (t) => {
  const { GBC, sent, d } = load(t, { stuck: true, levels: [['منخفض', true], ['متوسط', false], ['مرتفع', false]] });
  const r = await GBC.handle('send', { text: 'Mine this call.', thinking: 'high', timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'THINKING_NOT_SET');
  assert.equal(r.error.details.clicked, true);
  assert.equal(sent.length, 0);
  assert.equal(d.querySelectorAll('.mat-mdc-menu-panel').length, 0, 'menus closed again');
});

test('a thinking menu that first shows the wrong rows is opened again, not given up on', async (t) => {
  const { GBC, sent } = load(t, { wrongFirst: true, levels: [['منخفض', true], ['متوسط', false], ['مرتفع', false]] });
  const r = await GBC.handle('send', { text: 'Mine this call.', thinking: 'high', timeoutMs: 8000 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.result.thinking, 'مرتفع');
  assert.equal(sent[0].level, 'مرتفع');
});

test('new chat on an empty chat whose box still holds an untaken prompt clears it, and the next send goes out', async (t) => {
  const { GBC, d, sent } = load(t);
  const box = d.querySelector('rich-textarea .ql-editor');
  box.innerHTML = '<p>a long prompt that the page never took</p>';
  const r = await GBC.handle('new_chat', {});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(box.textContent.trim(), '');
  const s2 = await GBC.handle('send', { text: 'Next prompt.', newChat: true, timeoutMs: 5000 });
  assert.equal(s2.ok, true, JSON.stringify(s2.error));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Next prompt\./);
});

test('a prompt the page refuses with a toast fails at once with its text, and is not submitted again', async (t) => {
  const { GBC, sent } = load(t, { refuse: true });
  const started = Date.now();
  const r = await GBC.handle('send', { text: 'Mine this call.', timeoutMs: 60000 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'GEMINI_ERROR');
  assert.match(r.error.message, /الاتصال بالإنترنت/);
  assert.equal(r.error.details.refused, true);
  assert.equal(sent.length, 1, 'one submit, no escalation to a second');
  assert.ok(Date.now() - started < 10000, 'no wait for an answer that cannot come');
});

test('a new chat that does not reset the page (chats not saved, still on /app) asks the background to reload it', async (t) => {
  const { GBC } = load(t, { conversation: fx.userQuery('first') + fx.modelResponse({ finished: true, html: '<p>Answer.</p>' }) });
  const r = await GBC.handle('new_chat', { timeoutMs: 400 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'TIMEOUT');
  assert.equal(r.error.details.element, 'newChat');
  assert.equal(r.error.details.fallbackUrl, 'https://gemini.google.com/u/1/app');
});
