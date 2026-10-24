// jsdom tests for the Skills page methods in content/skills.js.
// Run: pnpm --filter @gratovo/gemini-extension test
//
// The page is a stand-in for gemini.google.com/customize/skills as calibrated
// on the live page (2026-10-14, Arabic UI): cards grouped under "نشطة" (active)
// and "غير نشطة" (inactive) section titles, each card's primary button labelled
// "<name>, <description>" and a "more" menu whose entries are told apart by
// icon; Create -> Upload opens skill-folder-upload-modal; a drop runs
// "uploading N%" -> "uploaded, saving metadata" -> "preparing the editor" and
// lands in the skill editor (create) or closes after saving (replace, which
// also turns the skill off); the file tree is a folder navigator with a back
// button, and a file opens in a read-only viewer.
// What is pinned: names come from the card labels, state from the section a
// card is in (never from text that merely contains "نشطة"), every action waits
// for the page to confirm it, a refused or misnamed upload is an error and
// never saved, and a read walks every folder.
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
const skillsSrc = read('content', 'skills.js');
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

// skills: [{name, description, active, files: {path: content}}]
function pageHtml() {
  return `<!doctype html><html><body>
    <bard-sidenav><a href="/app">Gemini</a></bard-sidenav>
    <main><customize-page>
      <div role="tablist"><button role="tab" data-tab="skills" aria-selected="true">المهارات</button></div>
      <div class="content-container">
        <div class="header-actions"><button class="mdc-button mat-mdc-menu-trigger mat-tonal-button">إنشاء ${icon('arrow_drop_down')}</button></div>
        <section class="category-section" data-kind="active"><span class="category-title gds-body-l">نشطة</span><div class="skills-grid"></div></section>
        <section class="category-section" data-kind="inactive"><span class="category-title gds-body-l">غير نشطة</span><div class="skills-grid"></div></section>
        <section class="category-section" data-kind="templates"><span class="category-title gds-body-l">مقترحة</span><div class="skills-grid">
          <customize-card><button class="card-primary-action" aria-label="الاستعداد للاجتماعات, يمكنك التحضير لأي اجتماع"></button><button aria-label="إضافة">${icon('add')}</button></customize-card>
          <customize-card><button class="card-primary-action" aria-label="الحصول على المزيد من وجهات النظر, يمكنك الحصول على 3 إلى 5 وجهات نظر"></button><button aria-label="إضافة">${icon('add')}</button></customize-card>
        </div></section>
      </div>
    </customize-page></main>
    <div class="cdk-overlay-container"></div>
  </body></html>`;
}

