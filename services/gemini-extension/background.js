/*
 * Gemini Bridge — background service worker (Manifest V3, classic script).
 *
 * WebSocket client to the Python BridgeServer, tab management, routing of
 * DOM methods to the content script (with on-demand injection), the
 * persisted prompt queue, selector-override persistence and popup API.
 *
 * Contract: services/pipeline/src/gratovo_pipeline/gemini/ (ADR 0014) §1–§3, §6.
 */
'use strict';

// compat.js points `chrome` at `browser` on Firefox. locators.js only touches
// the DOM lazily, so loading it here just gives us the BUILTIN strategy table
// for get_selectors and the shared gbError(). On Firefox there is no service
// worker: the build lists the same files as the background page's scripts
// (tools/build_addon.py BACKGROUND_SCRIPTS), so importScripts does not exist.
if (typeof importScripts === 'function') importScripts('compat.js', 'content/locators.js');

const DEFAULT_PORT = 8765;
// Localhost dials are cheap and the app wants the bridge back at once after a
// daemon restart, so the backoff tops out at 5 s (the alarm is the safety net).
const BACKOFF_MS = [500, 1000, 2000, 3000, 5000];
const IDLE_PING_MS = 20000;
const READY_TIMEOUT_MS = 20000;
const INJECT_READY_TIMEOUT_MS = 3000;
const MAX_FINISHED_JOBS = 200;
const GEMINI_APP_URL = 'https://gemini.google.com/app';
// The same files, in the same order, as the manifest's content_scripts: what
// on-demand injection (injectContent) loads into a tab that has none.
// content/gems.js registers the gem methods content.js merges in, so it goes first.
const CONTENT_FILES = ['compat.js', 'content/locators.js', 'content/gems.js', 'content/skills.js', 'content/content.js'];

const gbError = globalThis.GB.gbError;
const BUILTIN = globalThis.GB.BUILTIN;

// ---------------------------------------------------------------------------
// Logging: console at warn/error only, plus a `log` event over the socket.
// ---------------------------------------------------------------------------
// `debug` lines are forwarded only while the Python side asked for them
// (`set_debug`), so the socket stays quiet in normal use.
let debugLog = false;
function log(level, message, context) {
  if (level === 'warn' || level === 'error') {
    try { console[level]('[GB bg]', message, context || ''); } catch (_) { /* ignore */ }
    emit('log', { level, message, context: context || {} });
  } else if (level === 'debug' && debugLog) {
    emit('log', { level, message, context: context || {} });
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowMs() { return Date.now(); }

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function getLocal(key, dflt) {
  const v = await chrome.storage.local.get(key);
  return v && v[key] !== undefined ? v[key] : dflt;
}
async function setLocal(obj) { return chrome.storage.local.set(obj); }

// settings.ownWindow: keep the bridge tab as the active tab of its own
// window. Edge freezes and sleeps background tabs within seconds of losing
// focus — a frozen content script answers nothing — and the active tab of a
// window is exempt. The window is created unfocused, so the owner's current
// window keeps the focus. Default on for Edge and Chrome; off for Firefox,
// which keeps background tabs' content scripts running, and whose dedicated
// profile exists only for Gemini — every tab stays in its one window (owner,
// 2026-10-02).
async function getOwnWindowSetting() {
  const settings = await getLocal('settings', {});
  if (settings && typeof settings.ownWindow === 'boolean') return settings.ownWindow;
  return browserVersions().browser !== 'firefox';
}

async function getPort() {
  const settings = await getLocal('settings', {});
  const p = parseInt(settings && settings.port, 10);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

// Session storage survives worker restarts but not browser restarts —
// exactly the lifetime a "bridge tab" should have. Fall back to local.
const sessionStore = (chrome.storage.session || chrome.storage.local);
async function getBridgeTabId() {
  const v = await sessionStore.get('bridgeTabId');
  return v && Number.isInteger(v.bridgeTabId) ? v.bridgeTabId : null;
}
async function setBridgeTabId(tabId) { return sessionStore.set({ bridgeTabId: tabId }); }

// ---------------------------------------------------------------------------
// WebSocket client
// ---------------------------------------------------------------------------
let ws = null;
let wsPort = null;
let backoffIndex = 0;
let reconnectTimer = null;
let lastActivity = 0;
let lastError = null;
let connectedAt = null;
let keepaliveTimer = null;

function wsState() {
  if (!ws) return 'closed';
  return ['connecting', 'open', 'closing', 'closed'][ws.readyState] || 'closed';
}

function wsOpen() { return !!ws && ws.readyState === WebSocket.OPEN; }

function wsSend(obj) {
  if (!wsOpen()) return false;
  // console only: log() would emit over the same socket and recurse.
  try { ws.send(JSON.stringify(obj)); lastActivity = nowMs(); return true; } catch (e) { console.warn('[GB bg] ws send failed', String(e)); return false; }
}

function emit(event, data) { wsSend({ type: 'event', event, data }); }

let connecting = false; // guards the await below: 'installed' and 'boot' fire together
async function connect(reason) {
  if (connecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  connecting = true;
  let port;
  try { port = await getPort(); } finally { connecting = false; }
  wsPort = port;
  const url = 'ws://127.0.0.1:' + port;
  let socket;
  try { socket = new WebSocket(url); } catch (e) { lastError = String(e); scheduleReconnect(); return; }
  ws = socket;
  socket.onopen = async () => {
    if (ws !== socket) return;
    backoffIndex = 0; lastError = null; connectedAt = nowMs(); lastActivity = nowMs();
    wsSend({ type: 'event', event: 'hello', data: await helloData() });
    startKeepalive();
  };
  socket.onmessage = (ev) => { if (ws === socket) onMessage(ev.data); };
  socket.onerror = () => { if (ws === socket) lastError = 'connection failed (' + reason + ')'; };
  socket.onclose = (ev) => {
    if (ws !== socket) return;
    ws = null; connectedAt = null;
    stopKeepalive();
    if (ev && ev.code !== 1000 && ev.reason) lastError = ev.reason;
    // 4003: the app selected another browser. Knocking every few seconds
    // would only be refused again; try once a minute in case that changes.
    // 4001: the app refused our per-launch token (wrong or stale); same back-off.
    if (ev && (ev.code === 4003 || ev.code === 4001)) { scheduleReconnect(WRONG_BROWSER_RETRY_MS); return; }
    scheduleReconnect();
  };
}

const WRONG_BROWSER_RETRY_MS = 60000;

function scheduleReconnect(fixedDelay) {
  if (reconnectTimer) return;
  const delay = fixedDelay || BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
  backoffIndex++;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect('backoff'); }, delay);
}

function disconnect() {
  const s = ws; ws = null;
  if (s) { try { s.close(1000, 'reconfigure'); } catch (_) { /* ignore */ } }
  stopKeepalive();
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (!wsOpen()) return;
    if (nowMs() - lastActivity >= IDLE_PING_MS) wsSend({ type: 'ping' });
  }, 5000);
}
function stopKeepalive() { if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; } }

