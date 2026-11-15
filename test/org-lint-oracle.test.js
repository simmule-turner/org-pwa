// Holds org-lint to Emacs 29.3: test/fixtures/org-lint-oracle.json was made by tools/gen-org-lint-oracle.mjs, which runs `org-lint`
// (every checker) on the strings of Org's test-org-lint.el, on tools/org-lint-cases.mjs and on the app's example documents. The
// comparison is exact: line, trust, warning text and checker name, in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orgLint } from '../src/org-lint.js';
import { lintRuleFor, LINT_RULES } from './support/org-lint-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-lint-oracle.json', import.meta.url), 'utf8'));

/** The outside world the oracle ran in: the files of the fixture in the working directory CWD/, and /etc/passwd. */
const options = {
  fileExists: (/** @type {string} */ f) => f === '/etc/passwd' || Object.hasOwn(oracle.files, f.replace(/^CWD\//, '')),
  attachmentFile: (/** @type {string} */ f) => 'CWD/' + f,
  readFile: (/** @type {string} */ f) => (Object.hasOwn(oracle.files, f.replace(/^CWD\//, '')) ? oracle.files[f.replace(/^CWD\//, '')] : null),
  idExists: () => false,
};

/** @param {string} text */
function ours(text) {
  try {
    return orgLint(text, null, options).map((r) => [r.line, r.trust, r.message, r.checker]);
  } catch (e) {
    return 'ERROR ' + (e instanceof Error ? e.message : e);
  }
}

function differences() {
  const bad = [];
  for (const c of oracle.cases) {
    const got = ours(c.text);
    const want = c.emacs;
    const same = typeof want === 'string' ? typeof got === 'string' : JSON.stringify(got) === JSON.stringify(want);
    if (!same) bad.push({ text: c.text.length > 300 ? c.text.slice(0, 300) + '...' : c.text, got, want });
  }
  return bad;
}

test('org-lint gives the reports Emacs gives, except for the listed deviations', () => {
  const bad = differences().filter((c) => !lintRuleFor(c));
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.cases.length} differ without a known-deviation rule\n` + JSON.stringify(bad.slice(0, 3), null, 1));
});

test('every known-deviation rule still matches a case that differs', () => {
  const bad = differences();
  for (const r of LINT_RULES) assert.ok(bad.some((c) => lintRuleFor(c) === r), `rule "${r.id}" no longer matches a differing case: remove it`);
});