// `opts.upload`: what a drop does — {outcome: 'ok' | 'refused' | 'hang', name}.
function load(t, skills, opts = {}) {
  const dom = new JSDOM(pageHtml(), { url: 'https://gemini.google.com/u/1/customize/skills', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(locatorsSrc);
  w.GB.env.isVisible = testVisible;
  w.GB.env.log = () => {};
  w.eval(gemsSrc);
  w.eval(skillsSrc);
  w.eval(contentSrc);
  Object.assign(w.GeminiSkills.timeouts, { pageMs: 600, menuMs: 400, dialogMs: 600, uploadMs: 1500, editorMs: 800, saveMs: 800, toggleMs: 800, treeMs: 400, viewerMs: 500 });
  const d = w.document;
  const ov = d.querySelector('.cdk-overlay-container');
  const state = { skills: skills.map((s) => Object.assign({ files: {} }, s)), saved: [], toasts: [], clicks: [] };
  const later = (ms, fn) => w.setTimeout(fn, ms);
  const el = (html) => { const tpl = d.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; };

  function toast(text) {
    state.toasts.push(text);
    ov.querySelectorAll('mat-snack-bar-container').forEach((x) => x.remove());
    const s = el(`<mat-snack-bar-container><simple-snack-bar>${text}</simple-snack-bar></mat-snack-bar-container>`);
    ov.appendChild(s);
    later(400, () => s.remove());
  }

  function render() {
    for (const kind of ['active', 'inactive']) {
      const grid = d.querySelector(`section[data-kind="${kind}"] .skills-grid`);
      grid.innerHTML = '';
      for (const s of state.skills.filter((x) => x.active === (kind === 'active'))) {
        const card = el(`<customize-card><button class="card-primary-action" aria-label="${s.name}, ${s.description}"></button><button aria-label="مزيد من الخيارات">${icon('more_horiz')}</button></customize-card>`);
        card.querySelector('button.card-primary-action').addEventListener('click', () => openEditor(s, false));
        card.querySelector('button[aria-label="مزيد من الخيارات"]').addEventListener('click', () => openMenu(s));
        grid.appendChild(card);
      }
    }
  }

  function closeOverlay() { ov.querySelectorAll('.mat-mdc-menu-panel, mat-dialog-container').forEach((x) => x.remove()); }

  function menu(entries) {
    closeOverlay();
    const panel = el('<div class="mat-mdc-menu-panel" role="menu"></div>');
    for (const [label, ic, fn] of entries) {
      const item = el(`<button role="menuitem" class="mat-mdc-menu-item">${icon(ic)}<span>${label}</span></button>`);
      item.addEventListener('click', () => { panel.remove(); fn(); });
      panel.appendChild(item);
    }
    ov.appendChild(panel);
  }

  function openMenu(s) {
    const entries = [];
    if (s.active) entries.push(['الاستخدام الآن', 'contract', () => {}]);
    entries.push(['التعديل باستخدام Gemini', 'chat_spark', () => {}], ['التعديل يدويًا', 'edit_note', () => {}], ['تنزيل', 'download', () => {}],
      ['استبدال المهارة', 'upload', () => openUpload(s)]);
    if (s.active) entries.push(['إيقاف', 'block', () => later(120, () => { s.active = false; render(); toast('المهارة غير مفعّلة'); })]);
    else entries.push(['تفعيل', 'check_circle', () => later(120, () => { s.active = true; render(); toast('تم تفعيل المهارة'); })]);
    entries.push(['حذف', 'delete', () => confirmDelete(s)]);
    menu(entries);
  }

  function confirmDelete(s) {
    const dlg = el('<mat-dialog-container role="dialog"><h2>هل تريد حذف المهارة؟</h2><p>لا يمكن التراجع عن هذا الإجراء</p><button class="cancel">إلغاء</button><button class="ok">حذف</button></mat-dialog-container>');
    dlg.querySelector('.cancel').addEventListener('click', () => dlg.remove());
    dlg.querySelector('.ok').addEventListener('click', () => { dlg.remove(); later(150, () => { state.skills = state.skills.filter((x) => x !== s); render(); toast('تم حذف المهارة'); }); });
    ov.appendChild(dlg);
  }

  d.querySelector('customize-page button.mat-mdc-menu-trigger').addEventListener('click', () => {
    menu([['الإنشاء باستخدام Gemini', 'chat_bubble', () => {}], ['الإنشاء يدويًا', 'edit', () => {}], ['تحميل', 'upload', () => openUpload(null)]]);
  });

  let uploadTarget = null;
  function openUpload(replacing) {
    closeOverlay();
    uploadTarget = replacing;
    ov.appendChild(el(`<mat-dialog-container role="dialog"><skill-folder-upload-modal><h2 class="modal-title">تحميل مهارة</h2>
      <ul><li>تستخدم kebab-case لاسم المهارة في ملف SKILL.md</li></ul>
      <div class="upload-area"><div class="drag-text">اسحب أو اختَر <button class="upload-link">ملفات</button> أو <button class="upload-link">مجلدًا</button></div></div>
      </skill-folder-upload-modal></mat-dialog-container>`));
  }

  // What the background's drop_files does, as far as the page can tell.
  function drop(skill) {
    const dlg = ov.querySelector('skill-folder-upload-modal');
    const area = dlg.querySelector('.upload-area');
    const status = (text) => { area.innerHTML = `<div class="status">${text}</div>`; };
    const outcome = (opts.upload && opts.upload.outcome) || 'ok';
    status('جارٍ التحميل… %40');
    later(80, () => {
      if (outcome === 'refused') { status('تعذّر تحميل المهارة: ملف SKILL.md غير صالح'); return; }
      if (outcome === 'hang') return;
      status('جارٍ التحميل… %100');
      later(80, () => {
        status('تم التحميل بنجاح. جارٍ حفظ البيانات الوصفية…');
        later(80, () => {
          if (uploadTarget) {
            Object.assign(uploadTarget, skill, { name: uploadTarget.name, active: false });
            dlg.closest('mat-dialog-container').remove();
            render();
            return;
          }
          status('جارٍ تحضير المحرِّر…');
          later(80, () => { dlg.closest('mat-dialog-container').remove(); openEditor(Object.assign({ active: true, files: {} }, skill), true); });
        });
      });
    });
  }

  // The editor over the list: fields, the file tree popover, the viewer.
  function openEditor(s, isNew) {
    d.querySelectorAll('customize-page section').forEach((x) => { x.hidden = true; });
    const page = d.querySelector('customize-page');
    const host = el(`<skill-editor-container><skill-folder-manager>
      <div class="manager-header"><button class="back-to-skills-btn" aria-label="الرجوع إلى المهارات">${icon('arrow_back')}<span>المهارات</span></button>
        <div class="editor-actions"><gem-button class="save-button"><button class="mdc-button--unelevated" aria-label="حفظ المهارة"><span class="save-label">${isNew ? 'إنشاء' : 'حفظ'}</span></button></gem-button>
        ${Object.keys(s.files).length ? `<button class="file-tree-button" aria-label="فتح شجرة الملفات">${icon('folder')}</button>` : ''}</div></div>
      <div class="folder-manager-container"><div class="skill-detail-panel"><skill-editor><div class="editor-body">
        <input type="text" class="editor-title-input" aria-label="اسم المهارة">
        <div role="textbox" class="description-text" contenteditable="plaintext-only" aria-label="وصف المهارة"></div>
        <div role="textbox" class="content-editable" contenteditable="plaintext-only" aria-label="تعليمات المهارة"></div>
      </div></skill-editor></div></div></skill-folder-manager></skill-editor-container>`);
    page.appendChild(host);
    host.querySelector('input').value = s.name;
    host.querySelector('.description-text').textContent = s.description;
    host.querySelector('.content-editable').textContent = s.instructions || '';
    const close = () => { host.remove(); closeOverlay(); d.querySelectorAll('customize-page section').forEach((x) => { x.hidden = false; }); render(); };
    host.querySelector('.back-to-skills-btn').addEventListener('click', () => {
      if (!isNew) { close(); return; }
      const dlg = el('<mat-dialog-container role="dialog"><h2>هل تريد المغادرة بدون حفظ التغييرات؟</h2><button class="c">إلغاء</button><button class="l">مغادرة</button></mat-dialog-container>');
      dlg.querySelector('.c').addEventListener('click', () => dlg.remove());
      dlg.querySelector('.l').addEventListener('click', () => { dlg.remove(); close(); });
      ov.appendChild(dlg);
    });
    host.querySelector('.save-button button').addEventListener('click', () => {
      state.clicks.push('save');
      later(150, () => {
        if (isNew) { state.skills.push(s); state.saved.push(s.name); toast('تم إنشاء المهارة'); }
        close();
      });
    });
    const treeButton = host.querySelector('.file-tree-button');
    if (treeButton) treeButton.addEventListener('click', () => openTree(s, host, ''));
  }

  function openTree(s, host, dir) {
    ov.querySelectorAll('.file-tree-popover').forEach((x) => x.remove());
    const paths = Object.keys(s.files);
    const children = new Map();
    for (const p of ['SKILL.md', ...paths]) {
      if (!p.startsWith(dir)) continue;
      const rest = p.slice(dir.length);
      const [head, ...tail] = rest.split('/');
      children.set(head, tail.length ? 'folder' : 'file');
    }
    const pop = el(`<div class="file-tree-popover"><div class="file-tree-container"><div class="sidebar-header"><span>الملفات</span>
      <button data-test-id="nav-back-button" aria-label="رجوع" ${dir ? '' : 'disabled'}>${icon('chevron_left')}</button></div><div class="tree-items"></div></div></div>`);
    const items = pop.querySelector('.tree-items');
    for (const [name, kind] of children) {
      const node = el(`<div role="button" data-test-id="file-tree-node" class="tree-node ${kind === 'folder' ? 'folder-node' : ''}">${icon(kind === 'folder' ? 'folder' : 'description')}<span class="tree-label">${name}</span></div>`);
      node.addEventListener('click', () => {
        if (kind === 'folder') { openTree(s, host, dir + name + '/'); return; }
        pop.remove(); // opening a file closes the popover
        const panel = host.querySelector('.skill-detail-panel');
        panel.innerHTML = '';
        if (dir + name === 'SKILL.md') return;
        const viewer = el(`<div class="readonly-file-viewer"><div class="readonly-title">${icon('description')} ${name} </div><div class="readonly-section"><span>المحتوى</span><div class="readonly-content-area"></div></div></div>`);
        viewer.querySelector('.readonly-content-area').textContent = s.files[dir + name];
        panel.appendChild(viewer);
      });
      items.appendChild(node);
    }
    pop.querySelector('[data-test-id="nav-back-button"]').addEventListener('click', () => {
      if (!dir) return;
      const up = dir.split('/').slice(0, -2).join('/');
      openTree(s, host, up ? up + '/' : '');
    });
    ov.appendChild(pop);
  }

  render();
  t.after(() => w.close());
  return { w, d, GBC: w.GBC, state, drop };
}

const SKILLS = [
  { name: 'cold-email-drafter', description: 'When asked to draft emails', active: true },
  { name: 'gratovo-comms', description: 'Influencer and brand communication, from the course', active: false,
    instructions: '# Gratovo comms\nRead references/playbook.md first.',
    files: { 'references/playbook.md': '# Playbook\nRule one.\n\nRule two.', 'references/cases/brand.md': 'Brand cases', 'scripts/check.py': 'print(1)' } },
];

test('skills_list reads names, descriptions and state from the sections; templates are not skills', async (t) => {
  const { GBC } = load(t, SKILLS);
  const r = await GBC.handle('skills_list', {});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.result.skills, [
    { name: 'cold-email-drafter', description: 'When asked to draft emails', active: true, state: 'active' },
    { name: 'gratovo-comms', description: 'Influencer and brand communication, from the course', active: false, state: 'inactive' },
  ]);
  assert.equal(r.result.templates, 2, 'a template whose label says "more" is still a template');
});

test('skill_set_active turns a skill on and off and waits for its card to move', async (t) => {
  const { GBC, state } = load(t, SKILLS);
  const on = await GBC.handle('skill_set_active', { name: 'gratovo-comms', active: true });
  assert.equal(on.ok, true, JSON.stringify(on.error));
  assert.deepEqual(on.result, { name: 'gratovo-comms', active: true, changed: true, notice: 'تم تفعيل المهارة' });
  const again = await GBC.handle('skill_set_active', { name: 'gratovo-comms', active: true });
  assert.equal(again.result.changed, false, 'already on: nothing clicked');
  const off = await GBC.handle('skill_set_active', { name: 'gratovo-comms', active: false });
  assert.equal(off.result.notice, 'المهارة غير مفعّلة');
  assert.equal(state.skills.find((s) => s.name === 'gratovo-comms').active, false);
});

test('an unknown skill is SKILL_NOT_FOUND with the names that do exist', async (t) => {
  const { GBC } = load(t, SKILLS);
  const r = await GBC.handle('skill_set_active', { name: 'nope', active: true });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SKILL_NOT_FOUND');
  assert.deepEqual(r.error.details.available, ['cold-email-drafter', 'gratovo-comms']);
});

test('skill_delete confirms the dialog and waits for the card to go', async (t) => {
  const { GBC, state } = load(t, SKILLS);
  const r = await GBC.handle('skill_delete', { name: 'cold-email-drafter' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.result.deleted, true);
  assert.deepEqual(state.skills.map((s) => s.name), ['gratovo-comms']);
});

test('upload (create): open, drop, the editor shows the name from SKILL.md, Save creates it', async (t) => {
  const { GBC, state, drop, d } = load(t, SKILLS);
  const open = await GBC.handle('skill_upload_open', {});
  assert.equal(open.ok, true, JSON.stringify(open.error));
  assert.equal(open.result.mode, 'create');
  assert.match(open.result.dropSelector, /^\[data-gb-drop="gb[a-z0-9]+"\]$/);
  assert.ok(d.querySelector(open.result.dropSelector).classList.contains('upload-area'), 'the selector names the drop zone');
  drop({ name: 'new-skill', description: 'New one', instructions: 'Do it.' });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'new-skill' });
  assert.equal(fin.ok, true, JSON.stringify(fin.error));
  assert.equal(fin.result.saved, true);
  assert.equal(fin.result.notice, 'تم إنشاء المهارة');
  assert.ok(fin.result.progress.some((p) => /100/.test(p)), 'progress was followed: ' + fin.result.progress.join(' | '));
  assert.deepEqual(state.saved, ['new-skill']);
});

