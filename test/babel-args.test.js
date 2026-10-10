// Header-argument inheritance, checked against Emacs: test/fixtures/babel/args-N.json were produced by
// tools/emacs-dump-blocks.el (org-babel-get-src-block-info) from the matching .org files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { collectDocumentBlocks } from '../src/babel-blocks.js';
import { mergeHeaderArgs, splitHeaderArgs, readHeaderValue } from '../src/babel-args.js';

const fixture = (name) => readFileSync(new URL('./fixtures/babel/' + name, import.meta.url), 'utf8');
const words = (s) => String(s).split(/\s+/).filter(Boolean).sort();

for (const n of [1, 2, 3]) {
  test(`header arguments agree with Emacs (args-${n})`, () => {
    const blocks = collectDocumentBlocks(parseOrg(fixture(`args-${n}.org`)));
    const expected = JSON.parse(fixture(`args-${n}.json`));
    assert.equal(blocks.length, expected.length);
    expected.forEach((want, i) => {
      assert.equal(blocks[i].lang, want.lang);
      for (const [key, value] of Object.entries(want.params)) {
        const got = blocks[i].args[key];
        if (key === 'results' || key === 'exports') assert.deepEqual(words(got), words(value), `block ${i + 1} :${key}`);
        else assert.deepEqual(got, value, `block ${i + 1} :${key}`);
      }
      if (!want.params.var) assert.deepEqual(blocks[i].args.var, [], `block ${i + 1} has no variables`);
    });
  });
}

test('header text is split like Org does', () => {
  assert.deepEqual(splitHeaderArgs(':tangle a.js :shebang "#!/bin/sh :x" :var a=(f 1 :2)'), [['tangle', 'a.js'], ['shebang', '"#!/bin/sh :x"'], ['var', 'a=(f 1 :2)']]);
  assert.deepEqual(splitHeaderArgs(':no-expand :results table'), [['no-expand', ''], ['results', 'table']]);
  assert.equal(readHeaderValue('"a;b"'), 'a;b');
  assert.equal(readHeaderValue('plain'), 'plain');
  assert.deepEqual(mergeHeaderArgs([[['var', 'a=1 b=2']], [['var', 'a=3']]]).var, ['b=2', 'a=3']);
});
