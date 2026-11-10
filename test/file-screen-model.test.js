import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPath, listedAsFile, parentFolder } from '../src/file-screen-model.js';

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
