/* Gemini Bridge — popup. Talks to the background via {type:'popup', action}. */
'use strict';

const $ = (id) => document.getElementById(id);
const ELEMENT_ORDER = ['textarea', 'sendButton', 'stopButton', 'newChat', 'modelSwitcher', 'account'];
let lastDiagnostics = null;

// Promise style only: on Firefox `chrome` is `browser` (compat.js), which takes no callbacks.
async function bg(action, extra) {
  const resp = await chrome.runtime.sendMessage(Object.assign({ type: 'popup', action }, extra || {}));
  if (!resp) throw new Error('no reply from background');
  if (resp.ok) return resp.result;
  throw Object.assign(new Error(resp.error.message), resp.error);
}

// Never inject page-derived strings as HTML: build nodes with textContent.
function setText(el, text) { el.textContent = text == null ? '' : String(text); }
function cell(text, cls) { const td = document.createElement('td'); td.textContent = text == null ? '' : String(text); if (cls) td.className = cls; return td; }

function renderState(s) {
  setText($('version'), 'v' + s.version);
  setText($('browser'), s.browser ? s.browser.browser + ' ' + (s.browser.browserVersion || '') : '');
  const dot = $('conn-dot');
  dot.className = 'dot ' + s.ws;
  setText($('conn-text'), s.connected ? 'connected to ws://127.0.0.1:' + s.port : (s.ws === 'connecting' ? 'connecting to port ' + s.port + '…' : 'not connected (port ' + s.port + ')'));
  setText($('conn-error'), s.connected ? '' : (s.lastError ? s.lastError + ' — is the Python bridge running?' : 'Start the Python bridge; the extension reconnects with backoff.'));
  if (document.activeElement !== $('port')) $('port').value = s.port;
  const t = s.bridgeTab;
  setText($('tab-info'), t ? '#' + t.tabId + ' ' + (t.ready ? '(ready) ' : '(not ready) ') + (t.title || t.url) : 'none — a call will pick or open one');
  $('focus-tab').disabled = !t;
  const q = s.queue;
  setText($('queue-info'), 'queued: ' + q.length + ' · running: ' + (q.running || 'none') + ' · ' + (q.paused ? 'PAUSED' : 'active') + ' · stored: ' + q.total);
  $('queue-pause').disabled = q.paused;
  $('queue-resume').disabled = !q.paused;
}

function renderElements(elements, note) {
  const body = $('elements').querySelector('tbody');
  body.textContent = '';
  const names = ELEMENT_ORDER.concat(Object.keys(elements || {}).filter((n) => !ELEMENT_ORDER.includes(n)));
  for (const name of names) {
    const e = elements && elements[name];
    if (!e) continue;
    const tr = document.createElement('tr');
    tr.appendChild(cell(name));
    tr.appendChild(cell(e.found ? 'yes' : 'no', e.found ? 'found-yes' : 'found-no'));
    tr.appendChild(cell(e.found ? e.strategy : (e.note || (e.lastKnown ? 'last: ' + e.lastKnown.strategy : '—')), 'strategy'));
    body.appendChild(tr);
  }
  setText($('elements-note'), note || '');
}

async function refreshState() {
  try { renderState(await bg('state')); } catch (e) { setText($('conn-text'), 'background unreachable: ' + e.message); }
}

async function refreshElements() {
  try {
    const s = await bg('call', { method: 'status', params: {} });
    const note = [s.signedOut ? 'signed out' : null, s.generating ? 'generating' : null, s.model && s.model.name ? 'model: ' + s.model.name : null, s.account && s.account.email ? s.account.email : null, s.pageError ? 'page error: ' + s.pageError.text : null].filter(Boolean).join(' · ');
    renderElements(s.elements, note);
  } catch (e) {
    renderElements({}, 'status failed: ' + (e.code ? e.code + ' — ' : '') + e.message);
  }
}

async function runDiagnostics() {
  const out = $('diag-out');
  out.classList.remove('hidden');
  setText(out, 'running…');
  try {
    lastDiagnostics = await bg('call', { method: 'diagnostics', params: {} });
    setText(out, JSON.stringify(lastDiagnostics, null, 2));
    $('copy-diag').disabled = false;
    if (lastDiagnostics.elements) renderElements(lastDiagnostics.elements, 'from diagnostics');
  } catch (e) {
    lastDiagnostics = { error: e.code || 'ERROR', message: e.message, details: e.details || {} };
    setText(out, JSON.stringify(lastDiagnostics, null, 2));
    $('copy-diag').disabled = false;
  }
}

function wire() {
  $('save-port').addEventListener('click', async () => {
    try { await bg('set_port', { port: $('port').value }); setTimeout(refreshState, 800); } catch (e) { setText($('conn-error'), e.message); }
  });
  $('open-gemini').addEventListener('click', async () => {
    try { await bg('call', { method: 'open', params: { focus: true } }); await refreshState(); await refreshElements(); } catch (e) { setText($('conn-error'), e.message); }
  });
  $('focus-tab').addEventListener('click', () => bg('call', { method: 'focus', params: {} }).catch(() => undefined));
  $('queue-pause').addEventListener('click', () => bg('call', { method: 'queue_pause', params: {} }).then(refreshState));
  $('queue-resume').addEventListener('click', () => bg('call', { method: 'queue_resume', params: {} }).then(refreshState));
  $('queue-clear').addEventListener('click', () => bg('call', { method: 'queue_clear', params: {} }).then(refreshState));
  $('run-diag').addEventListener('click', runDiagnostics);
  $('copy-diag').addEventListener('click', async () => {
    if (!lastDiagnostics) return;
    try { await navigator.clipboard.writeText(JSON.stringify(lastDiagnostics, null, 2)); setText($('elements-note'), 'diagnostics copied'); } catch (e) { setText($('elements-note'), 'copy failed: ' + e.message); }
  });
}

wire();
refreshState();
refreshElements();
setInterval(refreshState, 2000);
