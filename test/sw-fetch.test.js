import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Runs the real sw.js in a sandbox with a fake `self` and `caches`, and drives its fetch handler.
function loadWorker({ cacheHit } = {}) {
  const handlers = {};
  const matchCalls = [];
  const fetchCalls = [];
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  const caches = {
    match: async (request, options) => { matchCalls.push({ request, options }); return cacheHit; },
    open: async () => ({ addAll: async () => {}, put: async () => {} }),
    keys: async () => [],
    delete: async () => true,
  };
  const fetchFn = async (request) => { fetchCalls.push(request); return 'from-network'; };
  vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches, fetch: fetchFn, console, URL, Promise });
  const dispatch = async (request) => {
    let responded;
    handlers.fetch({ request, respondWith: (p) => { responded = p; } });
    return { response: await responded, matchCalls, fetchCalls };
  };
  return { dispatch, matchCalls, fetchCalls };
}

test('a navigation (a launch from the share sheet or an icon shortcut) is matched ignoring its query string, so it works offline', async () => {
  const w = loadWorker({ cacheHit: 'cached-shell' });
  const { response } = await w.dispatch({ mode: 'navigate', url: 'https://example.test/app/index.html?capture=t&text=hi' });
  assert.equal(response, 'cached-shell');
  // the options object was made inside the sandbox (a different Object prototype), so compare its content, not its identity
  assert.equal(JSON.stringify(w.matchCalls[0].options), '{"ignoreSearch":true}');
  assert.equal(w.fetchCalls.length, 0, 'served from the cache, with no network');
});

test('anything that is not a navigation is matched exactly: a script or stylesheet never ignores its query string', async () => {
  const w = loadWorker({ cacheHit: 'cached-file' });
  await w.dispatch({ mode: 'cors', url: 'https://example.test/app/src/x.js?v=2' });
  assert.equal(w.matchCalls[0].options, undefined);
  await w.dispatch({ mode: 'no-cors', url: 'https://example.test/app/y.css' });
  assert.equal(w.matchCalls[1].options, undefined);
});

test('a miss still falls through to the network, navigation or not', async () => {
  const w = loadWorker({ cacheHit: undefined });
  const nav = await w.dispatch({ mode: 'navigate', url: 'https://example.test/app/other.html' });
  assert.equal(nav.response, 'from-network');
  assert.equal(w.fetchCalls.length, 1);
});