test('upload (create) whose SKILL.md has another name is refused and never saved', async (t) => {
  const { GBC, state, drop } = load(t, SKILLS);
  await GBC.handle('skill_upload_open', {});
  drop({ name: 'other-skill', description: 'x' });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'new-skill' });
  assert.equal(fin.ok, false);
  assert.equal(fin.error.code, 'SKILL_UPLOAD_FAILED');
  assert.equal(fin.error.details.reason, 'wrong name');
  assert.deepEqual(state.clicks, [], 'Save was not clicked');
  assert.deepEqual(state.saved, []);
});

test('a refused upload is SKILL_UPLOAD_FAILED with the page\'s message', async (t) => {
  const { GBC, drop } = load(t, SKILLS, { upload: { outcome: 'refused' } });
  await GBC.handle('skill_upload_open', {});
  drop({ name: 'new-skill' });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'new-skill' });
  assert.equal(fin.ok, false);
  assert.equal(fin.error.code, 'SKILL_UPLOAD_FAILED');
  assert.equal(fin.error.details.reason, 'refused');
  assert.match(fin.error.message, /غير صالح/);
});

test('an upload that never finishes times out with the progress it saw', async (t) => {
  const { GBC, drop } = load(t, SKILLS, { upload: { outcome: 'hang' } });
  await GBC.handle('skill_upload_open', {});
  drop({ name: 'new-skill' });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'new-skill', timeoutMs: 400 });
  assert.equal(fin.ok, false);
  assert.equal(fin.error.code, 'SKILL_UPLOAD_FAILED');
  assert.equal(fin.error.details.reason, 'timeout');
  assert.ok(fin.error.details.progress.length >= 1);
});

