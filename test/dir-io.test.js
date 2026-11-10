import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirIo, splitPath } from '../src-browser/dir-io.js';

// A folder made of plain objects with the parts of FileSystemDirectoryHandle the code uses.
function fakeDir(name = 'root') {
  const kids = new Map();
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const dir = {
    kind: 'directory',
    name,
    kids,
    async getDirectoryHandle(n, { create } = {}) {
      if (!kids.has(n)) {
        if (!create) throw notFound();
        kids.set(n, fakeDir(n));
      }
      return kids.get(n);
    },
    async getFileHandle(n, { create } = {}) {
      if (!kids.has(n)) {
        if (!create) throw notFound();
        kids.set(n, fakeFile(n));
      }
      const k = kids.get(n);
      if (k.kind !== 'file') throw Object.assign(new Error('mismatch'), { name: 'TypeMismatchError' });
      return k;
    },
    async removeEntry(n) {
      if (!kids.delete(n)) throw notFound();
    },
    async *entries() {
      for (const [n, k] of kids) yield [n, k];
    },
  };
  return dir;
}
function fakeFile(name) {
  const f = {
    kind: 'file',
    name,
    bytes: new Uint8Array(0),
    async getFile() {
      return { size: f.bytes.length, lastModified: 1000, arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) };
    },
    async createWritable() {
      return { write: async (b) => (f.bytes = new Uint8Array(b)), close: async () => {}, abort: async () => {} };
    },
  };
  return f;
}
const b64 = (text) => Buffer.from(text).toString('base64');

test('write creates the folders on the way, read and list see the file with its size', async () => {
  const root = fakeDir();
  const io = createDirIo(async () => root);
  await io.writeBinary('a/b/c.org', b64('* Hi\n'));
  assert.equal(Buffer.from((await io.readBinary('a/b/c.org')).base64, 'base64').toString(), '* Hi\n');
  const rows = await io.list('a/b');
  assert.deepEqual(rows, [{ name: 'c.org', path: 'a/b/c.org', type: 'file', size: 5, modified: 1000 }]);
  assert.deepEqual((await io.list('')).map((e) => [e.name, e.path, e.type]), [['a', 'a', 'dir']]);
});

test('a missing file reads as null, a delete of a missing file is quiet, a folder is deleted with what is in it', async () => {
  const root = fakeDir();
  const io = createDirIo(async () => root);
  assert.equal(await io.readBinary('nope.org'), null);
  await io.delete('nope.org');
  await io.writeBinary('d/x.org', b64('x'));
  await io.delete('d');
  assert.equal(await io.exists('d/x.org'), false);
});

test('a path cannot climb out of the folder, and no folder chosen is an error', async () => {
  const io = createDirIo(async () => fakeDir());
  await assert.rejects(io.writeBinary('../x', b64('x')), /cannot leave/);
  await assert.rejects(createDirIo(async () => null).list(''), /No folder/);
});

test('an empty write makes an empty file; folders sort first', async () => {
  const root = fakeDir();
  const io = createDirIo(async () => root);
  await io.writeBinary('z.org', '');
  await io.writeBinary('sub/a.org', b64('a'));
  assert.deepEqual((await io.list('')).map((e) => e.name), ['sub', 'z.org']);
  assert.equal((await io.list('')).find((e) => e.name === 'z.org').size, 0);
  assert.deepEqual(splitPath('a/b/c.org'), ['a/b', 'c.org']);
});

test('makeDirectory makes an empty folder, with the ones above it, and lists as a folder', async () => {
  const root = fakeDir();
  const io = createDirIo(async () => root);
  await io.makeDirectory('a/b/');
  assert.deepEqual((await io.list('a')).map((e) => [e.name, e.type]), [['b', 'dir']]);
  assert.deepEqual(await io.list('a/b'), []);
});
