import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileSystemAccessAdapter } from '../src-browser/filesystem-adapter.js';

// A stand-in for a FileSystemFileHandle that records which permission calls were made.
// `state` is what queryPermission reports; requestPermission is what shows the browser's prompt.
function fakeHandle({ state, answer = 'granted', content = '* One\n' }) {
  const calls = { query: 0, request: 0, writes: [] };
  return {
    calls,
    queryPermission: async () => { calls.query += 1; return state.value; },
    requestPermission: async () => { calls.request += 1; state.value = answer; return answer; },
    getFile: async () => ({ text: async () => content }),
    createWritable: async () => ({ write: async (c) => calls.writes.push(c), close: async () => {} }),
  };
}
function adapterFor(handle) {
  const store = new Map(handle ? [['filehandle:a.org', handle]] : []);
  const kv = { get: async (k) => (store.has(k) ? { key: k, value: store.get(k) } : null) };
  return createFileSystemAccessAdapter(kv);
}

test('an ordinary read asks the browser for permission when it is not already granted, then reads', async () => {
  const h = fakeHandle({ state: { value: 'prompt' } });
  const entry = await adapterFor(h).read('a.org');
  assert.equal(entry.content, '* One\n');
  assert.equal(h.calls.request, 1);
});

test('a background read ({ prompt: false }) NEVER asks: without access it returns null instead of showing the prompt', async () => {
  const h = fakeHandle({ state: { value: 'prompt' } });
  const entry = await adapterFor(h).read('a.org', { prompt: false });
  assert.equal(entry, null);
  assert.equal(h.calls.request, 0, 'requestPermission is what shows the prompt, so it must not be called');
  assert.ok(h.calls.query >= 1, 'it still checks, so a granted file is read');
});

test('a background read still reads when the browser has already granted access, without any request', async () => {
  const h = fakeHandle({ state: { value: 'granted' } });
  const entry = await adapterFor(h).read('a.org', { prompt: false });
  assert.equal(entry.content, '* One\n');
  assert.equal(h.calls.request, 0);
});

test('a background read does not throw when access is missing or would be refused: it is not an error, only nothing to compare', async () => {
  const h = fakeHandle({ state: { value: 'prompt' }, answer: 'denied' });
  assert.equal(await adapterFor(h).read('a.org', { prompt: false }), null);
  assert.equal(h.calls.request, 0);
});

test('an ordinary read that the person refuses still throws, as before', async () => {
  const h = fakeHandle({ state: { value: 'prompt' }, answer: 'denied' });
  await assert.rejects(() => adapterFor(h).read('a.org'), /Permission denied reading "a\.org"/);
});

test('a file with no stored handle reads as null either way', async () => {
  const a = adapterFor(null);
  assert.equal(await a.read('a.org'), null);
  assert.equal(await a.read('a.org', { prompt: false }), null);
});

test('writing is user-initiated and still asks for permission, unchanged', async () => {
  const h = fakeHandle({ state: { value: 'prompt' } });
  await adapterFor(h).write('a.org', 'new text');
  assert.equal(h.calls.request, 1);
  assert.deepEqual(h.calls.writes, ['new text']);
});