test('upload (replace) goes through the card menu and is saved when the dialog closes', async (t) => {
  const { GBC, state, drop } = load(t, SKILLS);
  const open = await GBC.handle('skill_upload_open', { replace: 'gratovo-comms' });
  assert.equal(open.ok, true, JSON.stringify(open.error));
  assert.equal(open.result.mode, 'replace');
  drop({ description: 'v2', instructions: 'v2 body', files: { 'references/playbook.md': 'v2' } });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'gratovo-comms' });
  assert.equal(fin.ok, true, JSON.stringify(fin.error));
  assert.equal(fin.result.mode, 'replace');
  assert.equal(fin.result.saved, true);
  const s = state.skills.find((x) => x.name === 'gratovo-comms');
  assert.equal(s.description, 'v2');
  assert.equal(s.active, false, 'replace turns the skill off — the caller turns it back on');
});

test('skill_read opens the skill, walks every folder, reads each file, and leaves the editor', async (t) => {
  const { GBC, d } = load(t, SKILLS);
  const r = await GBC.handle('skill_read', { name: 'gratovo-comms', contents: true });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.result.name, 'gratovo-comms');
  assert.equal(r.result.active, false);
  assert.equal(r.result.instructions, '# Gratovo comms\nRead references/playbook.md first.');
  const files = Object.fromEntries(r.result.files.filter((f) => f.kind === 'file').map((f) => [f.path, f.content]));
  assert.deepEqual(Object.keys(files).sort(), ['SKILL.md', 'references/cases/brand.md', 'references/playbook.md', 'scripts/check.py']);
  assert.equal(files['references/playbook.md'], '# Playbook\nRule one.\n\nRule two.');
  assert.equal(files['references/cases/brand.md'], 'Brand cases');
  assert.ok(r.result.files.some((f) => f.kind === 'folder' && f.path === 'references/cases/'));
  assert.equal(d.querySelector('skill-folder-manager'), null, 'back on the list');
});