function browserVersions() {
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  const edge = /Edg\/(\d+[\d.]*)/.exec(ua);
  const chromeM = /Chrome\/(\d+[\d.]*)/.exec(ua);
  const firefox = /Firefox\/(\d+[\d.]*)/.exec(ua);
  return {
    chromeVersion: chromeM ? chromeM[1] : null,
    browser: edge ? 'edge' : (chromeM ? 'chrome' : (firefox ? 'firefox' : 'other')),
    browserVersion: edge ? edge[1] : (chromeM ? chromeM[1] : (firefox ? firefox[1] : null)),
  };
}

// PROTOCOL.md "hello additions". `gems` = content/gems.js registered the gem_*
// methods; `keepalive` = this side answers ping and sends its own.
const CAPABILITIES = ['gems', 'keepalive'];

// The signed-in account the extension last saw (get_account / status replies),
// kept in storage so a hello right after a browser restart still carries it.
let lastAccount = null;
async function loadLastAccount() {
  if (lastAccount) return lastAccount;
  const a = await getLocal('lastAccount', null);
  if (a && typeof a === 'object' && (a.name || a.email)) lastAccount = a;
  return lastAccount;
}
function rememberAccount(account, url) {
  if (!account || typeof account !== 'object' || !(account.name || account.email)) return;
  const next = { name: account.name || null, email: account.email || null, index: Number.isInteger(account.index) ? account.index : accountIndexOf(url) };
  if (lastAccount && lastAccount.name === next.name && lastAccount.email === next.email && lastAccount.index === next.index) return;
  lastAccount = next;
  setLocal({ lastAccount: next }).catch(() => undefined);
}

function helloToken() {
  return (typeof self !== 'undefined' && typeof self.GB_BRIDGE_TOKEN === 'string') ? self.GB_BRIDGE_TOKEN : null;
}

async function helloData() {
  return Object.assign({
    extensionVersion: chrome.runtime.getManifest().version,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    capabilities: CAPABILITIES.slice(),
    account: await loadLastAccount().catch(() => null),
    port: wsPort,
    tabs: await listTabs(),
    // Per-launch token (bridge-token.js, written by the Firefox build). Never log it.
    token: helloToken(),
  }, browserVersions());
}

