// M-RET (org-meta-return) in the Text view, held to Emacs 29.3 (Org 9.6.15) at every caret position of several texts and for each
// setting of org-M-RET-may-split-line: test/fixtures/meta-return-oracle.json was made by tools/gen-meta-return-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maySplitLine, metaReturn } from '../src/meta-return.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/meta-return-oracle.json', import.meta.url), 'utf8'));

test('M-RET makes the text and puts the caret where Emacs does, for every setting', () => {
  const wrong = [];
  let compared = 0;
  for (const c of oracle) {
    const got = metaReturn(c.text, c.pos, c.setting);
    compared++;
    if ('error' in got || got.text !== c.result.text || got.pos !== c.result.pos) wrong.push({ setting: c.setting, text: c.text, pos: c.pos, got, want: c.result });
  }
  assert.ok(compared > 2000);
  assert.deepEqual(wrong.slice(0, 3), []);
});

test('the setting says per kind of line whether M-RET splits it', () => {
  assert.equal(maySplitLine(undefined, 'headline'), true);
  assert.equal(maySplitLine('t', 'item'), true);
  assert.equal(maySplitLine('nil', 'item'), false);
  assert.equal(maySplitLine("'((headline) (default . t))", 'headline'), false);
  assert.equal(maySplitLine("'((headline) (default . t))", 'item'), true);
  assert.equal(maySplitLine('((item . nil))', 'default'), false);
});

test('M-RET in a table is not handled', () => {
  assert.ok('error' in metaReturn('| a | b |\n', 3, undefined));
});
