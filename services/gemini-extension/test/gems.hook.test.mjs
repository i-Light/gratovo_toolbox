// jsdom tests for the hook that lets content/gems.js contribute methods to
// content/content.js (CONTRACT_GEMINI.md §3.4, §6).
// Run: pnpm --filter @gratovo/gemini-extension test
//
// What is pinned: gems.js registers an empty group; content.js merges a group's
// `handlers` into its method table (at load, and again on each call so a group
// registered late still works), never replaces one of its own methods, honours
// the group's `instant` list, and answers an unknown method exactly as before.
// The gem methods themselves are tested in gems.test.mjs; the mechanism tests
// here swap in an empty stand-in group (`emptyGroup`) so they do not depend on them.
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
const gemsSrc = read('content', 'gems.js');
const contentSrc = read('content', 'content.js');

// jsdom has no layout: "visible" = connected and nothing up the tree hides it
// (the same stand-in locators.test.mjs uses).
function parseRect(el) {
  const v = el.getAttribute && el.getAttribute('data-rect');
  if (!v) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = v.split(',').map(Number);
  return { x, y, w, h };
}
function testVisible(el) {
  if (!el || !el.isConnected || el.nodeType !== 1) return false;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hasAttribute('hidden')) return false;
    if (e.style && (e.style.display === 'none' || e.style.visibility === 'hidden')) return false;
  }
  return true;
}

// Objects built inside the jsdom realm have another Object.prototype, which
// deepStrictEqual rejects; compare their JSON shape instead.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const assert = Object.assign((v, m) => assertStrict.ok(v, m), assertStrict, {
  deepEqual: (a, b, m) => assertStrict.deepEqual(plain(a), plain(b), m),
});