async function onMessage(raw) {
  lastActivity = nowMs();
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { log('warn', 'non-JSON frame ignored'); return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') { wsSend({ type: 'pong' }); return; }
  if (msg.type === 'pong') return;
  if (msg.type === 'request') {
    const id = msg.id;
    let reply;
    try {
      const result = await handleRequest(msg.method, msg.params && typeof msg.params === 'object' ? msg.params : {});
      reply = { type: 'response', id, ok: true, result: result === undefined ? {} : result };
    } catch (e) {
      reply = { type: 'response', id, ok: false, error: normalizeError(e) };
    }
    if (!wsSend(reply)) log('warn', 'response dropped: socket closed', { id, method: msg.method });
  }
}

function normalizeError(e) {
  if (e && typeof e === 'object' && typeof e.code === 'string' && 'message' in e) {
    return { code: e.code, message: String(e.message), details: e.details && typeof e.details === 'object' ? e.details : {} };
  }
  return gbError('INTERNAL', e && e.message ? e.message : String(e), { stack: e && e.stack ? String(e.stack) : '' });
}

// ---------------------------------------------------------------------------
// Content-script readiness
// ---------------------------------------------------------------------------
const readyTabs = new Map(); // tabId -> {url, at}
const readyWaiters = []; // {tabId, since, resolve}

function markReady(tabId, url) {
  readyTabs.set(tabId, { url, at: nowMs() });
  for (let i = readyWaiters.length - 1; i >= 0; i--) {
    const w = readyWaiters[i];
    if (w.tabId === tabId && readyTabs.get(tabId).at >= w.since) { readyWaiters.splice(i, 1); w.resolve(true); }
  }
}

// Resolves when the tab's content script has announced itself after
// `since`, or answers a ping (covers a worker restart that missed cs_ready).
async function waitForReady(tabId, timeoutMs, since, requireFresh) {
  const deadline = nowMs() + timeoutMs;
  const r = readyTabs.get(tabId);
  if (r && r.at >= since) return true;
  let waiter;
  const announced = new Promise((resolve) => { waiter = { tabId, since, resolve }; readyWaiters.push(waiter); });
  const probe = (async () => {
    while (nowMs() < deadline) {
      await sleep(400);
      if (readyTabs.get(tabId) && readyTabs.get(tabId).at >= since) return true;
      if (requireFresh) continue; // after a navigation only a fresh cs_ready counts
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status !== 'complete') continue;
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'cs_call', method: 'ping', params: {} });
        if (resp && resp.ok) { markReady(tabId, tab.url); return true; }
      } catch (_) { /* not there yet */ }
    }
    return false;
  })();
  const timeout = sleep(timeoutMs).then(() => false);
  const ok = await Promise.race([announced, probe, timeout]);
  const i = readyWaiters.indexOf(waiter); if (i >= 0) readyWaiters.splice(i, 1);
  return ok;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function isGeminiUrl(u) { return typeof u === 'string' && /^https:\/\/gemini\.google\.com\//.test(u); }
function isAccountsUrl(u) { return typeof u === 'string' && /^https:\/\/accounts\.google\.com\//.test(u); }
function tabInfo(tab) { return { tabId: tab.id, url: tab.url || '', title: tab.title || '', active: !!tab.active, ready: readyTabs.has(tab.id), status: tab.status || null, windowId: tab.windowId }; }

async function listTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://gemini.google.com/*', 'https://accounts.google.com/*'] });
  return tabs.filter((t) => isGeminiUrl(t.url) || isAccountsUrl(t.url)).map(tabInfo);
}

async function tabById(tabId) {
  try { return await chrome.tabs.get(tabId); } catch (_) { return null; }
}

async function mostRecentGeminiTab() {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (!tabs.length) return null;
  tabs.sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  return tabs[0];
}

async function openGeminiTab(url, focus) {
  const since = nowMs();
  const tab = await chrome.tabs.create({ url: url || GEMINI_APP_URL, active: !!focus });
  await setBridgeTabId(tab.id);
  const ok = await waitForReady(tab.id, READY_TIMEOUT_MS, since, false);
  const fresh = await tabById(tab.id);
  if (!ok) throw gbError('TAB_NOT_READY', 'Opened a Gemini tab but its content script never reported ready', { tabId: tab.id, url: fresh && fresh.url, status: fresh && fresh.status });
  return fresh;
}

// PROTOCOL §3: params.tabId → bridge tab → most recently active Gemini tab → open one.
async function getTargetTab(params, opts) {
  opts = opts || {};
  log('debug', 'getTargetTab', { params });
  if (params && params.tabId != null) {
    const t = await tabById(Number(params.tabId));
    if (!t) throw gbError('NO_TAB', 'Tab ' + params.tabId + ' does not exist');
    return awake(t);
  }
  const bridgeId = await getBridgeTabId();
  if (bridgeId != null) {
    const t = await tabById(bridgeId);
    if (t && (isGeminiUrl(t.url) || isAccountsUrl(t.url))) return awake(t);
    await setBridgeTabId(null);
  }
  const recent = await mostRecentGeminiTab();
  if (recent) { await setBridgeTabId(recent.id); return awake(recent); }
  if (opts.open === false) throw gbError('NO_TAB', 'No gemini.google.com tab is open');
  return openGeminiTab(GEMINI_APP_URL, false);
}

// Make `tab` the active tab of a window of its own (unless it already is the
// active tab somewhere, or the setting is off). Returns the fresh tab.
const movedToOwnWindow = new Set();
async function ensureOwnWindow(tab) {
  if (!tab || tab.active || movedToOwnWindow.has(tab.id)) return tab;
  if (!(await getOwnWindowSetting())) return tab;
  movedToOwnWindow.add(tab.id);
  try {
    const win = await chrome.windows.create({ tabId: tab.id, focused: false, type: 'normal', width: 1100, height: 850 });
    log('warn', 'moved the Gemini tab to its own window so the browser keeps it awake', { tabId: tab.id, windowId: win && win.id });
    const fresh = await tabById(tab.id);
    return fresh || tab;
  } catch (e) {
    log('warn', 'could not move the Gemini tab to its own window', { tabId: tab.id, error: String(e && e.message || e) });
    return tab;
  }
}

// Edge's sleeping tabs and Chrome's memory saver discard a background tab:
// its content script is gone and a message to it hangs or returns nothing.
// Reload a discarded tab (that is how the browser itself wakes it) and mark
// the bridge tab as not discardable so it stays awake from then on.
const pinnedAwake = new Set();
async function awake(tab) {
  if (!tab) return tab;
  if (tab.discarded) {
    log('warn', 'bridge tab was discarded by the browser; waking it', { tabId: tab.id, url: tab.url });
    return navigateTab(tab.id, null, READY_TIMEOUT_MS, true);
  }
  tab = await ensureOwnWindow(tab);
  if (tab.autoDiscardable !== false && !pinnedAwake.has(tab.id)) {
    // Fire and forget: Edge has been seen never settling this promise, and
    // the request must not wait on it either way.
    pinnedAwake.add(tab.id);
    try { Promise.resolve(chrome.tabs.update(tab.id, { autoDiscardable: false })).catch(() => pinnedAwake.delete(tab.id)); } catch (_) { pinnedAwake.delete(tab.id); }
  }
  return tab;
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(t); resolve(v); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
    chrome.tabs.onUpdated.addListener(listener);
    const t = setTimeout(() => finish(false), timeoutMs);
    tabById(tabId).then((tab) => { if (tab && tab.status === 'complete' && !done) { /* may already be loaded; the ready wait decides */ } });
  });
}

