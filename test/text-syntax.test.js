import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight, syntaxKindFor } from '../src/text-syntax.js';

/** @param {string} kind @param {string} text */
const classes = (kind, text) => highlight(kind, text).map((line) => line.filter((s) => s.cls).map((s) => `${s.cls}:${s.text}`));

test('the language comes from the name', () => {
  assert.equal(syntaxKindFor('notes.org'), 'org');
  assert.equal(syntaxKindFor('notes.org_archive'), 'org');
  assert.equal(syntaxKindFor('a/b/diary'), 'diary');
  assert.equal(syntaxKindFor('x.md'), 'markdown');
  assert.equal(syntaxKindFor('x.mjs'), 'javascript');
  assert.equal(syntaxKindFor('x.json'), 'javascript');
  assert.equal(syntaxKindFor('packing.txt'), 'plain');
  assert.equal(syntaxKindFor('anything', true), 'diary');
});

test('joined, the pieces are the line', () => {
  const samples = {
    diary: "&12/25  10:00am Brunch\n   at Mom's\n%%(diary-float 11 4 4) Thanksgiving\nnote\n\nFriday x",
    org: '* TODO [#A] Fix *this* :w:\n#+begin_src js\nlet a = `x\ny`;\n#+end_src\n:PROPERTIES:\n:ID: 1\n:END:\n| a | b |',
    markdown: '# T\n```\ncode\n```\n> q **b**\n- item `c`',
    javascript: 'const r = /a+/g; /* a\nb */ x = "s\\"" // c',
    lisp: '(setq a "x") ; c',
  };
  for (const [kind, text] of Object.entries(samples)) {
    const joined = highlight(kind, text).map((l) => l.map((s) => s.text).join('')).join('\n');
    assert.equal(joined, text, kind);
  }
});

test('diary lines', () => {
  const c = classes('diary', "&12/25  10:00am Brunch\n  at Mom's\n%%(diary-float 11 4 4) Thanksgiving\nNotes here\n#include \"other\"\nFriday backup\napr. 25 start\n*/25 monthly");
  assert.deepEqual(c[0], ['tk-mark:&', 'tk-date:12/25', 'tk-time:10:00am']);
  assert.deepEqual(c[1], []);
  assert.ok(c[2].includes('tk-fn:diary-float'));
  assert.deepEqual(c[3], ['tk-ignored:Notes here']);
  assert.deepEqual(c[4], ['tk-meta:#include "other"']);
  assert.deepEqual(c[5], ['tk-date:Friday']);
  assert.deepEqual(c[6], ['tk-date:apr. 25']);
  assert.deepEqual(c[7], ['tk-date:*/25']);
});

test('org lines', () => {
  const c = classes('org', '* TODO [#A] Fix *this* :work:\nSCHEDULED: <2026-10-18 Sun>\n- [ ] see [[https://x][y]] and =code=\n#+TITLE: t\n# c\n* DONE x');
  assert.deepEqual(c[0].slice(0, 3), ['tk-heading:*', 'tk-todo:TODO', 'tk-kw:[#A]']);
  assert.ok(c[0].includes('tk-bold:*this*') && c[0].includes('tk-tag::work:'));
  assert.deepEqual(c[1], ['tk-meta:SCHEDULED:', 'tk-ts:<2026-10-18 Sun>']);
  assert.ok(c[2].includes('tk-link:[[https://x][y]]') && c[2].includes('tk-code:=code='));
  assert.deepEqual(c[3], ['tk-meta:#+TITLE: t']);
  assert.deepEqual(c[4], ['tk-cmt:# c']);
  assert.ok(c[5].includes('tk-done:DONE'));
});

test('a source block is colored as its language, and ends', () => {
  const c = classes('org', '#+begin_src js\nconst a = 1; // x\n#+end_src\nconst b = 2');
  assert.ok(c[1].includes('tk-kw:const') && c[1].includes('tk-num:1') && c[1].includes('tk-cmt:// x'));
  assert.deepEqual(c[3], []);
  const lisp = classes('org', '#+begin_src emacs-lisp\n(message "hi")\n#+end_src');
  assert.ok(lisp[1].includes('tk-fn:message') && lisp[1].includes('tk-str:"hi"'));
});

test('JavaScript', () => {
  const c = classes('javascript', 'const re = /ab+c/g, n = 10 / 2; // end\nlet s = `a\nb${1}`; /* x\ny */ f(1)');
  assert.ok(c[0].includes('tk-str:/ab+c/g'));
  assert.ok(c[0].includes('tk-num:10') && c[0].includes('tk-num:2'), 'a division is not a regexp');
  assert.ok(c[0].includes('tk-cmt:// end'));
  assert.ok(c[1].some((x) => x.startsWith('tk-str:`a')));
  assert.ok(c[2].some((x) => x.startsWith('tk-str:b')));
  assert.ok(c[2].includes('tk-cmt:/* x'));
  assert.ok(c[3].includes('tk-cmt:y */') && c[3].includes('tk-fn:f'));
});

test('Markdown', () => {
  const c = classes('markdown', '# Title\ntext **b** `c` [l](u)\n```js\nlet x\n```\nafter');
  assert.deepEqual(c[0], ['tk-heading:# Title']);
  assert.deepEqual(c[1], ['tk-bold:**b**', 'tk-code:`c`', 'tk-link:[l](u)']);
  assert.deepEqual(c[3], ['tk-code:let x']);
  assert.deepEqual(c[5], []);
});

test('plain text gets no coloring, and an unfinished line never throws', () => {
  assert.deepEqual(classes('plain', '* TODO x'), [[]]);
  for (const kind of ['diary', 'org', 'markdown', 'javascript', 'lisp']) {
    for (const bad of ['"unclosed', '(((', '/*', '`', '[[a', '%%(', '*', '#+begin_src', '\\']) assert.doesNotThrow(() => highlight(kind, bad), `${kind} ${bad}`);
  }
});
