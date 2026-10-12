import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPath, listedAsFile, parentFolder, resolveFileScreenType, stepFileScreenType, visibleEntries } from '../src/file-screen-model.js';

test('the remembered type is used only when it is a known type', () => {
  assert.equal(resolveFileScreenType('webdav'), 'webdav');
  assert.equal(resolveFileScreenType('nope'), 'local');
  assert.equal(resolveFileScreenType(undefined), 'local');
});
test('arrow stepping stops at the ends', () => {
  assert.equal(stepFileScreenType('github', -1), 'github');
  assert.equal(stepFileScreenType('github', 1), 'local');
  assert.equal(stepFileScreenType('webdav', 1), 'webdav');
});
test('listing keeps folders and org files, folders first', () => {
  const e = [
    { name: 'b.org', path: 'b.org', type: 'file' },
    { name: 'x.png', path: 'x.png', type: 'file' },
    { name: 'a', path: 'a', type: 'dir' },
    { name: 'old.org_archive', path: 'old.org_archive', type: 'file' },
  ];
  assert.deepEqual(visibleEntries(e).map((x) => x.name), ['a', 'b.org', 'old.org_archive']);
});
test('paths join under a folder; a leading slash starts at the root', () => {
  assert.equal(joinPath('work', 'a.org'), 'work/a.org');
  assert.equal(joinPath('', ' a.org '), 'a.org');
  assert.equal(joinPath('work', '/top.org'), 'top.org');
  assert.equal(parentFolder('a/b'), 'a');
  assert.equal(parentFolder('a'), '');
});
test('an existing file is recognised for the replace question', () => {
  const e = [{ name: 'a.org', path: '/work/a.org', type: 'file' }, { name: 'work', path: 'work', type: 'dir' }];
  assert.equal(listedAsFile(e, 'work/a.org'), true);
  assert.equal(listedAsFile(e, 'work'), false);
  assert.equal(listedAsFile(null, 'x'), false);
});
