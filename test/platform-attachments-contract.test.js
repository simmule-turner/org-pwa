// The contract between the app and a native shell's `platform.attachments` adapter (see src-browser/platform.js). A shell trusts the paths the
// app hands it, so whatever a document says (an :ID:, a :DIR:, an attachment: link, a picked file's name), the adapter must only ever see clean
// relative paths, and the source of a move must be a uri the app was given by the shell's own file picker in that same flow.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, pressButton } from './support/fake-dom.js';
import { parseOrg } from '../src/org-parser.js';
import { createHistory } from '../src/undo-history.js';

installFakeDom();
const { installPlatform } = await import('../src-browser/platform.js');
const { S } = await import('../src-browser/app-state.js');
const flow = await import('../src-browser/attachments-flow.js');
const { savedChannel } = await import('../src-browser/adapters.js');
after(() => savedChannel?.close()); // an open BroadcastChannel keeps a Node process alive

const HOSTILE_IDS = ['../x', '../../x', '..', '.', '/x', 'a\\b', 'a\0b', 'a\x01b', 'a\x7fb', 'a//b', 'a/../b', ' ../x'];
const HOSTILE_NAMES = ['../../x', '..', '.', '/x', 'a\\b', 'a\0b', 'a\x01b', 'a//b', 'a/../b', '../x.png', 'sub/x.txt'];
const HOSTILE_DIRS = ['../x', '..', '/x', 'a\\b', 'a//b', './../x', 'files/../../x'];
const DOCUMENT_IDS = ['notes.org', 'projects/work/notes.org'];

/** A path as the adapter receives it: relative, made of real names, nothing a shell could read as a way out of its folder. */
function pathProblem(path) {
  if (typeof path !== 'string') return `not a string (${typeof path})`;
  if (path === '') return 'empty';
  if (path.startsWith('/')) return 'leading slash';
  if (path.includes('\\')) return 'backslash';
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'control character';
  const segments = path.split('/');
  if (segments.some((s) => s === '')) return 'empty segment';
  if (segments.some((s) => s === '.' || s === '..')) return 'dot segment';
  return null;
}

/** An adapter that records every call, with a few files in it, and tells apart the uris its own picker handed out. */
function fakeAttachments() {
  const calls = [];
  const files = new Map([['data/seed/ok.txt', 'aGk=']]);
  const pickedUris = new Set();
  const record = (op, ...args) => calls.push({ op, args });
  return {
    calls,
    files,
    pickedUris,
    supported: () => true,
    folder: async () => 'content://tree/org-pwa',
    pickFolder: async () => 'content://tree/org-pwa',
    removeSource: async (uri) => record('removeSource', uri),
    adapter: {
      async readBinary(path) {
        record('readBinary', path);
        return files.has(path) ? { base64: files.get(path), name: path.split('/').pop() } : { base64: 'aGk=', name: 'x' };
      },
      async writeBinary(path, base64) {
        record('writeBinary', path);
        files.set(path, base64);
      },
      async delete(path) {
        record('delete', path);
        files.delete(path);
      },
      async exists(path) {
        record('exists', path);
        return files.has(path);
      },
      async list(dir) {
        record('list', dir);
        // a hostile shell or folder may also report names that climb out of the directory; the app must not pass them back
        return [{ name: 'ok.txt', type: 'file' }, { name: '..', type: 'file' }, { name: '../x', type: 'file' }, { name: 'a\\b', type: 'file' }, { name: 'a\0b', type: 'file' }, { name: 'sub', type: 'dir' }];
      },
      async link(path, uri) {
        record('link', path, uri);
      },
    },
  };
}

function setUp(documentId, headingText) {
  const attachments = fakeAttachments();
  installPlatform({ attachments, pickFile: null });
  const doc = parseOrg(headingText);
  S.state = { documentId, doc, startupConfig: {}, storageKind: 'filesystem', localVariables: {} };
  S.attachmentsFolder = 'content://tree/org-pwa';
  S.globalVariables = {};
  S.documentSessions = [];
  S.history = createHistory(headingText, 'Opened');
  return { attachments, heading: doc.children[0], doc };
}

