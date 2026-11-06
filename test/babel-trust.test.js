import test from 'node:test';
import assert from 'node:assert/strict';
import { executableLines, trustDigest } from '../src/babel-trust.js';

const DOC = [
  '* Notes', 'plain text', '',
  '#+NAME: sales', '| a | 1 |', '',
  '* Code', '#+BEGIN_SRC emacs-lisp', '(+ 1 2)', '#+END_SRC', '',
  '#+CALL: sales()', 'inline call_sales() and src_js{1}', '',
  '# Local Variables:', '# eval: (message "hi")', '# fill-column: 80', '# End:',
].join('\n');

test('the digest covers code, calls and eval variables, and ignores prose', async () => {
  const lines = executableLines(DOC);
  for (const want of ['#+BEGIN_SRC emacs-lisp', '(+ 1 2)', '#+END_SRC', '#+CALL: sales()', '# eval: (message "hi")']) assert.ok(lines.includes(want), want);
  assert.ok(!lines.includes('plain text'));
  assert.ok(!lines.includes('# fill-column: 80'));
  const base = await trustDigest(DOC);
  assert.equal(await trustDigest(DOC.replace('plain text', 'other prose')), base, 'prose may change');
  assert.equal(await trustDigest(DOC.replace('* Notes', '* Renamed')), base, 'a heading may change');
  assert.notEqual(await trustDigest(DOC.replace('(+ 1 2)', '(delete-file "x")')), base, 'a changed block asks again');
  assert.notEqual(await trustDigest(DOC.replace('sales()', 'evil()')), base, 'a changed call asks again');
  assert.notEqual(await trustDigest(DOC.replace('(message "hi")', '(shell-command "x")')), base, 'a changed eval variable asks again');
  assert.notEqual(await trustDigest(`${DOC}\n#+BEGIN_SRC js\n1\n#+END_SRC`), base, 'a new block asks again');
});

test('a form in a capture-style template counts as code', async () => {
  assert.notEqual(await trustDigest('* a\n%(foo)'), await trustDigest('* a\n%(bar)'));
});
