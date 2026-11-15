// Holds the *Org Lint* buffer's commands to Emacs 29.3: test/fixtures/org-lint-buffer-oracle.json was made by
// tools/gen-org-lint-buffer-oracle.mjs, which runs `h`, `i`, `S` and `g` of org-lint--report-mode on the reports of several texts and
// records the entries after every step, the categories and checker names `C-u M-x org-lint` and `C-u C-u M-x org-lint` offer, and the
// column each position of a report row is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orgLint, formatReports } from '../src/org-lint.js';
import { checkersOfCategory, columnAtOffset, hideChecker, ignoreChecker, lintBufferText, lintCategoryChoices, lintCheckerChoices, lintRowAtCaret, openLintBuffer, refreshReports, sortByColumn, LINT_COLUMNS } from '../src/org-lint-buffer.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-lint-buffer-oracle.json', import.meta.url), 'utf8'));
const options = {
  fileExists: (/** @type {string} */ f) => f === '/etc/passwd' || Object.hasOwn(oracle.files, f.replace(/^CWD\//, '')),
  attachmentFile: (/** @type {string} */ f) => 'CWD/' + f,
  readFile: (/** @type {string} */ f) => (Object.hasOwn(oracle.files, f.replace(/^CWD\//, '')) ? oracle.files[f.replace(/^CWD\//, '')] : null),
  idExists: () => false,
};

test('the categories and checker names the prefix argument offers are Emacs\'s', () => {
  assert.deepEqual(lintCategoryChoices(), oracle.categories);
  assert.deepEqual(lintCheckerChoices(), oracle.checkers);
  for (const [category, names] of Object.entries(oracle.byCategory)) assert.deepEqual(checkersOfCategory(category).sort(), [...names].sort(), `category "${category}"`);
});

test('h, i, S and g leave the entries Emacs leaves, step by step', () => {
  assert.ok(oracle.cases.length >= 100);
  for (const c of oracle.cases) {
    const reports = () => orgLint(c.text, buffer.names, options);
    const buffer = openLintBuffer(oracle.checkers, []);
    refreshReports(buffer, reports());
    const snapshot = () => ({ entries: buffer.entries.map((e) => [e.line, e.trust, e.message, e.checker]), ignored: oracle.checkers.filter((n) => !buffer.names.includes(n)).sort() });
    const want = (/** @type {any} */ s) => ({ entries: s.entries, ignored: [...s.ignored].sort() });
    assert.deepEqual(snapshot(), want(c.emacs[0]), 'start: ' + c.text.slice(0, 80));
    c.steps.forEach((/** @type {any[]} */ [kind, arg], i) => {
      const n = buffer.entries.length;
      const at = arg === 'last' ? n - 1 : arg === 'mid' ? Math.floor((n - 1) / 2) : arg;
      if (kind === 'g') refreshReports(buffer, reports());
      else if (kind === 'S') sortByColumn(buffer, at);
      else if (n > 0) (kind === 'h' ? hideChecker : ignoreChecker)(buffer, at);
      assert.deepEqual(snapshot(), want(c.emacs[i + 1]), `step ${i + 1} (${kind} ${arg}) of: ${c.text.slice(0, 80)}`);
    });
    const text = formatReports(buffer.entries.map((e, k) => ({ ...e, pos: k })));
    assert.equal(text.split('\n').slice(2).join('\n').trimEnd(), c.emacs[c.steps.length + 1].text.trimEnd());
  }
});

test('a position of a report row is in the column Emacs says', () => {
  const { length, columns } = oracle.row;
  for (let i = 0; i <= length; i++) assert.equal(columnAtOffset(i, length), columns[i] === null ? null : LINT_COLUMNS.indexOf(columns[i]), `offset ${i}`);
});

test('the report row of a caret is found below the two heading lines', () => {
  const buffer = openLintBuffer(oracle.checkers, orgLint('* A\n:PROPERTIES:\n:CUSTOM_ID: x\n:END:\n* B\n:PROPERTIES:\n:CUSTOM_ID: x\n:END:\n', null, options));
  const text = lintBufferText(buffer);
  const lines = text.split('\n');
  assert.equal(buffer.entries.length, 2);
  assert.equal(lintRowAtCaret(text, 3, 2), null, 'heading line');
  const second = text.indexOf(lines[3]);
  assert.deepEqual(lintRowAtCaret(text, second + 4, 2), { index: 1, offset: 4, length: lines[3].length, start: second });
  assert.equal(lintRowAtCaret(text, text.length, 2), null, 'after the last report');
});