// Loads the scripts in manifest order into a fresh page. `beforeContent(w)` runs
// after gems.js (when there is one) and before content.js — the moment a real
// gem handler would already be registered. `log` receives what content.js logs.
function load(t, { withGems = true, emptyGroup = false, beforeContent, log = () => {}, html = fx.emptyChat(), url = 'https://gemini.google.com/app' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(locatorsSrc);
  w.GB.env.isVisible = testVisible;
  w.GB.env.rect = parseRect;
  w.GB.env.log = log;
  if (withGems) w.eval(gemsSrc);
  if (emptyGroup) w.eval('globalThis.GeminiGems = { handlers: {}, instant: [] };');
  if (beforeContent) beforeContent(w);
  w.eval(contentSrc);
  t.after(() => w.close());
  return { w, GBC: w.GBC };
}

test('gems.js registers the gem methods, all of them instant', (t) => {
  const { w, GBC } = load(t);
  const methods = ['gem_read', 'gem_create', 'gem_update', 'gem_diagnostics'];
  assert.deepEqual(Object.keys(w.GeminiGems.handlers).sort(), methods.slice().sort());
  assert.deepEqual(w.GeminiGems.instant.slice().sort(), methods.slice().sort());
  for (const method of methods) assert.equal(typeof GBC.METHODS[method], 'function', method);
});

test('with an empty group the gem methods are unknown — exactly as before gems.js', async (t) => {
  const { GBC } = load(t, { emptyGroup: true });
  for (const method of ['gem_read', 'gem_create', 'gem_update']) {
    const r = await GBC.handle(method, {});
    assert.equal(r.ok, false, method);
    assert.equal(r.error.code, 'BAD_PARAMS', method);
    assert.ok(r.error.message.includes('Unknown method "' + method + '"'), method);
  }
  assert.equal(Object.keys(GBC.METHODS).some((name) => name.startsWith('gem_')), false);
});

test('without gems.js loaded at all, content.js still loads and unknown methods still fail', async (t) => {
  const { GBC } = load(t, { withGems: false });
  const r = await GBC.handle('gem_read', {});
  assert.equal(r.error.code, 'BAD_PARAMS');
  const ok = await GBC.handle('get_url', {});
  assert.equal(ok.ok, true);
});

test('handlers registered before content.js loads are in the method table', async (t) => {
  const { GBC } = load(t, {
    emptyGroup: true,
    beforeContent: (w) => {
      w.GeminiGems.handlers.gem_read = async (params) => ({ url: params.url, name: 'A gem' });
      w.GeminiGems.handlers.gem_create = (params) => ({ created: params.name });
    },
  });
  assert.equal(typeof GBC.METHODS.gem_read, 'function');
  assert.equal(typeof GBC.METHODS.gem_create, 'function');
  assert.deepEqual(await GBC.handle('gem_read', { url: 'https://gemini.google.com/gem/abc' }),
    { ok: true, result: { url: 'https://gemini.google.com/gem/abc', name: 'A gem' } });
  // A synchronous handler works too.
  assert.deepEqual(await GBC.handle('gem_create', { name: 'N' }), { ok: true, result: { created: 'N' } });
  // Something the group does not define is still unknown.
  assert.equal((await GBC.handle('gem_update', {})).error.code, 'BAD_PARAMS');
});

test('a group registered after content.js loaded is picked up on the next call', async (t) => {
  const { w, GBC } = load(t, { emptyGroup: true });
  assert.equal((await GBC.handle('gem_read', {})).error.code, 'BAD_PARAMS');
  w.GeminiGems.handlers.gem_read = () => ({ late: true });
  assert.deepEqual(await GBC.handle('gem_read', {}), { ok: true, result: { late: true } });
  assert.equal(typeof GBC.METHODS.gem_read, 'function');
});

test('a group can never replace a built-in method; the clash is logged once', async (t) => {
  const warnings = [];
  const { GBC } = load(t, {
    log: (level, message) => warnings.push([level, message]),
    beforeContent: (w) => {
      w.GeminiGems.handlers.get_url = () => ({ hijacked: true });
      w.GeminiGems.handlers.gem_read = () => ({ fine: true });
    },
  });
  const clashes = () => warnings.filter(([level, message]) => level === 'warn' && /replace the built-in method "get_url"/.test(message)).length;
  assert.equal(clashes(), 1, 'the clash is reported when the group is merged');

  const url = await GBC.handle('get_url', {});
  assert.deepEqual(url, { ok: true, result: { url: 'https://gemini.google.com/app', accountIndex: 0 } });
  assert.deepEqual(await GBC.handle('gem_read', {}), { ok: true, result: { fine: true } });
  await GBC.handle('get_url', {});
  await GBC.handle('get_url', {});
  assert.equal(clashes(), 1, 'and not again on every call');
});

test('non-function handlers and a malformed group are ignored, not fatal', async (t) => {
  const { w, GBC } = load(t, {
    beforeContent: (win) => {
      win.GeminiGems.handlers.gem_read = 'not a function';
      win.GeminiGems.handlers.gem_create = null;
      win.GeminiGems.handlers.gem_update = () => ({ ok: 1 });
    },
  });
  assert.equal((await GBC.handle('gem_read', {})).error.code, 'BAD_PARAMS');
  assert.equal((await GBC.handle('gem_create', {})).error.code, 'BAD_PARAMS');
  assert.deepEqual(await GBC.handle('gem_update', {}), { ok: true, result: { ok: 1 } });
  w.GeminiGems = 'nonsense';
  assert.equal((await GBC.handle('get_url', {})).ok, true);
  w.GeminiGems = { handlers: 42, instant: 'x' };
  assert.equal((await GBC.handle('get_url', {})).ok, true);
});

test('a handler that throws gets the normal error shape', async (t) => {
  const { GBC } = load(t, {
    beforeContent: (w) => {
      w.GeminiGems.handlers.gem_read = () => { throw new Error('kaboom'); };
      w.GeminiGems.handlers.gem_create = () => {
        const err = new Error('the editor refused the save');
        err.code = 'GEM_SAVE_FAILED';
        err.details = { reason: 'name too long' };
        throw err;
      };
    },
  });
  const boom = await GBC.handle('gem_read', {});
  assert.equal(boom.ok, false);
  assert.equal(boom.error.code, 'INTERNAL');
  assert.equal(boom.error.message, 'kaboom');
  const refused = await GBC.handle('gem_create', {});
  assert.equal(refused.error.code, 'GEM_SAVE_FAILED');
  assert.deepEqual(refused.error.details, { reason: 'name too long' });
});

test('a gem-specific code can be raised with the extension’s own gbError', async (t) => {
  const { GBC } = load(t, {
    beforeContent: (w) => {
      // gems.js loads after locators.js, so GB is there; handlers use it at call time.
      w.GeminiGems.handlers.gem_update = () => { throw w.GB.gbError('GEM_UI_NOT_FOUND', 'no instructions box', { element: 'gemInstructions', tried: [] }); };
    },
  });
  const r = await GBC.handle('gem_update', {});
  assert.equal(r.error.code, 'GEM_UI_NOT_FOUND');
  assert.equal(r.error.details.element, 'gemInstructions');
});

test('`instant` methods answer at once even where the chat prompt box is absent', async (t) => {
  // A gem editor page has no chat prompt box. A method that is not instant waits
  // (up to timeouts.appRenderMs) for one before it runs; an instant one does not.
  const { w } = load(t, {
    html: '<!doctype html><html><body><main id="gem-editor"><h1>New gem</h1></main></body></html>',
    url: 'https://gemini.google.com/gems/create',
    emptyGroup: true,
    beforeContent: (win) => {
      win.GeminiGems.handlers.gem_read = () => ({ instant: true });
      win.GeminiGems.handlers.gem_update = () => ({ instant: false });
      win.GeminiGems.instant.push('gem_read');
    },
  });
  w.GBC.timeouts.appRenderMs = 400;

  let started = Date.now();
  assert.deepEqual(await w.GBC.handle('gem_read', {}), { ok: true, result: { instant: true } });
  const instantMs = Date.now() - started;
  started = Date.now();
  assert.deepEqual(await w.GBC.handle('gem_update', {}), { ok: true, result: { instant: false } });
  const waitedMs = Date.now() - started;
  assert.ok(instantMs < 250, 'instant took ' + instantMs + ' ms');
  assert.ok(waitedMs >= 300, 'non-instant waited only ' + waitedMs + ' ms for the app to render');
});

test('the manifest loads gems.js and skills.js between locators.js and content.js, and injection uses the same order', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const files = manifest.content_scripts[0].js;
  assert.deepEqual(files, ['compat.js', 'content/locators.js', 'content/gems.js', 'content/skills.js', 'content/content.js']);
  // background.js re-injects the same files into a tab that has none (injectContent).
  const background = read('background.js');
  const injected = /const CONTENT_FILES = (\[[^\]]*\]);/.exec(background);
  assert.ok(injected, 'CONTENT_FILES not found in background.js — if injection was restructured, update this test: it pins that on-demand injection loads the same files, in the same order, as the manifest (gems.js included)');
  assert.deepEqual(JSON.parse(injected[1].replace(/'/g, '"')), files);
});

test('background.js routes the gem methods to the Gemini tab, with deadlines longer than an ordinary call', () => {
  const background = read('background.js');
  const routed = /const CONTENT_METHODS = new Set\((\[[^\]]*\])\);/.exec(background);
  assert.ok(routed, 'CONTENT_METHODS not found in background.js — if routing was restructured, update this test: it pins that gem_read/gem_create/gem_update reach the Gemini tab');
  const methods = JSON.parse(routed[1].replace(/'/g, '"'));
  for (const method of ['gem_read', 'gem_create', 'gem_update']) assert.ok(methods.includes(method), method + ' is not routed');
  // The methods that were routed before still are.
  for (const method of ['diagnostics', 'get_account', 'set_model', 'get_text', 'stop', 'ping']) assert.ok(methods.includes(method), method);

  const long = /const LONG_CONTENT_METHODS = (\{[^}]*\});/.exec(background);
  assert.ok(long, 'LONG_CONTENT_METHODS not found in background.js — if deadlines were restructured, update this test: gem_* must not get the 15 s default');
  const deadlines = JSON.parse(long[1].replace(/(\w+):/g, '"$1":'));
  for (const method of ['gem_read', 'gem_create', 'gem_update']) assert.ok(deadlines[method] > 15000, method + ' has no long deadline');
  assert.equal(deadlines.send, 180000);
});
