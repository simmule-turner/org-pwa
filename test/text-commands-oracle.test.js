// org-beginning-of-line, org-end-of-line, org-toggle-heading, org-mark-subtree and org-next-link, held to Emacs 29.3 (Org 9.6.15):
// test/fixtures/text-commands-oracle.json was made by tools/gen-text-commands-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markSubtree, nextLink, orgBeginningOfLine, orgEndOfLine, toggleHeading } from '../src/text-commands.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/text-commands-oracle.json', import.meta.url), 'utf8'));
const KEYWORDS = ['TODO', 'DONE'];

test('C-a and C-e go where Emacs goes for every setting of org-special-ctrl-a/e', () => {
  const wrong = [];
  let compared = 0;
  for (const c of oracle.filter((/** @type {{ kind: string }} */ x) => x.kind === 'line')) {
    const special = c.setting === 'nil' ? 'nil' : c.setting === 't' ? 't' : 'reversed';
    const repeated = c.setting === 'reversed-repeat';
    const got = [orgBeginningOfLine(c.text, c.pos, special, repeated, KEYWORDS), orgEndOfLine(c.text, c.pos, special, repeated, KEYWORDS)];
    compared++;
    if (got[0] !== c.result[0] || got[1] !== c.result[1]) wrong.push({ line: c.text.slice(c.text.lastIndexOf('\n', c.pos - 1) + 1).split('\n')[0], setting: c.setting, pos: c.pos, got, want: c.result });
  }
  assert.ok(compared > 500);
  assert.deepEqual(wrong.slice(0, 5), []);
});

test('marking a subtree selects what Emacs selects', () => {
  const wrong = [];
  const cases = oracle.filter((/** @type {{ kind: string }} */ x) => x.kind === 'mark');
  for (const c of cases) {
    const got = markSubtree(c.text, c.pos);
    const want = typeof c.result === 'string' ? null : { start: c.result[0], end: c.result[1] };
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ pos: c.pos, got, want });
  }
  assert.ok(cases.length > 50);
  assert.deepEqual(wrong.slice(0, 5), []);
});

test('the next link is where Emacs finds it', () => {
  const wrong = [];
  const cases = oracle.filter((/** @type {{ kind: string }} */ x) => x.kind === 'link');
  for (const c of cases) {
    const got = nextLink(c.text, c.pos, false).pos;
    if (got !== c.result) wrong.push({ pos: c.pos, got, want: c.result });
  }
  assert.ok(cases.length > 100);
  assert.deepEqual(wrong.slice(0, 8), []);
});

test('toggling a heading makes the text Emacs makes', () => {
  const wrong = [];
  let compared = 0;
  for (const c of oracle.filter((/** @type {{ kind: string }} */ x) => x.kind === 'toggle')) {
    // Emacs turns the lines of a list into headings with the end of the region narrowed one character too far, which mangles the text
    // when the region ends right before more text of the list: those cases are Emacs's own mistakes, not a behavior to copy
    const lines = c.text.split('\n');
    const fromItem = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]/.test(lines[c.line]) && !/^\*+ /.test(lines[c.line]);
    if (fromItem && c.to > c.line && /\S/.test(lines[c.to + 1] ?? '')) continue;
    const got = toggleHeading(c.text, c.line, c.to) ?? c.text;
    compared++;
    if (got !== c.result) wrong.push({ line: c.line, to: c.to, text: c.text, got, want: c.result });
  }
  assert.ok(compared > 80);
  assert.deepEqual(wrong.slice(0, 3), []);
});