function accountIndexOf(u) { const m = /\/u\/(\d+)(\/|$)/.exec(String(u || '')); return m ? parseInt(m[1], 10) : 0; }
function hasAccountPrefix(u) { return /\/u\/\d+(\/|$)/.test(String(u || '')); }

function isRedirected(requestedUrl, landedUrl) {
  let landedHost = '';
  try { landedHost = new URL(landedUrl).hostname; } catch (_) { /* ignore */ }
  if (landedHost !== 'gemini.google.com') return true;
  if (hasAccountPrefix(requestedUrl) && !hasAccountPrefix(landedUrl)) return true;
  return accountIndexOf(requestedUrl) !== accountIndexOf(landedUrl);
}

// Navigate (or reload) and wait for load + a fresh cs_ready.
async function navigateTab(tabId, url, timeoutMs, reload) {
  const since = nowMs();
  readyTabs.delete(tabId);
  const loadedP = waitForLoad(tabId, timeoutMs);
  if (reload) await chrome.tabs.reload(tabId, { bypassCache: true }); else await chrome.tabs.update(tabId, { url });
  // A fresh cs_ready can only follow the load, so waiting for it (with the
  // load watched concurrently) bounds the whole navigation by one timeout.
  const ready = await waitForReady(tabId, timeoutMs, since, true);
  const loaded = await Promise.race([loadedP, sleep(50).then(() => ready)]);
  const tab = await tabById(tabId);
  if (!tab) throw gbError('NO_TAB', 'Tab disappeared during navigation');
  if (isAccountsUrl(tab.url)) throw gbError('SIGNED_OUT', 'Navigation landed on the Google sign-in page', { url: tab.url, signal: 'accounts.google.com' });
  if (!ready) throw gbError(loaded ? 'TAB_NOT_READY' : 'TIMEOUT', 'Content script did not report ready after navigation', { tabId, url: tab.url, status: tab.status, phase: 'navigate' });
  return tab;
}

// ---------------------------------------------------------------------------
// Routing to the content script
// ---------------------------------------------------------------------------
function isDeadlineError(e) { return /did not answer within/.test(String(e && e.message || e)); }
function isNoReceiver(e) {
  const m = String(e && e.message || e);
  return /Receiving end does not exist|Could not establish connection/i.test(m);
}

async function injectContent(tabId) {
  log('debug', 'injectContent start', { tabId });
  const t0 = nowMs();
  try {
    const r = await withDeadline(chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES }), 5000, 'executeScript did not settle within 5 s');
    log('debug', 'injectContent done', { tabId, ms: nowMs() - t0, frames: Array.isArray(r) ? r.length : null });
  } catch (e) {
    log('debug', 'injectContent failed', { tabId, ms: nowMs() - t0, error: String(e && e.message || e) });
    throw e;
  }
}