const withId = (id) => `* Heading\n:PROPERTIES:\n:ID: ${id}\n:END:\n`;
const withDir = (dir) => `* Heading\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:DIR: ${dir}\n:END:\n`;
const FINE_ID = '11111111-2222-3333-4444-555555555555';

/** Runs a flow, ignoring a throw from the part of the flow that draws on screen: what matters is what reached the adapter. */
async function run(fn) {
  try {
    await Promise.race([fn(), new Promise((resolve) => setTimeout(resolve, 150))]);
  } catch {
    // a screen the fake page cannot draw
  }
}

function assertCleanCalls(calls, context) {
  for (const { op, args } of calls) {
    if (op === 'removeSource') continue;
    const paths = op === 'writeBinary' ? [args[0]] : op === 'link' ? [args[0]] : args;
    for (const path of paths) assert.equal(pathProblem(path), null, `${context}: ${op}(${JSON.stringify(path)}) ${pathProblem(path)}`);
  }
}

test('the paths the adapter sees are clean however hostile the :ID:, the name or the :DIR: in the document', async () => {
  for (const documentId of DOCUMENT_IDS) {
    for (const id of HOSTILE_IDS) {
      const { attachments, heading } = setUp(documentId, withId(id));
      const context = `${documentId} :ID: ${JSON.stringify(id)}`;
      await run(() => flow.uploadAttachmentToHeading(heading, { name: 'ok.txt', base64: 'aGk=' }));
      await run(() => flow.uploadAttachmentToHeading(heading, { name: 'ok.txt', base64: 'aGk=', uri: 'content://picked/1' }, { link: true }));
      await run(() => flow.openAttachmentLink('attachment:ok.txt', heading));
      await run(() => flow.deleteAttachment(heading, 'ok.txt'));
      await run(() => flow.attachmentFiles(heading));
      await run(() => flow.syncAttachments(heading));
      const deleting = flow.deleteAllAttachments(heading);
      await pressButton('Delete');
      await run(() => deleting);
      assertCleanCalls(attachments.calls, context);
    }
    for (const name of HOSTILE_NAMES) {
      const { attachments, heading } = setUp(documentId, withId(FINE_ID));
      const context = `${documentId} name ${JSON.stringify(name)}`;
      await run(() => flow.uploadAttachmentToHeading(heading, { name, base64: 'aGk=' }));
      await run(() => flow.uploadAttachmentToHeading(heading, { name, base64: 'aGk=', uri: 'content://picked/1' }, { link: true }));
      await run(() => flow.openAttachmentLink(`attachment:${name}`, heading));
      await run(() => flow.resolveAndReadAttachment(`attachment:${name}`, heading));
      await run(() => flow.deleteAttachment(heading, name));
      assertCleanCalls(attachments.calls, context);
    }
    for (const dir of HOSTILE_DIRS) {
      const { attachments, heading } = setUp(documentId, withDir(dir));
      const context = `${documentId} :DIR: ${JSON.stringify(dir)}`;
      await run(() => flow.attachmentFiles(heading));
      await run(() => flow.openAttachmentLink('attachment:ok.txt', heading));
      await run(() => flow.deleteAttachment(heading, 'ok.txt'));
      await run(() => flow.uploadAttachmentToHeading(heading, { name: 'ok.txt', base64: 'aGk=' }));
      const unsetting = flow.unsetAttachmentDirectory(heading);
      await pressButton('Move them');
      await run(() => unsetting);
      assertCleanCalls(attachments.calls, context);
    }
  }
});

