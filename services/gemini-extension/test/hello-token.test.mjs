// The hello event carries the per-launch token (D13): `self.GB_BRIDGE_TOKEN` when the Firefox
// build wrote bridge-token.js, `null` otherwise. background.js is loaded in a vm sandbox with a
// stub `chrome` and a fake WebSocket; the hello frame is read off the fake socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

async function helloFrame(token) {
  const sent = [];
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    send(raw) { sent.push(JSON.parse(raw)); }
    close() {}
  }
  Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const listener = { addListener() {}, removeListener() {} };
  let onStartup;
  const store = {
    get: async () => ({}), set: async () => {}, remove: async () => {},
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.0', manifest_version: 3 }),
      onMessage: listener, onInstalled: listener,
      onStartup: { addListener: (fn) => { onStartup = fn; } },
    },
    storage: { local: store, session: store, onChanged: listener },
    tabs: { query: async () => [], onRemoved: listener, onUpdated: listener, onActivated: listener },
    alarms: { create() {}, onAlarm: listener },
    windows: { onRemoved: listener },
    webNavigation: { onCommitted: listener, onCompleted: listener },
  };
  const sandbox = { chrome, WebSocket: FakeSocket, console: { log() {}, warn() {}, error() {}, debug() {} }, setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout, setInterval: () => 0, clearInterval() {}, URL };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('globalThis.chrome = chrome;', sandbox);
  if (token !== undefined) sandbox.GB_BRIDGE_TOKEN = token;
  vm.runInContext(read('content/locators.js'), sandbox, { filename: 'locators.js' });
  vm.runInContext(read('background.js'), sandbox, { filename: 'background.js' });
  onStartup();
  for (let i = 0; i < 50 && sockets.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(sockets.length, 1, 'the background script opened a socket');
  sockets[0].readyState = 1;
  await sockets[0].onopen();
  const hello = sent.find((m) => m.type === 'event' && m.event === 'hello');
  assert.ok(hello, 'a hello was sent');
  return hello.data;
}

const TOKEN = 'ab'.repeat(32);

test('hello carries the token from self.GB_BRIDGE_TOKEN', async () => {
  const data = await helloFrame(TOKEN);
  assert.equal(data.token, TOKEN);
});

test('hello token is null without bridge-token.js', async () => {
  const data = await helloFrame(undefined);
  assert.equal(data.token, null);
});
