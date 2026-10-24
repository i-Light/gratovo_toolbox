/*
 * Gemini Bridge — content script: the Skills page (Gemini 4 Argon, /customize/skills).
 *
 *   skills_list          {}                                -> {url, skills: [{name, description, active}], templates}
 *   skill_read           {name, contents?, maxFileChars?}  -> {name, description, instructions, active, files: [{path, kind, content?}]}
 *   skill_upload_open    {replace?: name}                  -> {mode: 'create'|'replace', dropZone: true}
 *   skill_upload_finish  {expectName?, save?: true}        -> {mode, name, saved, progress: [...], notice}
 *   skill_set_active     {name, active}                    -> {name, active, changed, notice}
 *   skill_delete         {name}                            -> {name, deleted, notice}
 *   skills_diagnostics   {}                                -> {url, elements, cards, dialog, buttons}
 *
 * An upload is three calls, made by Python (the gemini package: gratovo_pipeline/gemini): open the
 * upload dialog here, drop the zip with the background's `drop_files` (it runs
 * in the page's own world, where Gemini's drop handler can read the File
 * objects; a content script's File lives in another compartment on Firefox),
 * then `skill_upload_finish` here waits for the upload, checks the name the
 * page read from SKILL.md, and saves. Python opens `/u/N/customize/skills`
 * first; a handler never navigates, because a navigation would unload it.
 *
 * Calibrated on the live page 2026-10-14 (Arabic UI, Pro account): what is
 * stable there is the Angular element names (customize-card,
 * skill-folder-upload-modal, skill-folder-manager, skill-editor), a few
 * classes, `data-test-id="file-tree-node"` and the menu icons (ligature names
 * are the same in every language). Labels in English and Arabic come last.
 * Facts the handlers rely on, each seen on the live page:
 *   - card menu icons: contract = use now, chat_spark = edit with Gemini,
 *     edit_note = edit, download, upload = replace, block = deactivate,
 *     check_circle = activate, delete. "Use now" exists only on active skills.
 *   - a card's primary button is labelled "<name>, <description>"; skill names
 *     are kebab-case, so the name is everything before the first comma.
 *   - "Replace" swaps every file and turns the skill OFF; set it back on after.
 *   - Create -> Upload ends in the skill editor with the name from SKILL.md and
 *     a Save button labelled "Create"; Replace saves by itself.
 *   - the file tree is a folder navigator (a folder shows its children; the
 *     tree's back button goes up); a file opens in a read-only viewer.
 */