test('the flows do reach the adapter for a good heading, with the paths the contract describes', async () => {
  const { attachments, heading } = setUp('projects/work/notes.org', withId(FINE_ID));
  await run(() => flow.uploadAttachmentToHeading(heading, { name: 'report.pdf', base64: 'aGk=' }));
  await run(() => flow.uploadAttachmentToHeading(heading, { name: 'linked.pdf', base64: '', uri: 'content://picked/7' }, { link: true }));
  await run(() => flow.attachmentFiles(heading));
  const ops = attachments.calls.map((c) => c.op);
  assert.ok(ops.includes('list') && ops.includes('writeBinary') && ops.includes('link'), ops.join());
  const write = attachments.calls.find((c) => c.op === 'writeBinary');
  assert.match(write.args[0], /^data\/11\/11111-2222-3333-4444-555555555555\/report\.pdf$|report\.pdf$/);
  assertCleanCalls(attachments.calls, 'good heading');
  const link = attachments.calls.find((c) => c.op === 'link');
  assert.equal(link.args[1], 'content://picked/7', 'the link target is the uri the picker gave');
});

test('a hostile list from the folder is filtered before the app uses a name from it', async () => {
  const { attachments, heading } = setUp('notes.org', withId(FINE_ID));
  const names = await flow.attachmentFiles(heading);
  assert.deepEqual(names, ['ok.txt']);
  const deleting = flow.deleteAllAttachments(heading);
  await pressButton('Delete');
  await run(() => deleting);
  const deleted = attachments.calls.filter((c) => c.op === 'delete').map((c) => c.args[0]);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /\/ok\.txt$/);
});

test('mv only deletes a source the shell\'s picker returned in that flow, and only once the copy is written and the person agrees', async () => {
  for (const documentId of DOCUMENT_IDS) {
    const { attachments, heading } = setUp(documentId, withId(FINE_ID));
    const returned = [{ name: 'photo.jpg', base64: 'aGk=', uri: 'content://picked/photo' }, { name: 'no-uri.jpg', base64: 'aGk=' }, { name: '../evil.jpg', base64: 'aGk=', uri: 'content://picked/evil' }];
    installPlatform({
      pickFile: async () => {
        for (const file of returned) if (file.uri) attachments.pickedUris.add(file.uri);
        return returned;
      },
    });
    const moving = flow.attachFileToHeading(heading, 'mv');
    for (let i = 0; i < 3; i++) await pressButton('Delete original', 40);
    await run(() => moving);
    const removed = attachments.calls.filter((c) => c.op === 'removeSource').map((c) => c.args[0]);
    for (const uri of removed) assert.ok(attachments.pickedUris.has(uri), `removeSource(${uri}) was not a uri the picker returned`);
    assert.ok(!removed.includes(undefined), 'a file the shell gave no uri for is not removed');
    // every removal comes after a write of that file
    for (const { args, i } of attachments.calls.map((c, i) => ({ ...c, i })).filter((c) => c.op === 'removeSource')) {
      assert.ok(attachments.calls.slice(0, i).some((c) => c.op === 'writeBinary'), `removeSource(${args[0]}) came before any copy was written`);
    }
    assertCleanCalls(attachments.calls, `mv in ${documentId}`);
  }
});

test('mv without the person\'s agreement removes nothing', async () => {
  const { attachments, heading } = setUp('notes.org', withId(FINE_ID));
  installPlatform({ pickFile: async () => [{ name: 'photo.jpg', base64: 'aGk=', uri: 'content://picked/photo' }] });
  const moving = flow.attachFileToHeading(heading, 'mv');
  await pressButton('Cancel', 40);
  await run(() => moving);
  assert.equal(attachments.calls.filter((c) => c.op === 'removeSource').length, 0);
});

test('the contract checker itself rejects every kind of bad path', () => {
  for (const bad of ['', '/x', 'a\\b', 'a\0b', 'a\x01b', 'a//b', '..', '.', 'a/../b', 'a/./b', '../x', undefined, null]) assert.notEqual(pathProblem(bad), null, JSON.stringify(bad));
  for (const good of ['a', 'a/b', 'data/11/abc/x.txt', 'some folder/x y.png']) assert.equal(pathProblem(good), null, good);
});