test('skill_read of a skill that is only SKILL.md lists just that file', async (t) => {
  const { GBC } = load(t, SKILLS);
  const r = await GBC.handle('skill_read', { name: 'cold-email-drafter' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.result.files, [{ path: 'SKILL.md', kind: 'file' }]);
});

test('a fresh upload left unsaved is discarded through "leave without saving" before the next action', async (t) => {
  const { GBC, d, drop } = load(t, SKILLS);
  await GBC.handle('skill_upload_open', {});
  drop({ name: 'draft-skill', description: 'x' });
  const fin = await GBC.handle('skill_upload_finish', { expectName: 'draft-skill', save: false });
  assert.equal(fin.ok, true, JSON.stringify(fin.error));
  assert.equal(fin.result.saved, false);
  assert.ok(d.querySelector('skill-folder-manager'), 'editor still open');
  const list = await GBC.handle('skills_list', {});
  assert.equal(list.ok, true, JSON.stringify(list.error));
  assert.deepEqual(list.result.skills.map((s) => s.name), ['cold-email-drafter', 'gratovo-comms']);
});

test('skills_diagnostics reports every Skills element and the cards', async (t) => {
  const { GBC } = load(t, SKILLS);
  const r = await GBC.handle('skills_diagnostics', {});
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.result.elements.skillsPage.found, true);
  assert.equal(r.result.elements.skillsCreateButton.found, true);
  assert.equal(r.result.cards.length, 4);
});