// The gem editor methods (content/gems.js) drive a form and a save, so they get
// longer than an ordinary call; a request's own `timeoutMs` still wins.
const LONG_CONTENT_METHODS = {
  send: 180000, new_chat: 10000, set_model: 5000, list_models: 5000, stop: 5000, set_mode: 10000, list_thinking_levels: 8000, set_thinking_level: 20000,
  gem_read: 60000, gem_create: 120000, gem_update: 120000,
  skills_list: 30000, skill_read: 180000, skill_upload_open: 30000, skill_upload_finish: 180000, skill_set_active: 40000, skill_delete: 40000
};
// A caller may ask for a longer wait, but never past this: the longest method allows 3 minutes.
const MAX_CONTENT_TIMEOUT_MS = 600000;
function contentDeadlineMs(method, params) {
  const base = Object.prototype.hasOwnProperty.call(LONG_CONTENT_METHODS, method) ? LONG_CONTENT_METHODS[method] : null;
  if (base == null) return 15000;
  const asked = params && Number(params.timeoutMs);
  // Outside 1 ms to the cap (or not a number), the method's own wait applies.
  const wait = asked > 0 && asked <= MAX_CONTENT_TIMEOUT_MS ? asked : base;
  return wait + 15000;
}
function withDeadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function callContent(tabId, method, params) {
  log('debug', 'callContent start', { tabId, method });
  const tab = await tabById(tabId);
  log('debug', 'callContent tab', { tabId, url: tab && tab.url, discarded: tab && tab.discarded, status: tab && tab.status });
  if (!tab) throw gbError('NO_TAB', 'Tab ' + tabId + ' no longer exists');
  if (isAccountsUrl(tab.url)) throw gbError('SIGNED_OUT', 'The tab is on the Google sign-in page', { url: tab.url, signal: 'accounts.google.com' });
  const msg = { type: 'cs_call', method, params: params || {} };
  const deadline = contentDeadlineMs(method, params);
  log('debug', 'callContent sending', { tabId, method, deadline });
  let resp;
  try {
    resp = await withDeadline(chrome.tabs.sendMessage(tabId, msg), deadline, 'content script did not answer within ' + deadline + ' ms (tab asleep, frozen, or the page hung)');
    log('debug', 'callContent replied', { tabId, method, ok: resp && resp.ok });
  } catch (e) {
    log('debug', 'callContent threw', { tabId, method, error: String(e && e.message || e) });
    if (isDeadlineError(e) && !(await tabById(tabId) || {}).active) {
      // The script is there but not running: the tab is frozen. Bringing
      // it to the front of its window thaws it at once; then one retry.
      log('warn', 'content script did not answer; activating the tab to thaw it and retrying', { tabId, method, url: tab.url });
      try { await chrome.tabs.update(tabId, { active: true }); } catch (_) { /* tab gone */ }
      await sleep(300);
      try {
        resp = await withDeadline(chrome.tabs.sendMessage(tabId, msg), deadline, 'content script still did not answer after activating the tab');
      } catch (e2) {
        throw gbError('TAB_NOT_READY', 'Content script did not answer: ' + String(e2 && e2.message || e2), { tabId, url: tab.url, status: tab.status, frozen: true });
      }
    } else if (!isNoReceiver(e)) throw gbError('TAB_NOT_READY', 'Content script did not answer: ' + String(e && e.message || e), { tabId, url: tab.url, status: tab.status });
    else {
      let since = nowMs();
      try { await injectContent(tabId); } catch (ie) {
        // executeScript that never settles = the renderer is frozen (Edge
        // sleeps background tabs). No script of ours is alive in it, so a
        // reload loses nothing and is the only thing that wakes it.
        log('warn', 'tab renderer is not responding; reloading the tab to wake it', { tabId, url: tab.url, error: String(ie && ie.message || ie) });
        since = nowMs();
        try { await navigateTab(tabId, null, READY_TIMEOUT_MS, true); } catch (re) {
          throw gbError('TAB_NOT_READY', 'Tab is not responding and could not be reloaded: ' + String(re && re.message || re), { tabId, url: tab.url, status: tab.status, injectError: String(ie && ie.message || ie) });
        }
      }
      const ready = await waitForReady(tabId, INJECT_READY_TIMEOUT_MS, since, false);
      log('debug', 'callContent after inject', { tabId, ready });
      try { resp = await withDeadline(chrome.tabs.sendMessage(tabId, msg), deadline, 'content script did not answer within ' + deadline + ' ms after injection'); } catch (e2) {
        const t = await tabById(tabId);
        throw gbError('TAB_NOT_READY', 'Content script still not answering after injection', { tabId, url: t && t.url, status: t && t.status, reason: String(e2 && e2.message || e2) });
      }
    }
  }
  if (!resp || typeof resp !== 'object') throw gbError('TAB_NOT_READY', 'Content script returned no reply', { tabId, url: tab.url, status: tab.status });
  if (resp.ok) {
    readyTabs.set(tabId, { url: tab.url, at: nowMs() });
    if (method === 'get_account') rememberAccount(resp.result, tab.url);
    else if (method === 'status' && resp.result) rememberAccount(Object.assign({ index: resp.result.accountIndex }, resp.result.account), tab.url);
    return resp.result;
  }
  throw resp.error || gbError('INTERNAL', 'content script returned ok:false without an error');
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------
const BACKGROUND_METHODS = {
  hello: async () => helloData(),
  set_debug: async (p) => { debugLog = !!p.enabled; return { enabled: debugLog }; },
  tabs: async () => listTabs(),
  open: async (p) => {
    if (!p.newTab) {
      const existing = await getTargetTab({}, { open: false }).catch(() => null);
      if (existing) {
        if (p.focus) await focusTab(existing.id);
        return tabInfo(await tabById(existing.id));
      }
    }
    return tabInfo(await openGeminiTab(p.url || GEMINI_APP_URL, !!p.focus));
  },
  navigate: async (p) => {
    if (!p.url || typeof p.url !== 'string') throw gbError('BAD_PARAMS', 'navigate needs {url}');
    const tab = await getTargetTab(p);
    const landed = await navigateTab(tab.id, p.url, p.timeoutMs || READY_TIMEOUT_MS, false);
    return { tabId: landed.id, url: landed.url, redirected: isRedirected(p.url, landed.url), requestedUrl: p.url };
  },
  focus: async (p) => { const tab = await getTargetTab(p); await focusTab(tab.id); return tabInfo(await tabById(tab.id)); },
  switch_account: async (p) => {
    const index = parseInt(p.index, 10);
    if (!Number.isInteger(index) || index < 0) throw gbError('BAD_PARAMS', 'switch_account needs {index >= 0}');
    const tab = await getTargetTab(p);
    const requestedUrl = 'https://gemini.google.com/u/' + index + '/app';
    const landed = await navigateTab(tab.id, requestedUrl, p.timeoutMs || READY_TIMEOUT_MS, false);
    let account = null;
    try { account = await callContent(landed.id, 'get_account', {}); } catch (e) { log('warn', 'get_account after switch failed', { error: normalizeError(e) }); }
    return { requested: index, landedIndex: accountIndexOf(landed.url), url: landed.url, redirected: isRedirected(requestedUrl, landed.url), account };
  },
  reload_page: async (p) => { const tab = await getTargetTab(p); return tabInfo(await navigateTab(tab.id, null, p.timeoutMs || READY_TIMEOUT_MS, true)); },
  // Reload the extension itself from disk (an unpacked extension does not
  // notice edited files). The reply goes out first; the worker dies with the
  // reload and reconnects on boot. Open Gemini tabs keep the old content
  // script until a call fails with "Receiving end does not exist", which
  // makes the background inject the new one.
  reload_extension: async () => { setTimeout(() => chrome.runtime.reload(), 150); return { reloading: true }; },

  status: async (p) => {
    const tab = await getTargetTab(p);
    const s = await callContent(tab.id, 'status', {});
    const q = await loadQueue();
    s.tabId = tab.id;
    s.queue = { length: q.jobs.filter((j) => j.status === 'queued').length, paused: !!q.paused, running: q.running };
    return s;
  },
  new_chat: async (p) => {
    const tab = await getTargetTab(p);
    try { return await callContent(tab.id, 'new_chat', p); } catch (e) {
      if (e && (e.code === 'ELEMENT_NOT_FOUND' || e.code === 'TIMEOUT') && e.details && e.details.fallbackUrl) {
        const landed = await navigateTab(tab.id, e.details.fallbackUrl, p.timeoutMs || READY_TIMEOUT_MS, false);
        return { url: landed.url, fallback: 'navigated' };
      }
      throw e;
    }
  },
  send: async (p) => sendOnTab(await getTargetTab(p), p),
  drop_files: async (p) => dropFiles(p),

  get_selectors: async () => ({ builtin: BUILTIN, overrides: await getLocal('selectorOverrides', {}) }),
  set_selectors: async (p) => {
    const overrides = validateOverrides(p.overrides);
    await setLocal({ selectorOverrides: overrides });
    // The content script also watches storage; pushing keeps the reply exact.
    const bridgeId = await getBridgeTabId();
    if (bridgeId != null) { try { await callContent(bridgeId, 'set_selectors', { overrides }); } catch (_) { /* tab may be gone */ } }
    return { builtin: BUILTIN, overrides };
  },

  queue_add: async (p) => queueAdd(p),
  queue_list: async () => { const q = await loadQueue(); return { paused: !!q.paused, running: q.running, jobs: q.jobs }; },
  queue_get: async (p) => { const q = await loadQueue(); const j = q.jobs.find((x) => x.id === p.jobId); if (!j) throw gbError('BAD_PARAMS', 'Unknown jobId ' + p.jobId); return j; },
  queue_cancel: async (p) => queueCancel(p.jobId),
  queue_clear: async (p) => queueClear(!!p.includeRunning),
  queue_pause: async () => { await mutateQueue((q) => { q.paused = true; }); return { paused: true }; },
  queue_resume: async () => { await mutateQueue((q) => { q.paused = false; }); processQueue(); return { paused: false }; },
};

// Drops files on an element of the page, from the page's own world. Gemini's
// skill upload reads `event.dataTransfer.files` in its drop handler; a File a
// content script makes lives in another compartment on Firefox, which the
// page's code cannot read, so the drop is built where that code runs
// (scripting, world MAIN). Verified on the live Skills page 2026-10-14: a zip
// dropped this way keeps its folder tree (SKILL.md + references/ + scripts/).
async function dropFiles(p) {
  const files = Array.isArray(p.files) ? p.files : [];
  if (!files.length) throw gbError('BAD_PARAMS', 'drop_files needs {files: [{name, base64, type?}]}');
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !f.name || typeof f.base64 !== 'string') throw gbError('BAD_PARAMS', 'every file needs {name, base64}');
  }
  if (typeof p.selector !== 'string' || !p.selector) throw gbError('BAD_PARAMS', 'drop_files needs {selector}');
  const waitMs = Number(p.waitMs) > 0 ? Number(p.waitMs) : 5000;
  const tab = await getTargetTab(p);
  let results;
  try {
    results = await withDeadline(
      chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: pageDrop, args: [p.selector, files, waitMs] }),
      waitMs + 30000, 'the drop did not finish within ' + (waitMs + 30000) + ' ms');
  } catch (e) {
    throw gbError('DROP_FAILED', 'Could not run the drop in the page: ' + String(e && e.message || e), { selector: p.selector });
  }
  const r = results && results[0] && results[0].result;
  if (!r || !r.dropped) throw gbError('DROP_FAILED', (r && r.error) || 'the page returned nothing for the drop', Object.assign({ selector: p.selector }, r || {}));
  return r;
}

