import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLineEnding, fromLf, toLf } from '../src/line-endings.js';
import { withLineEndings } from '../src-browser/line-endings-adapter.js';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { contentHash } from '../src/sync-engine.js';

// ---- the pure helpers -------------------------------------------------------------------

test('a file\u2019s line ending is whichever it mostly uses, and Unix-style when there is nothing to go by', () => {
  assert.equal(detectLineEnding('a\nb\nc\n'), '\n');
  assert.equal(detectLineEnding('a\r\nb\r\nc\r\n'), '\r\n');
  assert.equal(detectLineEnding('a\r\nb\r\nc\n'), '\r\n', 'two Windows against one Unix');
  assert.equal(detectLineEnding('a\nb\nc\r\n'), '\n', 'two Unix against one Windows');
  assert.equal(detectLineEnding('a\r\nb\nc'), '\n', 'a tie goes to Unix');
  assert.equal(detectLineEnding('no line breaks'), '\n');
  assert.equal(detectLineEnding(''), '\n');
});

test('toLf turns every \\r\\n into \\n and leaves a lone \\r, which is not a line break to org', () => {
  assert.equal(toLf('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(toLf('a\nb\n'), 'a\nb\n');
  assert.equal(toLf('a\rb'), 'a\rb');
  assert.equal(toLf('a\r\r\nb'), 'a\r\nb', 'only the \\r\\n pair is changed');
});

test('fromLf puts a style back, and is the inverse of toLf for a consistently Windows-style text', () => {
  assert.equal(fromLf('a\nb\n', '\r\n'), 'a\r\nb\r\n');
  assert.equal(fromLf('a\nb\n', '\n'), 'a\nb\n');
  const windows = '* One\r\nbody\r\n* Two\r\n';
  assert.equal(fromLf(toLf(windows), '\r\n'), windows);
});

// ---- the adapter wrapper ----------------------------------------------------------------

function fakeAdapter(files, { token = null } = {}) {
  const writes = [];
  return {
    writes,
    files,
    async read(id) {
      if (!(id in files)) return null;
      return { content: files[id], hash: token || 'hash-of:' + files[id].length };
    },
    async write(id, content, expectedHash) {
      writes.push({ id, content, expectedHash });
      files[id] = content;
      return { hash: token || 'hash-of:' + content.length };
    },
    async list() { return ['listed']; },
    extra: 'kept',
  };
}

test('a Windows-style file is handed to the app as plain \\n text', async () => {
  const w = withLineEndings(fakeAdapter({ 'a.org': '* One\r\nbody\r\n' }), createInMemoryAdapter());
  assert.equal((await w.read('a.org')).content, '* One\nbody\n');
});

test('and it is written back Windows-style: a file that was never edited comes back byte for byte', async () => {
  const raw = '* One\r\nbody\r\n* Two\r\n';
  const base = fakeAdapter({ 'a.org': raw });
  const w = withLineEndings(base, createInMemoryAdapter());
  const { content } = await w.read('a.org');
  await w.write('a.org', content);
  assert.equal(base.writes[0].content, raw);
});

test('after one edit every line is still Windows-style, and only the edited line differs', async () => {
  const base = fakeAdapter({ 'a.org': '* One\r\nbody\r\n* Two\r\n' });
  const w = withLineEndings(base, createInMemoryAdapter());
  const { content } = await w.read('a.org');
  await w.write('a.org', content.replace('* Two', '* Two changed'));
  assert.equal(base.writes[0].content, '* One\r\nbody\r\n* Two changed\r\n');
  assert.ok(!/(?<!\r)\n/.test(base.writes[0].content), 'no bare \\n anywhere');
});

test('a Unix-style file is untouched, and leaves nothing remembered', async () => {
  const kv = createInMemoryAdapter();
  const base = fakeAdapter({ 'a.org': '* One\nbody\n' });
  const w = withLineEndings(base, kv);
  const { content } = await w.read('a.org');
  assert.equal(content, '* One\nbody\n');
  await w.write('a.org', content);
  assert.equal(base.writes[0].content, '* One\nbody\n');
  assert.equal(await kv.get('lineEnding:a.org'), null, 'Unix is the default, so nothing is stored');
});

test('the style is remembered per file, so a restart can write correctly without reading the file again', async () => {
  const kv = createInMemoryAdapter();
  const first = withLineEndings(fakeAdapter({ 'a.org': '* One\r\n' }), kv);
  await first.read('a.org');
  const base = fakeAdapter({ 'a.org': '* One\r\n' });
  const afterRestart = withLineEndings(base, kv); // a new wrapper over the same stored settings, with no read
  await afterRestart.write('a.org', '* One edited\n');
  assert.equal(base.writes[0].content, '* One edited\r\n');
});

test('each file keeps its own style: a Windows file does not change a Unix file beside it', async () => {
  const kv = createInMemoryAdapter();
  const base = fakeAdapter({ 'win.org': '* W\r\n', 'unix.org': '* U\n' });
  const w = withLineEndings(base, kv);
  await w.read('win.org');
  await w.read('unix.org');
  await w.write('unix.org', '* U2\n');
  await w.write('win.org', '* W2\n');
  assert.equal(base.writes[0].content, '* U2\n');
  assert.equal(base.writes[1].content, '* W2\r\n');
});

test('a file that was Windows-style and is read again as Unix-style (changed elsewhere) is written Unix-style from then on', async () => {
  const kv = createInMemoryAdapter();
  const files = { 'a.org': '* One\r\n' };
  const base = fakeAdapter(files);
  const w = withLineEndings(base, kv);
  await w.read('a.org');
  files['a.org'] = '* One\n';
  await w.read('a.org');
  await w.write('a.org', '* One\n');
  assert.equal(base.writes[0].content, '* One\n');
  assert.equal(await kv.get('lineEnding:a.org'), null);
});

test('a file that mixes the two styles is saved with the one it mostly uses', async () => {
  const base = fakeAdapter({ 'a.org': '* One\r\nb\r\nc\nd\r\n' });
  const w = withLineEndings(base, createInMemoryAdapter());
  const { content } = await w.read('a.org');
  assert.equal(content, '* One\nb\nc\nd\n');
  await w.write('a.org', content);
  assert.equal(base.writes[0].content, '* One\r\nb\r\nc\r\nd\r\n');
});

test('a server\u2019s own version token (a GitHub sha, a WebDAV ETag) is passed through untouched on read and write', async () => {
  const w = withLineEndings(fakeAdapter({ 'a.org': '* One\r\n' }, { token: 'etag-123' }), createInMemoryAdapter());
  assert.equal((await w.read('a.org')).hash, 'etag-123');
  assert.equal((await w.write('a.org', '* One\n')).hash, 'etag-123');
});

test('a hash made from a local file\u2019s content is recomputed on the \\n text, so it agrees with the app\u2019s own hashes', async () => {
  const base = fakeAdapter({ 'a.org': '* One\r\nbody\r\n' });
  const w = withLineEndings(base, createInMemoryAdapter(), { contentDerivedHash: true });
  const read = await w.read('a.org');
  assert.equal(read.hash, contentHash('* One\nbody\n'));
  const written = await w.write('a.org', '* One\nbody\nmore\n');
  assert.equal(written.hash, contentHash('* One\nbody\nmore\n'));
});

test('everything else passes through: a missing file, other methods, other fields, and extra write arguments', async () => {
  const base = fakeAdapter({ 'a.org': '* One\n' });
  const w = withLineEndings(base, createInMemoryAdapter());
  assert.equal(await w.read('missing.org'), null);
  assert.deepEqual(await w.list(), ['listed']);
  assert.equal(w.extra, 'kept');
  await w.write('a.org', '* Two\n', 'expected-hash');
  assert.equal(base.writes[0].expectedHash, 'expected-hash');
});

test('a file never read (a new one) is written Unix-style, and a failing store never breaks a read or a write', async () => {
  const base = fakeAdapter({});
  const brokenKv = { get: async () => { throw new Error('storage unavailable'); }, set: async () => { throw new Error('storage unavailable'); }, delete: async () => { throw new Error('storage unavailable'); } };
  const w = withLineEndings(base, brokenKv);
  await w.write('new.org', '* New\n');
  assert.equal(base.writes[0].content, '* New\n');
  base.files['b.org'] = '* B\r\n';
  assert.equal((await w.read('b.org')).content, '* B\n', 'reading still works');
});
