import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeSwitches, unravelCode, codeStart, newCodeCounter, resolveCodeRef, coderefText, formatCodePlain } from '../src/code-lines.js';
import { displayedLineNumber } from '../src/line-numbers.js';

// Expected values are what Emacs 29.3 (ox.el / org-element) gives for the same blocks.
test('switches follow org-element', () => {
  assert.deepEqual(parseCodeSwitches('-n').numberLines, { kind: 'new', n: 0 });
  assert.deepEqual(parseCodeSwitches('-n 10').numberLines, { kind: 'new', n: 9 });
  assert.deepEqual(parseCodeSwitches('+n 5').numberLines, { kind: 'continued', n: 4 });
  assert.equal(parseCodeSwitches('').numberLines, null);
  const r = parseCodeSwitches('-n -r');
  assert.equal(r.retainLabels, false);
  assert.equal(r.useLabels, false);
  const k = parseCodeSwitches('-n -k');
  assert.equal(k.retainLabels, true);
  assert.equal(k.useLabels, false);
  assert.equal(parseCodeSwitches('-r').retainLabels, false); // -r without -n: labels stay unless numbering
  assert.equal(parseCodeSwitches('-l "[ref:%s]"').labelFormat, '[ref:%s]');
  assert.equal(parseCodeSwitches('-n').useLabels, true);
});

test('unravel strips indentation and references', () => {
  const b = unravelCode(['    (a) (ref:x)', '      (b)'], '-n');
  assert.deepEqual(b.lines, ['(a)', '  (b)']);
  assert.equal(b.refs.get(1), 'x');
  assert.deepEqual(unravelCode(['  a', ' b'], '-i').lines, ['  a', ' b']);
  assert.equal(unravelCode(['x [ref:ly]'], '-l "[ref:%s]"').refs.get(1), 'ly');
});

test('numbering continues across blocks like org-export-get-loc', () => {
  const c = newCodeCounter();
  assert.equal(codeStart(c, parseCodeSwitches('-n'), 2), 0);
  assert.equal(codeStart(c, parseCodeSwitches('-n 10'), 2), 9);
  assert.equal(codeStart(c, parseCodeSwitches('+n 5'), 1), 15); // first number shown is 16
  assert.equal(codeStart(c, parseCodeSwitches(''), 3), null);
});

test('references resolve to a number or a label', () => {
  const mk = (/** @type {string[]} */ lines, /** @type {string} */ sw, /** @type {number | null} */ start) => ({ ...unravelCode(lines, sw), start });
  const blocks = [mk(['(a) (ref:sc)', '(b) (ref:jump)'], '-n -r', 0), mk(['(c) (ref:lab)'], '-n', 0)];
  assert.equal(resolveCodeRef(blocks, 'jump'), '2');
  assert.equal(resolveCodeRef(blocks, 'lab'), 'lab');
  assert.equal(resolveCodeRef(blocks, 'none'), null);
  assert.equal(coderefText('sc', '1', 'line (sc) here'), 'line 1 here');
  assert.equal(coderefText('sc', '1', 'the first'), 'the first');
});

test('plain text puts numbers left and labels six columns after the widest line', () => {
  assert.deepEqual(formatCodePlain({ ...unravelCode(['(foo) (ref:a)', '(bar) (ref:b)'], '-n'), }, 0), ['1  (foo)      (a)', '2  (bar)      (b)']);
  const ten = unravelCode(Array.from({ length: 10 }, (_, i) => `l${i + 1}`), '-n');
  assert.equal(formatCodePlain(ten, 0)[0], ' 1  l1');
  assert.equal(formatCodePlain(ten, 0)[9], '10  l10');
});

test('display-line-numbers types', () => {
  assert.equal(displayedLineNumber('absolute', 7, 3, 6, 2), 7);
  assert.equal(displayedLineNumber('relative', 7, 3, 4, 2), 4);
  assert.equal(displayedLineNumber('visual', 7, 3, 4, 2), 2);
  assert.equal(displayedLineNumber('relative', 3, 3, 2, 2), 3); // the current row keeps its number
  assert.equal(displayedLineNumber('relative', 7, 0, 4, -1), 7); // no current row
});

test('headingLineIndex agrees with findHeadingLineNumber', async () => {
  const { parseOrg, headingLineIndex, findHeadingLineNumber } = await import('../src/org-parser.js');
  const doc = parseOrg('#+TITLE: t\nintro\n* A\nSCHEDULED: <2026-01-01 Thu>\n:PROPERTIES:\n:ID: x\n:END:\nbody\n** B\ntext\ntext\n* C\n');
  const index = headingLineIndex(doc);
  const a = doc.children[0];
  assert.equal(index.lines.get(a)?.line, findHeadingLineNumber(doc, a));
  assert.equal(index.lines.get(a)?.bodyStart, 7);
  assert.equal(index.lines.get(doc.children[1])?.line, findHeadingLineNumber(doc, doc.children[1]));
});
