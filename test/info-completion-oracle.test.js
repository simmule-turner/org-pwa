// Holds Go to node's completion to Emacs 29.3: the typed text completes node names the way completion-all-completions does with
// completion-ignore-case on and the default styles. Skipped without Emacs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { completeNodeNames } from '../src/info-manual.js';
import { loadManual } from '../tools/info-oracle-lib.mjs';

const emacs = spawnSync('emacs', ['--version']).status === 0;
const FIXTURES = new URL('./fixtures/info/', import.meta.url).pathname;

test('Go to node completes as Emacs does', { skip: !emacs }, async () => {
  const names = (await loadManual(FIXTURES, 'sample.info')).completions().filter((n) => n !== '*');
  const typed = ['', 't', 'Ta', 'ort', 'Lisp f', 'l f', 'L f', 'l-f', 'li-fu', 'B-', '-', ' ', 's', 'top', 'Tab', 'x', 'fu', 'L-', 'lisp functions', 'Formulas-', 'formulas-f', 'Concept I', 'c i', 'F I', 'F-I', 'an a', 'A'];
  for (const n of names) for (let k = 1; k <= n.length; k += 2) typed.push(n.slice(0, k).toLowerCase());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'info-compl-'));
  const out = path.join(tmp, 'out.json');
  const q = path.join(tmp, 'q.json');
  fs.writeFileSync(q, JSON.stringify({ names, typed }));
  const el = `(progn (require 'json) (let* ((json-array-type 'list) (json-object-type 'alist) (data (json-read-file ${JSON.stringify(q)})) (completion-ignore-case t) (names (cdr (assq 'names data))) (res nil))
    (dolist (typed (cdr (assq 'typed data)))
      (let ((r (completion-all-completions typed names nil (length typed)))) (when r (setcdr (last r) nil))
        (push (mapcar (function substring-no-properties) r) res)))
    (with-temp-file ${JSON.stringify(out)} (insert (json-encode (nreverse res))))))`;
  const r = spawnSync('emacs', ['--batch', '-Q', '--eval', el], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const raw = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(tmp, { recursive: true });
  assert.ok(raw.length > 30);
  for (const [i, t] of typed.entries()) {
    const theirs = raw[i] || [];
    assert.deepEqual(completeNodeNames(names, t), theirs, JSON.stringify(t));
  }
});
