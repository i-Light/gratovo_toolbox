// jsdom tests for the gem editor methods in content/gems.js.
// Run: cd pipeline/gemini_extension/test && npm install && npm test
//
// The page is a stand-in for the gem editor as calibrated on a live gem's edit
// page (2026-09-30): the fields by their ids, a Save button that is disabled
// until the form registers an edit, and a save state that reads "not saved" ->
// "saving..." -> "saved" (in the Arabic UI: لم يتم حفظ Gem -> جارٍ حفظ Gem... ->
// تم حفظ Gem), with Save disabled while the save is in flight and gone after it.
// What is pinned: the fields are written and read back verbatim, Save is waited
// for rather than looked up once, and only a real "saved" state confirms a save
// -- neither Save going disabled nor a "not saved" text that contains "saved".
import { test } from 'node:test';
import assertStrict from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8');
const locatorsSrc = read('content', 'locators.js');
const gemsSrc = read('content', 'gems.js');
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

const STATES = {
  en: { unsaved: 'Gem not saved', saving: 'Saving Gem...', saved: 'Gem saved' },
  ar: { unsaved: 'لم يتم حفظ Gem', saving: 'جارٍ حفظ Gem...', saved: 'تم حفظ Gem' },
};

function editorHtml({ name, description, instructions }) {
  const paras = instructions.split('\n').map((l) => (l ? '<p>' + l + '</p>' : '<p><br></p>')).join('');
  return `<!doctype html><html><body>
    <bots-creation-window>
      <div class="action-buttons-container"><div class="create-button-container">
        <button class="save-button" data-test-id="create-button" aria-label="Save gem edits" disabled>Update</button>
      </div></div>
      <div class="editor-container"><div class="editor-container-inner">
        <input id="gem-name-input" class="name-input" value="${name}">
        <textarea id="gem-description-input" class="description-input">${description}</textarea>
        <div class="instructions-input-container"><rich-textarea>
          <div class="ql-editor" contenteditable="true">${paras}</div>
        </rich-textarea></div>
      </div></div>
      <div class="save-state" role="status"></div>
    </bots-creation-window>
    <div class="preview"><div class="ql-editor" contenteditable="true" aria-label="Enter a prompt"></div></div>
  </body></html>`;
}

// `behaviour`: what the editor does. enableMs: when Save enables after an edit
// (null = never). outcome: 'saved' | 'unsaved' (the save fails back to "not
// saved") | 'hang' (stays "saving"). lang: which strings the save state shows.
// lagMs: how long the old save state stays up after the click (live: ~1.5 s).
function load(t, gem, behaviour = {}) {
  const b = Object.assign({ enableMs: 30, saveMs: 60, lagMs: 0, outcome: 'saved', lang: 'en' }, behaviour);
  const words = STATES[b.lang];
  const dom = new JSDOM(editorHtml(gem), { url: 'https://gemini.google.com/u/0/gems/edit/abc123def', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(locatorsSrc);
  w.GB.env.isVisible = testVisible;
  w.GB.env.log = () => {};
  w.eval(gemsSrc);
  w.eval(contentSrc);
  Object.assign(w.GeminiGems.timeouts, { editorMs: 500, valuesMs: 500, enableMs: 400, saveMs: 800, idMs: 200 });
  const d = w.document;
  const state = d.querySelector('.save-state');
  const clicks = [];
  const saved = [];
  const snapshot = () => ({
    name: d.querySelector('#gem-name-input').value,
    description: d.querySelector('#gem-description-input').value,
    instructions: Array.from(d.querySelectorAll('.instructions-input-container .ql-editor > p')).map((p) => p.textContent).join('\n'),
  });
  d.querySelector('.editor-container').addEventListener('input', () => {
    state.textContent = words.unsaved;
    if (b.enableMs != null) w.setTimeout(() => { const btn = d.querySelector('button.save-button'); if (btn) btn.disabled = false; }, b.enableMs);
  });
  d.querySelector('button.save-button').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    clicks.push(Date.now());
    btn.disabled = true;
    w.setTimeout(() => {
      state.textContent = words.saving;
      if (b.outcome === 'hang') return;
      w.setTimeout(() => {
        if (b.outcome === 'unsaved') { state.textContent = words.unsaved; btn.disabled = false; return; }
        saved.push(snapshot());
        state.textContent = words.saved;
        btn.remove();
      }, b.saveMs);
    }, b.lagMs);
  });
  t.after(() => w.close());
  return { w, GBC: w.GBC, clicks, saved };
}

const GEM = { name: 'Gratovo – Email drafter', description: 'Description', instructions: 'instructions here' };
const MULTILINE = '# TEST HEADER\n\nLine one.\n\n  - indented bullet\nلغة عربية في سطر\nLast line.';

test('gem_read returns the fields as the editor shows them', async (t) => {
  const { GBC } = load(t, { ...GEM, instructions: 'Line one\n\nLine three' });
  const r = await GBC.handle('gem_read', {});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.result, { url: 'https://gemini.google.com/gem/abc123def', gemId: 'abc123def', ...GEM, instructions: 'Line one\n\nLine three' });
});

for (const lang of ['en', 'ar']) {
  test(`gem_update waits for Save to enable, saves, and confirms on the "saved" state (${lang})`, async (t) => {
    const { GBC, clicks, saved } = load(t, GEM, { lang, enableMs: 150 });
    const r = await GBC.handle('gem_update', { description: 'Round-trip – وصف', instructions: MULTILINE });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.result.changed, ['description', 'instructions']);
    assert.equal(clicks.length, 1);
    assert.deepEqual(saved, [{ name: GEM.name, description: 'Round-trip – وصف', instructions: MULTILINE }]);
  });
}

test('gem_update with nothing different does not click Save', async (t) => {
  const { GBC, clicks } = load(t, GEM);
  const r = await GBC.handle('gem_update', { name: GEM.name, description: GEM.description });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.result.changed, []);
  assert.equal(clicks.length, 0);
});

test('Save that never enables is a GEM_SAVE_FAILED "save disabled", not a missing element', async (t) => {
  const { GBC, clicks } = load(t, GEM, { enableMs: null });
  const r = await GBC.handle('gem_update', { instructions: 'new' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'GEM_SAVE_FAILED');
  assert.equal(r.error.details.reason, 'save disabled');
  assert.equal(clicks.length, 0);
});

for (const lang of ['en', 'ar']) {
  test(`a save that ends "not saved" is a failure, though the text contains "saved" (${lang})`, async (t) => {
    const { GBC, clicks } = load(t, GEM, { lang, outcome: 'unsaved' });
    const r = await GBC.handle('gem_update', { instructions: 'new' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'GEM_SAVE_FAILED');
    assert.equal(r.error.details.reason, 'no confirmation');
    assert.equal(clicks.length, 1);
  });

  test(`Save going disabled while "saving" is not taken for a confirmation (${lang})`, async (t) => {
    const { GBC } = load(t, GEM, { lang, outcome: 'hang' });
    const r = await GBC.handle('gem_update', { instructions: 'new' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'GEM_SAVE_FAILED');
  });
}

test('a "saved" state left over from an earlier save only counts once it has changed', async (t) => {
  const { w, GBC, saved } = load(t, GEM, { lagMs: 400 });
  const state = w.document.querySelector('.save-state');
  // An editor that keeps showing the old "Gem saved" until the new save starts.
  w.document.querySelector('.editor-container').addEventListener('input', () => { state.textContent = 'Gem saved'; });
  state.textContent = 'Gem saved';
  const r = await GBC.handle('gem_update', { instructions: 'second edit' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(saved.length, 1, 'returned before the save finished');
});