// Runs inside the page (executeScript serialises it): no closure variables.
function pageDrop(selector, files, waitMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const tick = async () => {
      const target = document.querySelector(selector);
      if (!target) {
        if (Date.now() - started > waitMs) { resolve({ dropped: false, error: 'no element matches ' + selector }); return; }
        setTimeout(tick, 200);
        return;
      }
      try {
        const dt = new DataTransfer();
        let bytes = 0;
        for (const f of files) {
          const bin = atob(f.base64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          bytes += arr.length;
          dt.items.add(new File([arr], f.name, { type: f.type || 'application/octet-stream' }));
        }
        // The order and pacing of a real drag, as verified on the live page.
        for (const type of ['dragenter', 'dragover', 'drop']) {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
          await pause(150);
        }
        const cls = typeof target.className === 'string' && target.className ? '.' + target.className.split(' ')[0] : '';
        resolve({ dropped: true, files: files.length, bytes, target: target.tagName.toLowerCase() + cls });
      } catch (e) {
        resolve({ dropped: false, error: String(e && e.message || e) });
      }
    };
    tick();
  });
}

// `send` with newChat may need the navigation fallback the content script
// cannot perform itself (the page load would kill it mid-call).
async function sendOnTab(tab, p) {
  try { return await callContent(tab.id, 'send', p); } catch (e) {
    // the button is missing, or it did nothing (an account whose chats are not saved stays on /app)
    if (p.newChat && e && (e.code === 'ELEMENT_NOT_FOUND' || e.code === 'TIMEOUT') && e.details && e.details.element === 'newChat' && e.details.fallbackUrl) {
      await navigateTab(tab.id, e.details.fallbackUrl, READY_TIMEOUT_MS, false);
      return callContent(tab.id, 'send', Object.assign({}, p, { newChat: false }));
    }
    throw e;
  }
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) { /* ignore */ }
}

