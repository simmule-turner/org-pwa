import test from 'node:test';
import assert from 'node:assert/strict';
import { findLoads, resolveLoad, expandLoads } from '../src/lisp-load.js';
import { runInit, listItems } from '../src/lisp-read.js';

test('load forms are found outside strings and comments only', () => {
  const text = '(setq a "(load \\"github:x.el\\")")\n; (load "github:no.el")\n(load "github:yes.el")\n(progn (load "webdav:also.el" t))';
  assert.deepEqual(findLoads(text).map((l) => l.name), ['github:yes.el', 'webdav:also.el']);
});

test('a name is resolved beside the file that loads it', () => {
  assert.equal(resolveLoad('github:a.el', 'webdav:x/y.el'), 'github:a.el');
  assert.equal(resolveLoad('holidays.el', 'github:org/init.el'), 'github:org/holidays.el');
  assert.equal(resolveLoad('../h.el', 'github:org/sub/init.el'), 'github:org/h.el');
  assert.equal(resolveLoad('/h.el', 'github:org/init.el'), 'github:h.el');
});

test('the text of each file replaces its load form, nested loads and a missing file included', async () => {
  const files = { 'github:org/a.el': '(setq x 1)\n(load "b.el")', 'github:org/b.el': '(setq y 2)\n(load "github:org/a.el")' };
  const out = await expandLoads('(setq w 0)\n(load "github:org/a.el")\n(load "github:org/missing.el")\n(setq z 3)', async (spec) => {
    if (!(spec in files)) throw new Error('not found');
    return files[spec];
  });
  assert.deepEqual(out.specs, ['github:org/a.el', 'github:org/b.el']);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /missing\.el.*not found/);
  const vars = runInit(out.text);
  assert.deepEqual(['w', 'x', 'y', 'z'].map((k) => vars.get(k)?.v), [0, 1, 2, 3]);
  assert.equal(listItems(vars.get('x')), null);
});

test('a name without a scheme in the settings box is reported, not guessed', async () => {
  const out = await expandLoads('(load "holidays.el")', async () => '');
  assert.match(out.errors[0], /name it like an agenda file/);
});
