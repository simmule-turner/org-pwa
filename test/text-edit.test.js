import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteLines, duplicateLines, indentLines, lineBounds, lineCount, lineNumberAt, lineRange, moveLines, newlineWithIndent } from '../src/text-edit.js';

/** @param {string} text @param {{ from: number, to: number, insert: string } | null} e */
const apply = (text, e) => (e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text);

test('lines', () => {
  const t = 'ab\ncde\n\nf';
  assert.deepEqual(lineBounds(t, 4), [3, 6]);
  assert.equal(lineNumberAt(t, 0), 1);
  assert.equal(lineNumberAt(t, 4), 2);
  assert.equal(lineNumberAt(t, t.length), 4);
  assert.equal(lineCount(t), 4);
  assert.deepEqual(lineRange(t, 2), { line: 2, start: 3, end: 6 });
  assert.deepEqual(lineRange(t, 99), { line: 4, start: 8, end: 9 });
  assert.deepEqual(lineRange(t, 0), { line: 1, start: 0, end: 2 });
});

test('Enter keeps the indentation of the line', () => {
  assert.equal(newlineWithIndent('  foo bar', 7), '\n  ');
  assert.equal(newlineWithIndent('foo', 3), '\n');
  assert.equal(newlineWithIndent('  foo', 1), '\n ');
});

test('indent and outdent', () => {
  const t = 'a\n  b\n\nc';
  const i = indentLines(t, 0, 5, 1);
  assert.equal(apply(t, i), '  a\n    b\n\nc');
  const o = indentLines('    a\n b\nc', 0, 9, -1);
  assert.equal(apply('    a\n b\nc', o), '  a\nb\nc');
  assert.equal(indentLines('a', 0, 1, -1), null);
});

test('duplicate, delete and move lines', () => {
  const t = 'a\nb\nc';
  assert.equal(apply(t, duplicateLines(t, 2, 2)), 'a\nb\nb\nc');
  assert.equal(apply(t, deleteLines(t, 2, 2)), 'a\nc');
  assert.equal(apply(t, deleteLines(t, 4, 4)), 'a\nb');
  assert.equal(apply('x', deleteLines('x', 0, 0)), '');
  assert.equal(apply(t, moveLines(t, 2, 2, -1)), 'b\na\nc');
  assert.equal(apply(t, moveLines(t, 2, 2, 1)), 'a\nc\nb');
  assert.equal(moveLines(t, 0, 0, -1), null);
  assert.equal(moveLines(t, 4, 4, 1), null);
  const sel = moveLines(t, 2, 2, -1);
  assert.equal(sel.selStart, 0);
});
