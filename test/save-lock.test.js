import test from 'node:test';
import assert from 'node:assert/strict';
import { announceSaved, isSavedMessage, openSavedChannel, saveLockName, savedElsewhere, withSaveLock, SAVED_CHANNEL } from '../src/save-lock.js';
import { syncDocument } from '../src/sync-engine.js';

/** A Web Locks stand-in: one holder at a time per name, in the order asked. */
function fakeLocks() {
  const tails = new Map();
  const calls = [];
  return {
    calls,
    request(name, options, cb) {
      calls.push({ name, options });
      const run = (tails.get(name) ?? Promise.resolve()).then(cb);
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

test('the lock is named by backend and file and is exclusive', async () => {
  const locks = fakeLocks();
  assert.equal(saveLockName('github', 'a/b.org'), 'org-pwa-save:github:a/b.org');
  assert.equal(await withSaveLock('github', 'a/b.org', async () => 7, locks), 7);
  assert.deepEqual(locks.calls, [{ name: 'org-pwa-save:github:a/b.org', options: { mode: 'exclusive' } }]);
});

test('two saves of one file run one after the other, in order; different files do not wait', async () => {
  const locks = fakeLocks();
  const log = [];
  const slow = (tag, ms) => async () => {
    log.push('start ' + tag);
    await new Promise((r) => setTimeout(r, ms));
    log.push('end ' + tag);
  };
  await Promise.all([withSaveLock('filesystem', 'f', slow('a', 20), locks), withSaveLock('filesystem', 'f', slow('b', 1), locks), withSaveLock('filesystem', 'g', slow('c', 1), locks)]);
  assert.deepEqual(log.filter((x) => / [ab]$/.test(x)), ['start a', 'end a', 'start b', 'end b']);
  assert.ok(log.indexOf('start c') < log.indexOf('end a'));
});

test('a failing save releases the lock for the next', async () => {
  const locks = fakeLocks();
  await assert.rejects(withSaveLock('webdav', 'x', async () => { throw new Error('boom'); }, locks), /boom/);
  assert.equal(await withSaveLock('webdav', 'x', async () => 'ok', locks), 'ok');
});

test('without Web Locks the work runs directly', async () => {
  assert.equal(await withSaveLock('input', 'x', async () => 1, null), 1);
  assert.equal(await withSaveLock('input', 'x', async () => 2, {}), 2);
});

test('syncDocument holds the adapter lock around the whole read-compare-write', async () => {
  const order = [];
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) };
  const disk = {
    lock: async (id, work) => { order.push('lock ' + id); try { return await work(); } finally { order.push('unlock'); } },
    read: async () => { order.push('read'); return null; },
    write: async (id, content) => { order.push('write'); return { hash: 'h' }; },
  };
  const { saveDocument } = await import('../src/document-store.js');
  const { parseOrg } = await import('../src/org-parser.js');
  await saveDocument({ documentId: 'd.org', doc: parseOrg('* A\n'), kvAdapter: kv });
  await syncDocument({ documentId: 'd.org', kvAdapter: kv, diskAdapter: disk });
  assert.deepEqual(order, ['lock d.org', 'read', 'write', 'unlock']);
});

test('messages are checked, and each window decides what to do about a save elsewhere', () => {
  const msg = { backend: 'github', id: 'a.org', hash: 'h2' };
  assert.ok(isSavedMessage(msg));
  assert.ok(!isSavedMessage({ backend: 1 }));
  assert.ok(!isSavedMessage(null));
  const open = { backend: 'github', id: 'a.org', dirty: false, knownHash: 'h1' };
  assert.equal(savedElsewhere(msg, open), 'reload');
  assert.equal(savedElsewhere(msg, { ...open, dirty: true }), 'conflict');
  assert.equal(savedElsewhere(msg, { ...open, knownHash: 'h2', dirty: true }), 'ignore');
  assert.equal(savedElsewhere(msg, { ...open, id: 'b.org' }), 'ignore');
  assert.equal(savedElsewhere(msg, { ...open, backend: 'webdav' }), 'ignore');
  assert.equal(savedElsewhere(msg, { ...open, id: null }), 'ignore');
  assert.equal(savedElsewhere('junk', open), 'ignore');
  assert.equal(savedElsewhere({ ...msg, hash: null }, open), 'reload');
});

test('the channel carries the announcement, and a broken one is harmless', () => {
  const posted = [];
  let name = null;
  const channel = openSavedChannel((n) => { name = n; return { postMessage: (m) => posted.push(m), close() {}, onmessage: null }; });
  assert.equal(name, SAVED_CHANNEL);
  announceSaved(channel, { backend: 'github', id: 'a.org', hash: 'h' });
  assert.deepEqual(posted, [{ backend: 'github', id: 'a.org', hash: 'h' }]);
  assert.equal(openSavedChannel(() => { throw new Error('none'); }), null);
  announceSaved(null, { backend: 'x', id: 'y', hash: null });
  announceSaved({ postMessage() { throw new Error('closed'); } }, { backend: 'x', id: 'y', hash: null });
});
