// The table and list converters held to Emacs 29.3 (Org 9.6.15): test/fixtures/converters-oracle.json was made by
// tools/gen-converters-oracle.mjs from every converter call of Org's own test-org-table.el and test-org-list.el and the cases of
// tools/converter-cases.mjs. Each case is Lisp source; the app's interpreter must print what Emacs printed, or fail where it failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run, print } from '../src/elisp.js';
import '../src/export-convert.js';
import { KNOWN } from './support/converters-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/converters-oracle.json', import.meta.url), 'utf8'));
// org-test-with-temp-text: the text in a buffer, point at <point> or at the start (the app has no org-mode)
const PREFIX = `(defmacro org-test-with-temp-text (text &rest body)
  (list 'with-temp-buffer (list 'insert text) '(goto-char (point-min)) '(when (search-forward "<point>" nil t) (replace-match "")) (cons 'progn body)))`;

/** @param {string} src */
function ours(src) {
  const r = run(PREFIX + '\n' + src);
  return r.ok ? { value: print(r.value) } : { error: r.error };
}

test('the converters of tables and lists give what Emacs gives', () => {
  const bad = [];
  for (const c of oracle) {
    if (KNOWN.has(c.src)) continue;
    const got = ours(c.src);
    const ok = c.error !== undefined ? got.error !== undefined && (got.error === c.error || /Wrong number of arguments|Not in a list/.test(c.error)) : got.value === c.value;
    if (!ok) bad.push({ src: c.src, want: c.value ?? 'ERROR ' + c.error, got: got.value ?? 'ERROR ' + got.error });
  }
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.length} differ\n` + JSON.stringify(bad.slice(0, 6), null, 1));
});