(function (root) {
  'use strict';

  const SKILL_ELEMENTS = {
    skillsPage: [
      { type: 'css', value: 'customize-page' },
      { type: 'css', value: '[data-tab="skills"][aria-selected="true"]', climb: 'main, body' },
    ],
    skillsCreateButton: [
      { type: 'css', value: 'customize-page button.mat-mdc-menu-trigger.mat-tonal-button' },
      { type: 'text', match: '^(create|new skill|إنشاء)$', tags: ['button', 'span'], climb: 'button', within: 'customize-page' },
      { type: 'attr', attr: 'aria-label', match: '^(create|new skill|إنشاء)$', tags: ['button'], within: 'customize-page' },
    ],
    skillsUploadItem: [
      { type: 'icon', match: '^upload$', climb: '[role="menuitem"]', within: '.cdk-overlay-container' },
      { type: 'text', match: '^(upload|upload skill|تحميل)$', tags: ['[role="menuitem"]', 'button', 'span'], climb: '[role="menuitem"], button', within: '.cdk-overlay-container' },
    ],
    skillUploadDialog: [
      { type: 'css', value: 'skill-folder-upload-modal' },
      { type: 'fn', name: 'skillDialogMentioning:SKILL.md' },
    ],
    skillUploadDropZone: [
      { type: 'css', value: 'skill-folder-upload-modal .upload-area' },
      { type: 'css', value: 'skill-folder-upload-modal [class*="drop"], [role="dialog"] .upload-area' },
      { type: 'fn', name: 'skillDropZoneInDialog' },
    ],
    skillCards: [
      { type: 'css', value: 'customize-page customize-card' },
      { type: 'css', value: 'customize-page [class*="skills-grid"] > *' },
    ],
    skillEditor: [
      { type: 'css', value: 'skill-folder-manager' },
      { type: 'css', value: 'skill-editor-container' },
    ],
    skillSaveButton: [
      { type: 'css', value: 'skill-folder-manager gem-button.save-button button, skill-folder-manager .editor-actions button.mdc-button--unelevated' },
      { type: 'attr', attr: 'aria-label', match: '^(save skill|save|create|حفظ المهارة|حفظ|إنشاء)$', tags: ['button'], within: 'skill-folder-manager, skill-editor-container' },
    ],
    skillBackButton: [
      { type: 'css', value: 'skill-folder-manager button.back-to-skills-btn' },
      { type: 'icon', match: '^arrow_back$', climb: 'button', within: 'skill-folder-manager, skill-editor-container' },
    ],
    skillNameInput: [
      { type: 'css', value: 'skill-editor input.editor-title-input' },
      { type: 'attr', attr: 'aria-label', match: '^(skill name|name|اسم المهارة)$', tags: ['input'] },
    ],
    skillDescription: [
      { type: 'css', value: 'skill-editor .description-text[contenteditable]' },
      { type: 'attr', attr: 'aria-label', match: '^(skill description|description|وصف المهارة)$', tags: ['[contenteditable]', 'textarea'] },
    ],
    skillInstructions: [
      { type: 'css', value: 'skill-editor .content-editable[contenteditable]' },
      { type: 'attr', attr: 'aria-label', match: '^(skill instructions|instructions|تعليمات المهارة)$', tags: ['[contenteditable]', 'textarea'] },
    ],
    skillFileTreeButton: [
      { type: 'css', value: 'skill-folder-manager button.file-tree-button' },
      { type: 'attr', attr: 'aria-label', match: 'file tree|files|شجرة الملفات', tags: ['button'] },
      { type: 'icon', match: '^folder$', climb: 'button', within: 'skill-folder-manager' },
    ],
    skillFileTreeNodes: [
      { type: 'css', value: '[data-test-id="file-tree-node"]' },
      { type: 'css', value: '.file-tree-container .tree-node' },
    ],
    skillFileTreeBack: [
      { type: 'css', value: '.file-tree-container [data-test-id="nav-back-button"]' },
      { type: 'icon', match: '^chevron_left$', climb: 'button', within: '.file-tree-container' },
    ],
    skillFileViewer: [
      { type: 'css', value: 'skill-folder-manager .readonly-file-viewer' },
      { type: 'css', value: '.readonly-file-viewer' },
    ],
  };
  const SKILL_ELEMENT_NAMES = Object.keys(SKILL_ELEMENTS);
  const SKILL_LIST_ELEMENTS = ['skillCards', 'skillFileTreeNodes'];

  // Card menu entries by icon (any language), then by label.
  const MENU = {
    use: { icon: /^contract$/, label: /^(use now|الاستخدام الآن)$/i },
    replace: { icon: /^upload$/, label: /^(replace( skill)?|استبدال المهارة)$/i },
    deactivate: { icon: /^block$/, label: /^(deactivate|turn off|disable|إيقاف)$/i },
    activate: { icon: /^check_circle$/, label: /^(activate|turn on|enable|تفعيل)$/i },
    delete: { icon: /^delete$/, label: /^(delete|حذف)$/i },
    download: { icon: /^download$/, label: /^(download|تنزيل)$/i },
  };

  // Section titles above the cards. "غير نشطة" contains "نشطة": exact matches only.
  const ACTIVE_TITLE = /^(active|on|enabled|نشطة|مفعّلة|مفعلة)$/i;
  const INACTIVE_TITLE = /^(inactive|off|disabled|غير نشطة|غير مفعّلة|غير مفعلة)$/i;
  // Upload dialog progress, in order: uploading N% -> uploaded, saving the
  // metadata -> preparing the editor (create only).
  const UPLOAD_FAILED = /\b(error|failed|invalid|could ?n[o']t|unable|not supported|too large|exceeds)\b|خطأ|تعذّ?ر|غير صالح|غير متوافق|فشل|يتجاوز|غير مسموح/i;
  const CONFIRM_DELETE = /^(delete|حذف)$/i;
  const LEAVE_WITHOUT_SAVING = /^(leave|discard|مغادرة|تجاهل)$/i;

  const timeouts = { pageMs: 15000, menuMs: 4000, dialogMs: 8000, uploadMs: 120000, editorMs: 20000, saveMs: 30000, toggleMs: 15000, treeMs: 4000, viewerMs: 6000 };

  function GB() { return root.GB; }
  function doc() { return GB().env.doc(); }
  function win() { return GB().env.win(); }
  function url() { return win().location.href; }
  function norm(s) { return GB().norm(s); }

  // ---------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------
  let installed = false;
  function install() {
    const gb = GB();
    if (!gb) return;
    for (const name of SKILL_ELEMENT_NAMES) if (!gb.BUILTIN[name]) gb.BUILTIN[name] = SKILL_ELEMENTS[name];
    for (const name of SKILL_LIST_ELEMENTS) gb.LIST_ELEMENTS.add(name);
    if (!gb.FNS['skillDialogMentioning:SKILL.md']) gb.FNS['skillDialogMentioning:SKILL.md'] = () => dialogs().filter((d) => /SKILL\.md/.test(d.textContent || ''));
    if (!gb.FNS.skillDropZoneInDialog) {
      gb.FNS.skillDropZoneInDialog = () => {
        const dlg = dialogs().find((d) => /SKILL\.md/.test(d.textContent || ''));
        if (!dlg) return [];
        // The block that holds the "drag or choose files / folder" links.
        const link = Array.from(dlg.querySelectorAll('button, a')).find((b) => /folder|files|مجلد|ملفات/i.test(norm(b.textContent)));
        return link ? [link.closest('[class*="area"], [class*="zone"], div') || link.parentElement] : [];
      };
    }
    installed = true;
  }

  function dialogs() { return Array.from(doc().querySelectorAll('mat-dialog-container, [role="dialog"], [role="alertdialog"]')).filter((d) => GB().isVisible(d)); }
  function overlayText() { const ov = doc().querySelector('.cdk-overlay-container'); return ov ? norm(ov.textContent) : ''; }

  // Resolves `name` or throws SKILL_UI_NOT_FOUND with the resolver's report.
  function element(name, opts) {
    try {
      return GB().resolve(name, Object.assign({ fresh: true }, opts || {})).el;
    } catch (e) {
      if (e && e.code === 'ELEMENT_NOT_FOUND') {
        throw GB().gbError('SKILL_UI_NOT_FOUND', 'The Skills page has no "' + name + '" (' + url() + ')', Object.assign({}, e.details, { element: name, url: url() }));
      }
      throw e;
    }
  }

  async function waitForElement(name, timeoutMs, phase) {
    try {
      await GB().waitFor(() => GB().find(name, { fresh: true }), { timeoutMs, phase: phase || 'Skills page (' + name + ')' });
    } catch (_) { /* element() below reports what is missing */ }
    return element(name);
  }

  // ---------------------------------------------------------------------
  // Reading the list
  // ---------------------------------------------------------------------
  function cardTitle(card) {
    const btn = card.querySelector('button.card-primary-action, button[aria-label]');
    const aria = btn ? norm(btn.getAttribute('aria-label') || '') : '';
    if (aria) {
      const cut = aria.indexOf(',');
      return { name: cut >= 0 ? aria.slice(0, cut).trim() : aria, description: cut >= 0 ? aria.slice(cut + 1).trim() : '' };
    }
    const lines = String(card.innerText || card.textContent || '').split(/\n+/).map(norm).filter(Boolean);
    return { name: lines[0] || '', description: lines.slice(1).join(' ') };
  }

  // The card's "more" button: its icon, else a short "more options" label. Never
  // the card's own button, whose label is the skill's name and description and
  // can contain "more" (a template is called "get more perspectives").
  function cardMenuButton(card) {
    const buttons = Array.from(card.querySelectorAll('button')).filter((b) => !b.classList.contains('card-primary-action'));
    const byIcon = buttons.find((b) => /^more_(horiz|vert)$/.test(GB().iconOf(b) || ''));
    return byIcon || buttons.find((b) => /^(more( options| actions)?|options|مزيد من الخيارات|المزيد|خيارات)$/i.test(norm(b.getAttribute('aria-label') || ''))) || null;
  }

  // active / inactive from the section title above the card; a template (an
  // "add" button instead of a menu) is not one of the user's skills.
  function cardState(card) {
    if (!cardMenuButton(card)) return 'template';
    const section = card.closest('section, .category-section');
    const titleEl = section ? section.querySelector('.category-title, h2, h3, [class*="title"]') : null;
    const title = titleEl ? norm(titleEl.textContent) : '';
    if (INACTIVE_TITLE.test(title)) return 'inactive';
    if (ACTIVE_TITLE.test(title)) return 'active';
    return 'unknown';
  }

  function readCards() {
    return GB().findAll('skillCards', { fresh: true }).map((card) => Object.assign(cardTitle(card), { state: cardState(card), card }));
  }

  function findCard(name) {
    const wanted = norm(name).toLowerCase();
    const cards = readCards().filter((c) => c.state !== 'template');
    return cards.find((c) => c.name.toLowerCase() === wanted) || null;
  }

  async function waitForList() {
    await waitForElement('skillsPage', timeouts.pageMs);
    // The cards render a moment after the page shell (and not at all while the
    // editor is open over the list).
    try {
      await GB().waitFor(() => readCards().length > 0 && !GB().find('skillEditor', { fresh: true }), { timeoutMs: timeouts.pageMs, phase: 'skill cards to render' });
    } catch (_) { /* an empty account has no cards; the callers report what they miss */ }
  }

  async function requireCard(name) {
    await waitForList();
    const hit = findCard(name);
    if (!hit) {
      throw GB().gbError('SKILL_NOT_FOUND', 'No skill named "' + name + '" on the Skills page', { name, available: readCards().filter((c) => c.state !== 'template').map((c) => c.name), url: url() });
    }
    return hit;
  }

  // ---------------------------------------------------------------------
  // Menus, dialogs, notices
  // ---------------------------------------------------------------------
  function menuItems() {
    return Array.from(doc().querySelectorAll('.cdk-overlay-container [role="menuitem"], .cdk-overlay-container .mat-mdc-menu-item')).filter((el) => GB().isVisible(el));
  }

  function menuItem(kind) {
    const spec = MENU[kind];
    const items = menuItems();
    return items.find((el) => spec.icon.test(GB().iconOf(el) || ''))
      || items.find((el) => spec.label.test(GB().labelText(el)))
      || null;
  }

  async function openCardMenu(card) {
    const button = cardMenuButton(card);
    if (!button) throw GB().gbError('SKILL_UI_NOT_FOUND', 'The skill card has no menu button', { element: 'skillCardMenu', url: url() });
    GB().robustClick(button);
    try {
      await GB().waitFor(() => menuItems().length > 0, { timeoutMs: timeouts.menuMs, phase: 'the skill menu to open' });
    } catch (_) {
      throw GB().gbError('SKILL_UI_NOT_FOUND', 'The skill menu did not open', { element: 'skillCardMenu', url: url() });
    }
  }

  async function chooseMenu(kind) {
    const item = menuItem(kind);
    if (!item) {
      const seen = menuItems().map((el) => ({ label: GB().labelText(el), icon: GB().iconOf(el) }));
      GB().pressEscape();
      throw GB().gbError('SKILL_UI_NOT_FOUND', 'The skill menu has no "' + kind + '" entry', { element: 'skillMenu:' + kind, seen, url: url() });
    }
    GB().robustClick(item);
  }

  // Toasts ("skill created", "skill deactivated") show in the overlay; the
  // first non-empty text after `since` is the page's answer.
  function snackText() {
    const els = Array.from(doc().querySelectorAll('mat-snack-bar-container, simple-snack-bar, .mdc-snackbar, [role="status"], [role="alert"]')).filter((el) => GB().isVisible(el));
    const t = els.map((el) => norm(el.textContent)).filter(Boolean)[0];
    return t || null;
  }

  function dialogButtons(dlg) { return Array.from(dlg.querySelectorAll('button')).filter((b) => GB().isVisible(b)); }

  // ---------------------------------------------------------------------
  // The editor (a skill opened from its card, or a fresh upload)
  // ---------------------------------------------------------------------
  function readEditable(el) {
    if (!el) return '';
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return String(el.value || '');
    const t = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return String(t || '').replace(/ /g, ' ').replace(/\n+$/, '');
  }

  function editorFields() {
    return {
      name: readEditable(GB().find('skillNameInput', { fresh: true })),
      description: readEditable(GB().find('skillDescription', { fresh: true })),
      instructions: readEditable(GB().find('skillInstructions', { fresh: true })),
    };
  }

  async function closeEditor() {
    const back = GB().find('skillBackButton', { fresh: true });
    if (!back) return;
    GB().robustClick(back);
    // A fresh upload that was never saved asks "leave without saving?".
    try {
      const leave = await GB().waitFor(() => {
        if (!GB().find('skillEditor', { fresh: true })) return 'gone';
        for (const dlg of dialogs()) {
          const b = dialogButtons(dlg).find((x) => LEAVE_WITHOUT_SAVING.test(norm(x.textContent)));
          if (b) return b;
        }
        return null;
      }, { timeoutMs: 5000, phase: 'the skill editor to close' });
      if (leave !== 'gone') {
        GB().robustClick(leave);
        await GB().waitFor(() => !GB().find('skillEditor', { fresh: true }), { timeoutMs: 5000, phase: 'the skill editor to close' });
      }
    } catch (_) { /* the next call sees the editor and reports it */ }
  }

  // The tree lives in a popover that closes when a file is opened.
  async function openTree() {
    if (GB().findAll('skillFileTreeNodes', { fresh: true }).length) return true;
    const button = GB().find('skillFileTreeButton', { fresh: true });
    if (!button) return false; // a skill made of SKILL.md alone has no tree
    GB().robustClick(button);
    try {
      await GB().waitFor(() => GB().findAll('skillFileTreeNodes', { fresh: true }).length > 0, { timeoutMs: timeouts.treeMs, phase: 'the file tree to open' });
      return true;
    } catch (_) { return false; }
  }

  function treeNodes() {
    return GB().findAll('skillFileTreeNodes', { fresh: true }).map((el) => ({ el, label: norm(el.textContent), folder: /\bfolder-node\b/.test(el.className || '') || /^folder/.test(GB().iconOf(el) || '') }));
  }

  async function treeToRoot() {
    for (let i = 0; i < 12; i++) {
      const back = GB().find('skillFileTreeBack', { fresh: true });
      if (!back || !GB().isEnabled(back)) return;
      const before = treeNodes().map((n) => n.label).join('|');
      GB().robustClick(back);
      try { await GB().waitFor(() => treeNodes().map((n) => n.label).join('|') !== before, { timeoutMs: timeouts.treeMs, phase: 'the file tree to go up' }); } catch (_) { return; }
    }
  }

  async function openFolder(label) {
    const node = treeNodes().find((n) => n.folder && n.label === label);
    if (!node) return false;
    const before = treeNodes().map((n) => n.label).join('|');
    GB().robustClick(node.el);
    try {
      await GB().waitFor(() => treeNodes().map((n) => n.label).join('|') !== before, { timeoutMs: timeouts.treeMs, phase: 'folder "' + label + '" to open' });
      return true;
    } catch (_) { return false; }
  }

  // Every path in the skill, walking the folder navigator depth-first.
  async function listFiles() {
    if (!(await openTree())) return [{ path: 'SKILL.md', kind: 'file' }];
    await treeToRoot();
    const out = [];
    async function walk(prefix, depth) {
      const nodes = treeNodes();
      for (const n of nodes) if (!n.folder) out.push({ path: prefix + n.label, kind: 'file' });
      for (const n of nodes) {
        if (!n.folder || depth > 6) continue;
        out.push({ path: prefix + n.label + '/', kind: 'folder' });
        if (await openFolder(n.label)) {
          await walk(prefix + n.label + '/', depth + 1);
          const back = GB().find('skillFileTreeBack', { fresh: true });
          const before = treeNodes().map((x) => x.label).join('|');
          if (back) {
            GB().robustClick(back);
            try { await GB().waitFor(() => treeNodes().map((x) => x.label).join('|') !== before, { timeoutMs: timeouts.treeMs, phase: 'the file tree to go up' }); } catch (_) { /* reported by the next lookup */ }
          }
        }
      }
    }
    await walk('', 0);
    return out;
  }

  async function readFile(path) {
    if (!(await openTree())) throw GB().gbError('SKILL_UI_NOT_FOUND', 'The file tree did not open', { element: 'skillFileTreeButton', url: url() });
    await treeToRoot();
    const parts = path.split('/');
    for (const folder of parts.slice(0, -1)) {
      if (!(await openFolder(folder))) throw GB().gbError('SKILL_FILE_NOT_FOUND', 'No folder "' + folder + '" in the skill', { path });
    }
    const leaf = parts[parts.length - 1];
    const node = treeNodes().find((n) => !n.folder && n.label === leaf);
    if (!node) throw GB().gbError('SKILL_FILE_NOT_FOUND', 'No file "' + path + '" in the skill', { path, seen: treeNodes().map((n) => n.label) });
    GB().robustClick(node.el);
    const viewer = await GB().waitFor(() => {
      const v = GB().find('skillFileViewer', { fresh: true });
      if (!v) return null;
      const title = norm((v.querySelector('.readonly-title, [class*="title"]') || {}).textContent || '');
      return title === leaf || title.endsWith(' ' + leaf) ? v : null;
    }, { timeoutMs: timeouts.viewerMs, phase: 'file "' + path + '" to open' }).catch(() => null);
    if (!viewer) throw GB().gbError('SKILL_UI_NOT_FOUND', 'The file viewer did not show "' + path + '"', { element: 'skillFileViewer', path, url: url() });
    const area = viewer.querySelector('.readonly-content-area, pre, code, [class*="content"]');
    return readEditable(area || viewer);
  }

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  async function skillsList() {
    install();
    if (GB().find('skillEditor', { fresh: true })) await closeEditor();
    await waitForList();
    const cards = readCards();
    return {
      url: url(),
      skills: cards.filter((c) => c.state !== 'template').map((c) => ({ name: c.name, description: c.description, active: c.state === 'active', state: c.state })),
      templates: cards.filter((c) => c.state === 'template').length,
    };
  }

  async function skillRead(params) {
    install();
    const name = String(params && params.name || '');
    if (!name) throw GB().gbError('BAD_PARAMS', 'skill_read needs a `name`');
    const maxChars = Number(params.maxFileChars) > 0 ? Number(params.maxFileChars) : 200000;
    if (GB().find('skillEditor', { fresh: true })) await closeEditor();
    const hit = await requireCard(name);
    const active = hit.state === 'active';
    GB().robustClick(hit.card.querySelector('button.card-primary-action') || hit.card);
    await waitForElement('skillEditor', timeouts.editorMs, 'the skill to open');
    try {
      await GB().waitFor(() => norm(editorFields().name).toLowerCase() === norm(name).toLowerCase() || norm(editorFields().instructions) !== '', { timeoutMs: timeouts.editorMs, phase: 'the skill editor to load "' + name + '"' });
    } catch (_) { /* read what is there */ }
    const fields = editorFields();
    let files = [];
    try {
      files = await listFiles();
      if (params.contents) {
        for (const f of files) {
          if (f.kind !== 'file' || f.path === 'SKILL.md') continue;
          try {
            const text = await readFile(f.path);
            f.content = text.length > maxChars ? text.slice(0, maxChars) : text;
            if (text.length > maxChars) f.truncated = true;
          } catch (e) { f.error = e && e.code ? e.code : String(e); }
        }
      }
    } finally {
      await closeEditor();
    }
    return { name: fields.name || name, description: fields.description, instructions: fields.instructions, active, files, url: url() };
  }

  async function skillUploadOpen(params) {
    install();
    const replace = params && params.replace ? String(params.replace) : '';
    if (GB().find('skillEditor', { fresh: true })) await closeEditor();
    if (replace) {
      const hit = await requireCard(replace);
      await openCardMenu(hit.card);
      await chooseMenu('replace');
    } else {
      await waitForList();
      const create = await waitForElement('skillsCreateButton', timeouts.pageMs);
      GB().robustClick(create);
      let item = null;
      try { item = await GB().waitFor(() => GB().find('skillsUploadItem', { fresh: true }), { timeoutMs: timeouts.menuMs, phase: 'the Create menu to open' }); } catch (_) { item = null; }
      if (!item) { GB().pressEscape(); element('skillsUploadItem'); }
      GB().robustClick(item);
    }
    const zone = await waitForElement('skillUploadDropZone', timeouts.dialogMs, 'the upload dialog');
    // The drop runs in the page's world (background `drop_files`), which cannot
    // see this script's references; a one-off attribute on the zone the
    // resolver picked tells it exactly where to drop.
    const token = 'gb' + Math.random().toString(36).slice(2, 10);
    zone.setAttribute('data-gb-drop', token);
    return { mode: replace ? 'replace' : 'create', dropZone: true, dropSelector: '[data-gb-drop="' + token + '"]', url: url() };
  }

  // After the drop: the dialog runs "uploading N%" -> "uploaded, saving
  // metadata" -> ("preparing the editor") and closes. Create lands in the editor
  // (Save there makes the skill); Replace has saved by the time it closes.
  async function skillUploadFinish(params) {
    install();
    params = params || {};
    const expect = params.expectName ? norm(params.expectName).toLowerCase() : '';
    const save = params.save !== false;
    const progress = [];
    const note = (t) => { if (t && progress[progress.length - 1] !== t) progress.push(t); };
    const uploadMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : timeouts.uploadMs;
    let outcome;
    try {
      outcome = await GB().waitFor(() => {
        const dlg = GB().find('skillUploadDialog', { fresh: true });
        if (dlg) {
          const lines = String(dlg.innerText || dlg.textContent || '').split(/\n+/).map(norm).filter(Boolean);
          const last = lines[lines.length - 1] || '';
          note(last);
          const failed = lines.slice(-3).find((l) => UPLOAD_FAILED.test(l));
          if (failed) return { failed };
          return null;
        }
        if (GB().find('skillEditor', { fresh: true })) return { editor: true };
        return { closed: true };
      }, { timeoutMs: uploadMs, phase: 'the skill upload to finish' });
    } catch (e) {
      throw GB().gbError('SKILL_UPLOAD_FAILED', 'The upload did not finish', { reason: 'timeout', progress, url: url() });
    }
    if (outcome.failed) {
      GB().pressEscape();
      throw GB().gbError('SKILL_UPLOAD_FAILED', 'Gemini refused the upload: ' + outcome.failed, { reason: 'refused', message: outcome.failed, progress, url: url() });
    }
    if (outcome.closed) {
      // Replace saves by itself; give the editor a moment in case a create is slow to open.
      const editor = await GB().waitFor(() => GB().find('skillEditor', { fresh: true }), { timeoutMs: 2500, phase: 'the skill editor' }).catch(() => null);
      if (!editor) return { mode: 'replace', name: params.expectName || null, saved: true, progress, notice: snackText() };
    }
    // Create: the editor shows what the page read from SKILL.md.
    const nameEl = await waitForElement('skillNameInput', timeouts.editorMs, 'the new skill\'s name');
    try { await GB().waitFor(() => norm(readEditable(nameEl)) !== '', { timeoutMs: 5000, phase: 'the skill name to load' }); } catch (_) { /* compared below */ }
    const fields = editorFields();
    if (expect && norm(fields.name).toLowerCase() !== expect) {
      await closeEditor();
      throw GB().gbError('SKILL_UPLOAD_FAILED', 'The uploaded SKILL.md is named "' + fields.name + '", expected "' + params.expectName + '"', { reason: 'wrong name', name: fields.name, expected: params.expectName, progress });
    }
    if (!save) return { mode: 'create', name: fields.name, saved: false, progress, fields };
    const button = element('skillSaveButton');
    GB().robustClick(button);
    let notice = null;
    try {
      await GB().waitFor(() => {
        notice = snackText() || notice;
        return !GB().find('skillEditor', { fresh: true });
      }, { timeoutMs: timeouts.saveMs, phase: 'the new skill to save' });
    } catch (_) {
      throw GB().gbError('SKILL_SAVE_FAILED', 'Save was clicked but the editor stayed open', { reason: 'no confirmation', notice: snackText(), dialog: dialogs().map((d) => norm(d.textContent).slice(0, 200)), url: url() });
    }
    return { mode: 'create', name: fields.name, saved: true, progress, notice: notice || snackText() };
  }

  async function skillSetActive(params) {
    install();
    const name = String(params && params.name || '');
    if (!name) throw GB().gbError('BAD_PARAMS', 'skill_set_active needs a `name`');
    const want = params.active !== false;
    if (GB().find('skillEditor', { fresh: true })) await closeEditor();
    const hit = await requireCard(name);
    if ((hit.state === 'active') === want) return { name: hit.name, active: want, changed: false, notice: null };
    await openCardMenu(hit.card);
    await chooseMenu(want ? 'activate' : 'deactivate');
    let notice = null;
    try {
      await GB().waitFor(() => {
        notice = snackText() || notice;
        const now = findCard(name);
        return now && (now.state === 'active') === want;
      }, { timeoutMs: timeouts.toggleMs, phase: 'the skill to turn ' + (want ? 'on' : 'off') });
    } catch (_) {
      const now = findCard(name);
      throw GB().gbError('SKILL_TOGGLE_FAILED', 'The skill did not turn ' + (want ? 'on' : 'off'), { name, state: now ? now.state : 'missing', notice, url: url() });
    }
    return { name: hit.name, active: want, changed: true, notice };
  }

  async function skillDelete(params) {
    install();
    const name = String(params && params.name || '');
    if (!name) throw GB().gbError('BAD_PARAMS', 'skill_delete needs a `name`');
    if (GB().find('skillEditor', { fresh: true })) await closeEditor();
    const hit = await requireCard(name);
    await openCardMenu(hit.card);
    await chooseMenu('delete');
    let confirm;
    try {
      confirm = await GB().waitFor(() => {
        for (const dlg of dialogs()) {
          const b = dialogButtons(dlg).find((x) => CONFIRM_DELETE.test(norm(x.textContent)));
          if (b) return b;
        }
        return null;
      }, { timeoutMs: timeouts.dialogMs, phase: 'the delete confirmation' });
    } catch (_) {
      throw GB().gbError('SKILL_UI_NOT_FOUND', 'No delete confirmation appeared', { element: 'skillDeleteConfirm', dialog: dialogs().map((d) => norm(d.textContent).slice(0, 200)), url: url() });
    }
    GB().robustClick(confirm);
    let notice = null;
    try {
      await GB().waitFor(() => { notice = snackText() || notice; return !findCard(name); }, { timeoutMs: timeouts.toggleMs, phase: 'the skill to disappear' });
    } catch (_) {
      throw GB().gbError('SKILL_DELETE_FAILED', 'The skill is still listed after the delete', { name, notice, url: url() });
    }
    return { name: hit.name, deleted: true, notice };
  }

  function skillsDiagnostics() {
    install();
    const gb = GB();
    const elements = {};
    for (const name of SKILL_ELEMENT_NAMES) elements[name] = gb.elementReport(name, { includeCandidates: !SKILL_LIST_ELEMENTS.includes(name) });
    const cards = readCards().map((c) => ({ name: c.name, state: c.state, description: c.description.slice(0, 80) }));
    const buttons = Array.from(doc().querySelectorAll('customize-page button, skill-folder-manager button, [role="dialog"] button'))
      .filter((el) => gb.isVisible(el)).slice(0, 80)
      .map((el) => ({ text: gb.labelText(el).slice(0, 60), aria: (el.getAttribute('aria-label') || '').slice(0, 80), icon: gb.iconOf(el), testId: el.getAttribute('data-test-id'), path: gb.cssPath(el, 6) }));
    return { url: url(), title: doc().title, elements, cards, dialog: dialogs().map((d) => norm(d.textContent).slice(0, 300)), menu: menuItems().map((el) => ({ label: gb.labelText(el), icon: gb.iconOf(el) })), notice: snackText(), overlay: overlayText().slice(0, 300), buttons };
  }

  if (root.GB) install();

  root.GeminiSkills = {
    handlers: {
      skills_list: skillsList,
      skill_read: skillRead,
      skill_upload_open: skillUploadOpen,
      skill_upload_finish: skillUploadFinish,
      skill_set_active: skillSetActive,
      skill_delete: skillDelete,
      skills_diagnostics: skillsDiagnostics,
    },
    instant: ['skills_list', 'skill_read', 'skill_upload_open', 'skill_upload_finish', 'skill_set_active', 'skill_delete', 'skills_diagnostics'],
    elements: SKILL_ELEMENT_NAMES,
    timeouts,
    install,
    cardTitle,
    isInstalled: () => installed,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
