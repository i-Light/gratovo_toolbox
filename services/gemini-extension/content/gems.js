/*
 * Gemini Bridge — content script: the gem editor methods.
 *
 *   gem_read        {url?}                                   -> {url, gemId, name, description, instructions}
 *   gem_create      {name, description?, instructions?}      -> {url, gemId, name}
 *   gem_update      {url?, name?, description?, instructions?} -> {url, gemId, name, changed: [...]}
 *   gem_diagnostics {}                                       -> {url, gemId, page, elements, fields, buttons, ...}
 *
 * Python (the gemini package: gratovo_pipeline/gemini) opens the page first — `/u/N/gems/create` for a
 * new gem, `/u/N/gems/edit/<id>` for an existing one — and then calls these; a
 * handler never navigates, because a navigation would unload the script running
 * it. Wire shapes: PROTOCOL.md, "gem_* methods".
 *
 * Elements are found through the shared resolver (content/locators.js) under the
 * names in GEM_ELEMENTS, so a missing one fails with the usual diagnostics
 * (`tried`, `lastKnown`, `suggestions`) as `GEM_UI_NOT_FOUND`, and
 * `set_selectors` / `heal` can fix it without a code change. The chat page's
 * diagnostics skip these names off the gem pages (content.js).
 *
 * How it is wired: manifest.json loads this file after content/locators.js and
 * before content/content.js; content.js merges `GeminiGems.handlers` into its
 * method table and `GeminiGems.instant` into the methods that do not wait for the
 * chat prompt box (the editor has none). `GBC` (content.js) is only touched
 * inside a handler, never at load time.
 */