function validateOverrides(overrides) {
  if (overrides == null) return {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw gbError('BAD_PARAMS', 'overrides must be an object {element: [strategy]}');
  const out = {};
  for (const [name, list] of Object.entries(overrides)) {
    if (!Array.isArray(list)) throw gbError('BAD_PARAMS', 'overrides.' + name + ' must be an array of strategies');
    const clean = list.filter((s) => s && typeof s === 'object' && typeof s.type === 'string');
    if (clean.length) out[name] = clean;
  }
  return out;
}

// Looked up in a Map, so a name like "constructor" or "__proto__" can never dispatch.
const BACKGROUND_METHOD_TABLE = new Map(Object.entries(BACKGROUND_METHODS));

async function handleRequest(method, params) {
  if (typeof method !== 'string') throw gbError('BAD_PARAMS', 'method must be a string');
  log('debug', 'handleRequest', { method });
  const fn = BACKGROUND_METHOD_TABLE.get(method);
  if (fn !== undefined) return fn(params);
  if (!CONTENT_METHODS.has(method)) throw gbError('BAD_PARAMS', 'Unknown method "' + method + '"');
  const tab = await getTargetTab(params);
  return callContent(tab.id, method, params);
}

const CONTENT_METHODS = new Set(['diagnostics', 'get_account', 'get_model', 'list_models', 'set_model', 'is_generating', 'get_text', 'set_text', 'clear_text', 'get_last_response', 'get_conversation', 'get_url', 'stop', 'ping', 'get_last_known', 'gem_read', 'gem_create', 'gem_update', 'gem_diagnostics',
  'get_task', 'get_mode', 'set_mode', 'list_thinking_levels', 'set_thinking_level',
  'skills_list', 'skill_read', 'skill_upload_open', 'skill_upload_finish', 'skill_set_active', 'skill_delete', 'skills_diagnostics']);

// ---------------------------------------------------------------------------
// Queue (persisted under `queue` in chrome.storage.local)
// ---------------------------------------------------------------------------
function emptyQueue() { return { nextId: 1, paused: false, running: null, jobs: [] }; }

async function loadQueue() {
  const q = await getLocal('queue', null);
  if (!q || typeof q !== 'object' || !Array.isArray(q.jobs)) return emptyQueue();
  if (!Number.isInteger(q.nextId)) q.nextId = 1;
  return q;
}
async function saveQueue(q) { await setLocal({ queue: q }); }

// Serialise read-modify-write cycles so concurrent calls never lose updates.
let queueLock = Promise.resolve();
function mutateQueue(fn) {
  const run = queueLock.then(async () => { const q = await loadQueue(); const r = await fn(q); trimFinished(q); await saveQueue(q); return r; });
  queueLock = run.catch(() => undefined);
  return run;
}

function trimFinished(q) {
  const finished = q.jobs.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled');
  if (finished.length <= MAX_FINISHED_JOBS) return;
  const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED_JOBS).map((j) => j.id));
  q.jobs = q.jobs.filter((j) => !drop.has(j.id));
}

function emitJob(job) { emit('job', job); }

async function queueAdd(p) {
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) throw gbError('BAD_PARAMS', 'queue_add needs a non-empty {prompt}');
  const job = await mutateQueue((q) => {
    const j = {
      id: 'job_' + q.nextId++,
      prompt: p.prompt,
      options: { newChat: !!p.newChat, model: p.model || null, thinking: p.thinking || null, timeoutMs: p.timeoutMs || 180000 },
      meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
      status: 'queued', result: null, error: null,
      createdAt: nowMs(), startedAt: null, finishedAt: null, attempts: 0,
    };
    q.jobs.push(j);
    return j;
  });
  emitJob(job);
  processQueue();
  return job;
}

async function queueCancel(jobId) {
  let wasRunning = false;
  const job = await mutateQueue((q) => {
    const j = q.jobs.find((x) => x.id === jobId);
    if (!j) throw gbError('BAD_PARAMS', 'Unknown jobId ' + jobId);
    if (j.status === 'queued' || j.status === 'running') {
      wasRunning = j.status === 'running';
      j.status = 'cancelled'; j.finishedAt = nowMs();
      if (q.running === j.id) q.running = null;
    }
    return j;
  });
  if (wasRunning) {
    const bridgeId = await getBridgeTabId();
    if (bridgeId != null) { try { await callContent(bridgeId, 'stop', {}); } catch (e) { log('warn', 'stop after cancel failed', { error: normalizeError(e) }); } }
  }
  emitJob(job);
  return job;
}

async function queueClear(includeRunning) {
  const removed = [];
  await mutateQueue((q) => {
    q.jobs = q.jobs.filter((j) => {
      const drop = j.status === 'queued' || (includeRunning && j.status === 'running');
      if (drop) removed.push(j);
      return !drop;
    });
    if (includeRunning) q.running = null;
  });
  if (includeRunning && removed.some((j) => j.status === 'running')) {
    const bridgeId = await getBridgeTabId();
    if (bridgeId != null) { try { await callContent(bridgeId, 'stop', {}); } catch (_) { /* ignore */ } }
  }
  for (const j of removed) { j.status = 'cancelled'; j.finishedAt = nowMs(); emitJob(j); }
  return { removed: removed.length };
}

