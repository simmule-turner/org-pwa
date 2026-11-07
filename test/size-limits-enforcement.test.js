import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubAdapter } from '../src-browser/github-adapter.js';
import { createWebdavAdapter } from '../src-browser/webdav-adapter.js';
import { withLineEndings } from '../src-browser/line-endings-adapter.js';
import { attachmentSizeCheck } from '../src/attach.js';
import { SizeLimitError, setSizeLimits, sizeLimitsOf } from '../src/size-limits.js';

const KB = 1024;
const MB = 1024 * KB;
const GH = { token: 't', owner: 'me', repo: 'notes', branch: 'main' };
const DAV = { baseUrl: 'https://dav.example.com/files/me', username: 'me', password: 'p' };

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    setSizeLimits(sizeLimitsOf({}));
  }
}

const ghJson = (body) => ({ status: 200, ok: true, json: async () => body });
const davBytes = (n, headers = {}) => {
  const map = new Map(Object.entries(headers));
  return { status: 200, ok: true, headers: { get: (k) => map.get(k) || null }, arrayBuffer: async () => new Uint8Array(n).fill(97).buffer };
};
const kv = { get: async () => null, set: async () => {}, delete: async () => {} };

test('GitHub: a text file bigger than any text limit is refused from the size GitHub reports, before the content is decoded', async () => {
  let decoded = false;
  await withFetch(async () => ghJson({ size: 6 * MB, sha: 's', encoding: 'base64', get content() { decoded = true; return ''; } }), async () => {
    await assert.rejects(createGithubAdapter(() => GH).read('big.org'), (e) => e instanceof SizeLimitError && /big\.org.*6 MB/.test(e.message));
  });
  assert.equal(decoded, false);
});

test('GitHub: readBinary with maxBytes says tooLarge and its size without downloading; without maxBytes the attachment limit applies', async () => {
  await withFetch(async () => ghJson({ size: 4 * MB, sha: 's', encoding: 'base64', content: 'AAAA' }), async () => {
    const adapter = createGithubAdapter(() => GH);
    const result = await adapter.readBinary('pic.png', { maxBytes: 3 * MB });
    assert.equal(result.tooLarge, true);
    assert.equal(result.bytes, 4 * MB);
    assert.equal((await adapter.readBinary('pic.png')).base64, 'AAAA');
  });
  await withFetch(async () => ghJson({ size: 96 * MB, sha: 's', encoding: 'base64', content: 'AAAA' }), async () => {
    await assert.rejects(createGithubAdapter(() => GH).readBinary('movie.mp4'), SizeLimitError);
  });
});

test('WebDAV: a text file is refused by Content-Length, and a binary one by maxBytes returns tooLarge', async () => {
  await withFetch(async () => davBytes(10, { 'Content-Length': String(7 * MB) }), async () => {
    await assert.rejects(createWebdavAdapter(() => DAV).read('big.org'), SizeLimitError);
    const result = await createWebdavAdapter(() => DAV).readBinary('pic.png', { maxBytes: 3 * MB });
    assert.equal(result.tooLarge, true);
    assert.equal(result.bytes, 7 * MB);
  });
  await withFetch(async () => davBytes(5), async () => {
    assert.equal((await createWebdavAdapter(() => DAV).read('a.org')).content, 'aaaaa');
  });
});

test('every text read passes the line-endings wrapper, which refuses an Org file over its limit and honors another kind', async () => {
  const inner = { read: async () => ({ content: 'x'.repeat(2 * MB + 1), hash: 'h' }) };
  const wrapped = withLineEndings(inner, kv);
  await assert.rejects(wrapped.read('big.org'), (e) => e instanceof SizeLimitError && e.kind === 'orgFile');
  // a bibliography may be larger than an Org file
  assert.equal((await wrapped.read('refs.bib', { sizeKind: 'bibliography' })).content.length, 2 * MB + 1);
  await assert.rejects(wrapped.read('setup.org', { sizeKind: 'setupfile' }), SizeLimitError);
  const small = withLineEndings({ read: async () => ({ content: 'a\r\nb', hash: 'h' }) }, kv);
  assert.equal((await small.read('ok.org')).content, 'a\nb');
  assert.equal(await withLineEndings({ read: async () => null }, kv).read('gone.org'), null);
});

test('the limit is the configured one: raising it lets the file open, lowering it refuses a smaller one', async () => {
  const inner = { read: async () => ({ content: 'x'.repeat(3 * MB), hash: 'h' }) };
  const wrapped = withLineEndings(inner, kv);
  try {
    await assert.rejects(wrapped.read('a.org'), SizeLimitError);
    setSizeLimits(sizeLimitsOf({ 'org-xx-size-limit-org-file': '4MB' }));
    assert.equal((await wrapped.read('a.org')).content.length, 3 * MB);
    setSizeLimits(sizeLimitsOf({ 'org-xx-size-limit-org-file': '1MB' }));
    await assert.rejects(wrapped.read('a.org'), /over the 1 MB limit/);
  } finally {
    setSizeLimits(sizeLimitsOf({}));
  }
});

test('attachments: nothing up to 20 MB, a question above, a refusal above 95 MB, and a changed limit applies', () => {
  const chars = (megabytes) => Math.ceil((megabytes * MB * 4) / 3);
  assert.equal(attachmentSizeCheck(chars(20), 'webdav'), null);
  assert.match(attachmentSizeCheck(chars(21), 'webdav').warn, /21 MB/);
  assert.match(attachmentSizeCheck(chars(96), 'webdav').refuse, /96 MB.*Size limits/);
  assert.equal(attachmentSizeCheck(chars(50), 'webdav', sizeLimitsOf({ 'org-xx-size-limit-attachment-warn': 'off' })), null);
  assert.match(attachmentSizeCheck(chars(30), 'webdav', sizeLimitsOf({ 'org-xx-size-limit-attachment': '25MB' })).refuse, /30 MB/);
});
