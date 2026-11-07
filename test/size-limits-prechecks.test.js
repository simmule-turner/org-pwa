import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaste, setSizeLimits, sizeLimitsOf, SizeLimitError } from '../src/size-limits.js';
import { createFileSystemAccessAdapter } from '../src-browser/filesystem-adapter.js';

const KB = 1024;
const MB = 1024 * KB;

test('a paste is checked as the file it would make: fine, ask, or refuse; a replaced selection counts as removed', () => {
  const limits = sizeLimitsOf({});
  assert.deepEqual(checkPaste(1000, 0, 1000, 'a.org', limits), { ok: true });
  const ask = checkPaste(400 * KB, 0, 200 * KB, 'a.org', limits);
  assert.equal(ask.ok, 'warn');
  assert.match(ask.message, /Pasting makes "a\.org" 600 KB.*Paste anyway\?/);
  const no = checkPaste(1 * MB, 0, 1.5 * MB, 'a.org', limits);
  assert.equal(no.ok, false);
  assert.match(no.message, /2\.5 MB, over the 2 MB limit/);
  assert.deepEqual(checkPaste(1 * MB, 1 * MB - 10, 600 * KB, '', limits).ok, 'warn', 'replacing most of the text with a smaller paste is judged by the result');
});

test('a paste is not limited when the Org file limit is off', () => {
  const limits = sizeLimitsOf({ 'org-xx-size-limit-org-file': 'off', 'org-xx-size-limit-org-file-warn': 'off' });
  assert.deepEqual(checkPaste(1 * MB, 0, 50 * MB, 'a.org', limits), { ok: true });
});

test('a local file is refused from its size before any of it is read', async () => {
  let read = false;
  const file = { size: 6 * MB, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } };
  const handle = { queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => file };
  const kv = { get: async () => ({ value: handle }), set: async () => {}, delete: async () => {} };
  const adapter = createFileSystemAccessAdapter(kv);
  try {
    await assert.rejects(adapter.read('big.org'), (e) => e instanceof SizeLimitError && /big\.org.*6 MB/.test(e.message));
    assert.equal(read, false, 'the content was never read');
    file.size = 100;
    file.arrayBuffer = async () => new TextEncoder().encode('* Fine\n').buffer;
    assert.equal((await adapter.read('big.org')).content, '* Fine\n');
  } finally {
    setSizeLimits(sizeLimitsOf({}));
  }
});