let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const job = await mutateQueue((q) => {
        if (q.paused || q.running) return null;
        const j = q.jobs.find((x) => x.status === 'queued');
        if (!j) return null;
        j.status = 'running'; j.startedAt = nowMs(); j.attempts = (j.attempts || 0) + 1; j.error = null;
        q.running = j.id;
        return j;
      });
      if (!job) break;
      emitJob(job);
      const outcome = await runJob(job);
      const updated = await mutateQueue((q) => {
        const j = q.jobs.find((x) => x.id === job.id);
        if (q.running === job.id) q.running = null;
        if (!j) return null;
        if (j.status === 'cancelled') return j; // cancelled while running
        if (outcome.retry) { j.status = 'queued'; return j; }
        j.finishedAt = nowMs();
        if (outcome.error) { j.status = 'error'; j.error = outcome.error; } else { j.status = 'done'; j.result = outcome.result; }
        return j;
      });
      if (updated) emitJob(updated);
      if (outcome.retry) await sleep(3000);
    }
  } catch (e) {
    log('error', 'queue processor crashed', { error: normalizeError(e) });
  } finally {
    processing = false;
  }
}

async function runJob(job) {
  try {
    const tab = await getTargetTab({}, { open: true });
    const result = await sendOnTab(tab, { text: job.prompt, newChat: !!job.options.newChat, model: job.options.model || undefined, thinking: job.options.thinking || undefined, wait: true, timeoutMs: job.options.timeoutMs });
    return { result };
  } catch (e) {
    const error = normalizeError(e);
    const retryable = error.code === 'TAB_NOT_READY' || error.code === 'SEND_NOT_ACCEPTED';
    if (retryable && job.attempts < 2) return { retry: true, error };
    return { error };
  }
}

// A worker restart mid-job leaves it `running`; give it its second attempt
// or fail it with WORKER_RESTARTED (PROTOCOL queue rules).
async function recoverQueue() {
  const changed = [];
  await mutateQueue((q) => {
    for (const j of q.jobs) {
      if (j.status !== 'running') continue;
      if ((j.attempts || 0) < 2) j.status = 'queued';
      else { j.status = 'error'; j.finishedAt = nowMs(); j.error = gbError('WORKER_RESTARTED', 'The extension service worker restarted while this job was running'); }
      changed.push(j);
    }
    q.running = null;
  });
  for (const j of changed) emitJob(j);
}

// ---------------------------------------------------------------------------
// Runtime messages: content scripts (cs_ready / cs_event) and the popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'cs_ready' && sender.tab) {
    markReady(sender.tab.id, msg.url);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'cs_event' && sender.tab) {
    if (msg.event === 'status') emit('status', Object.assign({ tabId: sender.tab.id }, msg.data));
    else if (msg.event === 'log') emit('log', Object.assign({ tabId: sender.tab.id }, msg.data));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'popup') {
    handlePopup(msg).then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  readyTabs.delete(tabId);
  if ((await getBridgeTabId()) === tabId) await setBridgeTabId(null);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A navigation invalidates the old script's readiness; cs_ready re-arms it.
  if (info.status === 'loading' && readyTabs.has(tabId)) readyTabs.delete(tabId);
});

async function handlePopup(msg) {
  switch (msg.action) {
    case 'state': {
      const q = await loadQueue();
      const bridgeId = await getBridgeTabId();
      const bridgeTab = bridgeId != null ? await tabById(bridgeId) : null;
      return {
        ws: wsState(), connected: wsOpen(), port: await getPort(), connectedAt, lastError,
        bridgeTab: bridgeTab ? tabInfo(bridgeTab) : null,
        queue: { length: q.jobs.filter((j) => j.status === 'queued').length, paused: !!q.paused, running: q.running, total: q.jobs.length },
        version: chrome.runtime.getManifest().version,
        browser: browserVersions(),
      };
    }
    case 'set_port': {
      const port = parseInt(msg.port, 10);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw gbError('BAD_PARAMS', 'invalid port');
      const settings = await getLocal('settings', {});
      await setLocal({ settings: Object.assign({}, settings, { port }) });
      return { port };
    }
    case 'reconnect': backoffIndex = 0; disconnect(); await connect('popup'); return { ws: wsState() };
    case 'call': return handleRequest(msg.method, msg.params || {});
    default: throw gbError('BAD_PARAMS', 'unknown popup action ' + msg.action);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue && changes.settings.oldValue.port;
  const after = changes.settings.newValue && changes.settings.newValue.port;
  if (before !== after) { backoffIndex = 0; disconnect(); connect('port changed'); }
});

chrome.alarms.create('gb-reconnect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'gb-reconnect') return;
  if (!wsOpen()) connect('alarm');
  processQueue();
});

chrome.runtime.onInstalled.addListener(() => { connect('installed'); });
chrome.runtime.onStartup.addListener(() => { connect('startup'); });

// Re-learn which Gemini tabs already have a live content script.
async function probeExistingTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  await Promise.all(tabs.map(async (t) => {
    try { const r = await chrome.tabs.sendMessage(t.id, { type: 'cs_call', method: 'ping', params: {} }); if (r && r.ok) markReady(t.id, t.url); } catch (_) { /* not injected */ }
  }));
}

(async function boot() {
  try {
    await connect('boot');
    await probeExistingTabs();
    await recoverQueue();
    processQueue();
  } catch (e) {
    log('error', 'boot failed', { error: String(e), stack: e && e.stack });
  }
})();
