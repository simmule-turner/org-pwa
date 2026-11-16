import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { swSource } from './sw-source.js';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the worker takes its cache name from the version the code carries, and names no version of its own', () => {
  const sw = read('sw.js');
  assert.match(sw, /^import \{ APP_VERSION as CACHE_NAME \} from '\.\/src-browser\/version\.js';$/m);
  assert.doesNotMatch(sw, /org-pwa-shell-v\d+/);
  assert.match(read('src-browser/version.js'), /APP_VERSION = 'org-pwa-shell-v\d+'/);
});

/** Runs sw.js's install handler with files that carry `fileVersion`, and says whether the install went through and what was cached. */
async function install(fileVersion) {
  const listeners = {};
  const store = new Map();
  const requests = [];
  const cache = {
    add: async (req) => {
      requests.push(req);
      store.set(req.url, req.url.endsWith('version.js') ? `export const APP_VERSION = '${fileVersion}';` : 'x');
    },
    match: async (url) => (store.has(String(url).replace('./', '')) || [...store.keys()].some((k) => k.endsWith(String(url).replace('./', '')))
      ? { text: async () => [...store.entries()].find(([k]) => k.endsWith(String(url).replace('./', '')))[1] }
      : undefined),
  };
  let deleted = false;
  const caches = { open: async () => cache, delete: async () => { deleted = true; }, keys: async () => [] };
  const self = { addEventListener: (type, fn) => { listeners[type] = fn; }, clients: { claim() {} }, location: { href: 'https://x.test/' } };
  class Request { constructor(url, init) { this.url = url; this.cache = init && init.cache; } }
  vm.runInNewContext(swSource(), { self, caches, Request, console: { warn() {}, log() {} }, URL, Promise });
  let pending;
  try {
    listeners.install({ waitUntil: (p) => { pending = p; } });
    await pending;
    return { ok: true, requests, deleted };
  } catch (e) {
    return { ok: false, requests, deleted, message: String(e.message) };
  }
}

test('installing bypasses the browser HTTP cache for every file', async () => {
  const name = /APP_VERSION = '([^']+)'/.exec(read('src-browser/version.js'))[1];
  const r = await install(name);
  assert.ok(r.ok);
  assert.ok(r.requests.length > 50 && r.requests.every((q) => q.cache === 'reload'));
});

test('files that carry another version make the install fail, so the old version keeps running', async () => {
  const r = await install('org-pwa-shell-v1');
  assert.equal(r.ok, false);
  assert.match(r.message, /another version/);
  assert.equal(r.deleted, true);
});