(function (root) {
  'use strict';

  // Most specific first: the ids and classes the live editor has (calibrated on
  // gemini.google.com/gems/create, 2026-09-30, Arabic UI), then labels in
  // English and Arabic, then structure. The instructions box is a Quill editor
  // whose aria-label is the chat prompt box's ("Enter a prompt for Gemini"), so
  // only its container identifies it -- and the preview pane on the right has a
  // real chat prompt box, which no strategy here may match.
  const GEM_ELEMENTS = {
    gemNameInput: [
      { type: 'css', value: 'input#gem-name-input, .editor-container input.name-input' },
      { type: 'css', value: 'input[formcontrolname="name"], [data-test-id="gem-name-input"] input' },
      { type: 'attr', attr: 'aria-label', match: '(gem )?name|اسم', tags: ['input'] },
      { type: 'fn', name: 'gemFieldByLabel:name' },
    ],
    gemDescriptionInput: [
      { type: 'css', value: 'textarea#gem-description-input, .editor-container textarea.description-input' },
      { type: 'css', value: 'textarea[formcontrolname="description"], [data-test-id="gem-description-input"] textarea' },
      { type: 'attr', attr: 'placeholder', match: 'describe|description|وصف', tags: ['textarea', 'input'] },
      { type: 'fn', name: 'gemFieldByLabel:description' },
    ],
    gemInstructionsEditor: [
      { type: 'css', value: '.instructions-input-container .ql-editor[contenteditable="true"], .instructions-input-container [contenteditable="true"]' },
      { type: 'css', value: '.instructions-input-container textarea, textarea[formcontrolname="instructions"], [data-test-id="gem-instructions-input"] [contenteditable="true"]' },
      { type: 'fn', name: 'gemFieldByLabel:instructions' },
    ],
    gemSaveButton: [
      { type: 'css', value: 'button.save-button, button[data-test-id="create-button"], button[data-test-id="update-button"], button[data-test-id="save-button"]' },
      { type: 'attr', attr: 'aria-label', match: '^(save|update|حفظ|تحديث)', tags: ['button'] },
      { type: 'text', match: '^(save|update|حفظ|تحديث)$', tags: ['button', 'span'], climb: 'button' },
    ],
  };
  const GEM_ELEMENT_NAMES = Object.keys(GEM_ELEMENTS);

  // What each field is called on screen, to find it by its visible label when
  // the form-control names change.
  const FIELD_LABELS = {
    name: /^\s*(name|gem name|الاسم|اسم)\b/i,
    description: /^\s*(description|الوصف|وصف)\b/i,
    instructions: /^\s*(instructions|التعليمات|تعليمات|الإرشادات)\b/i,
  };

  // The editor's save state (`div.save-state[role=status]`, calibrated on a gem's
  // edit page 2026-09-30) reads "not saved" -> "saving..." -> "saved"; in the
  // Arabic UI لم يتم حفظ Gem -> جارٍ حفظ Gem... -> تم حفظ Gem. "not saved"
  // contains "saved" and لم يتم حفظ contains تم حفظ, so the negative and
  // in-progress states are ruled out first. (`\b` does not work on Arabic
  // letters, hence the explicit start-or-space before تم.)
  const NOT_SAVED_SIGNAL = /\b(not|un)\s*saved\b|\bsaving\b|\bfailed\b|\bcould ?n[o']t\b|لم يتم|غير محفوظ|جار[ً-ْي]*\s*(ال)?حفظ|تعذّ?ر/i;
  const SAVED_SIGNAL = /\b(saved|gem (was |is )?(created|updated|saved))\b|(^|\s)تم (ال)?(حفظ|إنشاء|تحديث)/i;
  const GEM_ID = /\/gems?\/(?:edit\/)?([A-Za-z0-9_-]{6,})(?:[/?#]|$)/;

  // Waits, in ms; tests shrink them.
  const timeouts = { editorMs: 15000, valuesMs: 8000, enableMs: 8000, saveMs: 30000, idMs: 8000 };

  function GB() { return root.GB; }
  function doc() { return GB().env.doc(); }
  function win() { return GB().env.win(); }
  function url() { return win().location.href; }

  // ---------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------
  let installed = false;
  function install() {
    const gb = GB();
    if (!gb) return;
    for (const name of GEM_ELEMENT_NAMES) if (!gb.BUILTIN[name]) gb.BUILTIN[name] = GEM_ELEMENTS[name];
    for (const field of Object.keys(FIELD_LABELS)) {
      const fnName = 'gemFieldByLabel:' + field;
      if (!gb.FNS[fnName]) gb.FNS[fnName] = () => fieldByLabel(field);
    }
    installed = true;
  }

  // The control that follows a label reading "Name" / "Description" /
  // "Instructions": the input inside the same form field, or the next one in
  // document order. Never a control inside the preview's chat box.
  function fieldByLabel(field) {
    const re = FIELD_LABELS[field];
    const labels = Array.from(doc().querySelectorAll('label, mat-label, h2, h3, .label, [class*="label"], [class*="title"]'))
      .filter((el) => re.test(GB().norm(el.textContent || '')) && GB().norm(el.textContent || '').length < 40);
    for (const label of labels) {
      const forId = label.getAttribute && label.getAttribute('for');
      if (forId) {
        const byId = doc().getElementById(forId);
        if (byId) return [byId];
      }
      const box = label.closest('mat-form-field, .mat-mdc-form-field, [class*="form-field"], section, .field');
      const inside = box ? editableIn(box) : null;
      if (inside) return [inside];
      const next = nextEditable(label);
      if (next) return [next];
    }
    return [];
  }

  const EDITABLE = 'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';
  // The editor's own column. Everything outside it (the preview chat, the side
  // navigation) is never a gem field. On a page without that column (an older
  // or changed editor) nothing is excluded, so the label search still works.
  function inPreview(el) {
    const column = doc().querySelector('.editor-container');
    return column ? !column.contains(el) : false;
  }
  function editableIn(box) {
    return Array.from(box.querySelectorAll(EDITABLE)).find((el) => !inPreview(el) && GB().isVisible(el)) || null;
  }
  function nextEditable(from) {
    const all = Array.from(doc().querySelectorAll(EDITABLE)).filter((el) => !inPreview(el) && GB().isVisible(el));
    return all.find((el) => from.compareDocumentPosition(el) & 4 /* FOLLOWING */) || null;
  }

  // Resolves `name` or throws GEM_UI_NOT_FOUND with the resolver's report.
  function element(name, opts) {
    try {
      return GB().resolve(name, Object.assign({ fresh: true }, opts || {})).el;
    } catch (e) {
      if (e && e.code === 'ELEMENT_NOT_FOUND') {
        throw GB().gbError('GEM_UI_NOT_FOUND', 'The gem editor has no "' + name + '" (' + url() + ')', Object.assign({}, e.details, { element: name, url: url() }));
      }
      throw e;
    }
  }

  async function waitForElement(name, timeoutMs) {
    try {
      await GB().waitFor(() => GB().find(name, { fresh: true }), { timeoutMs, phase: 'gem editor (' + name + ')' });
    } catch (_) { /* element() below reports what is missing */ }
    return element(name);
  }

  // ---------------------------------------------------------------------
  // Reading and writing fields
  // ---------------------------------------------------------------------
  function isFormControl(el) { return /^(INPUT|TEXTAREA)$/.test(el.tagName); }

  function readEditable(el) {
    if (root.GBC && typeof root.GBC.readBox === 'function') return root.GBC.readBox(el);
    const blocks = Array.from(el.children).filter((c) => /^(P|DIV)$/.test(c.tagName));
    const t = blocks.length ? blocks.map((b) => b.textContent).join('\n') : el.textContent;
    return String(t || '').replace(/ /g, ' ').replace(/\n+$/, '');
  }

  function readField(el) { return isFormControl(el) ? String(el.value || '') : readEditable(el); }

  function same(a, b) { return GB().norm(a) === GB().norm(b); }

  function fire(el, type) {
    const w = win();
    let ev;
    try { ev = type === 'input' ? new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }) : new w.Event(type, { bubbles: true }); } catch (_) { ev = new w.Event(type, { bubbles: true }); }
    el.dispatchEvent(ev);
  }

  // Angular listens to `input`; the value is set through the prototype's own
  // setter so a framework that wrapped the instance's `value` still sees it.
  function writeFormControl(el, text) {
    const proto = el.tagName === 'TEXTAREA' ? win().HTMLTextAreaElement.prototype : win().HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    try { el.focus(); } catch (_) { /* ignore */ }
    if (setter && setter.set) setter.set.call(el, text); else el.value = text;
    fire(el, 'input');
    fire(el, 'change');
    try { el.blur(); } catch (_) { /* ignore */ }
    return same(el.value, text);
  }

  function selectAll(el) {
    try {
      el.focus();
      const sel = doc().getSelection();
      if (sel) { sel.removeAllRanges(); sel.selectAllChildren(el); }
    } catch (_) { /* ignore */ }
  }

  // Same two ways content.js types into the prompt box: what a paste does
  // (execCommand), or one <p> per line and a single input event. Long text
  // goes DOM-first: execCommand is slow on a long paste.
  function writeEditable(el, text) {
    const order = text.length >= 4000 ? ['dom', 'exec'] : ['exec', 'dom'];
    for (const way of order) {
      selectAll(el);
      if (way === 'exec') {
        try { if (!doc().execCommand('insertText', false, text)) continue; } catch (_) { continue; }
      } else {
        el.innerHTML = '';
        for (const line of text.split('\n')) {
          const p = doc().createElement('p');
          if (line === '') p.appendChild(doc().createElement('br')); else p.textContent = line;
          el.appendChild(p);
        }
        fire(el, 'input');
      }
      if (same(readEditable(el), text)) return true;
    }
    return false;
  }

  function writeField(name, el, text) {
    const ok = isFormControl(el) ? writeFormControl(el, text) : writeEditable(el, text);
    if (!ok) {
      throw GB().gbError('TYPE_FAILED', 'The gem editor does not read back the ' + name, { element: name, expected: text, actual: readField(el) });
    }
  }

  // ---------------------------------------------------------------------
  // Page state
  // ---------------------------------------------------------------------
  function gemIdFrom(u) {
    const m = GEM_ID.exec(String(u || ''));
    return m && m[1] !== 'create' && m[1] !== 'view' ? m[1] : null;
  }

  // A link to the gem's own chat, once the editor shows one (after a save).
  function gemIdOnPage() {
    for (const a of Array.from(doc().querySelectorAll('a[href*="/gem/"]'))) {
      const id = gemIdFrom(a.getAttribute('href'));
      if (id) return id;
    }
    return null;
  }

  function fieldErrors() {
    const els = Array.from(doc().querySelectorAll('mat-error, .mat-mdc-form-field-error, [role="alert"], .error-message'));
    return els.filter((el) => GB().isVisible(el)).map((el) => GB().norm(el.textContent || '')).filter(Boolean);
  }

  function isSavedText(text) { return SAVED_SIGNAL.test(text) && !NOT_SAVED_SIGNAL.test(text); }

  function savedSignal() {
    const els = Array.from(doc().querySelectorAll('.save-state, mat-snack-bar-container, simple-snack-bar, [role="status"], .mdc-snackbar'));
    const hit = els.find((el) => GB().isVisible(el) && isSavedText(GB().norm(el.textContent || '')));
    return hit ? GB().norm(hit.textContent || '') : null;
  }

  function canonicalUrl(id) { return id ? 'https://gemini.google.com/gem/' + id : url(); }

  // The editor enables Save a moment after it registers an edit; one that stays
  // disabled means the form never saw the new text.
  async function enabledSaveButton() {
    try {
      return await GB().waitFor(() => GB().find('gemSaveButton', { fresh: true, enabled: true }), { timeoutMs: timeouts.enableMs, phase: 'the Save button to enable' });
    } catch (_) {
      element('gemSaveButton'); // missing altogether: GEM_UI_NOT_FOUND with the resolver's report
      throw GB().gbError('GEM_SAVE_FAILED', 'The gem editor kept Save disabled after the edit', { reason: 'save disabled', element: GB().elementReport('gemSaveButton'), url: url() });
    }
  }

  // Clicks Save and waits for the editor to accept it: its save state reading
  // "saved", or (creating) the address moving to the new gem's id. A save state
  // that already read "saved" before the click only counts once it has changed
  // in between. Save going disabled proves nothing: it is disabled while the
  // save is in flight. Field errors mean the editor refused.
  async function save(opts) {
    const startUrl = url();
    let left = !savedSignal();
    const button = await enabledSaveButton();
    GB().robustClick(button);
    const accepted = () => {
      const errors = fieldErrors();
      if (errors.length) throw GB().gbError('GEM_SAVE_FAILED', 'The gem editor refused the save: ' + errors.join('; '), { reason: 'field errors', fieldErrors: errors });
      const notice = savedSignal();
      if (!notice) left = true;
      else if (left) return { how: 'notice', notice };
      const id = gemIdFrom(url());
      if (opts.creating && id && url() !== startUrl) return { how: 'url' };
      return null;
    };
    let how;
    try {
      how = await GB().waitFor(accepted, { timeoutMs: timeouts.saveMs, phase: 'the gem to save' });
    } catch (e) {
      if (e && e.code === 'GEM_SAVE_FAILED') throw e;
      throw GB().gbError('GEM_SAVE_FAILED', 'Save was clicked but the gem editor never confirmed it', { reason: 'no confirmation', fieldErrors: fieldErrors(), url: url() });
    }
    return how;
  }

  // The editor fills its fields a moment after it renders; an existing gem
  // always has a name, so an empty one means "not loaded yet".
  async function waitForValues(nameEl) {
    try {
      await GB().waitFor(() => readField(nameEl).trim() !== '', { timeoutMs: timeouts.valuesMs, phase: 'the gem editor to load the gem' });
    } catch (_) {
      throw GB().gbError('TIMEOUT', 'The gem editor did not show this gem\'s values', { phase: 'gem values', url: url() });
    }
  }

  function readAll() {
    const nameEl = element('gemNameInput');
    const descEl = GB().find('gemDescriptionInput', { fresh: true });
    const instrEl = element('gemInstructionsEditor');
    return {
      name: readField(nameEl),
      description: descEl ? readField(descEl) : '',
      instructions: readField(instrEl),
    };
  }

  function str(v) { return v == null ? null : String(v); }

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  async function gemRead() {
    install();
    const nameEl = await waitForElement('gemNameInput', timeouts.editorMs);
    await waitForValues(nameEl);
    const id = gemIdFrom(url());
    return Object.assign({ url: canonicalUrl(id), gemId: id }, readAll());
  }

  async function gemCreate(params) {
    install();
    const name = str(params.name);
    if (!name || !name.trim()) throw GB().gbError('BAD_PARAMS', 'gem_create needs a `name`');
    const description = str(params.description) || '';
    const instructions = str(params.instructions) || '';
    const nameEl = await waitForElement('gemNameInput', timeouts.editorMs);
    writeField('name', nameEl, name);
    if (description) writeField('description', element('gemDescriptionInput'), description);
    if (instructions) writeField('instructions', element('gemInstructionsEditor'), instructions);
    await save({ creating: true });
    let id = gemIdFrom(url()) || gemIdOnPage();
    if (!id) {
      try { id = await GB().waitFor(() => gemIdFrom(url()) || gemIdOnPage(), { timeoutMs: timeouts.idMs, phase: 'the new gem\'s id' }); } catch (_) { id = null; }
    }
    return { url: canonicalUrl(id), gemId: id || '', name };
  }

  async function gemUpdate(params) {
    install();
    const nameEl = await waitForElement('gemNameInput', timeouts.editorMs);
    await waitForValues(nameEl);
    const wanted = { name: str(params.name), description: str(params.description), instructions: str(params.instructions) };
    if (wanted.name != null && !wanted.name.trim()) throw GB().gbError('BAD_PARAMS', 'a gem cannot have an empty `name`');
    const elements = { name: 'gemNameInput', description: 'gemDescriptionInput', instructions: 'gemInstructionsEditor' };
    const changed = [];
    for (const field of ['name', 'description', 'instructions']) {
      if (wanted[field] == null) continue;
      const el = element(elements[field]);
      if (same(readField(el), wanted[field])) continue;
      writeField(field, el, wanted[field]);
      changed.push(field);
    }
    if (changed.length) await save({ creating: false });
    const id = gemIdFrom(url());
    return { url: canonicalUrl(id), gemId: id || '', name: readField(element('gemNameInput')), changed };
  }

  // What the editor looks like to the bridge: each gem element's report, and
  // every visible field and button with what labels it — the map to fix the
  // locators from when Gemini changes its editor.
  function describeControl(el) {
    const gb = GB();
    const box = el.closest('mat-form-field, .mat-mdc-form-field, [class*="form-field"]');
    const label = box ? gb.norm((box.querySelector('label, mat-label') || {}).textContent || '') : '';
    return Object.assign(gb.summarize(el), {
      type: el.getAttribute('type') || null,
      formControlName: el.getAttribute('formcontrolname') || (el.closest('[formcontrolname]') || { getAttribute: () => null }).getAttribute('formcontrolname'),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || null,
      label: label || null,
      inPreview: inPreview(el),
      valueLength: readField(el).length,
    });
  }

  function gemDiagnostics() {
    install();
    const gb = GB();
    const elements = {};
    for (const name of GEM_ELEMENT_NAMES) elements[name] = gb.elementReport(name, { includeCandidates: true });
    const fields = Array.from(doc().querySelectorAll(EDITABLE)).filter((el) => gb.isVisible(el)).slice(0, 40).map(describeControl);
    const buttons = Array.from(doc().querySelectorAll('button, [role="button"], a[href]'))
      .filter((el) => gb.isVisible(el)).slice(0, 80)
      .map((el) => ({ text: gb.textOf(el).slice(0, 60), aria: el.getAttribute('aria-label'), testId: el.getAttribute('data-test-id'), icon: gb.iconOf(el), href: el.getAttribute('href'), disabled: !gb.isEnabled(el), path: gb.cssPath(el, 6) }));
    const headings = Array.from(doc().querySelectorAll('h1, h2, h3, label, mat-label')).filter((el) => gb.isVisible(el)).map((el) => gb.norm(el.textContent || '').slice(0, 80)).filter(Boolean).slice(0, 40);
    return { url: url(), gemId: gemIdFrom(url()), title: doc().title, elements, fields, buttons, headings, fieldErrors: fieldErrors(), savedSignal: savedSignal() };
  }

  if (root.GB) install();

  root.GeminiGems = {
    handlers: { gem_read: gemRead, gem_create: gemCreate, gem_update: gemUpdate, gem_diagnostics: gemDiagnostics },
    instant: ['gem_read', 'gem_create', 'gem_update', 'gem_diagnostics'],
    elements: GEM_ELEMENT_NAMES,
    timeouts,
    install,
    gemIdFrom,
    isInstalled: () => installed,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
