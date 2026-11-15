// org-inlinetask's movement and test functions, held to Emacs 29.3: test/fixtures/inlinetask-oracle.json was made by
// tools/gen-inlinetask-oracle.mjs, which runs each function from every position of a text. Here the same Lisp functions run on the interpreter.
// org-inlinetask-get-task-level from a place with no task line before it reads whatever match data the last search left: Emacs gave 0 there
// in its run, which is not a rule, so those positions are not compared.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/elisp.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/inlinetask-oracle.json', import.meta.url), 'utf8'));
const show = (/** @type {any[]} */ r) => `(${r[0]} ${r[1] === null ? 'nil' : r[1] === true ? 't' : r[1] === false ? ':json-false' : r[1]})`;

test('inline task functions end up where Emacs puts point, and answer as Emacs does', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    const text = JSON.stringify(c.text);
    const value = /get-task-level/.test(c.fn) ? 'v' : /goto/.test(c.fn) ? 'nil' : '(if v t :json-false)';
    const got = run(`(let (r) (dotimes (i (1+ (length ${text}))) (push (with-temp-buffer (insert ${text}) (goto-char (1+ i))
      (let ((org-inlinetask-min-level ${c.min}) (org-odd-levels-only ${c.odd ? 't' : 'nil'}))
        (let ((v (${c.fn}))) (list (point) ${value})))) r)) (mapconcat (lambda (x) (format "%S" (list (car x) (cadr x)))) (nreverse r) " "))`);
    assert.ok(got.ok, got.error);
    const have = /** @type {string} */ (got.value).split(/(?<=\)) /);
    c.results.forEach((/** @type {any[]} */ r, /** @type {number} */ i) => {
      if (/get-task-level/.test(c.fn) && r[1] === 0) return;
      const want = show(r);
      const gotOne = have[i];
      if (gotOne !== want) wrong.push({ fn: c.fn, text: c.text, min: c.min, odd: c.odd, at: i + 1, got: gotOne, want });
    });
  }
  assert.deepEqual(wrong.slice(0, 3), []);
});

test('a column view over an inline task: a task deeper than the minimum level is the error Emacs gives', async () => {
  const { updateAllColumnviewBlocks } = await import('../src/org-columns.js');
  const { setInlineTaskLevel } = await import('../src/inline-tasks.js');
  const { parseOrg, serializeOrg } = await import('../src/org-parser.js');
  setInlineTaskLevel(15);
  try {
    for (const [i, c] of oracle.columns.entries()) {
      const doc = parseOrg(c.text);
      let got;
      try {
        updateAllColumnviewBlocks(doc, { category: 'x' });
        got = serializeOrg(doc);
      } catch (e) {
        got = 'ERROR ' + /** @type {Error} */ (e).message;
      }
      if (i === 0) {
        // known: Emacs reads a property inside an inline task through org-entry-get with the task's own END line counted as an entry with the
        // task's value, so a parent sums the value twice (4 here); the app counts the task once (see test/support/capture-known.js)
        assert.notEqual(got, c.emacs);
        assert.match(got, /\| A      \|    2 \|/);
      } else assert.equal(got, c.emacs);
    }
  } finally {
    setInlineTaskLevel(null);
  }
});
