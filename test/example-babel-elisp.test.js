// examples/babel-elisp.org holds what Emacs 29.3 wrote under each of its emacs-lisp blocks (tools/gen-example-babel-elisp.mjs runs them in
// Emacs, in order). The app, running the same blocks in order over the file without its results, must write the same text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executed } from './support/babel-exec.js';

const text = readFileSync(new URL('../examples/babel-elisp.org', import.meta.url), 'utf8');
const [body, tail] = text.split(/^\* Where the app differs from Emacs\n/m);

/** The text without its `#+RESULTS:` blocks: the keyword line and the lines that follow it up to the blank line (a block result up to its end line). @param {string} t */
function withoutResults(t) {
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#\+RESULTS(?:\[[^\]]*\])?:/.test(lines[i])) {
      i++;
      if (/^#\+begin_/i.test(lines[i] ?? '')) while (!/^#\+end_/i.test(lines[i])) i++;
      else {
        while (i < lines.length && lines[i] !== '') i++;
        i--; // the blank line after the result stays
      }
      if (out[out.length - 1] === '') out.pop();
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

test('babel-elisp.org: the app writes the results Emacs wrote', () => {
  let current = withoutResults(body);
  const count = (current.match(/^#\+begin_src/gim) || []).length;
  assert.ok(count >= 12);
  for (let i = 0; i < count; i++) current = executed(current, i);
  assert.equal(current.trimEnd(), body.trimEnd());
  assert.match(tail, /^- A heading with an empty/m);
});
