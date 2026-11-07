// Attachment names, IDs and storage paths cannot climb out of their folder; files that are not UTF-8 are refused; the conflict hash
// tells apart texts the old 32-bit hash could not. Each case here fails on the code before these fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  attachmentDir,
  hasUnsafeAttachmentId,
  isSafeAttachmentId,
  isSafeAttachmentName,
  ownAttachmentDirectory,
  sanitizeAttachmentFilename,
} from '../src/attach.js';
import { normalizeStoragePath, resolveAttachmentTarget, resolveImagePath } from '../src/link-resolve.js';
import { assertSafeStoragePath } from '../src/storage-path.js';
import { decodeUtf8Strict, isNonUtf8 } from '../src/utf8.js';
import { contentHash, matchesExpected, sameHash } from '../src/sync-engine.js';
import { createGithubAdapter } from '../src-browser/github-adapter.js';
import { createWebdavAdapter, fileUrl } from '../src-browser/webdav-adapter.js';

const HOSTILE_ID = '../../../../other/contents/pwn/x';
const docWith = (id) => parseOrg(`* Heading\n:PROPERTIES:\n:ID: ${id}\n:END:\n`);

async function withFetchLog(respond, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    return respond(url, init);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('an :ID: with a path separator or ".." names no attachment folder', () => {
  const doc = docWith(HOSTILE_ID);
  const heading = doc.children[0];
  assert.equal(hasUnsafeAttachmentId(heading), true);
  assert.equal(ownAttachmentDirectory(heading, 'notes.org'), null);
  assert.throws(() => attachmentDir(HOSTILE_ID, 'notes.org'));
  assert.equal(resolveAttachmentTarget(doc, heading, 'attachment:f.txt', 'notes.org'), null);
  assert.equal(isSafeAttachmentId('abcdef12-3456-7890'), true);
  for (const bad of ['a/b', 'a\\b', '..', 'x..y', 'ab\u0000c', 'ab\nc']) assert.equal(isSafeAttachmentId(bad), false, JSON.stringify(bad));
});

test('a normal :ID: still gives data/<prefix>/<rest> beside the document', () => {
  const doc = docWith('abcdef12-3456');
  assert.equal(ownAttachmentDirectory(doc.children[0], 'dir/notes.org'), 'dir/data/ab/cdef12-3456');
  assert.equal(resolveAttachmentTarget(doc, doc.children[0], 'attachment:sub/f.png', 'dir/notes.org'), 'dir/data/ab/cdef12-3456/sub/f.png');
});

test('an attachment: link that climbs out of its folder, or has a backslash or control character, resolves to nothing', () => {
  const doc = docWith('abcdef12-3456');
  const heading = doc.children[0];
  for (const name of ['../../../../private.org', '..', 'a/../../b', '/etc/passwd', 'a\\b', 'a\u0000b', 'a//b', './b', '']) {
    assert.equal(resolveAttachmentTarget(doc, heading, `attachment:${name}`, 'notes.org'), null, JSON.stringify(name));
    assert.equal(isSafeAttachmentName(name), false, JSON.stringify(name));
  }
});

test('sanitizeAttachmentFilename removes separators, control characters, dot names, outer dots and spaces, and Windows device names', () => {
  assert.equal(sanitizeAttachmentFilename('..'), 'attachment');
  assert.equal(sanitizeAttachmentFilename('.'), 'attachment');
  assert.equal(sanitizeAttachmentFilename('a\\b/c.png'), 'a_b_c.png');
  assert.equal(sanitizeAttachmentFilename('a\u0001b\u007f.txt'), 'a_b_.txt');
  assert.equal(sanitizeAttachmentFilename('.git'), 'git');
  assert.equal(sanitizeAttachmentFilename('  name.txt. '), 'name.txt');
  assert.equal(sanitizeAttachmentFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeAttachmentFilename('lpt1'), '_lpt1');
  assert.equal(sanitizeAttachmentFilename('console.txt'), 'console.txt');
  assert.equal(sanitizeAttachmentFilename('photo (1).jpg'), 'photo (1).jpg');
});

test('file link paths are worked out and cannot leave the root of the repository or folder', () => {
  assert.equal(normalizeStoragePath('a/b/../c.png'), 'a/c.png');
  assert.equal(normalizeStoragePath('../x'), '');
  assert.equal(normalizeStoragePath('a/../../x'), '');
  assert.equal(normalizeStoragePath('a\\b'), '');
  assert.equal(resolveImagePath('../../../../user', 'notes/today.org'), '');
  assert.equal(resolveImagePath('file:img/../img/a.png', 'notes/today.org'), 'img/a.png');
  assert.equal(resolveImagePath('/../x', 'notes/today.org'), '');
  assert.equal(resolveImagePath('images/a.png', 'notes/today.org'), 'images/a.png');
  assert.equal(resolveImagePath('a.png', 'notes/today.org'), 'notes/a.png');
  assert.equal(resolveImagePath('./a.png', ''), 'a.png');
});

test('assertSafeStoragePath accepts plain paths and refuses ".." and odd parts', () => {
  for (const ok of ['', 'a.org', 'a/b/c.org', '/a/b', 'a/b/']) assert.equal(assertSafeStoragePath(ok), ok);
  for (const bad of ['..', 'a/../b', '../a', 'a/./b', 'a//b', 'a\\b', 'a\u0000b']) assert.throws(() => assertSafeStoragePath(bad), /Refusing/, JSON.stringify(bad));
});

test('the GitHub adapter sends no request for a path with ".." (a hostile attachment ID no longer reaches another repo)', async () => {
  const adapter = createGithubAdapter(() => ({ token: 't', owner: 'me', repo: 'notes', branch: 'main' }));
  await withFetchLog(() => ({ status: 200, ok: true, json: async () => ({}) }), async (calls) => {
    const path = `data/..//../../../other/contents/pwn/x/f.txt`;
    await assert.rejects(adapter.readBinary(`data/${HOSTILE_ID}/f.txt`));
    await assert.rejects(adapter.delete(`data/${HOSTILE_ID}/f.txt`));
    await assert.rejects(adapter.read(path));
    await assert.rejects(adapter.write(`../x.org`, 'text'));
    assert.deepEqual(calls, []);
  });
});

test('the WebDAV adapter sends no request for a path with ".." (it cannot climb out of the configured folder)', async () => {
  const adapter = createWebdavAdapter(() => ({ baseUrl: 'https://dav.example/shared/me', username: 'u', password: 'p' }));
  assert.throws(() => fileUrl({ baseUrl: 'https://dav.example/shared/me' }, 'data/../../pwn/f.txt'), /Refusing/);
  await withFetchLog(() => ({ status: 200, ok: true, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }), async (calls) => {
    await assert.rejects(adapter.delete(`data/${HOSTILE_ID}/f.txt`));
    await assert.rejects(adapter.write('../../x.org', 'text'));
    await assert.rejects(adapter.readBinary('a/../../b'));
    assert.deepEqual(calls, []);
  });
});

test('a listing from a server cannot name a file outside the folder', async () => {
  const github = createGithubAdapter(() => ({ token: 't', owner: 'me', repo: 'notes', branch: 'main' }));
  await withFetchLog(
    () => ({
      status: 200,
      ok: true,
      json: async () => [
        { name: 'ok.png', path: 'data/ok.png', type: 'file' },
        { name: '..', path: '..', type: 'file' },
        { name: '../x', path: '../x', type: 'file' },
        { name: 'a\\b', path: 'a\\b', type: 'file' },
      ],
    }),
    async () => assert.deepEqual((await github.list('data')).map((e) => e.name), ['ok.png'])
  );
  const dav = createWebdavAdapter(() => ({ baseUrl: 'https://dav.example/shared/me', username: 'u', password: 'p' }));
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${['/shared/me/data/', '/shared/me/data/ok.png', '/shared/me/data/../../x', '/shared/me/data/..']
    .map((href) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>`)
    .join('')}</d:multistatus>`;
  await withFetchLog(
    () => ({ status: 207, ok: true, text: async () => xml, headers: { get: () => null } }),
    async () => assert.deepEqual((await dav.list('data')).map((e) => e.name), ['ok.png'])
  );
});

test('a file that is not valid UTF-8 opens with U+FFFD but cannot be written until it is converted', async () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1
  assert.throws(() => decodeUtf8Strict(latin1, 'notes.org'), /not valid UTF-8/);
  assert.equal(decodeUtf8Strict(new TextEncoder().encode('café 日本 🙂')), 'café 日本 🙂');
  assert.equal(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a'); // a byte-order mark is dropped, as before
  const github = createGithubAdapter(() => ({ token: 't', owner: 'me', repo: 'notes', branch: 'main' }));
  await withFetchLog(
    () => ({ status: 200, ok: true, json: async () => ({ content: Buffer.from(latin1).toString('base64'), sha: 'abc', encoding: 'base64' }) }),
    async (calls) => {
      assert.equal((await github.read('gh-notes.org')).content, 'caf\ufffd');
      assert.equal(isNonUtf8('gh-notes.org'), true);
      await assert.rejects(github.write('gh-notes.org', 'text'), /not valid UTF-8/);
      assert.equal(calls.filter((c) => c.startsWith('PUT')).length, 0);
    }
  );
  const dav = createWebdavAdapter(() => ({ baseUrl: 'https://dav.example/shared/me', username: 'u', password: 'p' }));
  await withFetchLog(
    () => ({ status: 200, ok: true, arrayBuffer: async () => latin1.buffer, text: async () => 'caf�', headers: { get: () => '"e1"' } }),
    async (calls) => {
      assert.equal((await dav.read('notes.org')).content, 'caf\ufffd');
      await assert.rejects(dav.write('notes.org', 'text'), /not valid UTF-8/);
      assert.equal(calls.filter((c) => c.startsWith('PUT')).length, 0);
    }
  );
});

test('the conflict hash is 64 bits, keeps the old 32-bit start, and tells apart texts that shared the old hash', () => {
  const a = 'k115878';
  const b = 'k218587'; // the same 32-bit FNV-1a hash
  assert.equal(contentHash(a).length, 16);
  assert.equal(contentHash(a).slice(0, 8), contentHash(b).slice(0, 8));
  assert.notEqual(contentHash(a), contentHash(b));
  assert.equal(matchesExpected({ exists: true, hash: contentHash(a) }, { content: b, hash: contentHash(b) }), false);
  assert.equal(matchesExpected({ exists: true, hash: contentHash(a).slice(0, 8) }, { content: a, hash: contentHash(a) }), true); // a hash saved by an earlier version
  assert.equal(sameHash(contentHash('abc').slice(0, 8), contentHash('abc')), true);
  assert.equal(sameHash('00000000', contentHash('abc')), false);
  assert.equal(sameHash(null, null), true);
  assert.equal(sameHash(null, 'x'), false);
});
